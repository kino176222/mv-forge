import React, { useMemo } from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import { loadFont as loadMontserrat } from "@remotion/google-fonts/Montserrat";

/**
 * TitleSignalGlitch25 — クリーンルーム再実装
 *
 * 縦方向のスミア（残像）で飛散し明滅するグリッチタイトル。
 *
 * 構成（機能記述と、自前レンダリングした旧の見た目を品質のものさしに
 * 白紙から設計したもの。旧実装のコード・定数は参照していない）:
 * - 黒地に白のライトウェイト大文字（ワイドトラッキング）が主題。
 * - 入場: 文字が1文字ずつランダムに点滅しながら出現。RGBチャンネル分離、
 *   上下への縦スミア残像、画面を貫く細い縦ストリーク、アウトライン化・
 *   純色化などの文字単位の乱れを伴う。
 * - 中盤: ほぼクリーンに保持（ごく淡い色フリンジのみ）。
 * - 後半: もう一度グリッチバーストが走り、終端では文字が1文字ずつ
 *   飛散して消え、断片だけを残して暗転する。
 *
 * 既定フォントは Google Fonts の Montserrat（Light 300）を
 * @remotion/google-fonts 経由でバンドル読込するため、Mac 内蔵フォントに
 * 依存せず配布可能。
 */

const montserrat = loadMontserrat("normal", {
  weights: ["300"],
  subsets: ["latin"],
});

/** 配布可能な既定フォントスタック */
const DEFAULT_FONT_FAMILY = `${montserrat.fontFamily}, sans-serif`;

export type TitleGlitch29Props = {
  /** 表示する文言（1行・既定で大文字化） */
  text?: string;
  /** 演出全体の尺（フレーム）。省略時はコンポジションの尺 */
  durationInFrames?: number;
  /** フォント（既定は Montserrat Light のスタック） */
  fontFamily?: string;
  /** 文字の太さ（既定 300 = Light） */
  fontWeight?: number | string;
  /** 文字サイズ(px) */
  fontSize?: number;
  /** 基本の文字色（ほんのり緑がかった白が既定） */
  color?: string;
  /** 字間（em単位・ワイドトラッキング） */
  letterSpacingEm?: number;
  /** 大文字化するか */
  uppercase?: boolean;
  /** 行の中心位置 Y（0〜1、画面高比） */
  posY?: number;
  /** RGBチャンネル分離の最大ずれ(px) */
  splitPx?: number;
  /** 縦スミア残像の最大距離(px) */
  smearPx?: number;
  /** 縦ストリーク（画面を貫く細線）の濃度 0〜1 */
  streakDensity?: number;
  /** 文字単位の乱れ（アウトライン化・純色化・明滅）の強さ 0〜1 */
  scatter?: number;
  /** 入場グリッチの秒数 */
  inSeconds?: number;
  /** 退場（飛散消滅）の秒数 */
  outSeconds?: number;
  /** 中盤の再バースト中心（0〜1、尺に対する位置。負値で無効） */
  burstCenter?: number;
  /** 再バーストの幅（0〜1、尺に対する割合） */
  burstWidth?: number;
  /** 再バーストのピーク強度 0〜1 */
  burstPeak?: number;
  /** グリッチのRGBアクセント色 */
  accentColors?: [string, string, string];
  /** 乱数シード（同じ値なら同じ乱れ方） */
  seed?: number;
};

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** 決定的な整数ハッシュ → [0,1)。Math.random は使わない。 */
const rand01 = (...nums: number[]): number => {
  let h = 0x811c9dc5;
  for (const n of nums) {
    h = Math.imul(h ^ Math.floor(n * 1021), 0x01000193);
    h ^= h >>> 15;
  }
  h = Math.imul(h ^ (h >>> 13), 0x5bd1e995);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
};

export const TitleSignalGlitch25: React.FC<TitleGlitch29Props> = ({
  text = "STATIC WAVE",
  durationInFrames,
  fontFamily = DEFAULT_FONT_FAMILY,
  fontWeight = 300,
  fontSize = 118,
  color = "#edf7ee",
  letterSpacingEm = 0.14,
  uppercase = true,
  posY = 0.5,
  splitPx = 10,
  smearPx = 90,
  streakDensity = 0.5,
  scatter = 1,
  inSeconds = 0.9,
  outSeconds = 0.7,
  burstCenter = 0.84,
  burstWidth = 0.28,
  burstPeak = 0.8,
  accentColors = ["#ff2030", "#20ff50", "#2840ff"],
  seed = 29,
}) => {
  const frame = useCurrentFrame();
  const { fps, width, height, durationInFrames: compDuration } = useVideoConfig();
  const total = durationInFrames ?? compDuration;

  const line = uppercase ? text.toUpperCase() : text;
  // Array.from はサロゲートペア（絵文字等）を1文字として分割する（split("")は破壊する）
  const letters = useMemo(() => Array.from(line), [line]);

  const inFrames = Math.max(2, Math.round(inSeconds * fps));
  const outFrames = Math.max(2, Math.round(outSeconds * fps));
  const outStart = total - outFrames;

  // ---- グリッチ量 g(frame) : 0=クリーン, 1=最大 ----
  const tNorm = total > 1 ? frame / (total - 1) : 0;
  const gIn = frame < inFrames ? 1 - frame / inFrames : 0;
  const gOut = frame >= outStart ? (frame - outStart) / outFrames : 0;
  let gBurst = 0;
  if (burstCenter >= 0 && burstWidth > 0) {
    const d = Math.abs(tNorm - burstCenter) / (burstWidth / 2);
    if (d < 1) {
      // なだらかな山なり（cos窓）の再バースト
      gBurst = burstPeak * 0.5 * (1 + Math.cos(Math.PI * d));
    }
  }
  const g = clamp01(Math.max(gIn * gIn * 0.2 + gIn * 0.8, gOut, gBurst));

  // グリッチ模様は数フレーム単位で切り替わる（デジタルなステップ感）
  const slot = Math.floor(frame / 2);

  // ---- 各文字の入場・退場タイミング（決定的） ----
  const letterCount = letters.length;
  const revealAt = (i: number) =>
    Math.floor(rand01(seed, 11, i) * inFrames * 0.45);
  const dropAt = (i: number) =>
    outStart + Math.floor(rand01(seed, 13, i) * outFrames * 0.75);

  // ---- 縦ストリーク（画面を貫く細線） ----
  const streaks: React.ReactNode[] = [];
  if (g > 0.02 && streakDensity > 0) {
    const maxStreaks = 12;
    for (let i = 0; i < maxStreaks; i++) {
      const show = rand01(seed, 31, slot, i);
      if (show > g * streakDensity) continue;
      // 文字領域の周辺に集中させる（旧の見た目に合わせる）
      const x = (0.18 + 0.64 * rand01(seed, 37, slot, i)) * width;
      const full = rand01(seed, 41, slot, i) < 0.45;
      const y0 = full ? 0 : rand01(seed, 43, slot, i) * height * 0.8;
      const len = full
        ? height
        : height * (0.08 + rand01(seed, 47, slot, i) * 0.55);
      const w = 1 + Math.floor(rand01(seed, 53, slot, i) * 2.5);
      const c = accentColors[Math.floor(rand01(seed, 59, slot, i) * 3) % 3];
      const op = 0.35 + 0.55 * rand01(seed, 61, slot, i);
      streaks.push(
        <div
          key={`st-${i}`}
          style={{
            position: "absolute",
            left: x,
            top: y0,
            width: w,
            height: len,
            background: c,
            opacity: op * clamp01(g * 1.6),
          }}
        />
      );
    }
  }

  // ---- 1文字ぶんの描画（本体 + チャンネル分離 + 縦スミア） ----
  const renderLetter = (ch: string, i: number): React.ReactNode => {
    if (ch === " ") {
      return (
        <span key={i} style={{ display: "inline-block", width: "0.6em" }}>
          {" "}
        </span>
      );
    }

    // 入場前・退場後は非表示（退場後はまれに断片が残る）
    const born = frame >= revealAt(i);
    const dead = frame >= dropAt(i);
    let fragment = false;
    if (!born || dead) {
      // 断片: 消えた文字の一部だけがアウトラインで残る
      fragment = rand01(seed, 67, i, dead ? 1 : 0) < 0.18;
      if (!fragment) {
        return (
          <span
            key={i}
            style={{ display: "inline-block", visibility: "hidden" }}
          >
            {ch}
          </span>
        );
      }
    }

    const r1 = rand01(seed, 71, slot, i);
    const r2 = rand01(seed, 73, slot, i);
    const r3 = rand01(seed, 79, slot, i);
    const r4 = rand01(seed, 83, slot, i);

    const gl = clamp01(g * (0.55 + 0.9 * r1) * scatter);

    // 文字単位の明滅（グリッチが強いほど消えやすい）
    const blink = gl > 0.25 && r2 < gl * 0.3;

    // 文字単位のスタイル抽選: 純色化 / アウトライン化 / 縦ずれ
    const pureColor =
      gl > 0.3 && r3 < gl * 0.45
        ? accentColors[Math.floor(r4 * 3) % 3]
        : null;
    const outlined = fragment || (gl > 0.35 && r4 < gl * 0.3);
    const dy = gl > 0.15 ? (r2 - 0.5) * 2 * gl * 26 : 0;
    const dxJit = gl > 0.15 ? (r3 - 0.5) * 2 * gl * 8 : 0;

    const baseColor = pureColor ?? color;
    const fillStyle: React.CSSProperties = outlined
      ? {
          color: "transparent",
          WebkitTextStroke: `1.5px ${baseColor}`,
          // 点線がちぎれたような欠け感（上下どちらかを切り落とす）
          clipPath:
            r1 < 0.5
              ? `inset(0 0 ${Math.floor(r2 * 45)}% 0)`
              : `inset(${Math.floor(r2 * 45)}% 0 0 0)`,
        }
      : { color: baseColor };

    // チャンネル分離のずれ幅
    const dx = splitPx * gl * (0.4 + 0.6 * r2);
    const showSplit = gl > 0.08 && !outlined;

    // 縦スミア残像（上下にすっと伸びる薄いゴースト）
    const smearAmt = smearPx * gl * (0.5 + 0.5 * r3);
    const showSmear = gl > 0.18;

    const ghost = (
      key: string,
      tx: number,
      ty: number,
      c: string,
      op: number,
      stretch = 1,
      blur = 0
    ) => (
      <span
        key={key}
        aria-hidden
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          color: c,
          opacity: op,
          transform: `translate(${tx}px, ${ty}px) scaleY(${stretch})`,
          filter: blur > 0 ? `blur(${blur}px)` : undefined,
          mixBlendMode: "screen",
          pointerEvents: "none",
        }}
      >
        {ch}
      </span>
    );

    // 文字のステム位置から上下へ伸びる細い縦線（旧の入場時の署名的な見た目）
    const stems: React.ReactNode[] = [];
    if (gl > 0.3) {
      const stemCount = r1 < 0.4 ? 2 : 1;
      for (let s = 0; s < stemCount; s++) {
        const up = rand01(seed, 103, slot, i, s) < 0.5;
        const sh = fontSize * (0.5 + 1.6 * rand01(seed, 107, slot, i, s));
        const sxPct = 8 + rand01(seed, 109, slot, i, s) * 74;
        const sc = accentColors[Math.floor(rand01(seed, 113, slot, i, s) * 3) % 3];
        stems.push(
          <span
            key={`stem-${s}`}
            aria-hidden
            style={{
              position: "absolute",
              left: `${sxPct}%`,
              width: 2,
              height: sh,
              ...(up ? { top: -sh } : { bottom: -sh }),
              background: sc,
              opacity: 0.45 + 0.45 * rand01(seed, 127, slot, i, s),
              pointerEvents: "none",
            }}
          />
        );
      }
    }

    return (
      <span
        key={i}
        style={{
          display: "inline-block",
          position: "relative",
          transform: `translate(${dxJit}px, ${dy}px)`,
          opacity: blink ? 0.06 : 1,
        }}
      >
        {/* 縦スミア残像（上下） */}
        {showSmear &&
          ghost(
            "sm-u",
            0,
            -smearAmt,
            accentColors[Math.floor(r1 * 3) % 3],
            0.16 + 0.14 * r2,
            1 + gl * 0.4,
            0.5
          )}
        {showSmear &&
          ghost(
            "sm-d",
            0,
            smearAmt * (0.6 + 0.4 * r4),
            "#9aa4a8",
            0.14 + 0.12 * r3,
            1 + gl * 0.3,
            0.5
          )}
        {/* RGBチャンネル分離（左右） */}
        {showSplit && ghost("ch-r", -dx, dx * 0.12, accentColors[0], 1)}
        {showSplit && ghost("ch-g", dx, -dx * 0.1, accentColors[1], 1)}
        {showSplit &&
          gl > 0.3 &&
          ghost("ch-b", dx * 1.7, dx * 0.2, accentColors[2], 0.9)}
        {/* 文字にアンカーされた縦ストローク（上下へ伸びる細線） */}
        {stems}
        {/* 本体 */}
        <span style={{ position: "relative", ...fillStyle }}>{ch}</span>
      </span>
    );
  };

  // ---- ライン全体の縦エコー残像（旧の署名的な見た目） ----
  // 生存中の文字の割合。入退場の途中はエコーを薄くする
  let aliveCount = 0;
  for (let i = 0; i < letterCount; i++) {
    if (letters[i] === " ") continue;
    if (frame >= revealAt(i) && frame < dropAt(i)) aliveCount++;
  }
  const solidCount = Math.max(1, letters.filter((c) => c !== " ").length);
  const aliveFrac = aliveCount / solidCount;
  const echoAmt = smearPx * clamp01(g * 1.25);
  const echoBase = 0.5 * clamp01(g * 1.4) * aliveFrac * aliveFrac;

  const textStyle: React.CSSProperties = {
    fontFamily,
    fontWeight,
    fontSize,
    letterSpacing: `${letterSpacingEm}em`,
    whiteSpace: "pre",
    lineHeight: 1.1,
  };

  const plainLetters = letters.map((ch, i) =>
    ch === " " ? (
      <span key={i} style={{ display: "inline-block", width: "0.6em" }}>
        {" "}
      </span>
    ) : (
      <span key={i} style={{ display: "inline-block" }}>
        {ch}
      </span>
    )
  );

  const lineEcho = (
    key: string,
    ty: number,
    tx: number,
    c: string,
    op: number,
    stretch: number
  ) => (
    <div
      key={key}
      aria-hidden
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        display: "flex",
        justifyContent: "center",
        pointerEvents: "none",
        transform: `translate(${tx}px, ${ty}px) scaleY(${stretch})`,
        color: c,
        opacity: op,
        filter: "blur(0.6px)",
      }}
    >
      <div style={textStyle}>{plainLetters}</div>
    </div>
  );

  const echoes: React.ReactNode[] = [];
  if (echoBase > 0.03 && echoAmt > 2) {
    // 上側: 赤系＋グレーの二重残像 / 下側: 青系＋グレー
    echoes.push(
      lineEcho("ec-u1", -echoAmt, -4, "#8a3540", echoBase * 0.7, 1.3),
      lineEcho("ec-u2", -echoAmt * 0.92, 4, "#5b6a72", echoBase * 0.5, 1.3),
      lineEcho("ec-d1", echoAmt * 0.85, 4, "#3a4a96", echoBase * 0.6, 1.25),
      lineEcho("ec-d2", echoAmt * 0.78, -4, "#5b6a72", echoBase * 0.45, 1.25)
    );
  }

  // クリーン時にも残るごく淡い色フリンジ（発光体らしさ）
  const idleFringe = g < 0.08 ? 0.35 : 0;

  // 全体フリッカー（強グリッチ時にたまに全体が落ちる）
  const globalDip =
    g > 0.35 && rand01(seed, 97, slot) < g * 0.22 ? 0.25 + 0.3 * rand01(seed, 101, slot) : 1;

  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      {streaks}
      <div
        style={{
          position: "absolute",
          left: 0,
          width: "100%",
          top: posY * height,
          transform: "translateY(-50%)",
          display: "flex",
          justifyContent: "center",
          opacity: globalDip,
        }}
      >
        {echoes}
        <div
          style={{
            ...textStyle,
            position: "relative",
            textShadow: idleFringe
              ? `1px 0 0 rgba(255,64,96,${idleFringe * 0.5}), -1px 0 0 rgba(64,255,128,${idleFringe * 0.5})`
              : undefined,
          }}
        >
          {letters.map((ch, i) => renderLetter(ch, i))}
        </div>
      </div>
    </AbsoluteFill>
  );
};
