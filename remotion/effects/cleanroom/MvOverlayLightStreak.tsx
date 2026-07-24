import React from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";

/**
 * MvOverlayLightStreak — 縦光条（ライトストリーク）家族のクリーンルーム実装。
 *
 * 考え方: 元映像(children)は最下層に無加工で置き、そのコピーに
 * 「明部抽出フィルタ → 縦異方ブラー」をかけて screen 合成で重ねる。
 * 暗部は screen では寄与しないため、明部抽出そのものがマスクの役割を果たす。
 * 縦異方ブラーは CSS に方向つきブラーが無いので
 *   外側 scaleY(N) → 中間 等方 blur+明部抽出 → 内側 scaleY(1/N)
 * の3段ネストで偽装する（先に縦へ潰してからボカして伸ばすと縦だけ N 倍ボケる）。
 *
 * variant(0..1) による分岐:
 *   < 0.5 : 長短2枚の縦フレアを重ねた静的な標準形（眩しいアナモルフィック風）
 *   >=0.5 : 光条1枚だが長さが頭→尻で減衰し、上方向へ引き裂かれる見え。
 *           薄いエンボスと間欠グリッチ帯の質感レイヤーを追加
 *
 * 完全決定論（Math.random 不使用）。px 値はフルHD幅基準でスケール。
 */
export interface MvOverlayLightStreakProps {
  children: React.ReactNode;
  durationInFrames: number;
  intensity?: number; // 0..100（1以下なら 0..1 として解釈。省略時=最大）
  variant?: number; // 0..1 家族内の見た目分岐
  tint?: string; // 任意: 基調色の色被せ（未指定=素材の色をそのまま借りる）
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

// 区分線形の頭と尻にだけ緩急を乗せる（smoothstep）
const ease = (t: number) => {
  const x = clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
};

// フレーム番号ベースの決定論ハッシュ（0..1）
const hash01 = (n: number) => {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453123;
  return x - Math.floor(x);
};

// 間欠グリッチ帯用: 横方向低周波・縦方向高周波のモノクロ縞ノイズ（手続き生成SVG）
const NOISE_SVG = `<svg xmlns='http://www.w3.org/2000/svg' width='512' height='128'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.012 0.75' numOctaves='2' seed='11' stitchTiles='stitch'/><feColorMatrix type='saturate' values='0'/></filter><rect width='512' height='128' filter='url(#n)'/></svg>`;
const NOISE_URL = `url("data:image/svg+xml;utf8,${encodeURIComponent(NOISE_SVG)}")`;

export const MvOverlayLightStreak: React.FC<MvOverlayLightStreakProps> = ({
  children,
  durationInFrames,
  intensity,
  variant = 0,
  tint,
}) => {
  const frame = useCurrentFrame();
  const { width, height, fps } = useVideoConfig();
  const dur = Math.max(1, durationInFrames);
  const s = width / 1920; // フルHD幅基準の解像度スケール

  // intensity 正規化: 0..100 想定だが 0..1 で渡されても破綻しない
  const k =
    intensity === undefined ? 1 : clamp(intensity > 1 ? intensity / 100 : intensity, 0, 1);

  const v = clamp(variant, 0, 1);
  const sorting = v >= 0.5; // 家族内分岐
  const jitter = hash01(Math.round(v * 977) + 5); // variant 由来の微差

  // ---- 台形エンベロープ（尺可変対応） ----
  // インは先頭からの経過秒、アウトは終端からの残り秒で読む。両者の min。
  // これで尺がテンプレより長くても短くても頭と尻のフェードだけが保たれる。
  const tIn = frame / fps;
  const tRemain = (dur - 1 - frame) / fps;
  const env = Math.min(ease(tIn / 1.0), ease(tRemain / 0.9)) * k;

  // ごく薄い明滅（決定論サイン）で生っぽさを足す
  const shimmer = 0.94 + 0.06 * Math.sin((frame / fps) * Math.PI * 1.3 + jitter * 6.283);

  // ---- 縦異方ブラーの3段ネスト ----
  const streakLayer = (opts: {
    stretch: number; // 縦伸ばし倍率 N
    blurPx: number; // 横太さぶんの等方ブラー
    extract: string; // 明部抽出フィルタ連鎖
    opacity: number;
    shiftY?: number; // レイヤー全体の縦ずらし(px)
    mask?: string; // 縦グラデマスク
    key: string;
  }) => (
    <AbsoluteFill
      key={opts.key}
      style={{
        mixBlendMode: "screen",
        opacity: opts.opacity,
        pointerEvents: "none",
        transform: opts.shiftY ? `translateY(${opts.shiftY}px)` : undefined,
        WebkitMaskImage: opts.mask,
        maskImage: opts.mask,
      }}
    >
      <AbsoluteFill style={{ transform: `scaleY(${opts.stretch})`, pointerEvents: "none" }}>
        <AbsoluteFill
          style={{ filter: `${opts.extract} blur(${opts.blurPx}px)`, pointerEvents: "none" }}
        >
          <AbsoluteFill
            style={{ transform: `scaleY(${1 / opts.stretch})`, pointerEvents: "none" }}
          >
            {children}
          </AbsoluteFill>
        </AbsoluteFill>
      </AbsoluteFill>
    </AbsoluteFill>
  );

  let overlays: React.ReactNode = null;

  if (env > 0.01) {
    if (!sorting) {
      // ---- 標準形: 長短2枚重ねの縦フレア ----
      const stretchMain = 14 + 4 * jitter; // 十数倍の縦長
      const stretchFlare = stretchMain * 1.9; // ほぼ倍の長さ
      overlays = (
        <>
          {streakLayer({
            key: "main",
            stretch: stretchMain,
            blurPx: 9 * s,
            // 急峻な明部抽出: 暗部を強く落とし、最後に強めに増幅して眩しく爆ぜさせる
            extract: "brightness(0.5) contrast(4) saturate(1.6) brightness(1.9)",
            opacity: env * shimmer,
          })}
          {streakLayer({
            key: "flare",
            stretch: stretchFlare,
            blurPx: 4.5 * s,
            // 2枚目はごく僅かに暖色へ寄せた薄い長フレア
            extract:
              "brightness(0.5) contrast(4) saturate(1.5) sepia(0.22) brightness(1.7)",
            opacity: 0.7 * env * shimmer,
          })}
        </>
      );
    } else {
      // ---- 動きと質感のせ: 長さが頭→尻で減衰し、上へ引き裂かれる ----
      const p = clamp(frame / Math.max(1, dur - 1), 0, 1);
      // ソート量カーブ: 冒頭ほぼ最大 → 終端で1割程度まで単調減少（緩急つき）
      const sortAmt = 1 - ease(p) * 0.9;
      const lenFactor = Math.max(0.4, sortAmt); // 下限4割
      const blurPx = 4 * s; // ごく細い横太さ
      const stretch = (13 + 27 * lenFactor) * (0.92 + 0.16 * jitter); // 縦横比 数十倍
      const effLen = Math.min(height * 0.2, blurPx * stretch * 1.6); // 実効の筋の長さ
      const mask =
        "linear-gradient(to bottom, rgba(0,0,0,1) 0%, rgba(0,0,0,1) 42%, rgba(0,0,0,0.24) 100%)";

      // 薄いエンボス: モノクロ強コントラスト＋1px斜めずらしを overlay で。
      // 強度はソートカーブの中立値(0.5)からの差分で最大1割強。
      const embossOpacity = 0.13 * clamp(Math.abs(sortAmt - 0.5) * 2, 0, 1) * env;

      // 間欠グリッチ帯: 1/24秒刻みの決定論ハッシュで縦位置ジャンプ、半分弱の確率で点滅
      const step = Math.floor((frame / fps) * 24);
      const glitchOn = hash01(step * 3 + 17) < 0.45;
      const glitchY = hash01(step * 7 + 31) * height * 0.84;
      const glitchH = height * 0.16;

      overlays = (
        <>
          {streakLayer({
            key: "sort",
            stretch,
            blurPx,
            // 緩めのしきい値: 残る明部が多い
            extract: "brightness(0.72) contrast(2.1) saturate(1.25) brightness(1.3)",
            opacity: env * shimmer,
            shiftY: -effLen / 3, // 筋の長さの1/3ほど上へ → 上へ引き裂かれる見え
            mask,
          })}
          {embossOpacity > 0.005 && (
            <AbsoluteFill
              style={{
                mixBlendMode: "overlay",
                opacity: embossOpacity,
                filter: "grayscale(1) contrast(2.6) brightness(1.1)",
                transform: `translate(${1 * s}px, ${1 * s}px)`,
                pointerEvents: "none",
              }}
            >
              {children}
            </AbsoluteFill>
          )}
          {glitchOn && (
            <div
              style={{
                position: "absolute",
                left: 0,
                right: 0,
                top: glitchY,
                height: glitchH,
                backgroundImage: NOISE_URL,
                backgroundSize: `${960 * s}px ${140 * s}px`,
                backgroundRepeat: "repeat",
                mixBlendMode: "overlay",
                opacity: 0.14 * env,
                pointerEvents: "none",
              }}
            />
          )}
        </>
      );
    }
  }

  return (
    <AbsoluteFill style={{ isolation: "isolate", pointerEvents: "none" }}>
      {/* 元映像は無加工でそのまま最下層に */}
      <AbsoluteFill>{children}</AbsoluteFill>
      {overlays}
      {tint && env > 0.01 && (
        <AbsoluteFill
          style={{
            background: `linear-gradient(to bottom, ${tint}, transparent 55%, ${tint})`,
            mixBlendMode: "soft-light",
            opacity: 0.3 * env,
            pointerEvents: "none",
          }}
        />
      )}
    </AbsoluteFill>
  );
};
