import React, { useMemo } from "react";
import {
  AbsoluteFill,
  interpolate,
  random,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { loadFont as loadMontserrat } from "@remotion/google-fonts/Montserrat";

/**
 * TitleSignalGlitch17 — クリーンルーム再実装
 *
 * 洗練されたタイポグラフィが色のうねり（波状の色収差）を起こす
 * グリッチタイトル。
 *
 * 細身の大文字タイトルが字単位でランダム順に静かに現れ、以降は
 * 文字列を横断する「色収差の波」が走り続ける──各文字に赤/青の
 * 分身が水平スライス状に覗き、時折タイル状の色破片が散る。
 * 下段にはタイトル幅いっぱいの細いライン（左端に虹色チップ）と、
 * 字単位で色フリッカーするサブタイトルが並ぶ。終端では文字が
 * 一度グレーに沈んでからランダム順に消えていく。
 *
 * 機能記述「洗練されたタイポグラフィが色のうねり（波状の色収差）を
 * 起こすグリッチタイトル」を出発点に、旧レンダリング（見た目の
 * ものさし）と同等以上の質感を白紙から構成したもの。
 *
 * 既定フォントは Google Fonts（Montserrat Light 300）を
 * @remotion/google-fonts 経由でバンドル読込するため、Mac 内蔵
 * フォントに依存せず配布可能。
 */

const montserrat = loadMontserrat("normal", {
  weights: ["300", "400"],
  subsets: ["latin"],
});

/** 配布可能な既定フォントスタック */
const DEFAULT_FONT_FAMILY = `${montserrat.fontFamily}, sans-serif`;

export type TitleGlitch18Props = {
  /**
   * 表示する文言。1行目が主題、2行目以降はサブタイトルになる。
   * サブタイトルを出さない場合は1行だけ渡す。
   */
  text?: string;
  /** サブタイトルを明示指定する場合（text の2行目以降より優先） */
  subtitle?: string;
  /** 演出全体の尺（フレーム）。省略時はコンポジションの尺 */
  durationInFrames?: number;
  /** 主題の文字サイズ(px) */
  fontSize?: number;
  /** サブタイトルの文字サイズ(px) */
  subtitleFontSize?: number;
  /** フォント（既定は Montserrat のサンセリフスタック） */
  fontFamily?: string;
  /** 主題のフォントウェイト（既定 300 = Light） */
  fontWeight?: number | string;
  /** 主題の色 */
  color?: string;
  /** サブタイトルの色 */
  subtitleColor?: string;
  /** グリッチ分身・フリッカーに使うアクセント色 */
  accentColors?: string[];
  /** 主題の字間（em） */
  letterSpacingEm?: number;
  /** サブタイトルの字間（em） */
  subtitleLetterSpacingEm?: number;
  /** 主題の中心位置 Y（0〜1、画面高比） */
  posY?: number;
  /** 主題とサブタイトル行の間隔(px) */
  rowGap?: number;
  /** 入場（字がそろうまで）の秒数 */
  inSeconds?: number;
  /** 退場（字が消えるまで）の秒数 */
  outSeconds?: number;
  /** 色収差・破片の強さ（0=無効、1=標準） */
  glitchIntensity?: number;
  /** 色収差の波が文字列を渡る速さ（周期/秒） */
  waveSpeed?: number;
  /** ラインの太さ(px) */
  lineThickness?: number;
  /** 乱数シード（同じ値なら毎回同じ暴れ方） */
  seed?: number;
};

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const easeOutCubic = (t: number) => 1 - (1 - t) ** 3;

/** 決定論的ハッシュ（remotion.random は seed 固定で純粋） */
const hash = (...parts: (string | number)[]) => random(parts.join("|"));

/** 文字1つぶんの色収差スライバー（分身クローン） */
type Sliver = {
  color: string;
  dx: number;
  dy: number;
  clipTop: number; // %
  clipBottom: number; // %
  opacity: number;
};

/** 文字のそばに散るタイル破片 */
type Tile = {
  x: number; // em 相当（文字幅比）
  y: number;
  w: number;
  h: number;
  color: string;
  opacity: number;
};

export const TitleSignalGlitch17: React.FC<TitleGlitch18Props> = ({
  text = "MIDNIGHT\nA FILM BY VESPER",
  subtitle,
  durationInFrames,
  fontSize = 112,
  subtitleFontSize = 38,
  fontFamily = DEFAULT_FONT_FAMILY,
  fontWeight = 300,
  color = "#f5f5f3",
  subtitleColor = "#eceae6",
  accentColors = ["#3f6bff", "#ffd21f", "#ff2e3c", "#22d3ee", "#ff8a2a"],
  letterSpacingEm = 0.52,
  subtitleLetterSpacingEm = 0.34,
  posY = 0.52,
  rowGap = 56,
  inSeconds = 1.15,
  outSeconds = 1.0,
  glitchIntensity = 1,
  waveSpeed = 0.55,
  lineThickness = 2,
  seed = 18,
}) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames: compDuration } = useVideoConfig();
  const total = durationInFrames ?? compDuration;

  const lines = text.split("\n");
  const titleText = (lines[0] ?? "").toUpperCase();
  const subText = (subtitle ?? lines.slice(1).join(" ")).toUpperCase();

  // Array.from はサロゲートペア（絵文字等）を1文字として分割する（split("")は破壊する）
  const titleChars = useMemo(() => Array.from(titleText), [titleText]);
  const subChars = useMemo(() => Array.from(subText), [subText]);

  const inFrames = Math.max(1, Math.round(inSeconds * fps));
  const outFrames = Math.max(1, Math.round(outSeconds * fps));
  const outStart = total - outFrames;

  /**
   * 文字ごとの在場係数（0=不在、1=定着）。
   * 入場: ランダム順に短いフェードで出現（出現直後はわずかに沈む）。
   * 退場: ランダム順にグレー化 → 消灯。
   */
  const presence = (key: string, i: number) => {
    const inDelay = hash(seed, key, "in", i) * (inFrames * 0.72);
    const inDur = inFrames * 0.22 + hash(seed, key, "indur", i) * inFrames * 0.16;
    const appear = clamp01((frame - inDelay) / inDur);

    const outDelay = hash(seed, key, "out", i) * (outFrames * 0.62);
    const outDur = outFrames * 0.28;
    const vanish = clamp01((frame - (outStart + outDelay)) / outDur);
    return { appear: easeOutCubic(appear), vanish };
  };

  /**
   * 色収差の波。文字列を横断する連続波 ＋ ランダムなバースト。
   * 返り値 0〜1 がその文字のその瞬間の「うねり量」。
   */
  const waveAmount = (key: string, i: number, count: number) => {
    if (glitchIntensity <= 0) return 0;
    const t = frame / fps;
    // 連続波: 文字列上を左→右に走る緩い波。山は狭く、谷は広い。
    const phase = (t * waveSpeed - i / Math.max(1, count)) * Math.PI * 2;
    const carrier = Math.max(0, Math.sin(phase)) ** 6;
    // バースト: 4フレーム刻みのスロットで確率的に発火。
    const slot = Math.floor(frame / 4);
    const gate = hash(seed, key, "burst", i, slot);
    const burst = gate > 0.82 ? (gate - 0.82) / 0.18 : 0;
    return clamp01(carrier * 0.7 + burst) * glitchIntensity;
  };

  /** うねり量からスライバー（色分身）を作る */
  const makeSlivers = (key: string, i: number, amount: number): Sliver[] => {
    if (amount < 0.06) return [];
    const slivers: Sliver[] = [];
    const slot = Math.floor(frame / 2);
    const n = amount > 0.55 ? 3 : 2;
    for (let s = 0; s < n; s++) {
      const r1 = hash(seed, key, "sl-top", i, slot, s);
      const r2 = hash(seed, key, "sl-h", i, slot, s);
      const top = r1 * 82;
      const height = 8 + r2 * 26;
      const cIdx = Math.floor(hash(seed, key, "sl-c", i, slot, s) * accentColors.length);
      const dir = hash(seed, key, "sl-d", i, slot, s) > 0.5 ? 1 : -1;
      slivers.push({
        color: accentColors[cIdx],
        dx: dir * (1.5 + amount * 4.5) * (0.6 + hash(seed, key, "sl-x", i, slot, s)),
        dy: (hash(seed, key, "sl-y", i, slot, s) - 0.5) * amount * 5,
        clipTop: top,
        clipBottom: Math.max(0, 100 - top - height),
        opacity: 0.5 + amount * 0.5,
      });
    }
    return slivers;
  };

  /** うねり量が強いときだけ、文字のそばにタイル破片を散らす */
  const makeTiles = (key: string, i: number, amount: number): Tile[] => {
    if (amount < 0.4) return [];
    const tiles: Tile[] = [];
    const slot = Math.floor(frame / 3);
    const n = amount > 0.75 ? 3 : 1;
    for (let s = 0; s < n; s++) {
      if (hash(seed, key, "tile-on", i, slot, s) < 0.45) continue;
      const cIdx = Math.floor(hash(seed, key, "tile-c", i, slot, s) * accentColors.length);
      tiles.push({
        x: (hash(seed, key, "tile-x", i, slot, s) - 0.5) * 1.8,
        y: (hash(seed, key, "tile-y", i, slot, s) - 0.5) * 1.9,
        w: 0.05 + hash(seed, key, "tile-w", i, slot, s) * 0.12,
        h: 0.04 + hash(seed, key, "tile-h", i, slot, s) * 0.08,
        color: accentColors[cIdx],
        opacity: 0.35 + amount * 0.5,
      });
    }
    return tiles;
  };

  /** タイトル1文字を描く */
  const renderTitleChar = (ch: string, i: number) => {
    if (ch === " ") {
      return <span key={`sp-${i}`}>{" "}</span>;
    }
    const { appear, vanish } = presence("title", i);
    const amount = appear >= 1 && vanish <= 0 ? waveAmount("title", i, titleChars.length) : 0;
    const slivers = makeSlivers("title", i, amount);
    const tiles = makeTiles("title", i, amount);

    // 入場中: 暗いグレーから白へ、わずかに縦にずれて定着。
    const introDrop = (1 - appear) * (hash(seed, "title-drop", i) - 0.35) * 46;
    // 退場中: 一度グレーに沈み、その後消灯。
    const fadeGray = clamp01(vanish * 2); // 前半でグレー化
    const gone = clamp01(vanish * 2 - 1); // 後半で消灯
    const baseOpacity = appear * (1 - gone);
    const grayMix = Math.max((1 - appear) * 0.75, fadeGray * 0.62);

    const charColor = grayMix > 0 ? `rgba(148,148,150,1)` : color;
    const mainStyle: React.CSSProperties = {
      position: "relative",
      display: "inline-block",
      transform: `translateY(${introDrop.toFixed(2)}px)`,
      opacity: baseOpacity,
    };

    return (
      <span key={`t-${i}`} style={mainStyle}>
        {/* 色分身（下層） */}
        {slivers.map((sl, k) => (
          <span
            key={`sl-${k}`}
            aria-hidden
            style={{
              position: "absolute",
              left: 0,
              top: 0,
              color: sl.color,
              opacity: sl.opacity * baseOpacity,
              transform: `translate(${sl.dx.toFixed(2)}px, ${sl.dy.toFixed(2)}px)`,
              clipPath: `inset(${sl.clipTop.toFixed(1)}% 0 ${sl.clipBottom.toFixed(1)}% 0)`,
              pointerEvents: "none",
            }}
          >
            {ch}
          </span>
        ))}
        {/* 本体 */}
        <span
          style={{
            position: "relative",
            color: charColor,
            opacity: grayMix > 0 ? 1 - grayMix * 0.25 : 1,
          }}
        >
          {ch}
        </span>
        {/* タイル破片 */}
        {tiles.map((tl, k) => (
          <span
            key={`tl-${k}`}
            aria-hidden
            style={{
              position: "absolute",
              left: `${(50 + tl.x * 50).toFixed(1)}%`,
              top: `${(50 + tl.y * 50).toFixed(1)}%`,
              width: `${(tl.w * fontSize).toFixed(1)}px`,
              height: `${(tl.h * fontSize).toFixed(1)}px`,
              background: tl.color,
              opacity: tl.opacity * baseOpacity,
              pointerEvents: "none",
            }}
          />
        ))}
      </span>
    );
  };

  /** サブタイトル1文字を描く（色フリッカー付き） */
  const renderSubChar = (ch: string, i: number) => {
    if (ch === " ") {
      return <span key={`ssp-${i}`}>{" "}</span>;
    }
    const { appear, vanish } = presence("sub", i);
    const gone = clamp01(vanish * 1.6);
    const baseOpacity = appear * (1 - gone);

    // 色フリッカー: 3フレーム刻みのスロットで低確率発火。
    let chColor = subtitleColor;
    if (glitchIntensity > 0 && appear >= 1 && vanish <= 0) {
      const slot = Math.floor(frame / 3);
      const gate = hash(seed, "sub-flicker", i, slot);
      if (gate > 0.88) {
        const cIdx = Math.floor(hash(seed, "sub-flicker-c", i, slot) * accentColors.length);
        chColor = accentColors[cIdx];
      }
    }
    return (
      <span
        key={`s-${i}`}
        style={{
          display: "inline-block",
          color: chColor,
          opacity: baseOpacity,
        }}
      >
        {ch}
      </span>
    );
  };

  // ライン: 入場で左から伸び、退場でフェード。左端に虹色チップ。
  const lineGrow = easeOutCubic(clamp01((frame - inFrames * 0.25) / (inFrames * 0.6)));
  const lineFade = 1 - clamp01((frame - outStart) / (outFrames * 0.55));
  const chipColors = accentColors.slice(0, 3);

  return (
    <AbsoluteFill style={{ fontFamily }}>
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: `${posY * 100}%`,
          transform: "translateY(-50%)",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
        }}
      >
        {/* 主題 */}
        <div
          style={{
            fontSize,
            fontWeight,
            letterSpacing: `${letterSpacingEm}em`,
            whiteSpace: "nowrap",
            // 最終字の letter-spacing ぶん右に寄るのを打ち消す
            paddingLeft: `${letterSpacingEm}em`,
          }}
        >
          {titleChars.map(renderTitleChar)}
        </div>

        {/* サブタイトル行（ライン + 文字） */}
        {subText.length > 0 && (
          <div
            style={{
              marginTop: rowGap,
              display: "flex",
              alignItems: "center",
              gap: "0.9em",
              fontSize: subtitleFontSize,
              fontWeight: 400,
              letterSpacing: `${subtitleLetterSpacingEm}em`,
              whiteSpace: "nowrap",
            }}
          >
            <div
              style={{
                position: "relative",
                width: 480 * lineGrow,
                height: lineThickness,
                opacity: lineFade * clamp01(lineGrow * 2),
                background:
                  "linear-gradient(90deg, rgba(255,255,255,0.9), rgba(255,255,255,0.75) 60%, rgba(110,140,255,0.9))",
              }}
            >
              {/* 左端の虹色チップ */}
              {chipColors.map((c, k) => (
                <span
                  key={`chip-${k}`}
                  style={{
                    position: "absolute",
                    left: k * 9,
                    top: 0,
                    width: 7,
                    height: lineThickness,
                    background: c,
                  }}
                />
              ))}
            </div>
            <div>{subChars.map(renderSubChar)}</div>
          </div>
        )}
      </div>
    </AbsoluteFill>
  );
};

export default TitleSignalGlitch17;
