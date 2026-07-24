import React, { useId, useMemo } from "react";
import {
  AbsoluteFill,
  Easing,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

/**
 * MvTransitionOverexpose — 露出オーバー（白飛び）トランジション（クリーンルーム実装）
 *
 * 機能: 画面が光に飲まれて真っ白になった瞬間、下で旧カットと新カットをすり替える。
 * 進行: 前半＝旧カットが光と歪みに飲まれていく → 頂点＝真っ白ですり替え →
 *       後半＝新カットが同じ道を逆再生で戻ってくる（対称構造）。
 *
 * 設計メモ:
 * - 全効果（ブラー / 露出 / 色収差 / ズーム / ドリフト / 発光 / 白飛び / 揺れ）を
 *   一本の「中盤ピークの山型エンベロープ」で駆動する。両端 0、中央で 1。
 *   鋭さはべき乗で作る: 白飛びは 0.7 乗（頂点を広く）、光の芯は 1.5 乗（頂点だけ鋭く）、
 *   全面フラッシュは「エンベロープが半分を超えた分」を正規化して頂点付近に限定。
 * - from/to はクロス方式（to の不透明度だけ上げる）。束を丸ごと一つのラッパーに入れ、
 *   ラッパー側にフィルタとトランスフォームを掛ける（継ぎ目が同じ劣化をまとって見えなくなる）。
 * - 色収差は feColorMatrix でチャンネル分離した 3 層の screen 合成。
 *   R と B を効果の方向軸に沿って逆向きにオフセットし、オフセット 0 で元の色に完全復元。
 * - 光は screen 合成 4 段（芯 → ブルーム → 光条/ビーム → 全面白飛び）で階調を作る。
 * - 最上段はモノクロのフラクタルノイズ（overlay 合成、シードを毎フレーム更新）。
 * - 乱数は (seed, tick, index) から決定的に生成。Math.random は使わない。
 * - px 量はすべて基準幅 1920 比のスケール係数を乗算（解像度非依存）。
 * - エンベロープがほぼ 0 の端では重いフィルタ鎖を素通しに切り替える（性能対策）。
 */

export interface MvTransitionOverexposeProps {
  /** 旧カット */
  from: React.ReactNode;
  /** 新カット */
  to: React.ReactNode;
  /** トランジション全体の長さ（フレーム） */
  durationInFrames: number;
  /** 方向族のみ指定。省略時は方向なしの白飛び */
  direction?: "left" | "right" | "up" | "down" | "forward" | "backward";
  /**
   * 0..1 同家族内の見た目分岐（決定論的）。
   * 方向なしのとき: 0.5 未満 = 瞬殺型（純三角・強露出・純白）、
   *                 0.5 以上 = ソフト型（脱色して光に溶ける・広いすり替え窓）。
   * 方向ありのとき: 揺れ/ブラー/発光の微差シードとして効く。
   */
  variant?: number;
}

/** (a,b,c) から 0..1 の決定的な擬似乱数を返す */
const rand = (a: number, b: number, c: number): number => {
  const s = Math.sin(a * 127.1 + b * 311.7 + c * 74.7) * 43758.5453123;
  return s - Math.floor(s);
};

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** interpolate の入力レンジを厳密単調増加に矯正する保険 */
const monotonic = (points: number[]): number[] => {
  const out = points.slice();
  for (let i = 1; i < out.length; i++) {
    out[i] = Math.max(out[i], out[i - 1] + 1e-5);
  }
  return out;
};

type Mode = "burst" | "soft" | "dir";

export const MvTransitionOverexpose: React.FC<MvTransitionOverexposeProps> = ({
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
  const seed = useMemo(() => 11 + Math.floor(v * 997), [v]);
  const sw = width / 1920; // 幅基準スケール

  const mode: Mode = direction ? "dir" : v < 0.5 ? "burst" : "soft";

  const last = Math.max(1, durationInFrames - 1);
  const p = clamp01(frame / last);

  // ---- エンベロープ（一本の山型で全効果を駆動） ----------------------------
  // 瞬殺型はプラトーなしの純三角。長尺型は頂点がほんの一瞬のプラトーになる台形。
  const plateau = mode === "burst" ? 0 : 0.024;
  const env = interpolate(
    p,
    monotonic([0, 0.5 - plateau, 0.5 + plateau, 1]),
    [0, 1, 1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );
  const wash = Math.pow(env, 0.7); // 立ち上がり早く頂点広く（白の滞在時間を稼ぐ）
  const core = Math.pow(env, 1.5); // 頂点だけ鋭い光の芯
  const flashHi = clamp01((env - 0.5) / 0.5); // 頂点付近に限定した全面フラッシュ

  // ---- すり替え（白飛びの真下で行う短い不透明度ランプ） --------------------
  const swapWin: [number, number] =
    mode === "burst" ? [0.46, 0.54] : mode === "soft" ? [0.37, 0.75] : [0.43, 0.57];
  const toOpacity = interpolate(p, monotonic([swapWin[0], swapWin[1]]), [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: mode === "soft" ? Easing.inOut(Easing.sin) : Easing.inOut(Easing.cubic),
  });

  // ---- 方向パラメータ --------------------------------------------------------
  const dirX = direction === "left" ? -1 : direction === "right" ? 1 : 0;
  const dirY = direction === "up" ? -1 : direction === "down" ? 1 : 0;

  // ---- ラッパーのトランスフォーム（ズーム＋方向ドリフト＋微振動） ----------
  const zoomMax =
    mode === "burst"
      ? 0.09
      : mode === "soft"
        ? 0.015
        : direction === "down"
          ? 0.3 // 球面膨張（バルジ）のズーム近似
          : direction === "forward"
            ? 0.22
            : direction === "backward"
              ? -0.12
              : 0.12;
  const zoom = 1 + zoomMax * env;

  let driftX = dirX * width * 0.06 * env;
  let driftY = dirY * height * 0.06 * env;
  if (direction === "down") {
    // 下向きサージ（画面高の1割弱）
    driftY = height * 0.09 * Math.pow(env, 1.6);
  }
  if (direction === "up") {
    driftY = -height * 0.07 * env;
  }

  // 微振動: ハッシュ乱数を実フレームの2〜3倍速の整数チックで引き、エンベロープを振幅に掛ける
  const tick = Math.floor(frame * 2.5);
  const jitterAmp =
    mode === "burst"
      ? 11
      : mode === "soft"
        ? 5
        : direction === "left"
          ? 0.6 // 左方向型は揺れほぼ無し
          : direction === "right"
            ? 3.5
            : 5;
  // ソフト型は中盤だけ短い横揺れ
  const jitterGate = mode === "soft" ? clamp01((env - 0.6) / 0.4) : 1;
  const jShape = 0.85 + 0.3 * rand(seed, 3, 5); // variant 由来の個体差
  const jx = (rand(seed, tick, 21) - 0.5) * 2 * jitterAmp * env * jitterGate * sw * jShape;
  const jy =
    mode === "soft"
      ? 0
      : (rand(seed, tick, 22) - 0.5) * 2 * jitterAmp * 0.6 * env * sw * jShape;

  // ---- ラッパーのフィルタ（ブラー＋露出ブースト＋色グレーディング） --------
  const fxOn = env > 0.035; // 端では重いフィルタ鎖を素通し
  const blurBase =
    mode === "burst" ? 24 : mode === "soft" ? 13 : direction === "up" ? 24 : 16;
  // 方向付きは移動軸を強める非等方（上下型は縦優勢）
  const bx =
    (direction === "up" || direction === "down" ? blurBase * 0.25 : blurBase) *
    env *
    sw;
  const by =
    (direction === "left" || direction === "right"
      ? blurBase * 0.35
      : blurBase) *
    env *
    sw;

  const gradeParts: string[] = [];
  if (mode === "burst") {
    // 露出3倍相当まで押し切る
    gradeParts.push(`brightness(${(1 + env * 1.9).toFixed(3)})`);
    gradeParts.push(`contrast(${(1 + env * 0.06).toFixed(3)})`);
  } else if (mode === "soft") {
    // 頂点で大脱色（彩度ほぼゼロ）＝脱色して光に溶ける
    gradeParts.push(`brightness(${(1 + env * 1.05).toFixed(3)})`);
    gradeParts.push(`saturate(${(1 - env * 0.88).toFixed(3)})`);
  } else if (direction === "right") {
    // 右方向型: フッテージ側の色グレーディングは無し（露出＋ヘイズのみ）
    gradeParts.push(`brightness(${(1 + env * 1.15).toFixed(3)})`);
  } else {
    // 暖色オーバーエクスポーズ・グレーディング（露出2倍強＋セピア＋彩度アップ）
    gradeParts.push(`brightness(${(1 + env * 1.2).toFixed(3)})`);
    gradeParts.push(`sepia(${(env * (direction === "left" ? 0.5 : 0.42)).toFixed(3)})`);
    gradeParts.push(`saturate(${(1 + env * 0.4).toFixed(3)})`);
    if (direction === "left") {
      // ピンク寄りの色相微回転
      gradeParts.push(`hue-rotate(${(-14 * env).toFixed(1)}deg)`);
    }
  }
  const footageFilter = fxOn
    ? `url(#${uid}-blur) ${gradeParts.join(" ")}`
    : undefined;
  const footageTransform = `translate(${(driftX + jx).toFixed(2)}px, ${(
    driftY + jy
  ).toFixed(2)}px) scale(${zoom.toFixed(4)})`;

  // ---- 色収差（RGBチャンネル分離。分離軸は効果の方向に一致） ----------------
  // 左右型＝水平、上下型・瞬殺型＝垂直。ソフト型と下方向型は収差なし。
  const caAxis: "x" | "y" | null =
    mode === "soft" || direction === "down" || direction === "forward" || direction === "backward"
      ? null
      : mode === "burst" || direction === "up"
        ? "y"
        : "x";
  const caMaxPct = direction === "left" ? 0.003 : 0.005; // 画面幅の0.5%前後
  const caPx = caAxis ? caMaxPct * width * env : 0;
  const caOn = caAxis !== null && caPx > 0.6;
  const caT = (d: number) =>
    caAxis === "x" ? `translateX(${d.toFixed(2)}px)` : `translateY(${d.toFixed(2)}px)`;

  // ---- from/to の束（クロス方式。to の不透明度だけ上げる） ------------------
  // 上方向型のみ: すり替えに連動して from が上へ抜け、to が下から立ち上がる二段の縦押し
  const upPush = direction === "up" ? 5.5 * env : 0;
  const fromStyle: React.CSSProperties =
    upPush > 0.05
      ? { transform: `translateY(${(-toOpacity * upPush).toFixed(3)}%)` }
      : {};
  const toStyle: React.CSSProperties = {
    opacity: toOpacity,
    ...(upPush > 0.05
      ? { transform: `translateY(${((1 - toOpacity) * upPush).toFixed(3)}%)` }
      : {}),
  };
  // 注記(性能): 色収差が乗る間、この束は R/G/B の3層に計3回マウントされる。
  // 重い content を渡す場合は事前ラスタライズ（<Img>/<OffthreadVideo>）を推奨。
  const bundle = (
    <AbsoluteFill>
      <AbsoluteFill style={fromStyle}>{from}</AbsoluteFill>
      <AbsoluteFill style={toStyle}>{to}</AbsoluteFill>
    </AbsoluteFill>
  );

  // ---- 光のオーバーレイ群（screen 合成 4 段） --------------------------------
  // バーストの中心（方向型は走査する）
  let cx = 50;
  let cy = mode === "soft" ? 46 : 50;
  if (direction === "right") {
    // 白爆発の中心が全尺かけて 1/3 → 3/4 へ左から右に走査
    cx = 33 + p * 42;
  } else if (direction === "left") {
    cx = 66 - p * 40;
  } else if (direction === "up") {
    cy = 42 - env * 10;
  } else if (direction === "down") {
    cy = 62 + env * 10;
  }

  const isWarm = mode === "dir" && direction !== "right";
  const coreColor = isWarm ? "rgba(255,243,224,0.95)" : "rgba(255,255,255,0.95)";
  const bloomColor =
    mode === "soft"
      ? "rgba(255,244,229,0.8)" // 中央の暖白ブルーム
      : direction === "up" || direction === "down"
        ? "rgba(255,201,120,0.8)" // 黄→橙
        : isWarm
          ? "rgba(255,214,160,0.8)"
          : direction === "right"
            ? "rgba(255,228,240,0.7)" // ほんのりピンク
            : "rgba(228,238,255,0.7)"; // 淡いブルーム（瞬殺型はやや青白）

  // 白飛び平面: 瞬殺型・ソフト型は純白、方向付きは暖色寄りの白（クリーム）の全面グラデ
  const flashBg =
    mode === "dir"
      ? "linear-gradient(180deg, #fff8ea 0%, #ffffff 52%, #fff3dc 100%)"
      : "#ffffff";
  const flashOpacity =
    mode === "burst"
      ? clamp01(wash * 1.2) // 飽和気味に押し切る
      : mode === "soft"
        ? clamp01(wash * 0.98)
        : clamp01(Math.pow(flashHi, 0.8) * 1.05);

  const coreShape =
    direction === "up" || direction === "down"
      ? "ellipse 26% 52%" // 縦長ブルーム
      : "circle";

  // グレイン: 瞬殺型は常時薄く敷く、他はエンベロープ連動
  const grainOpacity =
    mode === "burst" ? 0.07 + env * 0.06 : clamp01(env * 0.12);
  const grainSeed = ((seed * 77 + frame * 13) % 9973) + 1;

  return (
    <AbsoluteFill style={{ background: "#000", overflow: "hidden" }}>
      {/* フィルタ定義（チャンネル分離＋非等方ガウスブラー） */}
      <svg width={0} height={0} style={{ position: "absolute" }} aria-hidden>
        <defs>
          <filter id={`${uid}-blur`} colorInterpolationFilters="sRGB">
            <feGaussianBlur
              stdDeviation={`${Math.max(0, bx).toFixed(2)} ${Math.max(0, by).toFixed(2)}`}
              edgeMode="duplicate"
            />
          </filter>
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
        </defs>
      </svg>

      {/* フッテージ束（ラッパーにフィルタ＋トランスフォームを一括で掛ける） */}
      <AbsoluteFill
        style={{ filter: footageFilter, transform: footageTransform }}
      >
        {caOn ? (
          <>
            {/* G: 据え置き層 */}
            <AbsoluteFill style={{ filter: `url(#${uid}-g)` }}>
              {bundle}
            </AbsoluteFill>
            {/* R / B: 方向軸に沿って逆向きへオフセット。整列時は screen で元の色に復元 */}
            <AbsoluteFill
              style={{
                filter: `url(#${uid}-r)`,
                mixBlendMode: "screen",
                transform: caT(-caPx),
              }}
            >
              {bundle}
            </AbsoluteFill>
            <AbsoluteFill
              style={{
                filter: `url(#${uid}-b)`,
                mixBlendMode: "screen",
                transform: caT(caPx),
              }}
            >
              {bundle}
            </AbsoluteFill>
          </>
        ) : (
          bundle
        )}
      </AbsoluteFill>

      {/* --- 光のオーバーレイ群（下から: 芯 → ブルーム → 光条/ビーム → 全面白） --- */}

      {/* 中心の白コア（放射グラデ） */}
      {core > 0.01 && (
        <AbsoluteFill
          style={{
            mixBlendMode: "screen",
            opacity: clamp01(core * 0.95),
            background: `radial-gradient(${coreShape} at ${cx.toFixed(1)}% ${cy.toFixed(
              1
            )}%, ${coreColor} 0%, rgba(255,255,255,0) ${(
              22 +
              core * 16
            ).toFixed(1)}%)`,
          }}
        />
      )}

      {/* 広がる淡いブルーム */}
      {wash > 0.02 && (
        <AbsoluteFill
          style={{
            mixBlendMode: "screen",
            opacity: clamp01(wash * 0.8),
            background: `radial-gradient(${coreShape} at ${cx.toFixed(1)}% ${cy.toFixed(
              1
            )}%, ${bloomColor} 0%, rgba(255,255,255,0) ${(
              direction === "down"
                ? 38 + p * 42 // 拡張し続ける下寄りブルーム
                : 46 + wash * 22
            ).toFixed(1)}%)`,
          }}
        />
      )}

      {/* 光条（右方向型: 中心からの繰り返し円錐グラデの白スポーク） */}
      {direction === "right" && core > 0.03 && (
        <AbsoluteFill
          style={{
            mixBlendMode: "screen",
            opacity: clamp01(core * 0.8),
            background: `repeating-conic-gradient(from ${(p * 9).toFixed(
              2
            )}deg at ${cx.toFixed(1)}% ${cy.toFixed(1)}%, rgba(255,255,255,0.32) 0deg 1.7deg, rgba(255,255,255,0) 1.7deg 6.8deg)`,
          }}
        />
      )}

      {/* 収差フリンジ対（右方向型: ピンク/シアンをバースト中心の左右に） */}
      {direction === "right" && core > 0.03 && (
        <>
          <AbsoluteFill
            style={{
              mixBlendMode: "screen",
              opacity: clamp01(core * 0.55),
              background: `radial-gradient(circle at ${(cx - 4.5).toFixed(1)}% ${cy.toFixed(
                1
              )}%, rgba(255,96,190,0.4) 0%, rgba(255,96,190,0) 30%)`,
            }}
          />
          <AbsoluteFill
            style={{
              mixBlendMode: "screen",
              opacity: clamp01(core * 0.55),
              background: `radial-gradient(circle at ${(cx + 4.5).toFixed(1)}% ${cy.toFixed(
                1
              )}%, rgba(96,224,255,0.4) 0%, rgba(96,224,255,0) 30%)`,
            }}
          />
        </>
      )}

      {/* 縦ビーム（上方向型: 縦縞の繰り返し線形グラデを「上ほど濃い」マスクで切る） */}
      {direction === "up" && wash > 0.03 && (
        <AbsoluteFill
          style={{
            mixBlendMode: "screen",
            opacity: clamp01(wash * 0.7),
            background: `repeating-linear-gradient(90deg, rgba(255,236,198,0.32) 0px ${(
              6 * sw
            ).toFixed(1)}px, rgba(255,236,198,0) ${(6 * sw).toFixed(1)}px ${(
              28 * sw
            ).toFixed(1)}px)`,
            WebkitMaskImage:
              "linear-gradient(180deg, rgba(0,0,0,1) 0%, rgba(0,0,0,0) 72%)",
            maskImage:
              "linear-gradient(180deg, rgba(0,0,0,1) 0%, rgba(0,0,0,0) 72%)",
          }}
        />
      )}

      {/* 橙のビネット（上方向型） */}
      {direction === "up" && wash > 0.03 && (
        <AbsoluteFill
          style={{
            mixBlendMode: "overlay",
            opacity: clamp01(wash * 0.55),
            background:
              "radial-gradient(ellipse at 50% 45%, rgba(0,0,0,0) 52%, rgba(255,126,32,0.6) 100%)",
          }}
        />
      )}

      {/* 橙の全面かぶせ（下方向型） */}
      {direction === "down" && wash > 0.03 && (
        <AbsoluteFill
          style={{
            mixBlendMode: "overlay",
            opacity: clamp01(wash * 0.5),
            background: "rgba(255,142,40,0.55)",
          }}
        />
      )}

      {/* 全面白飛びの平面（頂点でほぼ不透明） */}
      {flashOpacity > 0.003 && (
        <AbsoluteFill
          style={{
            mixBlendMode: "screen",
            opacity: flashOpacity,
            background: flashBg,
          }}
        />
      )}

      {/* フィルムグレイン（モノクロのフラクタルノイズ、シードを毎フレーム更新） */}
      {grainOpacity > 0.01 && (
        <svg
          width="100%"
          height="100%"
          style={{
            position: "absolute",
            inset: 0,
            mixBlendMode: "overlay",
            opacity: grainOpacity,
            pointerEvents: "none",
          }}
          aria-hidden
        >
          <filter id={`${uid}-grain`}>
            <feTurbulence
              type="fractalNoise"
              baseFrequency="0.9"
              numOctaves={2}
              seed={grainSeed}
              stitchTiles="stitch"
            />
            <feColorMatrix type="saturate" values="0" />
          </filter>
          <rect width="100%" height="100%" filter={`url(#${uid}-grain)`} />
        </svg>
      )}
    </AbsoluteFill>
  );
};
