import React, { useId, useMemo } from "react";
import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from "remotion";

/**
 * MvTransitionGlitchNoise — グリッチ・ノイズ崩壊系トランジション（クリーンルーム実装）
 *
 * 機能: 旧カット(from)と新カット(to)を、砂嵐・走査線・色収差・歪みで「汚してから」
 *       入れ替える家族。効果量は折れ線エンベロープ（両端0）で束ね、入りと出は必ずクリーン。
 *       切替は効果の頂点（画面が最も汚れている瞬間）の陰で行う。
 *
 * variant(0..1) を7等分して個体を選ぶ:
 *   0: 終盤一撃型   — 頂点が9割弱と極端に遅い。縦ブラー+RGBズレ+横裂け+白フラッシュが
 *                     一斉に頂点を迎え、最終フレームで完治。前半は素通し。
 *   1: テープ帯型   — 多層構成。ティール被り・走査線・グレインはほぼ全編、縦の白帯
 *                     （縁をノイズで破り赤/シアンの縁取り）とネガ反転フラッシュが固有。切替は早め。
 *   2: 全面砂嵐型   — 最少構成。中央頂点の対称三角1本。白黒化+強デフォーカス+輝度フリッカの
 *                     下に白screen+黒multiplyの2層砂嵐。切替は素直な線形ディゾルブ。
 *   3: 波打ちノイズ型 — 最長尺向け。低周波の横縞ノイズで波打ち歪み+色収差+縁隠しズーム。
 *                     切替のみスムーズステップ。塩胡椒3層+明暗2種の走査線。
 *   4: ピンぼけリレー型 — 砂嵐で覆わない唯一の個体。fromは横ブラーが段階的に増し、
 *                     toはブラーから解像して入る。中盤白飛び。強い脱彩はほぼ恒常。
 *   5: ブロック融解型 — 主役は巨大モザイク（点タイル+膨張の古典手法、中央で最大セル）。
 *                     揺れと粒のエンベロープは二山。ぼかしはW字、RGBズレは終盤のみ、中盤に淡いグロー。
 *   6: 前進ラッシュ型 — 唯一「動き」を持つ。fromは前方ズームで押し出され、toはズーム済みから
 *                     等倍へ着地（中央ほぼハードカット）。強いシアン被りと水平の光の筋が固有。
 *
 * 設計メモ:
 * - 乱数はすべて (seed, frame, index) から決定的に生成。Math.random 不使用。
 * - ピクセル量は画面幅のフルHD比（width/1920）を掛けて解像度非依存。
 * - 粒子ノイズは feTurbulence → 彩度0 → 線形関数でほぼ二値化。screen=白い塩、
 *   multiply=黒い胡椒、overlay=両方叩く、と混合モードで役割分担。シードは毎フレーム更新。
 * - 色収差は feColorMatrix でチャンネル単離した3層の screen 合成（整列時は元色を再構成）。
 * - ぼかし・歪みで縁が透けるぶんは量に比例した数%の拡大で外へ逃がす。
 * - イージングは使わず、直線的な折れ線パルスの鋭い立ち上がり/減衰で緩急を作る。
 * - テキスト・フォント・外部素材は一切使わない。
 */

export interface MvTransitionGlitchNoiseProps {
  /** 旧カット */
  from: React.ReactNode;
  /** 新カット */
  to: React.ReactNode;
  /** トランジション全体の長さ（フレーム） */
  durationInFrames: number;
  /** 方向（前進ラッシュ型のみ有効。forward=押し出し / backward=引き） */
  direction?: "left" | "right" | "up" | "down" | "forward" | "backward";
  /** 0..1 を7等分して個体を選ぶ（決定論的） */
  variant?: number;
}

/** (a,b,c) から 0..1 の決定的な擬似乱数（GLSL定番のsinハッシュ） */
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

/** 折れ線サンプリング（両端clamp）。エンベロープはすべてこれで作る */
const ip = (v: number, xs: number[], ys: number[]): number =>
  interpolate(v, monotonic(xs), ys, {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

type TearBand = { top: number; height: number; shift: number };
type TapeBand = { left: number; width: number; opacity: number };

type Fx = {
  blurX: number;
  blurY: number;
  wave: number;
  waveFreqX: number;
  waveFreqY: number;
  rgb: number;
  saturate: number;
  contrast: number;
  brightness: number;
  jitter: number;
  jitterYFactor: number;
  fromScale: number;
  toScale: number;
  cross: number;
  tears: TearBand[];
  bands: TapeBand[];
  flashWhite: number;
  flashNeg: number;
  saltOp: number;
  pepperOp: number;
  overlayOp: number;
  grainFreq: number;
  scanDark: number;
  scanLight: number;
  tintMul: { color: string; opacity: number } | null;
  tintScreen: { css: string; opacity: number } | null;
  beam: number;
  glow: number;
  mosaicCell: number;
};

/** 個体ごとの毎フレーム効果量。すべて折れ線エンベロープ×決定的乱数で算出 */
const computeFx = (
  mode: number,
  p: number,
  frame: number,
  seed: number,
  px: number,
  dirSign: number
): Fx => {
  const fx: Fx = {
    blurX: 0,
    blurY: 0,
    wave: 0,
    waveFreqX: 0.004,
    waveFreqY: 0.09,
    rgb: 0,
    saturate: 1,
    contrast: 1,
    brightness: 1,
    jitter: 0,
    jitterYFactor: 0.6,
    fromScale: 1,
    toScale: 1,
    cross: 0,
    tears: [],
    bands: [],
    flashWhite: 0,
    flashNeg: 0,
    saltOp: 0,
    pepperOp: 0,
    overlayOp: 0,
    grainFreq: 0.8,
    scanDark: 0,
    scanLight: 0,
    tintMul: null,
    tintScreen: null,
    beam: 0,
    glow: 0,
    mosaicCell: 0,
  };

  /** 切替進行。hard=ハードカット / linear=線形クロス / smooth=スムーズステップ */
  const crossAt = (
    at: number,
    win: number,
    style: "linear" | "hard" | "smooth"
  ): number => {
    if (style === "hard") return p >= at ? 1 : 0;
    const t = clamp01((p - (at - win / 2)) / Math.max(win, 1e-4));
    return style === "smooth" ? t * t * (3 - 2 * t) : t;
  };

  // ほぼ恒常の層でも最初と最後の数%はフェードし、入りと出をクリーンに保つ
  const edge = ip(p, [0, 0.06, 0.94, 1], [0, 1, 1, 0]);

  switch (mode) {
    case 0: {
      // 終盤一撃型: 前半素通し → 87%地点で全効果が同時に頂点 → 最終フレームで完治
      const env = ip(p, [0, 0.55, 0.87, 1], [0, 0.07, 1, 0]);
      fx.blurY = 24 * env * px;
      fx.rgb = 16 * env * px;
      fx.jitter = 10 * env * px;
      fx.saturate = 1 - 0.55 * env;
      fx.contrast = 1 + 0.18 * env;
      fx.brightness = 1 + (rand(seed, frame, 31) - 0.5) * 0.25 * env;
      fx.flashWhite = 0.9 * ip(p, [0.7, 0.87, 0.97, 1], [0, 1, 0.12, 0]);
      fx.saltOp = 0.45 * env;
      fx.grainFreq = 0.85;
      fx.scanDark = 0.3 * env;
      fx.cross = crossAt(0.87, 0, "hard");
      if (env > 0.08) {
        for (let i = 0; i < 4; i++) {
          if (rand(seed, frame, 80 + i) < env * 0.9) {
            fx.tears.push({
              top: rand(seed, frame, 90 + i) * 88,
              height: 3.5 + rand(seed, frame, 100 + i) * 8,
              shift: (rand(seed, frame, 110 + i) - 0.5) * 2 * 6.5 * env,
            });
          }
        }
      }
      break;
    }
    case 1: {
      // テープ帯型: ティール被り・走査線・グレインはほぼ全編。縦帯とネガ反転が固有。切替45%と早め
      const env = ip(p, [0, 0.18, 0.45, 0.75, 1], [0, 0.75, 1, 0.45, 0]);
      const bandEnv = ip(p, [0, 0.12, 0.3, 0.55, 0.85, 1], [0, 1, 0.55, 1, 0.35, 0]);
      fx.blurY = 5 * env * px;
      fx.rgb = 11 * env * px;
      fx.jitter = 6 * env * px;
      fx.saturate = 1 - 0.22 * edge;
      fx.contrast = 1 + 0.06 * edge;
      fx.brightness = 1 + (rand(seed, frame, 32) - 0.5) * 0.12 * env;
      fx.tintMul = { color: "rgb(168, 214, 208)", opacity: 0.5 * edge };
      fx.tintScreen = {
        css: "radial-gradient(ellipse 70% 60% at 50% 45%, rgba(90,200,205,0.35) 0%, rgba(90,200,205,0) 70%)",
        opacity: (0.45 + 0.35 * env) * edge,
      };
      fx.scanDark = 0.24 * edge;
      fx.scanLight = 0.12 * edge;
      fx.saltOp = 0.3 * edge;
      fx.pepperOp = 0.18 * edge;
      fx.grainFreq = 0.8;
      fx.flashNeg = 0.85 * ip(p, [0.38, 0.45, 0.53], [0, 1, 0]);
      fx.cross = crossAt(0.45, 0.12, "linear");
      const blk = Math.floor(frame / 6);
      for (let i = 0; i < 3; i++) {
        const gate = rand(seed, frame, 60 + i);
        const op = bandEnv * (gate < 0.8 ? 0.9 : 0.25);
        if (op > 0.04) {
          fx.bands.push({
            left: 4 + rand(seed + 1, blk, 40 + i) * 88,
            width: 2.5 + rand(seed + 2, blk, 50 + i) * 5,
            opacity: op,
          });
        }
      }
      break;
    }
    case 2: {
      // 全面砂嵐型: 中央頂点の対称三角1本。白黒化+デフォーカス+フリッカ+2層砂嵐+線形ディゾルブ
      const env = ip(p, [0, 0.5, 1], [0, 1, 0]);
      fx.blurX = 17 * env * px;
      fx.blurY = 17 * env * px;
      fx.saturate = 1 - 0.95 * env;
      fx.contrast = 1 + 0.12 * env;
      fx.brightness = 1 + (rand(seed, frame, 33) - 0.5) * 0.65 * env;
      fx.jitter = 5 * env * px;
      fx.jitterYFactor = 1;
      fx.saltOp = Math.min(1, env * 1.5);
      fx.pepperOp = Math.min(1, env * 1.35);
      fx.grainFreq = 0.92;
      fx.scanDark = 0.2 * env;
      fx.flashWhite = 0.18 * Math.pow(env, 3);
      fx.cross = crossAt(0.5, 0.26, "linear");
      break;
    }
    case 3: {
      // 波打ちノイズ型: 頂点7割と遅め。低周波横縞の変位+色収差+縁隠しズーム。切替のみスムーズ
      const env = ip(p, [0, 0.25, 0.7, 0.9, 1], [0, 0.45, 1, 0.3, 0]);
      fx.wave = 72 * env * px;
      fx.waveFreqX = 0.0035;
      fx.waveFreqY = 0.085;
      fx.rgb = 15 * env * px;
      fx.saturate = 1 - 0.4 * env;
      fx.contrast = 1 + 0.12 * env;
      fx.brightness = 1 - 0.06 * env;
      fx.jitter = 4 * env * px;
      fx.saltOp = (0.15 + 0.4 * env) * edge;
      fx.pepperOp = (0.1 + 0.3 * env) * edge;
      fx.overlayOp = 0.35 * env;
      fx.grainFreq = 0.8;
      fx.scanDark = 0.26 * (0.35 + 0.65 * env) * edge;
      fx.scanLight = 0.14 * (0.35 + 0.65 * env) * edge;
      fx.cross = crossAt(0.62, 0.16, "smooth");
      break;
    }
    case 4: {
      // ピンぼけリレー型: fromは段階的に横ブラー増、toは解像して入る。中盤白飛び。砂嵐なし
      const cut = 0.5;
      fx.saturate = 1 - 0.88 * edge;
      fx.contrast = 1 + 0.12 * edge;
      fx.cross = crossAt(cut, 0, "hard");
      if (p < cut) {
        // コマ落ちの「段」: 増加ランプを5段に量子化
        const ramp = ip(p, [0, cut], [0, 1]);
        fx.blurX = 66 * (Math.floor(ramp * 5) / 5) * px;
      } else {
        const t = ip(p, [cut, 0.95], [0, 1]);
        fx.blurX = 66 * Math.pow(1 - t, 1.7) * px;
      }
      fx.blurY = fx.blurX * 0.08;
      const pulse = ip(p, [0.32, 0.5, 0.82], [0, 1, 0]);
      fx.flashWhite = 0.7 * Math.pow(pulse, 1.5);
      fx.brightness = 1 + 0.06 * pulse;
      fx.jitter = 3 * px * pulse;
      fx.jitterYFactor = 0.2;
      break;
    }
    case 5: {
      // ブロック融解型: 巨大モザイクが中央で最大。ぼかしW字、RGBズレ終盤のみ、揺れ/粒は二山
      const hump = Math.max(
        ip(p, [0.02, 0.27, 0.52], [0, 1, 0]),
        ip(p, [0.48, 0.73, 0.98], [0, 1, 0])
      );
      const mid = ip(p, [0, 0.5, 1], [0, 1, 0]);
      fx.mosaicCell = 64 * px * ip(p, [0.08, 0.5, 0.92], [0, 1, 0]);
      const w = Math.max(
        ip(p, [0, 0.28, 0.5], [0, 1, 0.12]),
        ip(p, [0.5, 0.72, 1], [0.12, 1, 0])
      );
      fx.blurX = 11 * px * w;
      fx.blurY = fx.blurX;
      fx.rgb = 12 * px * ip(p, [0.7, 0.85, 1], [0, 1, 0]);
      fx.glow = 0.3 * ip(p, [0.25, 0.5, 0.75], [0, 1, 0]);
      fx.jitter = 7 * hump * px;
      fx.saltOp = 0.32 * hump;
      fx.pepperOp = 0.22 * hump;
      fx.grainFreq = 0.85;
      fx.saturate = 1 - 0.3 * mid;
      fx.contrast = 1 + 0.1 * mid;
      fx.cross = crossAt(0.5, 0.1, "linear");
      break;
    }
    case 6:
    default: {
      // 前進ラッシュ型: fromは前方ズームで押し出し、toはズーム済みから等倍へ着地。中央ハードカット
      const env = ip(p, [0, 0.16, 0.5, 0.84, 1], [0, 0.9, 1, 0.9, 0]);
      const mid = ip(p, [0, 0.5, 1], [0, 1, 0]);
      fx.blurX = 44 * px * Math.pow(mid, 0.9);
      fx.rgb = 12 * px * mid;
      fx.cross = crossAt(0.5, 0, "hard");
      const tIn = ip(p, [0, 0.5], [0, 1]);
      const tOut = ip(p, [0.5, 1], [0, 1]);
      if (dirSign >= 0) {
        // 加速して飛び込み、減速して着地する（等速にしない）
        fx.fromScale = 1 + 0.6 * Math.pow(tIn, 1.7);
        fx.toScale = 1 + 0.45 * Math.pow(1 - tOut, 1.8);
      } else {
        fx.fromScale = Math.max(0.55, 1 - 0.34 * Math.pow(tIn, 1.7));
        fx.toScale = Math.max(0.6, 1 - 0.26 * Math.pow(1 - tOut, 1.8));
      }
      fx.saturate = 1 - 0.3 * env;
      fx.brightness = 1 + 0.16 * env;
      fx.contrast = 1.04;
      fx.tintMul = { color: "rgb(158, 216, 226)", opacity: 0.55 * env };
      fx.tintScreen = {
        css: "radial-gradient(ellipse 75% 60% at 50% 50%, rgba(120,205,255,0.4) 0%, rgba(120,205,255,0) 72%)",
        opacity: env,
      };
      fx.beam = ip(p, [0.1, 0.5, 0.9], [0, 1, 0]);
      fx.scanLight = 0.1 * env;
      fx.jitter = 3 * env * px;
      fx.jitterYFactor = 0.3;
      break;
    }
  }
  return fx;
};

/** 粒子ノイズ1層: フラクタルノイズ→彩度0→線形関数でほぼ二値化。シードは毎フレーム更新 */
const GrainLayer: React.FC<{
  fid: string;
  blend: "screen" | "multiply" | "overlay";
  opacity: number;
  freq: number;
  seed: number;
  slope: number;
  intercept: number;
}> = ({ fid, blend, opacity, freq, seed, slope, intercept }) => (
  <AbsoluteFill style={{ mixBlendMode: blend, opacity, pointerEvents: "none" }}>
    <svg
      width="100%"
      height="100%"
      preserveAspectRatio="none"
      style={{ display: "block" }}
    >
      <defs>
        <filter
          id={fid}
          x="0%"
          y="0%"
          width="100%"
          height="100%"
          colorInterpolationFilters="sRGB"
        >
          <feTurbulence
            type="fractalNoise"
            baseFrequency={`${freq}`}
            numOctaves={2}
            seed={seed}
            stitchTiles="stitch"
          />
          <feColorMatrix type="saturate" values="0" />
          <feComponentTransfer>
            <feFuncR type="linear" slope={slope} intercept={intercept} />
            <feFuncG type="linear" slope={slope} intercept={intercept} />
            <feFuncB type="linear" slope={slope} intercept={intercept} />
            <feFuncA type="linear" slope={0} intercept={1} />
          </feComponentTransfer>
        </filter>
      </defs>
      <rect x="0" y="0" width="100%" height="100%" filter={`url(#${fid})`} />
    </svg>
  </AbsoluteFill>
);

export const MvTransitionGlitchNoise: React.FC<MvTransitionGlitchNoiseProps> = ({
  from,
  to,
  durationInFrames,
  direction = "forward",
  variant = 0,
}) => {
  const frame = useCurrentFrame();
  const { width } = useVideoConfig();
  const rawId = useId();
  const uid = useMemo(() => rawId.replace(/[^a-zA-Z0-9_-]/g, ""), [rawId]);

  const px = width / 1920;
  const v = clamp01(variant);
  const mode = Math.min(6, Math.floor(v * 7));
  const seed = 7 + Math.floor(v * 997);
  const last = Math.max(1, durationInFrames - 1);
  const p = clamp01(frame / last);
  const dirSign =
    direction === "backward" || direction === "left" || direction === "up" ? -1 : 1;

  const fx = computeFx(mode, p, frame, seed, px, dirSign);

  // ---- 本体グループのフィルタ組み立て（不要なフィルタパスは参照しない） ----
  const useWave = fx.wave > 0.5;
  const useBlur = fx.blurX > 0.15 || fx.blurY > 0.15;
  const mosaicOn = fx.mosaicCell >= 4;
  const filterParts: string[] = [];
  if (mosaicOn) filterParts.push(`url(#${uid}-mos)`);
  if (useWave || useBlur) filterParts.push(`url(#${uid}-mfx)`);
  filterParts.push(
    `saturate(${fx.saturate.toFixed(3)}) contrast(${fx.contrast.toFixed(
      3
    )}) brightness(${fx.brightness.toFixed(3)})`
  );

  // ぼかし・歪みで縁が透けるぶんを拡大で外へ逃がす
  const escape =
    1 + Math.min(0.08, ((fx.blurX + fx.blurY) * 2.2 + fx.wave * 1.2) / Math.max(width, 1));

  const jx = (rand(seed, frame, 21) - 0.5) * 2 * fx.jitter;
  const jy = (rand(seed, frame, 22) - 0.5) * 2 * fx.jitter * fx.jitterYFactor;
  const groupTransform = `translate(${jx.toFixed(2)}px, ${jy.toFixed(
    2
  )}px) scale(${escape.toFixed(4)})`;

  // ---- from/to の束（切替は効果の頂点の陰で行う） ----
  const sideWrap = (node: React.ReactNode, scale: number): React.ReactNode =>
    scale === 1 ? (
      <AbsoluteFill>{node}</AbsoluteFill>
    ) : (
      <AbsoluteFill style={{ transform: `scale(${scale.toFixed(4)})` }}>
        {node}
      </AbsoluteFill>
    );

  const mediaStack = (
    <AbsoluteFill>
      {fx.cross < 0.999 && sideWrap(from, fx.fromScale)}
      {fx.cross > 0.001 && (
        <AbsoluteFill style={{ opacity: fx.cross >= 0.999 ? 1 : fx.cross }}>
          {sideWrap(to, fx.toScale)}
        </AbsoluteFill>
      )}
    </AbsoluteFill>
  );

  // ---- 横裂け（テア）: 画面を数本の水平帯にクリップし、帯ごとに横ズレしたコピーを重ねる ----
  const body =
    fx.tears.length === 0 ? (
      mediaStack
    ) : (
      <AbsoluteFill>
        {mediaStack}
        {fx.tears.map((t, i) => (
          <div
            key={i}
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              top: `${t.top.toFixed(2)}%`,
              height: `${t.height.toFixed(2)}%`,
              overflow: "hidden",
              transform: `translateX(${t.shift.toFixed(3)}%)`,
            }}
          >
            <div
              style={{
                position: "absolute",
                left: 0,
                width: "100%",
                top: `${(-(t.top / t.height) * 100).toFixed(2)}%`,
                height: `${((100 / t.height) * 100).toFixed(2)}%`,
              }}
            >
              {mediaStack}
            </div>
          </div>
        ))}
      </AbsoluteFill>
    );

  const rgbOn = fx.rgb > 0.5;
  const grainSeed = (seed * 13 + frame) % 9999;

  return (
    <AbsoluteFill style={{ background: "#000", overflow: "hidden" }}>
      {/* フィルタ定義（チャンネル単離 / 歪み+方向ブラー / モザイク / 帯の縁破り） */}
      <svg width={0} height={0} style={{ position: "absolute" }} aria-hidden>
        <defs>
          <filter id={`${uid}-cr`} colorInterpolationFilters="sRGB">
            <feColorMatrix
              type="matrix"
              values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0"
            />
          </filter>
          <filter id={`${uid}-cg`} colorInterpolationFilters="sRGB">
            <feColorMatrix
              type="matrix"
              values="0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0"
            />
          </filter>
          <filter id={`${uid}-cb`} colorInterpolationFilters="sRGB">
            <feColorMatrix
              type="matrix"
              values="0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0"
            />
          </filter>

          {(useWave || useBlur) && (
            <filter
              id={`${uid}-mfx`}
              x="-15%"
              y="-15%"
              width="130%"
              height="130%"
              colorInterpolationFilters="sRGB"
            >
              {useWave ? (
                <>
                  <feTurbulence
                    type="fractalNoise"
                    baseFrequency={`${fx.waveFreqX} ${fx.waveFreqY}`}
                    numOctaves={1}
                    seed={(seed + Math.floor(frame / 3)) % 9999}
                    result="w"
                  />
                  <feDisplacementMap
                    in="SourceGraphic"
                    in2="w"
                    scale={Number(fx.wave.toFixed(1))}
                    xChannelSelector="R"
                    yChannelSelector="G"
                    result="d"
                  />
                  <feGaussianBlur
                    in="d"
                    stdDeviation={`${fx.blurX.toFixed(2)} ${fx.blurY.toFixed(2)}`}
                  />
                </>
              ) : (
                <feGaussianBlur
                  in="SourceGraphic"
                  stdDeviation={`${fx.blurX.toFixed(2)} ${fx.blurY.toFixed(2)}`}
                />
              )}
            </filter>
          )}

          {mosaicOn &&
            (() => {
              // 古典モザイク: セル毎に1点サンプル（点タイル+合成in）→膨張で塗り広げる
              const c = Math.round(fx.mosaicCell);
              const dot = Math.max(1, Math.round(c * 0.2));
              const off = Math.round((c - dot) / 2);
              const rad = Math.min(48, Math.ceil(c / 2));
              return (
                <filter
                  id={`${uid}-mos`}
                  x="0%"
                  y="0%"
                  width="100%"
                  height="100%"
                  colorInterpolationFilters="sRGB"
                >
                  <feFlood
                    x={off}
                    y={off}
                    width={dot}
                    height={dot}
                    floodColor="#ffffff"
                    result="dot"
                  />
                  <feComposite
                    in="dot"
                    in2="dot"
                    operator="over"
                    x={0}
                    y={0}
                    width={c}
                    height={c}
                    result="cell"
                  />
                  <feTile in="cell" result="grid" />
                  <feComposite
                    in="SourceGraphic"
                    in2="grid"
                    operator="in"
                    result="pts"
                  />
                  <feMorphology in="pts" operator="dilate" radius={rad} />
                </filter>
              );
            })()}

          {fx.bands.length > 0 && (
            <filter
              id={`${uid}-rag`}
              x="-40%"
              y="-5%"
              width="180%"
              height="110%"
              colorInterpolationFilters="sRGB"
            >
              <feTurbulence
                type="fractalNoise"
                baseFrequency="0.9 0.012"
                numOctaves={2}
                seed={(seed * 7 + Math.floor(frame / 2)) % 9999}
                result="n"
              />
              <feDisplacementMap
                in="SourceGraphic"
                in2="n"
                scale={Number((26 * px).toFixed(1))}
                xChannelSelector="R"
                yChannelSelector="G"
              />
            </filter>
          )}
        </defs>
      </svg>

      {/* 映像本体（歪み・ぼかし・色ズレ・揺れ・縁逃がし） */}
      <AbsoluteFill
        style={{ filter: filterParts.join(" "), transform: groupTransform }}
      >
        {rgbOn ? (
          <>
            {/* G: 本体（裂け込み）。R/Bは全面を左右逆向きにずらしscreenで再合成 → 色収差 */}
            <AbsoluteFill style={{ filter: `url(#${uid}-cg)` }}>{body}</AbsoluteFill>
            <AbsoluteFill
              style={{
                filter: `url(#${uid}-cr)`,
                mixBlendMode: "screen",
                transform: `translateX(${(-fx.rgb).toFixed(2)}px)`,
              }}
            >
              {mediaStack}
            </AbsoluteFill>
            <AbsoluteFill
              style={{
                filter: `url(#${uid}-cb)`,
                mixBlendMode: "screen",
                transform: `translateX(${fx.rgb.toFixed(2)}px)`,
              }}
            >
              {mediaStack}
            </AbsoluteFill>
          </>
        ) : (
          body
        )}
      </AbsoluteFill>

      {/* 縦のテープ帯（縁をノイズ変位で破り、赤/シアンの縁取りを添える） */}
      {fx.bands.map((b, i) => (
        <div
          key={i}
          style={{
            position: "absolute",
            top: "-2%",
            bottom: "-2%",
            left: `${b.left.toFixed(2)}%`,
            width: `${b.width.toFixed(2)}%`,
            background: "rgba(232, 238, 238, 0.92)",
            opacity: b.opacity,
            filter: `url(#${uid}-rag)`,
            boxShadow:
              "-5px 0 0 rgba(255,70,80,0.45), 5px 0 0 rgba(70,225,255,0.45)",
          }}
        />
      ))}

      {/* 色被り（multiplyで赤を抜く / screenの寒色グロー） */}
      {fx.tintMul && fx.tintMul.opacity > 0.01 && (
        <AbsoluteFill
          style={{
            background: fx.tintMul.color,
            mixBlendMode: "multiply",
            opacity: fx.tintMul.opacity,
          }}
        />
      )}
      {fx.tintScreen && fx.tintScreen.opacity > 0.01 && (
        <AbsoluteFill
          style={{
            background: fx.tintScreen.css,
            mixBlendMode: "screen",
            opacity: fx.tintScreen.opacity,
          }}
        />
      )}

      {/* 走査線（暗線=multiply / 明線=screen） */}
      {fx.scanDark > 0.01 && (
        <AbsoluteFill
          style={{
            background:
              "repeating-linear-gradient(180deg, rgba(0,0,0,0.55) 0px, rgba(0,0,0,0.55) 1px, transparent 1px, transparent 4px)",
            mixBlendMode: "multiply",
            opacity: fx.scanDark,
          }}
        />
      )}
      {fx.scanLight > 0.01 && (
        <AbsoluteFill
          style={{
            background:
              "repeating-linear-gradient(180deg, transparent 0px, transparent 2px, rgba(255,255,255,0.5) 2px, rgba(255,255,255,0.5) 3px, transparent 3px, transparent 6px)",
            mixBlendMode: "screen",
            opacity: fx.scanLight,
          }}
        />
      )}

      {/* 粒子ノイズ: screen=白い塩 / multiply=黒い胡椒 / overlay=両方叩く */}
      {fx.saltOp > 0.01 && (
        <GrainLayer
          fid={`${uid}-gr0`}
          blend="screen"
          opacity={fx.saltOp}
          freq={fx.grainFreq}
          seed={grainSeed}
          slope={9}
          intercept={-5.6}
        />
      )}
      {fx.pepperOp > 0.01 && (
        <GrainLayer
          fid={`${uid}-gr1`}
          blend="multiply"
          opacity={fx.pepperOp}
          freq={fx.grainFreq * 0.9}
          seed={grainSeed + 311}
          slope={-9}
          intercept={6.1}
        />
      )}
      {fx.overlayOp > 0.01 && (
        <GrainLayer
          fid={`${uid}-gr2`}
          blend="overlay"
          opacity={fx.overlayOp}
          freq={fx.grainFreq * 0.55}
          seed={grainSeed + 733}
          slope={2.4}
          intercept={-0.7}
        />
      )}

      {/* 画面中央を横断する水平の光の筋（柔らかい帯+鋭い芯の2層） */}
      {fx.beam > 0.01 && (
        <>
          <AbsoluteFill
            style={{
              justifyContent: "center",
              mixBlendMode: "screen",
              pointerEvents: "none",
            }}
          >
            <div
              style={{
                height: "24%",
                background:
                  "linear-gradient(180deg, rgba(160,220,255,0) 0%, rgba(190,235,255,0.55) 45%, rgba(255,255,255,0.75) 50%, rgba(190,235,255,0.55) 55%, rgba(160,220,255,0) 100%)",
                filter: `blur(${(18 * px).toFixed(1)}px)`,
                opacity: 0.85 * fx.beam,
              }}
            />
          </AbsoluteFill>
          <AbsoluteFill
            style={{
              justifyContent: "center",
              mixBlendMode: "screen",
              pointerEvents: "none",
            }}
          >
            <div
              style={{
                height: `${Math.max(2, 3 * px).toFixed(1)}px`,
                background: "#ffffff",
                boxShadow: `0 0 ${(26 * px).toFixed(1)}px ${(10 * px).toFixed(
                  1
                )}px rgba(200,240,255,0.9)`,
                opacity: fx.beam,
              }}
            />
          </AbsoluteFill>
        </>
      )}

      {/* 中央の淡いグロー */}
      {fx.glow > 0.01 && (
        <AbsoluteFill
          style={{
            background:
              "radial-gradient(ellipse 50% 42% at 50% 50%, rgba(255,255,255,0.9) 0%, rgba(255,255,255,0) 70%)",
            mixBlendMode: "screen",
            opacity: fx.glow,
          }}
        />
      )}

      {/* フラッシュ: 白ベタ+screen=白飛び / 白ベタ+difference=ネガ反転 */}
      {fx.flashWhite > 0.005 && (
        <AbsoluteFill
          style={{
            background: "#ffffff",
            mixBlendMode: "screen",
            opacity: fx.flashWhite,
          }}
        />
      )}
      {fx.flashNeg > 0.005 && (
        <AbsoluteFill
          style={{
            background: "#ffffff",
            mixBlendMode: "difference",
            opacity: fx.flashNeg,
          }}
        />
      )}
    </AbsoluteFill>
  );
};
