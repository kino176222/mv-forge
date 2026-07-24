import React, { useId, useMemo } from "react";
import {
  AbsoluteFill,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

/**
 * MvTransitionShakeImpact — 衝撃シェイク系トランジション（クリーンルーム実装）
 *
 * 旧カット→新カットの切替を「衝撃」で誤魔化す家族。ブラーと揺れの頂点の陰で
 * 絵を入れ替えるのが本質。from / to を1枚の「カメラ層」に束ね、
 * translate / rotate / scale とブラー系 filter をカメラ層にまとめて掛けることで
 * 「1台のカメラが殴られた」感を出す。
 *
 * variant (0..1) で家族内の 4 つの見た目に分岐する:
 * - [0.00, 0.25) handheld … 手ブレ包絡＋ズームパルス＋プリズム色収差。家族最長向け
 * - [0.25, 0.50) rumble   … 最短・最シンプル。異方性ブラーの方位が毎フレーム暴れる
 * - [0.50, 0.75) smash    … 頂点が前寄り(p=0.2)。横一方向の強スメア＋明度リフト。
 *                            to を下に敷き from を前面フェードアウトする逆式
 * - [0.75, 1.00] whip     … ウィップパン型。斜め軸に from が抜け to が入る＋2倍ズーム。
 *                            ブラーはゴーストクローン式、イージングは加速→減速
 *
 * 設計メモ:
 * - 乱数はすべて (seed, frame, channel) の決定論ハッシュ。Math.random 不使用
 * - 全効果（揺れ/ブラー/ズーム/フラッシュ）は共通の三角エンベロープ 1 本で同期
 * - クロスフェード窓はエンベロープ頂点をまたぐ（一番見えない瞬間に絵が替わる）
 * - 数値は基準横幅 1920 に対する比率で持ち、実解像度で線形スケール
 * - 揺れ・回転で黒縁が出ないよう、エンベロープ比例のオーバースキャン拡大を仕込む
 *   （両端では 1.0 に収束し、前後カットへ静止で受け渡す）
 * - filter がほぼゼロの時は filter 自体を外す（無駄なラスタライズ回避）
 */

export interface MvTransitionShakeImpactProps {
  /** 旧カット */
  from: React.ReactNode;
  /** 新カット */
  to: React.ReactNode;
  /** トランジション全体の長さ（フレーム） */
  durationInFrames: number;
  /** 方向族のみ有効（smash: スメア軸 / whip: パン軸。省略時 whip は斜め60度） */
  direction?: "left" | "right" | "up" | "down" | "forward" | "backward";
  /** 0..1 で家族内の見た目分岐（決定論的） */
  variant?: number;
}

/** (a,b,c) から 0..1 の決定的な擬似乱数（GLSL 定番ハッシュ） */
const rand = (a: number, b: number, c: number): number => {
  const s = Math.sin(a * 127.1 + b * 311.7 + c * 74.7) * 43758.5453123;
  return s - Math.floor(s);
};

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** -1..1 の決定的乱数 */
const srand = (a: number, b: number, c: number) => rand(a, b, c) * 2 - 1;

/** 三角エンベロープ（0→1→0、頂点 peak） */
const tri = (p: number, peak: number): number => {
  const q = clamp01(p);
  return q <= peak
    ? q / Math.max(peak, 1e-4)
    : (1 - q) / Math.max(1 - peak, 1e-4);
};

const easeInCubic = (t: number) => {
  const q = clamp01(t);
  return q * q * q;
};

const easeOutCubic = (t: number) => {
  const q = clamp01(t);
  const inv = 1 - q;
  return 1 - inv * inv * inv;
};

type Kind = "handheld" | "rumble" | "smash" | "whip";

const kindOf = (v: number): Kind =>
  v < 0.25 ? "handheld" : v < 0.5 ? "rumble" : v < 0.75 ? "smash" : "whip";

export const MvTransitionShakeImpact: React.FC<MvTransitionShakeImpactProps> = ({
  from,
  to,
  durationInFrames,
  direction,
  variant = 0,
}) => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const rawId = useId();
  const uid = useMemo(() => rawId.replace(/[^a-zA-Z0-9_-]/g, ""), [rawId]);

  const v = clamp01(variant);
  const kind = kindOf(v);
  // 同一バンド内でも variant で微差が出るように（振幅 ±15% とシード）
  const bandT = clamp01((v - (kind === "handheld" ? 0 : kind === "rumble" ? 0.25 : kind === "smash" ? 0.5 : 0.75)) / 0.25);
  const ampMul = 0.85 + 0.3 * bandT;
  const seed = 13 + Math.floor(v * 1000) * 7;

  const last = Math.max(1, durationInFrames - 1);
  const p = clamp01(frame / last);
  const rs = width / 1920; // 解像度スケール（フルHD横基準）

  // 頂点位置: smash だけ極端に前寄り（先に殴ってから余韻）
  const peak = kind === "smash" ? 0.2 : 0.5;
  const env = tri(p, peak); // 共通三角エンベロープ
  const flashTri = Math.pow(env, 2.2); // フラッシュは頂点近傍だけ鋭く

  // ---- 揺れ（決定論ハッシュ乱数・3チャンネル独立） -------------------------
  const shakeSpec: Record<Kind, { x: number; y: number; rot: number }> = {
    handheld: { x: 0.032, y: 0.024, rot: 2.0 },
    rumble: { x: 0.05, y: 0.038, rot: 3.5 },
    smash: { x: 0.045, y: 0.014, rot: 1.2 },
    whip: { x: 0.012, y: 0.01, rot: 0.8 },
  };
  const spec = shakeSpec[kind];

  // handheld は多点折れ線の手ブレ包絡（他は素の三角形）
  const envMain =
    kind === "handheld"
      ? interpolate(
          p,
          [0, 0.12, 0.3, 0.5, 0.62, 0.8, 1],
          [0, 0.55, 0.75, 1, 0.8, 0.4, 0],
          { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
        )
      : env;

  let shakeX = srand(seed, frame, 11) * spec.x * width * envMain * ampMul;
  let shakeY = srand(seed, frame, 12) * spec.y * width * envMain * ampMul;
  const rot = srand(seed, frame, 13) * spec.rot * envMain * ampMul;

  // handheld には低周波の「持ち手のうねり」を重ねる（ガタガタ＋ゆらゆらの二層）
  if (kind === "handheld") {
    const ph1 = rand(seed, 0, 21) * Math.PI * 2;
    const ph2 = rand(seed, 0, 22) * Math.PI * 2;
    shakeX += Math.sin(p * Math.PI * 2 * 1.7 + ph1) * spec.x * width * 0.5 * envMain;
    shakeY += Math.sin(p * Math.PI * 2 * 2.3 + ph2) * spec.y * width * 0.5 * envMain;
  }

  // ---- クロスフェード（頂点をまたぐ窓・幅2割強） ---------------------------
  const fadeHalf = 0.12;
  const toOpacity =
    kind === "smash" || kind === "whip"
      ? 1 // smash: to は下敷き / whip: 位置で入れ替える
      : interpolate(p, [peak - fadeHalf, peak + fadeHalf], [0, 1], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        });
  // smash は逆式: 前面の from をフェードアウト
  const fromOpacity =
    kind === "smash"
      ? interpolate(p, [peak - 0.1, peak + 0.12], [1, 0], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        })
      : 1;

  // ---- ズーム＋オーバースキャン（黒縁防止。両端で 1.0 に収束） -------------
  let zoom = 1;
  if (kind === "handheld") {
    // 中盤で 1.5 倍まで膨らむズームパルス
    zoom = 1 + 0.08 * envMain + 0.42 * Math.pow(tri(p, 0.5), 1.2);
  } else if (kind === "rumble") {
    zoom = 1 + 0.12 * env + 0.06 * env; // ズームパンチは1割程度＋揺れ分の余白
  } else if (kind === "smash") {
    zoom = 1 + 0.1 * env + 0.08 * env;
  } else {
    // whip: 頂点へ加速(ease-in)→頂点後は減速(ease-out)で戻る 2倍ズーム
    const zIn = easeInCubic(p / peak);
    const zOut = easeOutCubic((p - peak) / (1 - peak));
    zoom = 1 + 0.05 * env + (p <= peak ? 1.0 * zIn : 1.0 * (1 - zOut));
  }

  // ---- 方向の解決 -----------------------------------------------------------
  // whip: パン軸。省略時はこの型の署名である斜め60度
  const whipAngleDeg =
    direction === "right"
      ? 0
      : direction === "left"
        ? 180
        : direction === "down"
          ? 90
          : direction === "up"
            ? 270
            : direction === "backward"
              ? 240
              : 60;
  const whipRad = (whipAngleDeg * Math.PI) / 180;
  const ux = Math.cos(whipRad);
  const uy = Math.sin(whipRad);
  // smash: スメア軸（左右=横 / 上下=縦）
  const smashVertical = direction === "up" || direction === "down";
  const smashSign = direction === "left" || direction === "up" ? -1 : 1;

  // ---- ブラー（質感の手続き） ------------------------------------------------
  let cameraFilter: string | undefined;
  let anisoX = 0;
  let anisoY = 0;

  if (kind === "handheld") {
    // 等方ブラー（急ズーム時のズームブラー近似）
    const b = 22 * rs * Math.pow(envMain, 1.3) * ampMul;
    cameraFilter = b > 0.4 ? `blur(${b.toFixed(2)}px)` : undefined;
  } else if (kind === "rumble") {
    // 異方性ガウス。方位が毎フレーム乱数で暴れるのが個性
    const maxB = 40 * rs * env * ampMul;
    const theta = rand(seed, frame, 41) * Math.PI * 2;
    anisoX = maxB * Math.abs(Math.cos(theta));
    anisoY = maxB * Math.abs(Math.sin(theta));
    cameraFilter =
      anisoX + anisoY > 0.6 ? `url(#${uid}-aniso)` : undefined;
  } else if (kind === "smash") {
    // 横:縦 ≒ 7:1 の強烈な一方向スメア＋明度リフト（露出オーバー）
    const main = 110 * rs * env * ampMul;
    const crossAxis = main / 7;
    anisoX = smashVertical ? crossAxis : main;
    anisoY = smashVertical ? main : crossAxis;
    const lift = 1 + 0.5 * flashTri;
    const parts: string[] = [];
    if (anisoX + anisoY > 0.6) parts.push(`url(#${uid}-aniso)`);
    if (lift > 1.01) parts.push(`brightness(${lift.toFixed(3)})`);
    cameraFilter = parts.length > 0 ? parts.join(" ") : undefined;
  } else {
    // whip: ブラーはゴーストクローン式（filter なし）。明度だけ軽く持ち上げ
    const lift = 1 + 0.3 * flashTri;
    cameraFilter = lift > 1.01 ? `brightness(${lift.toFixed(3)})` : undefined;
  }

  const needAniso = (kind === "rumble" || kind === "smash") && anisoX + anisoY > 0.6;

  // ---- プリズム色収差（handheld 専用） ---------------------------------------
  // R を＋横 / B を−横 に数px ずらし、screen で再合成（頂点で画面幅の0.5%）
  const aberration = kind === "handheld" ? 0.005 * width * envMain * ampMul : 0;
  const aberrationOn = aberration > 0.75;

  // ---- smash のショブ（殴られた方向へ画面ごと小突く） -------------------------
  if (kind === "smash") {
    const shove = 0.02 * width * env * smashSign;
    if (smashVertical) {
      shakeY += shove;
    } else {
      shakeX += shove;
    }
  }

  // ---- from / to の重ね（家族標準: from 下・to 上。smash のみ逆） -------------
  // 最終フレームを完全にクリーンな絵で終えるため、不要になった側はアンマウント
  let stack: React.ReactNode;
  if (kind === "smash") {
    stack = (
      <AbsoluteFill>
        <AbsoluteFill>{to}</AbsoluteFill>
        {fromOpacity > 0.001 && (
          <AbsoluteFill style={{ opacity: fromOpacity }}>{from}</AbsoluteFill>
        )}
      </AbsoluteFill>
    );
  } else if (kind === "whip") {
    // ウィップパン: from は加速して軸方向へ抜け、to は逆側から減速して止まる
    const travelX = 1.15 * width * ux;
    const travelY = 1.15 * height * uy;
    const tFrom = easeInCubic(p / (peak + 0.06));
    const tTo = easeOutCubic((p - (peak - 0.06)) / (1 - peak + 0.06));
    const fromX = -travelX * tFrom;
    const fromY = -travelY * tFrom;
    const toX = travelX * (1 - tTo);
    const toY = travelY * (1 - tTo);

    // ゴーストクローン式ストリーク: 進行方向±に等間隔クローン、遠いほど淡く。
    // ベース1枚は不透明のまま残す（全部半透明にすると下層が透ける）
    const gap = 0.045 * width * env * ampMul;
    const ghostsOn = gap > 4;
    const ghostOffsets = [-2, -1, 1, 2];
    const ghostOpacity = (k: number) => (Math.abs(k) === 1 ? 0.26 : 0.13);

    const withGhosts = (
      node: React.ReactNode,
      cx: number,
      cy: number
    ): React.ReactNode => (
      <AbsoluteFill>
        {ghostsOn &&
          ghostOffsets.map((k) => (
            <AbsoluteFill
              key={k}
              style={{
                transform: `translate(${(cx + ux * gap * k).toFixed(1)}px, ${(
                  cy + uy * gap * k
                ).toFixed(1)}px)`,
                opacity: ghostOpacity(k),
              }}
            >
              {node}
            </AbsoluteFill>
          ))}
        <AbsoluteFill
          style={{ transform: `translate(${cx.toFixed(1)}px, ${cy.toFixed(1)}px)` }}
        >
          {node}
        </AbsoluteFill>
      </AbsoluteFill>
    );

    const showFrom = p < peak + 0.1;
    const showTo = p > peak - 0.2;
    stack = (
      <AbsoluteFill>
        {showFrom && withGhosts(from, fromX, fromY)}
        {showTo && withGhosts(to, toX, toY)}
      </AbsoluteFill>
    );
  } else {
    stack = (
      <AbsoluteFill>
        {toOpacity < 0.999 && <AbsoluteFill>{from}</AbsoluteFill>}
        {toOpacity > 0.001 && (
          <AbsoluteFill style={{ opacity: toOpacity }}>{to}</AbsoluteFill>
        )}
      </AbsoluteFill>
    );
  }

  // ---- カメラ層の transform（オーバースキャンはエンベロープ比例で黒縁防止） ---
  const cameraTransform = `translate(${shakeX.toFixed(1)}px, ${shakeY.toFixed(
    1
  )}px) rotate(${rot.toFixed(3)}deg) scale(${zoom.toFixed(4)})`;

  // ---- 白フラッシュ（screen・控えめな三角パルス） ------------------------------
  const flashMax =
    kind === "handheld" ? 0.18 : kind === "rumble" ? 0.1 : kind === "smash" ? 0.22 : 0.28;
  const flashOpacity = flashMax * flashTri;

  // ---- whip 専用: 青みの銀グロー（ストリーク軸に直交する帯・screen） -----------
  const glowOpacity = kind === "whip" ? 0.45 * Math.pow(env, 1.5) : 0;

  return (
    <AbsoluteFill style={{ background: "#000", overflow: "hidden" }}>
      {/* フィルタ定義（必要なモードでだけ生成） */}
      <svg width={0} height={0} style={{ position: "absolute" }} aria-hidden>
        <defs>
          {needAniso && (
            <filter
              id={`${uid}-aniso`}
              x="-60%"
              y="-60%"
              width="220%"
              height="220%"
              colorInterpolationFilters="sRGB"
            >
              <feGaussianBlur
                stdDeviation={`${anisoX.toFixed(2)} ${anisoY.toFixed(2)}`}
                edgeMode="duplicate"
              />
            </filter>
          )}
          {aberrationOn && (
            <>
              <filter id={`${uid}-r`} colorInterpolationFilters="sRGB">
                <feColorMatrix
                  type="matrix"
                  values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0"
                />
              </filter>
              <filter id={`${uid}-g`} colorInterpolationFilters="sRGB">
                <feColorMatrix
                  type="matrix"
                  values="0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0"
                />
              </filter>
              <filter id={`${uid}-b`} colorInterpolationFilters="sRGB">
                <feColorMatrix
                  type="matrix"
                  values="0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0"
                />
              </filter>
            </>
          )}
        </defs>
      </svg>

      {/* カメラ層: from/to を束ね、揺れ・ズーム・ブラーをまとめて掛ける */}
      <AbsoluteFill
        style={{
          transform: cameraTransform,
          filter: cameraFilter,
        }}
      >
        {aberrationOn ? (
          <>
            {/* G: 基準層。R/B は横ずらしの screen 合成（整列部は元の色に戻る） */}
            <AbsoluteFill style={{ filter: `url(#${uid}-g)` }}>{stack}</AbsoluteFill>
            <AbsoluteFill
              style={{
                filter: `url(#${uid}-r)`,
                mixBlendMode: "screen",
                transform: `translateX(${aberration.toFixed(1)}px)`,
              }}
            >
              {stack}
            </AbsoluteFill>
            <AbsoluteFill
              style={{
                filter: `url(#${uid}-b)`,
                mixBlendMode: "screen",
                transform: `translateX(${(-aberration).toFixed(1)}px)`,
              }}
            >
              {stack}
            </AbsoluteFill>
          </>
        ) : (
          stack
        )}
      </AbsoluteFill>

      {/* whip: わずかに青みの銀グロー。ストリーク軸に直交する帯状グラデ */}
      {glowOpacity > 0.01 && (
        <AbsoluteFill
          style={{
            top: "-20%",
            left: "-20%",
            right: "-20%",
            bottom: "-20%",
            width: "auto",
            height: "auto",
            background: `linear-gradient(${(whipAngleDeg + 90).toFixed(0)}deg, transparent 30%, rgba(185, 202, 232, 0.85) 50%, transparent 70%)`,
            mixBlendMode: "screen",
            opacity: glowOpacity,
            pointerEvents: "none",
          }}
        />
      )}

      {/* 衝撃フラッシュ（露出オーバー分・screen） */}
      {flashOpacity > 0.005 && (
        <AbsoluteFill
          style={{
            background: "#ffffff",
            mixBlendMode: "screen",
            opacity: flashOpacity,
            pointerEvents: "none",
          }}
        />
      )}
    </AbsoluteFill>
  );
};
