import React, { useId, useMemo } from "react";
import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from "remotion";

/**
 * MvTransitionSpin — 回転・渦トランジション家族（クリーンルーム実装）
 *
 * 機能: 回転のエネルギーで旧カットから新カットへ「叩き込む」MV用トランジション群。
 *       短尺の暴力的スピン2種と、フィルム質感を厚く盛る長尺ウィップ回転2種を
 *       variant / direction で切り替える。
 *
 * 家族の骨格:
 * - 黒ベタのステージ（回転で四隅が欠けても黒帯が走らない受け皿）の上に
 *   from / to を同じ座標系で重ね、その上に光（中央ラジアル・フラッシュ）、
 *   最上段に質感（粒子・ビネット）を積む。
 * - 全エフェクト強度は 0→1→0 のエンベロープ 1 本に乗る。短尺はほぼ三角、
 *   長尺は中盤にプラトーを持ち、尺の 85% までに歪みが消えて残りは完全静止。
 * - 回転の受け渡し: 旧は 0 から正方向へ回って抜け、新は負方向から 0 へ
 *   回り込む。同符号に見えるため 1 本の連続した回転運動としてつながる。
 * - 継ぎ目（不透明度クロス）は尺の 1〜2 割と短く、最大歪みの瞬間の下に隠す。
 *
 * 実装メモ:
 * - モーションブラー近似は 2 系統を使い分け:
 *   (a) 残像スタック: 同じ画を複数枚、角度とスケールを ± に散らして平均
 *       （回転ブラー＋放射ブラーが同時に出る。短尺スピン系で使用）
 *   (b) SVG 軸別ガウス: 水平優勢の stdDeviation を回転 transform より前に
 *       かけて、回転で曲がった渦状ブラーに見せる（長尺リボルブ系で使用）
 * - 回転角から「16:9 矩形が画面を覆い切る最小スケール」を三角関数で計算し
 *   scale の下限にする。シェイク余白とブラー時の縁滲み対策の微拡大も上乗せ。
 * - 色収差はチャンネル抽出（feColorMatrix）した赤 / 青の複製を逆方向へ
 *   オフセットして screen 合成。ずれ量もエンベロープに乗せる。
 * - 乱数はすべて種付きハッシュの決定論（Math.random 不使用）。
 *   シェイクは 2 フレームごとの粗い更新で「ガタつく」カメラにする。
 * - 外部素材・フォント・追加依存なし（CSS / SVG / remotion 標準のみ）。
 */

export interface MvTransitionSpinProps {
  /** 旧カット */
  from: React.ReactNode;
  /** 新カット */
  to: React.ReactNode;
  /** トランジション全体の長さ（フレーム） */
  durationInFrames: number;
  /** 回転方向。left/up は反時計回り、right/down は時計回り。
   *  forward は押し込みズーム強調、backward は旧カットが引いて抜ける */
  direction?: "left" | "right" | "up" | "down" | "forward" | "backward";
  /** 0..1 家族内の個体分岐（決定論的にモードとシードへ変換） */
  variant?: number;
}

// ---- 決定的乱数・イージング -------------------------------------------------

/** (a,b,c) から 0..1 の決定的な擬似乱数（sin ハッシュ） */
const rand = (a: number, b: number, c: number): number => {
  const s = Math.sin(a * 127.1 + b * 311.7 + c * 74.7) * 43758.5453123;
  return s - Math.floor(s);
};

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const smooth = (t: number) => {
  const x = clamp01(t);
  return x * x * (3 - 2 * x);
};
const easeInCubic = (t: number) => {
  const x = clamp01(t);
  return x * x * x;
};
const easeOutCubic = (t: number) => 1 - Math.pow(1 - clamp01(t), 3);

/** 中心 c・半幅 w の山（0..1） */
const bump = (t: number, c: number, w: number) =>
  Math.max(0, 1 - Math.abs((t - c) / w));

/**
 * 台形エンベロープ: [r0,r1] で滑らかに 0→1、[f0,f1] で滑らかに 1→0。
 * f1 以降は完全に 0（着地後の静止を保証する）。
 */
const riseFall = (
  p: number,
  r0: number,
  r1: number,
  f0: number,
  f1: number
): number => {
  if (p <= r0 || p >= f1) return 0;
  if (p < r1) return smooth((p - r0) / (r1 - r0));
  if (p > f0) return smooth((f1 - p) / (f1 - f0));
  return 1;
};

/** 回転角 deg の 16:9 矩形が 16:9 画面を覆い切る最小スケール */
const coverScale = (deg: number): number => {
  const r = (Math.abs(deg) * Math.PI) / 180;
  const c = Math.abs(Math.cos(r));
  const s = Math.abs(Math.sin(r));
  // 幅方向: (W·c + H·s)/W, 高さ方向: (W·s + H·c)/H  (W=16, H=9)
  return Math.max(c + (9 / 16) * s, (16 / 9) * s + c);
};

// ---- 個体（モード）設定 ------------------------------------------------------

type Cfg = {
  /** 旧カットの総回転量（turn, 1 = 360°） */
  turnsFrom: number;
  /** 新カットが逆側から回り込む量（turn） */
  turnsTo: number;
  /** ズームの性格 */
  zoom: "swell" | "punch" | "drift";
  /** swell/drift 時の膨張量、punch 時の押し込み倍率増分 */
  zoomAmt: number;
  /** 残像スタック枚数。0 なら SVG 軸別ブラー方式 */
  ghosts: number;
  /** 残像の角度散らし最大（deg） */
  ghostSpreadDeg: number;
  /** 残像のスケール散らし最大（比率） */
  ghostSpreadScale: number;
  /** 残像方式の仕上げガウスぼかし最大（px, 1920 基準） */
  finishBlur: number;
  /** SVG 方式の水平 stdDeviation 最大（px, 1920 基準） */
  dirBlur: number;
  /** クロス中心位置 0..1 と幅（尺比） */
  crossAt: number;
  crossW: number;
  /** 新カットの歪み・回転が消える進行位置（以降は完全静止） */
  settleAt: number;
  /** 強度エンベロープ */
  env: (p: number) => number;
  /** 白フラッシュのピーク量と色 */
  flashPeak: number;
  flashColor: string;
  /** 中央ラジアル発光の強さと色 */
  glow: number;
  glowColor: string;
  /** 色収差の最大ずれ（px, 1920 基準） */
  aberration: number;
  /** シェイク最大振幅（px, 1920 基準） */
  shakePx: number;
  /** フィルム粒子の不透明度（0 で無効） */
  grain: number;
  /** 周辺減光の濃さ */
  vignette: number;
  /** 中盤のカラーグレード（色相回し＋脱彩＋増光） */
  grade: boolean;
  /** ピンク〜紫の光漏れ（soft-light）＋暖色リーク */
  leak: boolean;
  /** 全尺かける緩い押し込みズーム量 */
  drift: number;
};

const buildCfg = (mode: number): Cfg => {
  // 短尺の共通形（0.4 秒級）: 回転・ズームが暴力的で、光は白 1 発。粒子・ビネットは薄い
  const short: Cfg = {
    turnsFrom: 1,
    turnsTo: 0.75,
    zoom: "swell",
    zoomAmt: 0.3,
    ghosts: 5,
    ghostSpreadDeg: 15,
    ghostSpreadScale: 0.07,
    finishBlur: 8,
    dirBlur: 0,
    crossAt: 0.5,
    crossW: 0.16,
    settleAt: 0.96,
    env: (p) => riseFall(p, 0, 0.46, 0.54, 0.96),
    flashPeak: 0.85,
    flashColor: "#ffffff",
    glow: 0.45,
    glowColor: "rgba(255,255,255,0.9)",
    aberration: 11,
    shakePx: 10,
    grain: 0,
    vignette: 0.22,
    grade: false,
    leak: false,
    drift: 0,
  };
  // 長尺の共通形（1 秒級）: 回転は演出の一部で、フィルム質感を厚く盛る。
  // エンベロープは中盤にプラトーを持ち、85% で歪みゼロ → 残りは静止
  const long: Cfg = {
    ...short,
    turnsFrom: 0.33,
    turnsTo: 0.28,
    zoomAmt: 0.16,
    ghosts: 0,
    finishBlur: 0,
    dirBlur: 95,
    crossW: 0.12,
    settleAt: 0.85,
    env: (p) => riseFall(p, 0.02, 0.3, 0.62, 0.85),
    flashPeak: 0.5,
    flashColor: "#fff6e8",
    glow: 0.35,
    glowColor: "rgba(255,236,206,0.85)",
    aberration: 8,
    shakePx: 8,
    grain: 0.1,
    vignette: 0.42,
    drift: 0.1,
  };
  switch (mode) {
    case 0:
      // 全画面スピン: フル 1 回転の大回し＋中心ラジアルブラー（残像のスケール散らし）
      return short;
    case 1:
      // 渦回転＋×3 急ズーム: 旧カットが回りながら 3 倍まで膨らんで抜け、
      // 新カットは縮んで着地。中央グローは暖色で強め
      return {
        ...short,
        turnsFrom: 0.85,
        turnsTo: 0.6,
        zoom: "punch",
        zoomAmt: 2,
        ghosts: 6,
        ghostSpreadDeg: 11,
        ghostSpreadScale: 0.11,
        finishBlur: 10,
        crossAt: 0.55,
        crossW: 0.14,
        flashPeak: 0.7,
        glow: 0.85,
        glowColor: "rgba(255,214,158,0.95)",
        aberration: 13,
        shakePx: 12,
        grain: 0.06,
        vignette: 0.3,
      };
    case 2:
      // 左回りウィップ回転＋ズームブラー: 渦状の方向ブラーに放射の残像を少量足し、
      // 中盤だけ色相を回すカラーグレードで「露出が暴れたフィルム」にする
      return {
        ...long,
        ghosts: 4,
        ghostSpreadDeg: 5,
        ghostSpreadScale: 0.09,
        finishBlur: 6,
        dirBlur: 0,
        grade: true,
      };
    case 3:
    default:
      // 右回りウィップ回転＋光漏れ: 水平優勢の SVG ブラーが回転で渦状に曲がり、
      // ピンク〜紫の光漏れと暖色リークをフィルム粒子の下に敷く
      return {
        ...long,
        turnsFrom: 0.36,
        dirBlur: 105,
        leak: true,
        grain: 0.12,
        vignette: 0.46,
      };
  }
};

// ---- 本体 --------------------------------------------------------------------

export const MvTransitionSpin: React.FC<MvTransitionSpinProps> = ({
  from,
  to,
  durationInFrames,
  direction = "left",
  variant = 0,
}) => {
  const frame = useCurrentFrame();
  const { width } = useVideoConfig();
  const rawId = useId();
  const uid = useMemo(() => rawId.replace(/[^a-zA-Z0-9_-]/g, ""), [rawId]);

  const k = width / 1920; // 解像度スケール
  const v = clamp01(variant);
  const mode = Math.min(3, Math.floor(v * 4));
  const seed = 29 + Math.floor(v * 991);
  const cfg = useMemo(() => buildCfg(mode), [mode]);

  const last = Math.max(1, durationInFrames - 1);
  const p = clamp01(frame / last);
  const env = cfg.env(p);

  // ---- 回転方向とズームバイアス ---------------------------------------------
  const sign = direction === "left" || direction === "up" ? -1 : 1;
  const zoomBias =
    direction === "forward" ? 1 : direction === "backward" ? -1 : 0;

  // ---- クロス（継ぎ目は最大歪みの下に隠す） ---------------------------------
  const cs = cfg.crossAt - cfg.crossW / 2;
  const ce = cfg.crossAt + cfg.crossW / 2;
  const toOp = interpolate(p, [cs, ce], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const fromProg = clamp01(p / ce);
  const toProg = clamp01((p - cs) / Math.max(0.05, cfg.settleAt - cs));

  // ---- 回転の受け渡し: 旧 0→+θ で抜け、新 -θ'→0 で回り込む ------------------
  const fromRot = sign * cfg.turnsFrom * 360 * easeInCubic(fromProg);
  const toRot = -sign * cfg.turnsTo * 360 * (1 - easeOutCubic(toProg));

  // ---- ズーム（膨らんで抜け、縮んで着地） -----------------------------------
  let fromScale: number;
  let toScale: number;
  if (cfg.zoom === "punch") {
    fromScale = 1 + cfg.zoomAmt * easeInCubic(fromProg);
    toScale = 1 + 0.5 * (1 - easeOutCubic(toProg));
  } else {
    fromScale = 1 + cfg.zoomAmt * easeInCubic(fromProg);
    toScale = 1 + cfg.zoomAmt * 0.7 * (1 - easeOutCubic(toProg));
  }
  if (zoomBias > 0) {
    fromScale += 0.25 * easeInCubic(fromProg);
  } else if (zoomBias < 0) {
    // 旧カットが引いて抜ける（黒ステージが受け皿になる）
    fromScale = Math.max(0.55, 1 - 0.35 * easeInCubic(fromProg));
  }

  // ---- シェイク（2 フレームごとの粗い更新でガタつかせる） --------------------
  const stepIdx = Math.floor(frame / 2);
  const shakeX = (rand(seed, stepIdx, 1) - 0.5) * 2 * cfg.shakePx * k * env;
  const shakeY =
    (rand(seed, stepIdx, 2) - 0.5) * 2 * cfg.shakePx * k * env * 0.8;

  // ---- ステージ全体の緩いドリフト（長尺個体のみ） ---------------------------
  const stageScale = 1 + cfg.drift * smooth(p);
  const driftX =
    cfg.drift > 0 ? (rand(seed, 0, 7) - 0.5) * 2 * 26 * k * smooth(p) : 0;
  const driftY =
    cfg.drift > 0 ? (rand(seed, 0, 8) - 0.5) * 2 * 16 * k * smooth(p) : 0;

  // ---- 発光・フラッシュ・色収差の量 -----------------------------------------
  // フラッシュはエンベロープ 3 乗相当で「頂点の一瞬だけ」に絞る
  const flashVal =
    cfg.flashPeak * Math.pow(bump(p, cfg.crossAt, 0.45), 3);
  const glowVal = cfg.glow * env;
  const abOff = cfg.aberration * k * env;

  // ---- カラーグレード（中盤だけ色相を回して彩度を落とし明度を上げる） --------
  const gradeEnv = cfg.grade ? bump(p, 0.5, 0.32) : 0;
  const gradeParts: string[] = [];
  if (gradeEnv > 0.01) {
    gradeParts.push(`hue-rotate(${(78 * gradeEnv).toFixed(1)}deg)`);
    gradeParts.push(`saturate(${(1 - 0.4 * gradeEnv).toFixed(3)})`);
  }
  gradeParts.push(
    `brightness(${(1 + 0.22 * gradeEnv + 0.1 * flashVal).toFixed(3)})`
  );
  const grade = gradeParts.join(" ");

  // ---- レイヤー描画 -----------------------------------------------------------
  // 回転角に応じた被覆スケール下限（シェイク余白＋ブラー縁滲み対策の微拡大込み）
  const coverOf = (deg: number, scale: number, allowUnder: boolean): number => {
    const need = coverScale(deg) * (1 + 0.025 + 0.12 * env);
    return allowUnder ? scale : Math.max(scale, need);
  };

  const dirBlurOn = cfg.ghosts === 0 && cfg.dirBlur * k * env > 0.4;

  const renderLayer = (
    node: React.ReactNode,
    rot: number,
    scale: number,
    opacity: number,
    allowUnder: boolean
  ): React.ReactNode => {
    if (opacity <= 0.001) return null;
    const eff = coverOf(rot, scale, allowUnder);
    if (cfg.ghosts > 0) {
      // 残像スタック方式: 角度とスケールを ± に散らした複製を積んで平均化。
      // i 枚目の不透明度 1/(i+1) の重ね合わせが算術平均になる
      const n = cfg.ghosts;
      const fb = cfg.finishBlur * k * env;
      return (
        <AbsoluteFill
          style={{
            opacity,
            filter: fb > 0.3 ? `blur(${fb.toFixed(1)}px)` : undefined,
          }}
        >
          {Array.from({ length: n }, (_, i) => {
            const d = n === 1 ? 0 : i / (n - 1) - 0.5;
            const ga = rot + d * cfg.ghostSpreadDeg * env;
            const gs = eff * (1 + d * cfg.ghostSpreadScale * env);
            return (
              <AbsoluteFill
                key={i}
                style={{
                  opacity: 1 / (i + 1),
                  transform: `rotate(${ga.toFixed(2)}deg) scale(${gs.toFixed(4)})`,
                }}
              >
                {node}
              </AbsoluteFill>
            );
          })}
        </AbsoluteFill>
      );
    }
    // SVG 軸別ブラー方式: ぼかしを回転より前（レイヤーローカル）にかけると
    // 回転で曲がって渦状のブラーに見える
    return (
      <AbsoluteFill
        style={{
          opacity,
          transform: `rotate(${rot.toFixed(2)}deg) scale(${eff.toFixed(4)})`,
        }}
      >
        <AbsoluteFill style={{ filter: dirBlurOn ? `url(#${uid}-db)` : undefined }}>
          {node}
        </AbsoluteFill>
      </AbsoluteFill>
    );
  };

  // ---- 色収差用: いま見えている側の単発複製（赤 / 青抽出を逆方向へずらす） ----
  const showTo = p >= cfg.crossAt;
  const abNode = showTo ? to : from;
  const abRot = showTo ? toRot : fromRot;
  const abScale = coverOf(
    abRot,
    showTo ? toScale : fromScale,
    !showTo && zoomBias < 0
  );
  const abOn = abOff > 0.5;

  // SVG 軸別ブラーの量（水平優勢。回転に乗って渦状に曲がる）
  const dbx = cfg.dirBlur * k * env;
  const dby = dbx * 0.18;

  return (
    <AbsoluteFill style={{ background: "#000", overflow: "hidden" }}>
      {/* フィルタ定義（軸別ブラー / チャンネル抽出 / 粒子） */}
      <svg width={0} height={0} style={{ position: "absolute" }} aria-hidden>
        <defs>
          <filter
            id={`${uid}-db`}
            x="-60%"
            y="-60%"
            width="220%"
            height="220%"
            colorInterpolationFilters="sRGB"
          >
            <feGaussianBlur
              stdDeviation={`${dbx.toFixed(2)} ${dby.toFixed(2)}`}
              edgeMode="duplicate"
            />
          </filter>
          <filter id={`${uid}-r`} colorInterpolationFilters="sRGB">
            <feColorMatrix
              type="matrix"
              values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0"
            />
          </filter>
          <filter id={`${uid}-b`} colorInterpolationFilters="sRGB">
            <feColorMatrix
              type="matrix"
              values="0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0"
            />
          </filter>
          <filter id={`${uid}-gr`}>
            <feTurbulence
              type="fractalNoise"
              baseFrequency="0.9"
              numOctaves={2}
              seed={seed + frame}
              stitchTiles="stitch"
            />
            <feColorMatrix type="saturate" values="0" />
          </filter>
        </defs>
      </svg>

      {/* ステージ（シェイク＋ドリフト＋グレード） */}
      <AbsoluteFill
        style={{
          transform: `translate(${(shakeX + driftX).toFixed(1)}px, ${(
            shakeY + driftY
          ).toFixed(1)}px) scale(${stageScale.toFixed(4)})`,
          filter: grade,
        }}
      >
        {/* 旧カット: 0 から正方向へ回って抜ける */}
        {toOp < 0.999 &&
          renderLayer(from, fromRot, fromScale, 1, zoomBias < 0)}
        {/* 新カット: 逆側から 0 へ回り込み、直立で着地 */}
        {renderLayer(to, toRot, toScale, toOp, false)}

        {/* 色収差: 赤 / 青抽出を逆方向へずらして screen 再合成（縁だけ色フリンジ） */}
        {abOn && (
          <>
            <AbsoluteFill
              style={{
                mixBlendMode: "screen",
                opacity: clamp01(env) * 0.75,
                transform: `translateX(${(-abOff).toFixed(1)}px) rotate(${abRot.toFixed(
                  2
                )}deg) scale(${abScale.toFixed(4)})`,
                filter: `url(#${uid}-r)`,
              }}
            >
              {abNode}
            </AbsoluteFill>
            <AbsoluteFill
              style={{
                mixBlendMode: "screen",
                opacity: clamp01(env) * 0.75,
                transform: `translateX(${abOff.toFixed(1)}px) rotate(${abRot.toFixed(
                  2
                )}deg) scale(${abScale.toFixed(4)})`,
                filter: `url(#${uid}-b)`,
              }}
            >
              {abNode}
            </AbsoluteFill>
          </>
        )}
      </AbsoluteFill>

      {/* 中央ラジアル発光（回転で潰れたハイライト） */}
      {glowVal > 0.02 && (
        <AbsoluteFill
          style={{
            background: `radial-gradient(circle at 50% 50%, ${cfg.glowColor} 0%, rgba(255,255,255,0) 58%)`,
            mixBlendMode: "screen",
            opacity: glowVal,
            pointerEvents: "none",
          }}
        />
      )}

      {/* ピンク〜紫の光漏れ（soft-light）＋暖色リーク */}
      {cfg.leak && (
        <>
          <AbsoluteFill
            style={{
              background:
                "linear-gradient(118deg, rgba(255,124,196,0.55) 8%, rgba(148,92,255,0.45) 46%, rgba(255,124,196,0) 78%)",
              mixBlendMode: "soft-light",
              opacity: riseFall(p, 0.08, 0.34, 0.6, 0.9),
              pointerEvents: "none",
            }}
          />
          <AbsoluteFill
            style={{
              background:
                "radial-gradient(circle at 86% 18%, rgba(255,196,128,0.8) 0%, rgba(255,196,128,0) 44%)",
              mixBlendMode: "screen",
              filter: `blur(${(30 * k).toFixed(1)}px)`,
              opacity: 0.8 * riseFall(p, 0.12, 0.4, 0.58, 0.88),
              pointerEvents: "none",
            }}
          />
        </>
      )}

      {/* フィルム粒子（毎フレーム seed 更新の fractalNoise を overlay 合成） */}
      {cfg.grain > 0 && (
        <AbsoluteFill
          style={{
            mixBlendMode: "overlay",
            opacity: cfg.grain * (0.45 + 0.55 * env),
            pointerEvents: "none",
          }}
        >
          <svg width="100%" height="100%">
            <rect width="100%" height="100%" filter={`url(#${uid}-gr)`} />
          </svg>
        </AbsoluteFill>
      )}

      {/* 周辺減光（中央の光との明暗コントラスト） */}
      {cfg.vignette > 0.02 && (
        <AbsoluteFill
          style={{
            background: `radial-gradient(ellipse at center, rgba(0,0,0,0) 52%, rgba(0,0,0,${cfg.vignette.toFixed(
              2
            )}) 100%)`,
            opacity: 0.55 + 0.45 * env,
            pointerEvents: "none",
          }}
        />
      )}

      {/* 白フラッシュ（頂点の一瞬だけ露出が飛ぶ） */}
      {flashVal > 0.005 && (
        <AbsoluteFill
          style={{
            background: cfg.flashColor,
            mixBlendMode: "screen",
            opacity: clamp01(flashVal),
            pointerEvents: "none",
          }}
        />
      )}
    </AbsoluteFill>
  );
};
