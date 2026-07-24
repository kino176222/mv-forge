import React, { useId, useMemo } from "react";
import {
  AbsoluteFill,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

/**
 * MvTransitionColorSmear — 方向性ブラー＋プリズム色分解のカラーブラー系トランジション（クリーンルーム実装）
 *
 * 機能: from→to の約1秒切替。中盤に向けて画面を方向性ガウスブラーと
 *       RGBチャンネル分解で「潰し」、最大ボケの真下でカット気味に入れ替え、
 *       じわっと元に戻る。カラーウォッシュ（screen/multiply）と中央グローで
 *       個体ごとの色の性格を出す。
 *
 * 設計メモ:
 * - 効果エンベロープは台形（〜48%まで直線で立ち上がり→52%まで頂点保持→直線で解ける）。
 *   両端は必ずゼロ＝素の映像で始まり素の映像で終わる。
 * - プリズムは1本のSVGフィルタ内で完結: 軸方向ガウスブラー→R/G/B抽出→
 *   RとBを軸に沿って逆方向オフセット→screenで再合成（チャンネルが互いに素なので
 *   整列時は元の色を正確に再構成する）。
 * - from/to でフィルタ id を分けて2定義（上下方向の個体は from/to が独立
 *   エンベロープを持つため）。
 * - 乱数はすべて (seed, frame, index) から決定的に生成。Math.random 不使用。
 *   微振動は「フレームの3倍速」でハッシュを更新し中盤だけ振幅最大に。
 * - 効果量はフルHD幅基準のpxで定義し width/1920 を掛けて解像度非依存に。
 *   ブラーの縁食われはレイヤー膨張（エンベロープ比例）＋フィルタ領域拡張で隠す。
 * - direction で左右上下の4個体、direction 省略時は variant で
 *   横潰し/縦潰しの2個体（脱色＋光条系）に分岐する。
 */

export interface MvTransitionColorSmearProps {
  /** 旧カット */
  from: React.ReactNode;
  /** 新カット */
  to: React.ReactNode;
  /** トランジション全体の長さ（フレーム） */
  durationInFrames: number;
  /** 方向族のみ。省略時は variant で横/縦の潰し系に分岐 */
  direction?: "left" | "right" | "up" | "down" | "forward" | "backward";
  /** 0..1 同家族内の見た目分岐（決定論的） */
  variant?: number;
}

/** (a,b,c) から 0..1 の決定的な擬似乱数（GLSL定番ハッシュ） */
const rand = (a: number, b: number, c: number): number => {
  const s = Math.sin(a * 127.1 + b * 311.7 + c * 74.7) * 43758.5453123;
  return s - Math.floor(s);
};

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

type Mode = "left" | "right" | "up" | "down" | "distortH" | "distortV";

type Look = {
  /** ブラー/色ズレの効果軸 */
  axis: "x" | "y";
  /** from/to が独立エンベロープを持つ変奏か */
  independent: boolean;
  /** 軸方向ブラー最大量（px @1920） */
  blurPx: number;
  /** 直交方向ブラー（異方性個体のみ >0） */
  crossPx: number;
  /** R/B チャンネルの逆方向オフセット最大量（px @1920） */
  splitPx: number;
  /** 全チャンネル共通の軸方向バイアス（右流れ個体のみ、符号込み） */
  biasPx: number;
  /** 中盤の膨張パンチ量（uniform scale 追加分） */
  punch: number;
  /** 二段ズーム（階段状の膨張エンベロープ）を使うか */
  twoStage: boolean;
  /** 軸方向ストレッチ量 */
  stretchX: number;
  stretchY: number;
  /** 共通スタックの軸方向ドリフト（px @1920, 符号込み） */
  driftStackPx: number;
  /** 独立エンベロープ個体の from/to 逆向きドリフト（px @1920, 符号込み） */
  driftFromPx: number;
  driftToPx: number;
  /** 微振動の最大振幅（px @1920）と軸重み */
  jitterPx: number;
  jitterXW: number;
  jitterYW: number;
  /** 中盤の脱色量 0..1 */
  desat: number;
  /** カラーウォッシュ（全画面グラデ） */
  washCss: string;
  washBlend: "screen" | "multiply";
  washMax: number;
  /** 減光（暗赤 multiply の「フィルム焼け」） */
  darkenCss?: string;
  darkenMax?: number;
  /** 中央グロー（放射グラデ, screen） */
  glowCss: string;
  glowMax: number;
  /** 粒子ノイズの最大不透明度 0..1（0で無し） */
  grain: number;
  /** 細縞の繰り返しグラデ（縦縞/光条列） */
  stripesCss?: string;
  stripesBlend?: "screen" | "overlay" | "multiply";
  stripesMax?: number;
  /** 暗バンドの繰り返しグラデ */
  bandsCss?: string;
  bandsMax?: number;
  /** 光条（個別div）の本数と向き・色 */
  streaks: number;
  streakVertical: boolean;
  streakColor: string;
  /** 隅のライトリーク */
  leakCss?: string;
  leakMax?: number;
};

const resolveMode = (
  direction: MvTransitionColorSmearProps["direction"],
  variant: number
): Mode => {
  switch (direction) {
    case "left":
    case "right":
    case "up":
    case "down":
      return direction;
    case "forward":
      return "distortH";
    case "backward":
      return "distortV";
    default:
      return variant < 0.5 ? "distortH" : "distortV";
  }
};

const buildLook = (mode: Mode, variant: number): Look => {
  // variant で色相を少しだけ振る（家族内の決定論的な見た目分岐）
  const vh = (clamp01(variant) - 0.5) * 26;

  const base: Look = {
    axis: "x",
    independent: false,
    blurPx: 85,
    crossPx: 0,
    splitPx: 22,
    biasPx: 0,
    punch: 0.18,
    twoStage: false,
    stretchX: 0,
    stretchY: 0,
    driftStackPx: 0,
    driftFromPx: 0,
    driftToPx: 0,
    jitterPx: 0,
    jitterXW: 1,
    jitterYW: 1,
    desat: 0,
    washCss: "",
    washBlend: "screen",
    washMax: 0,
    glowCss: "",
    glowMax: 0,
    grain: 0,
    streaks: 0,
    streakVertical: false,
    streakColor: "#ffffff",
  };

  switch (mode) {
    case "left":
      // 最簡素: 横ブラー＋左シフト＋2割膨張、青→紫ウォッシュ＋白グロー
      return {
        ...base,
        driftStackPx: -150,
        punch: 0.2,
        washCss: `linear-gradient(105deg, hsla(${212 + vh}, 95%, 62%, 1) 0%, hsla(${268 + vh}, 90%, 58%, 1) 100%)`,
        washMax: 0.5,
        glowCss:
          "radial-gradient(48% 42% at 50% 48%, rgba(255,255,255,0.95) 0%, rgba(255,255,255,0) 70%)",
        glowMax: 0.55,
      };
    case "right":
      // 全チャンネル右バイアスで右流れ強調。横ストレッチ＋強め揺れ、黒減光＋濃い青→紫
      return {
        ...base,
        driftStackPx: 150,
        biasPx: 34,
        punch: 0.15,
        stretchX: 0.16,
        jitterPx: 10,
        washCss: `linear-gradient(100deg, hsla(${222 + vh}, 90%, 48%, 1) 0%, hsla(${282 + vh}, 85%, 46%, 1) 100%)`,
        washMax: 0.55,
        darkenCss:
          "radial-gradient(125% 125% at 50% 50%, rgba(255,255,255,1) 35%, rgba(28,8,30,1) 100%)",
        darkenMax: 0.45,
        glowCss:
          "radial-gradient(50% 44% at 46% 50%, rgba(255,255,255,0.9) 0%, rgba(255,255,255,0) 70%)",
        glowMax: 0.4,
      };
    case "up":
      // from/to 独立エンベロープ＋逆向き縦ドリフト（上抜け/下から上）。
      // 膨張最大、ピンク〜暗赤の焼き込み＋粒子＋縦縞
      return {
        ...base,
        axis: "y",
        independent: true,
        punch: 0.3,
        stretchY: 0.08,
        driftFromPx: -230,
        driftToPx: 210,
        washCss: `linear-gradient(180deg, hsla(${338 + vh}, 95%, 68%, 1) 0%, hsla(${352 + vh}, 90%, 46%, 1) 100%)`,
        washMax: 0.5,
        darkenCss:
          "radial-gradient(120% 120% at 50% 55%, rgba(255,255,255,1) 30%, rgba(72,4,14,1) 100%)",
        darkenMax: 0.5,
        glowCss: `radial-gradient(46% 52% at 50% 46%, hsla(${344 + vh}, 100%, 78%, 0.95) 0%, hsla(${344 + vh}, 100%, 78%, 0) 70%)`,
        glowMax: 0.5,
        grain: 0.16,
        stripesCss:
          "repeating-linear-gradient(90deg, rgba(255,255,255,0.09) 0px, rgba(255,255,255,0.09) 1px, rgba(255,255,255,0) 1px, rgba(255,255,255,0) 7px)",
        stripesBlend: "screen",
        stripesMax: 0.35,
      };
    case "down":
      // 独立エンベロープ型の下向き（from下抜け/to降下）。二段ズーム＋縦優勢の揺れ、
      // 暗赤multiply減光＋赤い中央閃光。粒子なし
      return {
        ...base,
        axis: "y",
        independent: true,
        punch: 0.22,
        twoStage: true,
        stretchY: 0.07,
        driftFromPx: 230,
        driftToPx: -210,
        jitterPx: 9,
        jitterXW: 0.35,
        jitterYW: 1,
        washCss: `linear-gradient(180deg, hsla(${4 + vh}, 90%, 50%, 1) 0%, hsla(${350 + vh}, 85%, 38%, 1) 100%)`,
        washMax: 0.25,
        darkenCss:
          "radial-gradient(115% 115% at 50% 50%, rgba(255,255,255,1) 28%, rgba(58,2,8,1) 100%)",
        darkenMax: 0.55,
        glowCss: `radial-gradient(42% 46% at 50% 50%, hsla(${4 + vh}, 100%, 62%, 0.95) 0%, hsla(${4 + vh}, 100%, 62%, 0) 68%)`,
        glowMax: 0.6,
      };
    case "distortH":
      // 横:縦≒10:1 の異方性ブラー＋中盤脱色。暖色光条＋右下暖色リーク＋粒子。
      // 揺れなし・ズーム控えめ
      return {
        ...base,
        blurPx: 80,
        crossPx: 8,
        splitPx: 18,
        punch: 0.08,
        desat: 0.45,
        washCss: `linear-gradient(120deg, hsla(${26 + vh}, 85%, 55%, 1) 0%, hsla(${8 + vh}, 70%, 40%, 1) 100%)`,
        washMax: 0.18,
        glowCss:
          "radial-gradient(52% 46% at 46% 50%, rgba(255,244,230,0.85) 0%, rgba(255,244,230,0) 70%)",
        glowMax: 0.35,
        grain: 0.14,
        streaks: 7,
        streakVertical: false,
        streakColor: `hsla(${28 + vh}, 100%, 72%, 1)`,
        leakCss: `radial-gradient(55% 55% at 88% 84%, hsla(${24 + vh}, 100%, 58%, 0.9) 0%, hsla(${24 + vh}, 100%, 58%, 0) 70%)`,
        leakMax: 0.55,
      };
    case "distortV":
    default:
      // 縦10:1ブラー＋縦揺れ＋脱色。白縦光条＋暗バンド＋左下赤リーク
      return {
        ...base,
        axis: "y",
        blurPx: 80,
        crossPx: 8,
        splitPx: 18,
        punch: 0.1,
        jitterPx: 7,
        jitterXW: 0.2,
        jitterYW: 1,
        desat: 0.4,
        washCss: `linear-gradient(180deg, hsla(${352 + vh}, 60%, 34%, 1) 0%, hsla(${340 + vh}, 55%, 22%, 1) 100%)`,
        washMax: 0.15,
        glowCss:
          "radial-gradient(46% 52% at 50% 50%, rgba(255,248,248,0.85) 0%, rgba(255,248,248,0) 70%)",
        glowMax: 0.35,
        stripesCss:
          "repeating-linear-gradient(90deg, rgba(255,255,255,0) 0px, rgba(255,255,255,0) 84px, rgba(255,255,255,0.22) 85px, rgba(255,255,255,0.22) 86px)",
        stripesBlend: "screen",
        stripesMax: 0.5,
        bandsCss:
          "repeating-linear-gradient(90deg, rgba(0,0,0,0.32) 0px, rgba(0,0,0,0.32) 46px, rgba(0,0,0,0) 46px, rgba(0,0,0,0) 132px)",
        bandsMax: 0.4,
        streaks: 5,
        streakVertical: true,
        streakColor: "rgba(255,252,250,1)",
        leakCss: `radial-gradient(50% 55% at 8% 88%, hsla(${350 + vh}, 95%, 42%, 0.9) 0%, hsla(${350 + vh}, 95%, 42%, 0) 70%)`,
        leakMax: 0.5,
      };
  }
};

/** チャンネル抽出行列（alpha は保持） */
const MAT_R =
  "1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0";
const MAT_G =
  "0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0";
const MAT_B =
  "0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0";
const MAT_GRAY =
  "0.33 0.33 0.33 0 0  0.33 0.33 0.33 0 0  0.33 0.33 0.33 0 0  0 0 0 0 1";

/** 軸ブラー＋プリズム分解を1本にまとめたフィルタ定義 */
const PrismFilter: React.FC<{
  id: string;
  bx: number;
  by: number;
  offX: number;
  offY: number;
  biasX: number;
  biasY: number;
}> = ({ id, bx, by, offX, offY, biasX, biasY }) => (
  <filter
    id={id}
    x="-25%"
    y="-25%"
    width="150%"
    height="150%"
    colorInterpolationFilters="sRGB"
  >
    <feGaussianBlur
      in="SourceGraphic"
      stdDeviation={`${Math.max(0, bx).toFixed(2)} ${Math.max(0, by).toFixed(2)}`}
      result="blur"
    />
    <feColorMatrix in="blur" type="matrix" values={MAT_R} result="chR" />
    <feOffset
      in="chR"
      dx={(-offX + biasX).toFixed(2)}
      dy={(-offY + biasY).toFixed(2)}
      result="chRo"
    />
    <feColorMatrix in="blur" type="matrix" values={MAT_G} result="chG" />
    <feOffset
      in="chG"
      dx={biasX.toFixed(2)}
      dy={biasY.toFixed(2)}
      result="chGo"
    />
    <feColorMatrix in="blur" type="matrix" values={MAT_B} result="chB" />
    <feOffset
      in="chB"
      dx={(offX + biasX).toFixed(2)}
      dy={(offY + biasY).toFixed(2)}
      result="chBo"
    />
    {/* チャンネルが互いに素なので screen 合成＝加算＝正確な再構成 */}
    <feBlend in="chRo" in2="chGo" mode="screen" result="chRG" />
    <feBlend in="chRG" in2="chBo" mode="screen" />
  </filter>
);

export const MvTransitionColorSmear: React.FC<MvTransitionColorSmearProps> = ({
  from,
  to,
  durationInFrames,
  direction,
  variant = 0,
}) => {
  const frame = useCurrentFrame();
  const { width } = useVideoConfig();
  const rawId = useId();
  const uid = useMemo(() => rawId.replace(/[^a-zA-Z0-9_-]/g, ""), [rawId]);

  const v = clamp01(variant);
  const mode = resolveMode(direction, v);
  const look = useMemo(() => buildLook(mode, v), [mode, v]);
  const seed = 13 + Math.round(v * 997);

  // 解像度非依存: 効果量はフルHD幅基準
  const k = width / 1920;

  const last = Math.max(1, durationInFrames - 1);
  const p = clamp01(frame / last);

  // ---- 時間フェーズ ---------------------------------------------------------
  // 効果エンベロープ: 台形（〜48%立ち上がり→52%まで頂点保持→解ける）
  const env = interpolate(p, [0, 0.48, 0.52, 1], [0, 1, 1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  // 独立エンベロープ変奏: from は「クリア→前半で最大ボケ」/ to は「最大ボケ→後半でクリア」
  const fromEnv = look.independent
    ? interpolate(p, [0, 0.48, 0.6], [0, 1, 1], {
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
      })
    : env;
  const toEnv = look.independent
    ? interpolate(p, [0.4, 0.52, 1], [1, 1, 0], {
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
      })
    : env;
  // A→B入替: 中央±6.5%の狭い窓。最大ボケの真下でカット気味に入れ替える
  const toOpacity = interpolate(p, [0.435, 0.565], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  // ウォッシュ窓はブラーより広く、グロー窓はその中間
  const washEnv = interpolate(p, [0.13, 0.5, 0.87], [0, 1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const glowEnv = interpolate(p, [0.26, 0.5, 0.74], [0, 1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  // 膨張パンチ: 二段ズーム個体は階段状の折れ線
  const punchEnv = look.twoStage
    ? interpolate(
        p,
        [0, 0.22, 0.3, 0.46, 0.54, 0.7, 0.78, 1],
        [0, 0.45, 0.5, 1, 1, 0.5, 0.45, 0],
        { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
      )
    : env;

  // ---- フィルタ量（from/to で独立） -----------------------------------------
  const ax = look.axis === "x" ? 1 : 0;
  const ay = look.axis === "y" ? 1 : 0;
  const mkAmounts = (e: number) => {
    const b = look.blurPx * k * e;
    const cb = look.crossPx * k * e;
    const off = look.splitPx * k * e;
    const bias = look.biasPx * k * e;
    return {
      bx: ax ? b : cb,
      by: ay ? b : cb,
      offX: off * ax,
      offY: off * ay,
      biasX: bias * ax,
      biasY: bias * ay,
    };
  };
  const amtFrom = mkAmounts(fromEnv);
  const amtTo = mkAmounts(toEnv);

  // ---- 変形（膨張パンチ＋ストレッチ＋ドリフト＋微振動） ----------------------
  // 微振動: フレームの3倍速でハッシュ更新、中盤だけ振幅最大
  const jAmp = look.jitterPx * k * env;
  const jx = (rand(seed, frame * 3, 11) - 0.5) * 2 * jAmp * look.jitterXW;
  const jy = (rand(seed, frame * 3, 12) - 0.5) * 2 * jAmp * look.jitterYW;
  // 縁の黒食われ隠し（env比例の下駄）＋個体の膨張パンチ
  const inflate = 0.06 * env + look.punch * punchEnv;
  const sx = (1 + inflate) * (1 + look.stretchX * env);
  const sy = (1 + inflate) * (1 + look.stretchY * env);
  const stackDx = look.driftStackPx * k * env * ax + jx;
  const stackDy = look.driftStackPx * k * env * ay + jy;

  const fromDx = look.driftFromPx * k * fromEnv * ax;
  const fromDy = look.driftFromPx * k * fromEnv * ay;
  const toDx = look.driftToPx * k * toEnv * ax;
  const toDy = look.driftToPx * k * toEnv * ay;

  // 中盤の脱色＋コントラスト微増（フィルム処理感）
  const grade =
    look.desat > 0
      ? `saturate(${(1 - look.desat * env).toFixed(3)}) contrast(${(1 + 0.1 * env).toFixed(3)})`
      : undefined;

  // ---- 光条（決定論的な配置＋フレーム毎フリッカー） --------------------------
  const streaks = useMemo(
    () =>
      Array.from({ length: look.streaks }, (_, i) => ({
        pos: 4 + rand(seed, 1, i * 3 + 1) * 88, // 配置（横光条=top% / 縦光条=left%）
        start: rand(seed, 2, i * 3 + 2) * 42, // 進行方向の開始位置%
        span: 32 + rand(seed, 3, i * 3 + 3) * 58, // 長さ%
        thick: 1 + rand(seed, 4, i * 3 + 4) * 2.4, // 太さ（px @1080相当）
      })),
    [look.streaks, seed]
  );

  const grainOpacity = look.grain * env;
  const grainSeed = (seed * 7 + frame * 13) % 65536;

  return (
    <AbsoluteFill style={{ background: "#000", overflow: "hidden" }}>
      {/* プリズム分解フィルタ定義（from/to で量が独立） */}
      <svg width={0} height={0} style={{ position: "absolute" }} aria-hidden>
        <defs>
          <PrismFilter id={`${uid}-pf`} {...amtFrom} />
          <PrismFilter id={`${uid}-pt`} {...amtTo} />
          {look.grain > 0 && (
            <filter id={`${uid}-gr`} x="0%" y="0%" width="100%" height="100%">
              <feTurbulence
                type="fractalNoise"
                baseFrequency="0.85"
                numOctaves={2}
                seed={grainSeed}
                stitchTiles="stitch"
              />
              <feColorMatrix type="matrix" values={MAT_GRAY} />
            </filter>
          )}
        </defs>
      </svg>

      {/* フッテージ段（膨張＋ストレッチ＋ドリフト＋揺れ＋脱色） */}
      <AbsoluteFill
        style={{
          transform: `translate(${stackDx.toFixed(2)}px, ${stackDy.toFixed(2)}px) scale(${sx.toFixed(4)}, ${sy.toFixed(4)})`,
          filter: grade,
        }}
      >
        <AbsoluteFill
          style={{
            transform:
              look.independent && (fromDx !== 0 || fromDy !== 0)
                ? `translate(${fromDx.toFixed(2)}px, ${fromDy.toFixed(2)}px)`
                : undefined,
          }}
        >
          <AbsoluteFill style={{ filter: `url(#${uid}-pf)` }}>
            {from}
          </AbsoluteFill>
        </AbsoluteFill>
        {toOpacity > 0.001 && (
          <AbsoluteFill
            style={{
              opacity: toOpacity,
              transform:
                look.independent && (toDx !== 0 || toDy !== 0)
                  ? `translate(${toDx.toFixed(2)}px, ${toDy.toFixed(2)}px)`
                  : undefined,
            }}
          >
            <AbsoluteFill style={{ filter: `url(#${uid}-pt)` }}>
              {to}
            </AbsoluteFill>
          </AbsoluteFill>
        )}
      </AbsoluteFill>

      {/* 減光: 暗赤/黒の放射グラデを multiply（フィルム焼けの沈み） */}
      {look.darkenCss && (look.darkenMax ?? 0) * washEnv > 0.004 && (
        <AbsoluteFill
          style={{
            background: look.darkenCss,
            mixBlendMode: "multiply",
            opacity: (look.darkenMax ?? 0) * washEnv,
            pointerEvents: "none",
          }}
        />
      )}

      {/* カラーウォッシュ: 全画面グラデを screen で焼く */}
      {look.washMax * washEnv > 0.004 && (
        <AbsoluteFill
          style={{
            background: look.washCss,
            mixBlendMode: look.washBlend,
            opacity: look.washMax * washEnv,
            pointerEvents: "none",
          }}
        />
      )}

      {/* 暗バンド（縦潰し個体） */}
      {look.bandsCss && (look.bandsMax ?? 0) * glowEnv > 0.004 && (
        <AbsoluteFill
          style={{
            background: look.bandsCss,
            mixBlendMode: "multiply",
            opacity: (look.bandsMax ?? 0) * glowEnv,
            pointerEvents: "none",
          }}
        />
      )}

      {/* 細縞（縦縞/光条列の繰り返しグラデ） */}
      {look.stripesCss && (look.stripesMax ?? 0) * glowEnv > 0.004 && (
        <AbsoluteFill
          style={{
            background: look.stripesCss,
            mixBlendMode: look.stripesBlend ?? "screen",
            opacity: (look.stripesMax ?? 0) * glowEnv,
            pointerEvents: "none",
          }}
        />
      )}

      {/* 隅のライトリーク */}
      {look.leakCss && (look.leakMax ?? 0) * washEnv > 0.004 && (
        <AbsoluteFill
          style={{
            background: look.leakCss,
            mixBlendMode: "screen",
            opacity: (look.leakMax ?? 0) * washEnv,
            pointerEvents: "none",
          }}
        />
      )}

      {/* 中央グロー（ライトレイの代役） */}
      {look.glowMax * glowEnv > 0.004 && (
        <AbsoluteFill
          style={{
            background: look.glowCss,
            mixBlendMode: "screen",
            opacity: look.glowMax * glowEnv,
            pointerEvents: "none",
          }}
        />
      )}

      {/* 光条（決定論的配置、フレーム毎に明滅） */}
      {glowEnv > 0.02 &&
        streaks.map((s, i) => {
          const flicker = 0.45 + 0.55 * rand(seed, frame, 60 + i);
          const op = glowEnv * flicker;
          const thick = Math.max(1, s.thick * k);
          return (
            <div
              key={i}
              style={{
                position: "absolute",
                ...(look.streakVertical
                  ? {
                      left: `${s.pos.toFixed(2)}%`,
                      top: `${s.start.toFixed(2)}%`,
                      height: `${s.span.toFixed(2)}%`,
                      width: `${thick.toFixed(2)}px`,
                      background: `linear-gradient(180deg, transparent 0%, ${look.streakColor} 50%, transparent 100%)`,
                    }
                  : {
                      top: `${s.pos.toFixed(2)}%`,
                      left: `${s.start.toFixed(2)}%`,
                      width: `${s.span.toFixed(2)}%`,
                      height: `${thick.toFixed(2)}px`,
                      background: `linear-gradient(90deg, transparent 0%, ${look.streakColor} 50%, transparent 100%)`,
                    }),
                mixBlendMode: "screen",
                opacity: op.toFixed(3),
                pointerEvents: "none",
              }}
            />
          );
        })}

      {/* 粒子: フラクタルノイズのグレインを overlay 弱で（フレーム毎にシード更新） */}
      {grainOpacity > 0.004 && (
        <AbsoluteFill
          style={{
            mixBlendMode: "overlay",
            opacity: grainOpacity,
            pointerEvents: "none",
          }}
        >
          <svg width="100%" height="100%">
            <rect
              width="100%"
              height="100%"
              filter={`url(#${uid}-gr)`}
            />
          </svg>
        </AbsoluteFill>
      )}
    </AbsoluteFill>
  );
};
