import React from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";

/**
 * MvOverlayLiquidWarp — 「有機的に溶け・うねる」液状ディストーションのオーバーレイ家族。
 * クリーンルーム実装（技法メモとポスターの雰囲気のみを根拠に白紙から作成）。
 *
 * SVGのフラクタルノイズを変位マップにして映像や光帯を歪ませ、
 * 色収差・発光・粒の質感レイヤーを重ねる。children は必ず全面描画される
 * （加工して描く個体もあるが、画面から消えることはない）。
 *
 * variant(0..1) → 4プリセット:
 *   0.00 INKBLUE  変位+RGB分版を1本のフィルタに統合し、青雲・寒色グレード・
 *                 全面ハーフトーン網点まで重ねる最も装飾的な個体
 *   0.33 SUNTEAR  映像本体は歪ませず、生成した暖色光帯オーバーレイだけを
 *                 帯ノイズ二段変位で水平に引き裂くオーバーレイ駆動型
 *   0.67 DRIP     縦のみ変位+ほぼ二値の縦ドリップマスクで「溶け落ち」を作る
 *                 マスク駆動型。不透明度と別に成長用の第2エンベロープを持つ
 *   1.00 WATER    水平S字うねり+全画面RGB小幅分版+オフセンターのバルジ+
 *                 ブルーム霞。イン/アウトが最もゆっくりな上品系
 *
 * fps非依存（実時間ベース）・完全決定論（Math.random不使用）・外部アセットなし。
 */
export interface MvOverlayLiquidWarpProps {
  children: React.ReactNode; // 下の絵。全面に描画して上に質感を重ねる
  durationInFrames: number;
  intensity?: number; // 0..100
  variant?: number; // 0..1 同家族内の見た目分岐（決定論的に）
  tint?: string; // 任意: 基調色の差し替え（空/未指定=デザイン既定）
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

const smooth01 = (v: number) => {
  const c = clamp01(v);
  return c * c * (3 - 2 * c);
};

/** 台形エンベロープ: イン側は先頭基準、アウト側は終端基準で読みmin合成 */
const trapezoid = (t: number, total: number, inSec: number, outSec: number) =>
  Math.min(clamp01(t / Math.max(0.001, inSec)), clamp01((total - t) / Math.max(0.001, outSec)));

/** 決定論的ハッシュ（0..1） */
const hash01 = (n: number) => {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453123;
  return x - Math.floor(x);
};

/** 不規則ゆらぎ: 一定周期ごとに目標値(-1..1)を引き、smoothstep補間 */
const wriggle = (t: number, period: number, seed: number) => {
  const p = t / period;
  const i = Math.floor(p);
  const f = smooth01(p - i);
  const a = hash01(seed + i * 13.77) * 2 - 1;
  const b = hash01(seed + (i + 1) * 13.77) * 2 - 1;
  return a + (b - a) * f;
};

/** 静的モノクログレインのタイル（data URI・外部アセットなし） */
const GRAIN_TILE = `data:image/svg+xml;utf8,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160">' +
    '<filter id="g"><feTurbulence type="fractalNoise" baseFrequency="0.7" numOctaves="2" seed="7" stitchTiles="stitch"/>' +
    '<feColorMatrix type="matrix" values="0.33 0.33 0.33 0 0 0.33 0.33 0.33 0 0 0.33 0.33 0.33 0 0 0 0 0 0 0.9"/></filter>' +
    '<rect width="160" height="160" filter="url(#g)"/></svg>'
)}`;

/** 青雲タイル: 雲ノイズの明度をアルファに写して基調色で塗る */
const cloudTile = (color: string) =>
  `data:image/svg+xml;utf8,${encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512">' +
      '<filter id="c" x="0" y="0" width="100%" height="100%">' +
      '<feTurbulence type="fractalNoise" baseFrequency="0.008 0.012" numOctaves="3" seed="11" stitchTiles="stitch" result="n"/>' +
      '<feColorMatrix in="n" type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0.55 0.55 0.55 0 -0.3" result="a"/>' +
      '<feComposite in="SourceGraphic" in2="a" operator="in"/></filter>' +
      `<rect width="512" height="512" fill="${color}" filter="url(#c)"/></svg>`
  )}`;

/** プリセット既定の基調色 */
const DEFAULT_ACCENTS = ["#2f56d8", "#ff7a2a", "#a9b3c4", "#8fb0ff"];

export const MvOverlayLiquidWarp: React.FC<MvOverlayLiquidWarpProps> = ({
  children,
  durationInFrames,
  intensity = 80,
  variant = 0,
  tint,
}) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();

  const t = frame / fps; // 実時間（秒）
  const total = Math.max(1, durationInFrames) / fps;
  const s = width / 1920; // 横1920基準の倍率
  const k = clamp01(intensity / 100);
  const tick = Math.floor(t * 24); // 「毎フレーム更新の粒」用の24fps刻み

  const preset = Math.round(clamp01(variant) * 3); // 0..3
  const rawId = React.useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const fid = `lqw-${rawId}-${preset}`;

  const accent = tint && tint.trim() ? tint : DEFAULT_ACCENTS[preset];
  const cloudUrl = React.useMemo(() => cloudTile(accent), [accent]);

  let defs: React.ReactNode = null;
  let layers: React.ReactNode = null;

  if (preset === 0) {
    // ── INKBLUE: 変位+RGB分版を1本のフィルタに直列で焼き込み、寒色の質感を重ねる ──
    const env = trapezoid(t, total, 0.8, 0.9); // 基本は直線ランプ
    const q = env * k;
    const fx = 0.006 / s;
    const fy = 0.009 / s;
    const driftX = (t * 22 * s) % (1 / fx);
    const driftY = (t * 9 * s) % (1 / fy);
    const disp = 30 * s * q;
    const ca = 7 * s * q; // 色収差の水平オフセット
    const desat = 1 - 0.22 * env; // 軽い減彩
    const dim = 1 - 0.1 * env; // 軽い減光
    const cloudX = -((t * 26 * s) % (1024 * s));
    const cloudY = wriggle(t, 1.6, 71) * 10 * s;

    defs = (
      <filter id={fid} x="-15%" y="-15%" width="130%" height="130%" colorInterpolationFilters="sRGB">
        <feTurbulence
          type="fractalNoise"
          baseFrequency={`${fx} ${fy}`}
          numOctaves={3}
          seed={5}
          stitchTiles="stitch"
          result="noise"
        />
        {/* premultiply汚染防止: アルファを1へ平坦化してから変位マップに使う */}
        <feComponentTransfer in="noise" result="map">
          <feFuncA type="linear" slope={0} intercept={1} />
        </feComponentTransfer>
        <feOffset in="map" dx={driftX} dy={driftY} result="mapDrift" />
        <feDisplacementMap
          in="SourceGraphic"
          in2="mapDrift"
          scale={disp}
          xChannelSelector="R"
          yChannelSelector="G"
          result="warped"
        />
        {/* RGB分版: R/Bを水平逆向きオフセット+軽い水平ブラー、screenで再合成 */}
        <feColorMatrix
          in="warped"
          type="matrix"
          values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0"
          result="chR"
        />
        <feOffset in="chR" dx={ca} dy={0} result="chRo" />
        <feGaussianBlur in="chRo" stdDeviation={`${ca * 0.7} 0`} result="chRb" />
        <feColorMatrix
          in="warped"
          type="matrix"
          values="0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0"
          result="chG"
        />
        <feColorMatrix
          in="warped"
          type="matrix"
          values="0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0"
          result="chB"
        />
        <feOffset in="chB" dx={-ca} dy={0} result="chBo" />
        <feGaussianBlur in="chBo" stdDeviation={`${ca * 0.7} 0`} result="chBb" />
        <feBlend in="chRb" in2="chG" mode="screen" result="rg" />
        <feBlend in="rg" in2="chBb" mode="screen" result="rgb" />
        <feColorMatrix in="rgb" type="saturate" values={String(desat)} result="graded" />
        <feComponentTransfer in="graded">
          <feFuncR type="linear" slope={dim} />
          <feFuncG type="linear" slope={dim} />
          <feFuncB type="linear" slope={dim} />
        </feComponentTransfer>
      </filter>
    );

    layers = (
      <>
        {/* ベース: 4〜9%拡大で縁の透けを画面外へ逃がす */}
        <AbsoluteFill style={{ transform: "scale(1.07)", filter: `url(#${fid})` }}>
          {children}
        </AbsoluteFill>
        {/* 左右へずらしたぼけクローンのハロー */}
        <AbsoluteFill
          style={{
            transform: `translateX(${15 * s}px) scale(1.07)`,
            filter: `blur(${11 * s}px)`,
            mixBlendMode: "screen",
            opacity: 0.26 * q,
          }}
        >
          {children}
        </AbsoluteFill>
        <AbsoluteFill
          style={{
            transform: `translateX(${-15 * s}px) scale(1.07)`,
            filter: `blur(${11 * s}px)`,
            mixBlendMode: "screen",
            opacity: 0.24 * q,
          }}
        >
          {children}
        </AbsoluteFill>
        {/* 寒色グレード: 深青multiply + 基調色soft-light */}
        <AbsoluteFill style={{ background: "#0b1f63", mixBlendMode: "multiply", opacity: 0.24 * env }} />
        <AbsoluteFill style={{ background: accent, mixBlendMode: "soft-light", opacity: 0.72 * env }} />
        {/* 青く着色した雲タイル: 横2倍ストレッチ・ゆっくり横流し+緩い縦揺れ */}
        <AbsoluteFill
          style={{
            backgroundImage: `url("${cloudUrl}")`,
            backgroundRepeat: "repeat",
            backgroundSize: `${1024 * s}px ${512 * s}px`,
            backgroundPosition: `${cloudX}px ${cloudY}px`,
            mixBlendMode: "screen",
            opacity: 0.62 * env,
          }}
        />
        {/* 全面ハーフトーン網点（黒ドット格子・multiply） */}
        <AbsoluteFill
          style={{
            backgroundImage: `radial-gradient(circle, rgba(2,4,12,0.85) ${1.1 * s}px, rgba(0,0,0,0) ${1.6 * s}px)`,
            backgroundSize: `${5.5 * s}px ${5.5 * s}px`,
            mixBlendMode: "multiply",
            opacity: 0.4 * env,
          }}
        />
      </>
    );
  } else if (preset === 1) {
    // ── SUNTEAR: 元映像は歪ませず、暖色光帯オーバーレイだけを帯ノイズ二段変位で引き裂く ──
    const env = smooth01(trapezoid(t, total, 1.0, 0.9)); // ランプはsmoothstep化
    const q = env * k;
    const bandFx = 0.0022 / s; // 横長の帯ノイズ（横に長く・縦に細かい）
    const bandFy = 0.03 / s;
    const drift = -((t * 300 * s) % (1 / bandFx)); // 速めに横流し
    const bigTear = (width / 6) * q; // 画面幅の1/6級の引き裂き
    const jitter = 6 * s * q; // 毎フレーム再抽選の細粒ジッタ
    const jitterSeed = 1 + Math.floor(hash01(tick * 7.13) * 9998);
    const wrMag = wriggle(t, 0.7, 21) * 55 * s; // マゼンタ帯の横揺れ

    defs = (
      <filter id={fid} x="-30%" y="-30%" width="160%" height="160%" colorInterpolationFilters="sRGB">
        <feTurbulence
          type="fractalNoise"
          baseFrequency={`${bandFx} ${bandFy}`}
          numOctaves={2}
          seed={9}
          stitchTiles="stitch"
          result="bands"
        />
        {/* 横のみ変位: Y側チャンネル(G)を中間値グレーに平坦化して殺す */}
        <feComponentTransfer in="bands" result="bandMap">
          <feFuncA type="linear" slope={0} intercept={1} />
          <feFuncG type="linear" slope={0} intercept={0.5} />
        </feComponentTransfer>
        <feOffset in="bandMap" dx={drift} dy={0} result="bandDrift" />
        <feDisplacementMap
          in="SourceGraphic"
          in2="bandDrift"
          scale={bigTear}
          xChannelSelector="R"
          yChannelSelector="G"
          result="torn"
        />
        {/* 二段目: 毎フレーム再抽選の細粒ジッタ */}
        <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves={1} seed={jitterSeed} result="fine" />
        <feComponentTransfer in="fine" result="fineMap">
          <feFuncA type="linear" slope={0} intercept={1} />
        </feComponentTransfer>
        <feDisplacementMap in="torn" in2="fineMap" scale={jitter} xChannelSelector="R" yChannelSelector="B" />
      </filter>
    );

    // 光帯生成 → 強ブラー後、「横に強圧縮→ブラー→10倍伸長」で水平ストリーク化
    const bandStack = (key: number) => (
      <AbsoluteFill
        key={key}
        style={{
          transform: "scaleX(10)",
          transformOrigin: "50% 50%",
          filter: `blur(${8 * s}px) saturate(1.55) brightness(1.15)`,
        }}
      >
        <AbsoluteFill style={{ transform: "scaleX(0.1)", transformOrigin: "50% 50%" }}>
          {/* 右端外から差す白〜橙〜赤の大帯 */}
          <AbsoluteFill
            style={{
              background:
                "radial-gradient(75% 160% at 106% 22%, rgba(255,255,255,0.95) 0%, rgba(255,196,64,0.9) 26%, rgba(255,94,26,0.55) 55%, rgba(255,94,26,0) 78%)",
            }}
          />
          {/* マゼンタ〜紫の帯（wriggleで横揺れ） */}
          <AbsoluteFill
            style={{
              transform: `translateX(${wrMag}px)`,
              background:
                "radial-gradient(34% 130% at 79% 62%, rgba(255,120,235,0.85) 0%, rgba(168,64,255,0.5) 45%, rgba(168,64,255,0) 72%)",
            }}
          />
          {/* 左上の斜め赤帯 */}
          <AbsoluteFill
            style={{
              background:
                "linear-gradient(112deg, rgba(255,46,26,0.75) 0%, rgba(255,46,26,0.35) 14%, rgba(255,46,26,0) 32%)",
            }}
          />
        </AbsoluteFill>
      </AbsoluteFill>
    );

    layers = (
      <>
        <AbsoluteFill>{children}</AbsoluteFill>
        <AbsoluteFill
          style={{
            filter: `url(#${fid})`,
            mixBlendMode: "screen",
            opacity: env * (0.5 + 0.5 * k),
          }}
        >
          {bandStack(0)}
          {/* 色相を逆向きに回した上下数pxずらしコピー2枚のフリンジ（変位は全体に掛かる） */}
          <AbsoluteFill
            style={{ filter: "hue-rotate(48deg)", transform: `translateY(${3 * s}px)`, opacity: 0.34 }}
          >
            {bandStack(1)}
          </AbsoluteFill>
          <AbsoluteFill
            style={{ filter: "hue-rotate(-48deg)", transform: `translateY(${-3 * s}px)`, opacity: 0.34 }}
          >
            {bandStack(2)}
          </AbsoluteFill>
        </AbsoluteFill>
        {tint && tint.trim() ? (
          <AbsoluteFill style={{ background: accent, mixBlendMode: "overlay", opacity: 0.22 * env }} />
        ) : null}
      </>
    );
  } else if (preset === 2) {
    // ── DRIP: 縦のみ大振幅で溶かし、ほぼ二値の縦ドリップマスクで切り抜く ──
    const envOpacity = trapezoid(t, total, 0.6, 0.8);
    // 成長用の第2エンベロープ: ドリップが伸びて引く（不透明度とは別の時間）
    const grow = smooth01(trapezoid(t, total, 2.0, 1.1)) * (0.35 + 0.65 * k);
    const dripFx = 0.02 / s; // 縦長ノイズ（細い柱・縦に長い）
    const dripFy = 0.0035 / s;
    const drift = (t * 120 * s) % (1 / dripFy); // 下方向スクロール
    const disp = height * 0.25 * grow; // 画面高の1/4級（実効シフトは±1/8）

    defs = (
      <filter id={fid} x="-20%" y="-40%" width="140%" height="180%" colorInterpolationFilters="sRGB">
        <feTurbulence
          type="fractalNoise"
          baseFrequency={`${dripFx} ${dripFy}`}
          numOctaves={2}
          seed={13}
          stitchTiles="stitch"
          result="noise"
        />
        {/* 縦のみ変位: X側チャンネル(R)を中間値グレーに平坦化して殺す */}
        <feComponentTransfer in="noise" result="map">
          <feFuncA type="linear" slope={0} intercept={1} />
          <feFuncR type="linear" slope={0} intercept={0.5} />
        </feComponentTransfer>
        <feOffset in="map" dx={0} dy={drift} result="mapDrift" />
        <feDisplacementMap
          in="SourceGraphic"
          in2="mapDrift"
          scale={disp}
          xChannelSelector="R"
          yChannelSelector="G"
          result="melted"
        />
        {/* 変位後に縦異方性ブラーで粒をヘアライン化 */}
        <feGaussianBlur in="melted" stdDeviation={`0 ${9 * s}`} result="hair" />
        {/* クローンは減光・減彩 */}
        <feColorMatrix in="hair" type="saturate" values="0.45" result="desat" />
        <feComponentTransfer in="desat" result="dark">
          <feFuncR type="linear" slope={0.72} />
          <feFuncG type="linear" slope={0.72} />
          <feFuncB type="linear" slope={0.72} />
        </feComponentTransfer>
        {/* ドリップ内は強い静的モノクログレイン（overlay合成） */}
        <feTurbulence type="fractalNoise" baseFrequency="0.55" numOctaves={2} seed={31} result="gnoise" />
        <feColorMatrix
          in="gnoise"
          type="matrix"
          values="0.33 0.33 0.33 0 0  0.33 0.33 0.33 0 0  0.33 0.33 0.33 0 0  0 0 0 0 0.4"
          result="grain"
        />
        <feBlend in="dark" in2="grain" mode="overlay" />
      </filter>
    );

    // ドリップマスク: 細い縦線×低周波クラスタ×毎フレーム微細ノイズ、下ほど減衰の急峻二値
    let rects = "";
    for (let i = 0; i < 4; i++) {
      const cx = 200 + hash01(i * 5.31 + 2) * 1520; // 柱が数カ所に固まる
      const wr = wriggle(t, 0.9, 40 + i * 7) * 16; // マスクも横に十数px揺れる
      const clusterAmp = 0.45 + 0.55 * hash01(i * 13.7);
      const nStrips = 4 + Math.floor(hash01(i * 9.13) * 4);
      for (let j = 0; j < nStrips; j++) {
        const x = cx + (hash01(i * 31.7 + j * 7.71) - 0.5) * 170 + wr;
        const w = 6 + hash01(i * 3.3 + j * 11.3) * 15;
        const base = 0.3 + 0.7 * hash01(i * 2.9 + j * 5.9);
        const flick = 0.9 + 0.2 * (hash01(tick * 3.31 + i * 17 + j) - 0.5); // 毎フレーム更新の微細ノイズ
        const len = 1080 * 0.95 * grow * clusterAmp * base * flick;
        if (len < 8) continue;
        const op = 0.8 + 0.2 * hash01(tick * 1.7 + j * 3 + i);
        rects += `<rect x="${(x - w / 2).toFixed(1)}" y="0" width="${w.toFixed(1)}" height="${len.toFixed(
          1
        )}" fill="url(#vg)" opacity="${op.toFixed(2)}"/>`;
      }
    }
    const maskSvg =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1920 1080" preserveAspectRatio="none">' +
      '<defs><linearGradient id="vg" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0.62" stop-color="#fff"/><stop offset="1" stop-color="#fff" stop-opacity="0"/>' +
      `</linearGradient></defs>${rects}</svg>`;
    const maskUrl = `url("data:image/svg+xml;utf8,${encodeURIComponent(maskSvg)}")`;

    // 細い横スライス: 数フレームごとに再抽選され小さく横ズレ（1px未満は描かない）
    const group = Math.floor(tick / 5);
    const sliceDx = (hash01(group * 3.17 + 60) * 2 - 1) * 28 * s * k;
    const sliceBands = [0, 1, 2]
      .map((i) => ({
        y: hash01(group * 7.7 + i * 13.1) * 92,
        h: 0.25 + hash01(group * 5.1 + i * 3.7) * 0.5,
      }))
      .sort((a, b) => a.y - b.y);
    const sliceStops = sliceBands
      .map(
        (b) =>
          `transparent ${b.y.toFixed(2)}%, #fff ${b.y.toFixed(2)}%, #fff ${(b.y + b.h).toFixed(2)}%, transparent ${(
            b.y + b.h
          ).toFixed(2)}%`
      )
      .join(", ");
    const sliceMask = `linear-gradient(180deg, transparent 0%, ${sliceStops}, transparent 100%)`;
    const showSlices = Math.abs(sliceDx) >= 1;

    layers = (
      <>
        <AbsoluteFill>{children}</AbsoluteFill>
        {/* 溶け落ちクローン（縦のみ変位・ドリップマスクで切り抜き） */}
        <AbsoluteFill
          style={{
            filter: `url(#${fid})`,
            WebkitMaskImage: maskUrl,
            maskImage: maskUrl,
            WebkitMaskSize: "100% 100%",
            maskSize: "100% 100%",
            opacity: 0.92 * envOpacity,
          }}
        >
          <AbsoluteFill style={{ transform: "scale(1.08, 1.3)" }}>{children}</AbsoluteFill>
          {tint && tint.trim() ? (
            <AbsoluteFill style={{ background: accent, mixBlendMode: "soft-light", opacity: 0.35 }} />
          ) : null}
        </AbsoluteFill>
        {/* 細い横スライスの小さな横ズレ */}
        {showSlices ? (
          <AbsoluteFill
            style={{
              transform: `translateX(${sliceDx}px)`,
              WebkitMaskImage: sliceMask,
              maskImage: sliceMask,
              opacity: envOpacity,
            }}
          >
            {children}
          </AbsoluteFill>
        ) : null}
        {/* 全面に弱いoverlayグレイン */}
        <AbsoluteFill
          style={{
            backgroundImage: `url("${GRAIN_TILE}")`,
            backgroundRepeat: "repeat",
            backgroundSize: `${160 * s}px ${160 * s}px`,
            mixBlendMode: "overlay",
            opacity: 0.14 * envOpacity,
          }}
        />
      </>
    );
  } else {
    // ── WATER: 水平のみのS字うねり+全画面RGB小幅分版+オフセンターバルジ+ブルーム霞 ──
    const env = smooth01(trapezoid(t, total, 1.6, 1.6)); // イン/アウトは最もゆっくり
    const q = env * k;
    const waveFx = 0.0035 / s; // 大きく滑らかなタービュランス
    const waveFy = 0.0045 / s;
    const drift = (t * 46 * s) % (1 / waveFy); // ノイズ場を縦へ等速ドリフト→波紋が進行
    const disp = width * 0.038 * q; // 画面幅の数%級
    const prism = 16 * s * q; // 1920基準で小幅の三分版
    const bulge = 1.05 + 0.09 * q; // 1割弱のバルジ拡大

    defs = (
      <filter id={fid} x="-15%" y="-15%" width="130%" height="130%" colorInterpolationFilters="sRGB">
        <feTurbulence
          type="fractalNoise"
          baseFrequency={`${waveFx} ${waveFy}`}
          numOctaves={2}
          seed={17}
          stitchTiles="stitch"
          result="noise"
        />
        {/* 水平のみ: Y側チャンネル(G)を中間値グレーに平坦化して殺す */}
        <feComponentTransfer in="noise" result="map">
          <feFuncA type="linear" slope={0} intercept={1} />
          <feFuncG type="linear" slope={0} intercept={0.5} />
        </feComponentTransfer>
        <feOffset in="map" dx={0} dy={drift} result="mapDrift" />
        <feDisplacementMap
          in="SourceGraphic"
          in2="mapDrift"
          scale={disp}
          xChannelSelector="R"
          yChannelSelector="G"
          result="wavy"
        />
        {/* 全画面RGB三分版の小幅プリズム（ミックス半分程度） */}
        <feColorMatrix
          in="wavy"
          type="matrix"
          values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0"
          result="chR"
        />
        <feOffset in="chR" dx={prism} dy={0} result="chRo" />
        <feColorMatrix
          in="wavy"
          type="matrix"
          values="0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0"
          result="chG"
        />
        <feColorMatrix
          in="wavy"
          type="matrix"
          values="0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0"
          result="chB"
        />
        <feOffset in="chB" dx={-prism} dy={0} result="chBo" />
        <feBlend in="chRo" in2="chG" mode="screen" result="rg" />
        <feBlend in="rg" in2="chBo" mode="screen" result="split" />
        <feComposite in="split" in2="wavy" operator="arithmetic" k1={0} k2={0.5} k3={0.5} k4={0} result="mixed" />
        {/* 軽いデフォーカス */}
        <feGaussianBlur in="mixed" stdDeviation={1.3 * s * env} />
      </filter>
    );

    layers = (
      <>
        {/* 本体: バルジは中心をやや左上寄り（横44%・縦39%付近）に置く */}
        <AbsoluteFill
          style={{
            transform: `scale(${bulge})`,
            transformOrigin: "44% 39%",
            filter: `url(#${fid})`,
          }}
        >
          {children}
        </AbsoluteFill>
        {/* 明るい強ブラークローンをscreenで重ねブルーム霞 */}
        <AbsoluteFill
          style={{
            transform: `scale(${bulge})`,
            transformOrigin: "44% 39%",
            filter: `blur(${24 * s}px) brightness(1.45) saturate(1.15)`,
            mixBlendMode: "screen",
            opacity: 0.55 * env * (0.4 + 0.6 * k),
          }}
        >
          {children}
        </AbsoluteFill>
        {/* 基調色の淡い霞 */}
        <AbsoluteFill
          style={{
            background: `radial-gradient(60% 55% at 44% 39%, ${accent} 0%, rgba(0,0,0,0) 70%)`,
            mixBlendMode: "screen",
            opacity: 0.13 * env,
          }}
        />
      </>
    );
  }

  return (
    <AbsoluteFill style={{ pointerEvents: "none", overflow: "hidden", isolation: "isolate" }}>
      <svg width={0} height={0} style={{ position: "absolute" }} aria-hidden>
        <defs>{defs}</defs>
      </svg>
      {layers}
    </AbsoluteFill>
  );
};
