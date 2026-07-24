import React, { useId, useMemo } from "react";
import {
  AbsoluteFill,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

/**
 * MvTransitionZoomPunch — ズームパンチ系トランジション（クリーンルーム実装）
 *
 * 骨格（3幕構成）:
 *   前半: 旧カットが手前へ急拡大して視界を突き抜ける
 *   中央: ブラー / 暗転 / 白フラッシュの頂点の裏で新カットへ差し替え
 *   後半: 新カットが過剰スケールから等倍へ減速して着地
 *
 * 設計メモ:
 * - 放射状ズームブラーは本物のブラーではなく、同じ絵をスケール違いに複製して
 *   1/(i+1) の不透明度で積層する古典近似。積層の縞は薄いガウスぼかしで均す。
 * - variant (0..1) で家族内の 8 つの見た目へ決定論的に分岐する。
 * - 乱数はすべて (seed, frame, index) の決定的ハッシュ。Math.random 不使用。
 * - px 量は基準幅 1920 に対する比率で持ち、実描画時に幅比を掛ける（解像度非依存）。
 * - 先頭フレームは素の from、最終フレームは素の to（隣接クリップへクリーンに渡す契約）。
 * - 色収差は feColorMatrix で G を本体、R / B を薄いオフセット層として screen 再合成。
 *   ずれ量ゼロなら分離しない設計で端をクリーンに保つ。
 */

export interface MvTransitionZoomPunchProps {
  /** 旧カット */
  from: React.ReactNode;
  /** 新カット */
  to: React.ReactNode;
  /** トランジション全体の長さ（フレーム） */
  durationInFrames: number;
  /** 進行方向。forward=突っ込む / backward=引き戻る / 上下左右=軸パンチ */
  direction?: "left" | "right" | "up" | "down" | "forward" | "backward";
  /** 0..1 家族内の見た目分岐（決定論的） */
  variant?: number;
}

/** (a,b,c) から 0..1 の決定的な擬似乱数を返す（GLSL の定番ハッシュ） */
const rand = (a: number, b: number, c: number): number => {
  const s = Math.sin(a * 127.1 + b * 311.7 + c * 74.7) * 43758.5453123;
  return s - Math.floor(s);
};

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** 三角パルス: 0 → (peak で 1) → 0 */
const tri = (p: number, peak: number): number => {
  const a = Math.min(Math.max(peak, 0.02), 0.98);
  return clamp01(p <= a ? p / a : (1 - p) / (1 - a));
};

const CLAMP = {
  extrapolateLeft: "clamp",
  extrapolateRight: "clamp",
} as const;

type BlurMode = "radialSym" | "radialOut" | "horizontal" | "none";

type StyleConfig = {
  /** 旧カットの最終スケール（forward 基準。backward 時は逆数を使う） */
  fromScaleEnd: number;
  /** 新カットの開始スケール（forward 基準） */
  toScaleStart: number;
  /** 進行度の2乗で加速するズーム（突進感） */
  quadZoom: boolean;
  /** 差し替え中心 / 片側幅（進行度） */
  swapCenter: number;
  swapWidth: number;
  /** ブラー積層の型と広がり（radial: スケール差 / horizontal: 幅% ） */
  blurMode: BlurMode;
  blurSpread: number;
  blurPeakAt: number;
  /** 積層の縞を均すガウス（頂点で幅の%） */
  gaussPct: number;
  /** シェイク振幅（幅の%）と包絡の形 */
  shakePct: number;
  shakeShape: "tri" | "burst" | "twoHump";
  /** グレイン */
  grain: "none" | "animatedMono" | "staticColor";
  grainOpacity: number;
  /** 暖色グローの強さ 0..1 */
  glow: number;
  /** 白フラッシュ / 黒フェードの最大量 0..1 */
  flashWhite: number;
  blackFade: number;
  /** 色収差（radial: スケール差 / horizontal: px@1920） */
  aberration: "none" | "radial" | "horizontal";
  aberrationAmount: number;
  /** 中央の暗い渦（吸い込み口）0..1 */
  vortex: number;
  /** 光条 */
  streaks: "none" | "horizontal" | "diagonal";
  /** フィルム汚しキットの総量 0..1 */
  filmDirt: number;
  /** マゼンタ/紫の色被り 0..1 */
  magentaBurn: number;
  /** 波状歪みの最大変位 px@1920 */
  displacePx: number;
  /** 二連バースト包絡で全演出を駆動 */
  burstDrive: boolean;
  /** 全体を包むサージ拡大の追加量 / 球面膨張の脈動量 */
  surge: number;
  bulge: number;
};

/**
 * 8 個体のプリセット。variant を等分割で丸めて選ぶ。
 * すべて forward 基準で定義し、backward はスケールの逆数で反転する。
 */
const STYLES: StyleConfig[] = [
  // 0: 家族の教科書。10倍級パンチイン＋中心対称ブラー＋微振動。オーバーレイなし
  {
    fromScaleEnd: 9, toScaleStart: 0.35, quadZoom: true,
    swapCenter: 0.5, swapWidth: 0.055,
    blurMode: "radialSym", blurSpread: 0.3, blurPeakAt: 0.5, gaussPct: 0.9,
    shakePct: 0.9, shakeShape: "tri",
    grain: "none", grainOpacity: 0,
    glow: 0.14, flashWhite: 0, blackFade: 0,
    aberration: "none", aberrationAmount: 0,
    vortex: 0, streaks: "none", filmDirt: 0, magentaBurn: 0,
    displacePx: 0, burstDrive: false, surge: 0, bulge: 0,
  },
  // 1: ズーム控えめ・シェイク無し。群全体のガウス＋動くモノクログレイン。外側片方向ブラー
  {
    fromScaleEnd: 2.4, toScaleStart: 0.55, quadZoom: false,
    swapCenter: 0.5, swapWidth: 0.08,
    blurMode: "radialOut", blurSpread: 0.5, blurPeakAt: 0.5, gaussPct: 1.5,
    shakePct: 0, shakeShape: "tri",
    grain: "animatedMono", grainOpacity: 0.18,
    glow: 0.1, flashWhite: 0, blackFade: 0,
    aberration: "none", aberrationAmount: 0,
    vortex: 0, streaks: "none", filmDirt: 0, magentaBurn: 0,
    displacePx: 0, burstDrive: false, surge: 0, bulge: 0,
  },
  // 2: 黒フェードで差し替えを隠す。ズーム+3割・家族最強シェイク・ブラー頂点は前寄り
  {
    fromScaleEnd: 1.35, toScaleStart: 0.78, quadZoom: false,
    swapCenter: 0.5, swapWidth: 0.045,
    blurMode: "radialSym", blurSpread: 0.22, blurPeakAt: 0.34, gaussPct: 0.9,
    shakePct: 2.4, shakeShape: "tri",
    grain: "none", grainOpacity: 0,
    glow: 0.05, flashWhite: 0, blackFade: 1,
    aberration: "none", aberrationAmount: 0,
    vortex: 0, streaks: "none", filmDirt: 0, magentaBurn: 0,
    displacePx: 0, burstDrive: false, surge: 0, bulge: 0,
  },
  // 3: 全部盛り。加速ズーム＋球面膨張、水平ブラー・水平RGB分離・暖色グロー・水平光条・フィルム汚れ
  {
    fromScaleEnd: 4, toScaleStart: 0.4, quadZoom: true,
    swapCenter: 0.5, swapWidth: 0.06,
    blurMode: "horizontal", blurSpread: 4.5, blurPeakAt: 0.5, gaussPct: 0.8,
    shakePct: 1.1, shakeShape: "tri",
    grain: "none", grainOpacity: 0,
    glow: 0.55, flashWhite: 0, blackFade: 0,
    aberration: "horizontal", aberrationAmount: 16,
    vortex: 0, streaks: "horizontal", filmDirt: 0.45, magentaBurn: 0.12,
    displacePx: 0, burstDrive: false, surge: 0.05, bulge: 0.07,
  },
  // 4: 白フラッシュで隠す。パンチ控えめ・クロス幅広め・固定シードのカラーグレイン常駐
  {
    fromScaleEnd: 1.5, toScaleStart: 0.7, quadZoom: false,
    swapCenter: 0.5, swapWidth: 0.17,
    blurMode: "radialSym", blurSpread: 0.18, blurPeakAt: 0.5, gaussPct: 0.7,
    shakePct: 0.6, shakeShape: "tri",
    grain: "staticColor", grainOpacity: 0.13,
    glow: 0.12, flashWhite: 0.62, blackFade: 0,
    aberration: "none", aberrationAmount: 0,
    vortex: 0, streaks: "none", filmDirt: 0, magentaBurn: 0,
    displacePx: 0, burstDrive: false, surge: 0, bulge: 0,
  },
  // 5: 吸い込み。合成後の全体へ放射ブラー＋半径方向RGB分離（R外・B内）＋中央の暗い渦。シェイク無し
  {
    fromScaleEnd: 2.8, toScaleStart: 0.5, quadZoom: true,
    swapCenter: 0.5, swapWidth: 0.08,
    blurMode: "radialSym", blurSpread: 0.28, blurPeakAt: 0.5, gaussPct: 1.3,
    shakePct: 0, shakeShape: "tri",
    grain: "none", grainOpacity: 0,
    glow: 0.15, flashWhite: 0, blackFade: 0,
    aberration: "radial", aberrationAmount: 0.035,
    vortex: 0.8, streaks: "none", filmDirt: 0, magentaBurn: 0,
    displacePx: 0, burstDrive: false, surge: 0, bulge: 0,
  },
  // 6: 前進サージ。ブラー積層なし。二連バースト包絡＋波状歪み＋水平プリズム＋色被り＋砂埃
  {
    fromScaleEnd: 1.6, toScaleStart: 0.72, quadZoom: false,
    swapCenter: 0.5, swapWidth: 0.11,
    blurMode: "none", blurSpread: 0, blurPeakAt: 0.5, gaussPct: 0.5,
    shakePct: 0.9, shakeShape: "burst",
    grain: "none", grainOpacity: 0,
    glow: 0.35, flashWhite: 0, blackFade: 0,
    aberration: "horizontal", aberrationAmount: 12,
    vortex: 0, streaks: "none", filmDirt: 0.35, magentaBurn: 0.3,
    displacePx: 26, burstDrive: true, surge: 0.12, bulge: 0.05,
  },
  // 7: 後退サージ（direction=backward で使う）。1.3倍サージ＋球面膨張＋二山シェイク＋斜め光条＋フル装備の汚しキット
  {
    fromScaleEnd: 2.9, toScaleStart: 0.125, quadZoom: true,
    swapCenter: 0.45, swapWidth: 0.07,
    blurMode: "radialSym", blurSpread: 0.2, blurPeakAt: 0.45, gaussPct: 0.9,
    shakePct: 1.5, shakeShape: "twoHump",
    grain: "animatedMono", grainOpacity: 0.1,
    glow: 0.2, flashWhite: 0, blackFade: 0,
    aberration: "none", aberrationAmount: 0,
    vortex: 0, streaks: "diagonal", filmDirt: 0.8, magentaBurn: 0,
    displacePx: 0, burstDrive: false, surge: 0.3, bulge: 0.08,
  },
];

const BLUR_LAYERS = 8;

export const MvTransitionZoomPunch: React.FC<MvTransitionZoomPunchProps> = ({
  from,
  to,
  durationInFrames,
  direction = "forward",
  variant = 0,
}) => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const rawId = useId();
  const uid = useMemo(() => rawId.replace(/[^a-zA-Z0-9_-]/g, ""), [rawId]);

  const v = clamp01(variant);
  const cfg = STYLES[Math.round(v * (STYLES.length - 1))];
  const seed = 13 + Math.round(v * 997);

  const rs = width / 1920; // 解像度スケール（px量は1920基準比率）
  const last = Math.max(1, durationInFrames - 1);
  const p = clamp01(frame / last);

  // 端の契約: 先頭は素のfrom・末尾は素のto。全オーバーレイをこのゲートで殺す
  const edgeGate = interpolate(p, [0, 0.05, 0.94, 1], [0, 1, 1, 0], CLAMP);

  // ---- 方向 ----------------------------------------------------------------
  const axisVec: readonly [number, number] | null =
    direction === "left" ? [-1, 0]
    : direction === "right" ? [1, 0]
    : direction === "up" ? [0, -1]
    : direction === "down" ? [0, 1]
    : null;
  const backward = direction === "backward";

  // ---- ズームカーブ（3幕構成の1幕と3幕） -------------------------------------
  const fromEnd = axisVec ? 1.3 : backward ? 1 / cfg.fromScaleEnd : cfg.fromScaleEnd;
  const toStart = axisVec ? 0.92 : backward ? 1 / cfg.toScaleStart : cfg.toScaleStart;

  // 旧カット: 等倍 → fromEnd（quad なら 2乗加速、線形個体もわずかに加速を混ぜる）
  const zoomOutEndP = Math.min(0.98, cfg.swapCenter + cfg.swapWidth + 0.06);
  const tf = clamp01(p / zoomOutEndP);
  const tfe = cfg.quadZoom ? tf * tf : tf * tf * 0.35 + tf * 0.65;
  const fromScale = 1 + (fromEnd - 1) * tfe;

  // 新カット: toStart → 等倍へ ease-out 着地（バウンスは無い）
  const zoomInStartP = Math.max(0.02, cfg.swapCenter - cfg.swapWidth - 0.06);
  const tt = clamp01((p - zoomInStartP) / (1 - zoomInStartP));
  const tte = 1 - Math.pow(1 - tt, cfg.quadZoom ? 2.4 : 1.8);
  const toScale = toStart + (1 - toStart) * tte;

  // 軸パンチ（left/right/up/down）: スライド主体でズームは控えめ
  const fromX = axisVec ? axisVec[0] * width * 1.15 * tfe : 0;
  const fromY = axisVec ? axisVec[1] * height * 1.15 * tfe : 0;
  const toX = axisVec ? -axisVec[0] * width * 0.3 * (1 - tte) : 0;
  const toY = axisVec ? -axisVec[1] * height * 0.3 * (1 - tte) : 0;

  // ---- 差し替え（狭いクロス。ブラー等の頂点の裏で継ぎ目を隠す） ----------------
  const toOpacity = interpolate(
    p,
    [cfg.swapCenter - cfg.swapWidth, cfg.swapCenter + cfg.swapWidth],
    [0, 1],
    CLAMP
  );

  // ---- 包絡（緩急の性格） -----------------------------------------------------
  // 二連バースト: 山→谷→山→減衰
  const burst = interpolate(
    p,
    [0, 0.16, 0.3, 0.46, 0.6, 0.78, 1],
    [0, 1, 0.2, 0.85, 0.3, 0.12, 0],
    CLAMP
  );
  const twoHump = interpolate(
    p,
    [0, 0.24, 0.42, 0.6, 0.78, 1],
    [0, 1, 0.25, 0.95, 0.2, 0],
    CLAMP
  );
  const drive = (cfg.burstDrive ? burst : tri(p, 0.5)) * edgeGate;
  const blurEnv = (cfg.burstDrive ? burst : tri(p, cfg.blurPeakAt)) * edgeGate;
  const shakeEnv =
    (cfg.shakeShape === "burst" ? burst
      : cfg.shakeShape === "twoHump" ? twoHump
      : tri(p, 0.5)) * edgeGate;

  // ---- シェイク（決定論。縦は横の6割に抑える） --------------------------------
  const shakeAmp = (cfg.shakePct / 100) * width * shakeEnv;
  const shakeX = (rand(seed, frame, 11) - 0.5) * 2 * shakeAmp;
  const shakeY = (rand(seed, frame, 12) - 0.5) * 2 * shakeAmp * 0.6;

  // 黒フチ対策の下地拡大（端では 1 に戻して素の絵を保つ）
  const inflate = 1 + 0.03 * edgeGate;

  // 全体サージ＋球面膨張の脈動
  const surgeScale = 1 + cfg.surge * drive;
  const bulgeX = 1 + cfg.bulge * drive;
  const bulgeY = 1 + cfg.bulge * 0.55 * drive;
  const groupTransform = `translate(${shakeX.toFixed(1)}px, ${shakeY.toFixed(1)}px) scale(${(surgeScale * bulgeX).toFixed(4)}, ${(surgeScale * bulgeY).toFixed(4)})`;

  // ---- シーン（from / to を1つに合成してから加工する） ------------------------
  const sceneNode = (
    <AbsoluteFill>
      <AbsoluteFill
        style={{
          transform: `translate(${fromX.toFixed(1)}px, ${fromY.toFixed(1)}px) scale(${(fromScale * inflate).toFixed(4)})`,
        }}
      >
        {from}
      </AbsoluteFill>
      <AbsoluteFill
        style={{
          opacity: toOpacity,
          transform: `translate(${toX.toFixed(1)}px, ${toY.toFixed(1)}px) scale(${(toScale * inflate).toFixed(4)})`,
        }}
      >
        {to}
      </AbsoluteFill>
    </AbsoluteFill>
  );

  // ---- ブラー積層（スケール/変位違いの複製を 1/(i+1) で重ねる古典近似） ---------
  // 注記(性能): 積層 8 層 × from/to で最大 16 マウント＋色収差 R/B で +4。
  // 重い content はラスタライズ済み素材（<Img>/<OffthreadVideo>）を推奨。
  const stackActive = cfg.blurMode !== "none" && blurEnv > 0.02;
  const layerOffsets: { s: number; x: number; y: number }[] = stackActive
    ? Array.from({ length: BLUR_LAYERS }, (_, i) => {
        const t = i / (BLUR_LAYERS - 1);
        if (axisVec) {
          const spreadPx = 0.05 * width * blurEnv;
          return {
            s: 1,
            x: axisVec[0] * spreadPx * (t - 0.5) * 2,
            y: axisVec[1] * spreadPx * (t - 0.5) * 2,
          };
        }
        if (cfg.blurMode === "radialSym") {
          return { s: 1 + cfg.blurSpread * blurEnv * (t - 0.5) * 2, x: 0, y: 0 };
        }
        if (cfg.blurMode === "radialOut") {
          return { s: 1 + cfg.blurSpread * blurEnv * t, x: 0, y: 0 };
        }
        // horizontal: 幅%の対称変位
        return { s: 1, x: (cfg.blurSpread / 100) * width * blurEnv * (t - 0.5) * 2, y: 0 };
      })
    : [{ s: 1, x: 0, y: 0 }];

  // ---- 積層グループへ掛けるフィルタ群 -----------------------------------------
  const gaussPx = (cfg.gaussPct / 100) * width * blurEnv;
  const exposure = 1 + (0.28 * cfg.glow + 0.06) * drive;
  const dispScale = cfg.displacePx * rs * drive;

  const aberrAmt =
    cfg.aberration === "radial"
      ? cfg.aberrationAmount * blurEnv // スケール差
      : cfg.aberrationAmount * rs * blurEnv; // px
  const splitOn =
    cfg.aberration !== "none" &&
    (cfg.aberration === "radial" ? aberrAmt > 0.004 : aberrAmt > 0.5);

  const stackFilterParts: string[] = [];
  if (splitOn) stackFilterParts.push(`url(#${uid}-g)`);
  if (dispScale > 1) stackFilterParts.push(`url(#${uid}-disp)`);
  if (gaussPx > 0.4) stackFilterParts.push(`blur(${gaussPx.toFixed(1)}px)`);
  if (exposure > 1.005) stackFilterParts.push(`brightness(${exposure.toFixed(3)})`);
  const stackFilter = stackFilterParts.length > 0 ? stackFilterParts.join(" ") : undefined;

  // 色収差 R/B 層の変位（radial: R が外・B が内 / horizontal: 左右）
  const rTransform =
    cfg.aberration === "radial"
      ? `scale(${(1 + aberrAmt).toFixed(4)})`
      : `translateX(${(-aberrAmt).toFixed(1)}px)`;
  const bTransform =
    cfg.aberration === "radial"
      ? `scale(${(1 - aberrAmt).toFixed(4)})`
      : `translateX(${aberrAmt.toFixed(1)}px)`;

  // ---- オーバーレイの量 --------------------------------------------------------
  const flashOp =
    cfg.flashWhite *
    interpolate(p, [cfg.swapCenter - 0.14, cfg.swapCenter, cfg.swapCenter + 0.18], [0, 1, 0], CLAMP) *
    edgeGate;
  const blackOp =
    cfg.blackFade *
    interpolate(p, [cfg.swapCenter - 0.18, cfg.swapCenter, cfg.swapCenter + 0.18], [0, 1, 0], CLAMP) *
    edgeGate;
  const glowOp = clamp01(cfg.glow * 1.2 * drive);
  const vortexOp = cfg.vortex * tri(p, 0.5) * edgeGate;
  const dirtEnv = edgeGate * (0.3 + 0.7 * drive);
  const streakOp = (cfg.streaks !== "none" ? 1 : 0) * 0.7 * drive;

  // グレイン（動く個体はシードをフレーム毎にハッシュ更新）
  const grainSeed =
    cfg.grain === "animatedMono"
      ? Math.floor(rand(seed, frame, 31) * 9973)
      : seed;
  const grainOp = cfg.grainOpacity * edgeGate;

  // フィルム汚し: 砂埃（2フレーム毎に更新）・縦スクラッチ（3フレーム毎）
  const dustKey = Math.floor(frame / 2);
  const dustCount = Math.round(14 * cfg.filmDirt);
  const dust = Array.from({ length: dustCount }, (_, i) => ({
    x: rand(seed + 5, dustKey, 40 + i) * 100,
    y: rand(seed + 6, dustKey, 41 + i) * 100,
    r: (1 + rand(seed + 7, dustKey, 42 + i) * 2.2) * rs,
    dark: rand(seed + 8, dustKey, 43 + i) > 0.62,
    op: 0.25 + rand(seed + 9, dustKey, 44 + i) * 0.4,
  }));
  const scratchKey = Math.floor(frame / 3);
  const scratchCount = cfg.filmDirt >= 0.6 ? 3 : cfg.filmDirt >= 0.3 ? 1 : 0;
  const scratches = Array.from({ length: scratchCount }, (_, i) => ({
    x: rand(seed + 15, scratchKey, 60 + i) * 100,
    op: 0.1 + rand(seed + 16, scratchKey, 61 + i) * 0.14,
  }));

  // 斜め光条ビーム（位置はシード固定、明滅のみ時間駆動）
  const beams =
    cfg.streaks === "diagonal"
      ? Array.from({ length: 3 }, (_, i) => ({
          x: 12 + rand(seed + 21, 0, 70 + i) * 76,
          ang: (rand(seed + 22, 0, 71 + i) - 0.5) * 40 - (i === 2 ? 55 : 0),
          w: (2 + rand(seed + 23, 0, 72 + i) * 3) * rs,
          op: 0.35 + rand(seed + 24, 0, 73 + i) * 0.4,
        }))
      : [];

  return (
    <AbsoluteFill style={{ background: "#000", overflow: "hidden" }}>
      {/* フィルタ定義（チャンネル分離 / グレイン / 波状歪み） */}
      <svg width={0} height={0} style={{ position: "absolute" }} aria-hidden>
        <defs>
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
          {cfg.grain !== "none" && (
            <filter id={`${uid}-grain`} x="0" y="0" width="100%" height="100%">
              <feTurbulence
                type="fractalNoise"
                baseFrequency={0.9}
                numOctaves={2}
                seed={grainSeed}
                stitchTiles="stitch"
              />
              {cfg.grain === "animatedMono" && (
                <feColorMatrix type="saturate" values="0" />
              )}
            </filter>
          )}
          {cfg.displacePx > 0 && (
            <filter
              id={`${uid}-disp`}
              x="-10%"
              y="-10%"
              width="120%"
              height="120%"
              colorInterpolationFilters="sRGB"
            >
              <feTurbulence
                type="fractalNoise"
                baseFrequency="0.008 0.02"
                numOctaves={2}
                seed={seed % 100}
                result="n"
              />
              <feDisplacementMap
                in="SourceGraphic"
                in2="n"
                scale={dispScale}
                xChannelSelector="R"
                yChannelSelector="G"
              />
            </filter>
          )}
        </defs>
      </svg>

      {/* 本体（シェイク＋サージ＋膨張） */}
      <AbsoluteFill style={{ transform: groupTransform }}>
        {/* ブラー積層（色収差が有効な間は G チャンネルのみ担う） */}
        <AbsoluteFill style={{ filter: stackFilter }}>
          {layerOffsets.map((off, i) => (
            <AbsoluteFill
              key={i}
              style={{
                opacity: 1 / (i + 1),
                transform: `translate(${off.x.toFixed(1)}px, ${off.y.toFixed(1)}px) scale(${off.s.toFixed(4)})`,
              }}
            >
              {sceneNode}
            </AbsoluteFill>
          ))}
        </AbsoluteFill>

        {/* 色収差: R を外（または左）、B を内（または右）へずらして screen 再合成 */}
        {splitOn && (
          <>
            <AbsoluteFill
              style={{
                filter: `url(#${uid}-r)`,
                mixBlendMode: "screen",
                transform: rTransform,
              }}
            >
              {sceneNode}
            </AbsoluteFill>
            <AbsoluteFill
              style={{
                filter: `url(#${uid}-b)`,
                mixBlendMode: "screen",
                transform: bTransform,
              }}
            >
              {sceneNode}
            </AbsoluteFill>
          </>
        )}
      </AbsoluteFill>

      {/* 中央の暗い渦（吸い込み口） */}
      {vortexOp > 0.02 && (
        <AbsoluteFill
          style={{
            background:
              "radial-gradient(circle at 50% 50%, rgba(0,0,0,0.9) 0%, rgba(0,0,0,0.55) 12%, rgba(0,0,0,0) 38%)",
            mixBlendMode: "multiply",
            opacity: vortexOp,
          }}
        />
      )}

      {/* 暖色グロー（中央からの放射。中盤ピークで露出を持ち上げる） */}
      {glowOp > 0.02 && (
        <AbsoluteFill
          style={{
            background:
              "radial-gradient(circle at 50% 50%, rgba(255,242,220,0.95) 0%, rgba(255,158,64,0.5) 24%, rgba(255,120,40,0) 58%)",
            mixBlendMode: "screen",
            opacity: glowOp,
          }}
        />
      )}

      {/* 水平ライトストリーク（芯＋ハロ） */}
      {cfg.streaks === "horizontal" && streakOp > 0.02 && (
        <>
          <div
            style={{
              position: "absolute",
              left: "-5%",
              right: "-5%",
              top: "50%",
              height: `${Math.max(2, 2.5 * rs)}px`,
              transform: "translateY(-50%)",
              background:
                "linear-gradient(90deg, rgba(255,255,255,0) 0%, rgba(255,250,240,1) 18%, rgba(255,250,240,1) 82%, rgba(255,255,255,0) 100%)",
              filter: `blur(${(1.2 * rs).toFixed(1)}px)`,
              mixBlendMode: "screen",
              opacity: streakOp,
            }}
          />
          <div
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              top: "50%",
              height: "22%",
              transform: "translateY(-50%)",
              background:
                "radial-gradient(ellipse 60% 100% at 50% 50%, rgba(255,220,180,0.9) 0%, rgba(255,200,140,0) 70%)",
              mixBlendMode: "screen",
              opacity: streakOp * 0.6,
            }}
          />
        </>
      )}

      {/* 斜めの光条ビーム */}
      {beams.map((b, i) => (
        <div
          key={i}
          style={{
            position: "absolute",
            left: `${b.x.toFixed(1)}%`,
            top: "-25%",
            height: "150%",
            width: `${b.w.toFixed(1)}px`,
            background:
              "linear-gradient(180deg, rgba(255,255,255,0) 0%, rgba(255,255,255,0.95) 30%, rgba(255,255,255,0.95) 70%, rgba(255,255,255,0) 100%)",
            filter: `blur(${(1.5 * rs).toFixed(1)}px)`,
            transform: `rotate(${b.ang.toFixed(1)}deg)`,
            transformOrigin: "50% 50%",
            mixBlendMode: "screen",
            opacity: b.op * streakOp,
          }}
        />
      ))}

      {/* マゼンタ／紫の色被り（フィルム焼け） */}
      {cfg.magentaBurn > 0 && drive > 0.03 && (
        <AbsoluteFill
          style={{
            background:
              "radial-gradient(circle at 28% 38%, rgba(255,0,128,0.55) 0%, rgba(255,0,128,0) 52%), radial-gradient(circle at 76% 66%, rgba(140,60,255,0.45) 0%, rgba(140,60,255,0) 48%)",
            mixBlendMode: "screen",
            opacity: cfg.magentaBurn * drive,
          }}
        />
      )}

      {/* フィルム汚しキット: 周縁の焦げ＋暗色ティント＋砂埃＋縦スクラッチ */}
      {cfg.filmDirt > 0 && dirtEnv > 0.03 && (
        <>
          <AbsoluteFill
            style={{
              background:
                "radial-gradient(ellipse 75% 70% at 50% 50%, rgba(0,0,0,0) 52%, rgba(28,10,6,0.85) 100%)",
              mixBlendMode: "multiply",
              opacity: cfg.filmDirt * 0.75 * dirtEnv,
            }}
          />
          <AbsoluteFill
            style={{
              background: "#2a1626",
              mixBlendMode: "multiply",
              opacity: cfg.filmDirt * 0.22 * dirtEnv,
            }}
          />
          {dust.map((d, i) => (
            <div
              key={i}
              style={{
                position: "absolute",
                left: `${d.x.toFixed(2)}%`,
                top: `${d.y.toFixed(2)}%`,
                width: `${d.r.toFixed(1)}px`,
                height: `${d.r.toFixed(1)}px`,
                borderRadius: "50%",
                background: d.dark ? "#120a08" : "#efe6da",
                opacity: d.op * dirtEnv,
              }}
            />
          ))}
          {scratches.map((s, i) => (
            <div
              key={i}
              style={{
                position: "absolute",
                left: `${s.x.toFixed(2)}%`,
                top: 0,
                bottom: 0,
                width: `${Math.max(1, rs).toFixed(1)}px`,
                background: "rgba(255,252,245,1)",
                opacity: s.op * dirtEnv,
              }}
            />
          ))}
        </>
      )}

      {/* グレイン（feTurbulence を overlay で薄く） */}
      {cfg.grain !== "none" && grainOp > 0.01 && (
        <svg
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            mixBlendMode: "overlay",
            opacity: grainOp,
            pointerEvents: "none",
          }}
        >
          <rect width="100%" height="100%" filter={`url(#${uid}-grain)`} />
        </svg>
      )}

      {/* 黒フェード（差し替えを暗転の裏に隠す個体） */}
      {blackOp > 0.005 && (
        <AbsoluteFill style={{ background: "#000", opacity: blackOp }} />
      )}

      {/* 白フラッシュ（差し替えを露出の飛びで隠す個体） */}
      {flashOp > 0.005 && (
        <AbsoluteFill
          style={{
            background: "#fff",
            mixBlendMode: "screen",
            opacity: flashOp,
          }}
        />
      )}
    </AbsoluteFill>
  );
};
