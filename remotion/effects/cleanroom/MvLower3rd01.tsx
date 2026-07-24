/**
 * MvLower3rd01（クリーンルーム再実装）
 *
 * 機能: 常時割れるRGBグリッチの、ミュージックビデオ用ロワーサード字幕。
 * - 下1/3中央にコンデンス極太の白大文字テロップを置く
 * - 赤チャンネル(上寄り)/シアンチャンネル(下寄り)のRGB分離を常時かける
 * - テキストを細い水平スライスに割り、スライスごとにランダム横ズレ（常時ジッタ）
 * - ときどき大きな「スクレイプ」ズレ（スライス単位＋全体単位）が走る
 * - テキスト行を横断する全幅の走査線バンド（Bad TV）を文字の上に重ねる
 * - 入り/出はグリッチ強度が膨らみながらフェード、字間は全尺でゆっくり漸増
 *
 * 見た目（文言・書体・サイズ・色・位置・スライス数・ジッタ量・入り出の長さ）は
 * すべて props でパラメータ化。既定値のままで完成した見た目になる。
 * 既定書体は Google Fonts の Oswald 700（配布可能・Mac内蔵フォント非依存）。
 * 乱数は決定論的ハッシュのみ（フレーム番号から算出）。CSSキーフレーム不使用。
 * 解像度非依存: scale = width / 1920。
 */
import React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { loadFont } from "@remotion/google-fonts/Oswald";

const { fontFamily: OSWALD } = loadFont("normal", {
  weights: ["700"],
  subsets: ["latin"],
});

export interface MvLower3rdNC3VProps {
  /** 表示する文言。"\n" で複数行。 */
  text?: string;
  /** エフェクト全体の長さ(frames)。省略時はコンポジションの長さ。 */
  durationInFrames?: number;
  /** 書体（コンデンス極太ゴシック想定）。既定は Oswald 700 */
  fontFamily?: string;
  fontWeight?: React.CSSProperties["fontWeight"];
  /** 本文サイズ(px, 1920x1080基準。解像度でスケール) */
  fontSize?: number;
  /** 本体の文字色 */
  color?: string;
  /** RGB分離: 上側チャンネルの色 */
  channelTopColor?: string;
  /** RGB分離: 下側チャンネルの色 */
  channelBottomColor?: string;
  /** RGB分離の縦ずれ量(px, 1080p基準) */
  channelOffsetPx?: number;
  /** 横方向の中心位置（画面幅に対する比率 0-1） */
  centerXRatio?: number;
  /** 縦方向の中心位置（画面高に対する比率 0-1）。ロワーサード既定 */
  centerYRatio?: number;
  /** 基本字間(em) */
  letterSpacingEm?: number;
  /** 全尺かけて追加される字間(em)（トラッキング漸増） */
  trackingGrowEm?: number;
  /** 水平スライスの本数（多いほど細かく割れる） */
  sliceCount?: number;
  /** スライスの基本横ジッタ量(px, 1080p基準) */
  jitterPx?: number;
  /** スライスが大きくズレる（スクレイプ）確率 0-1 */
  burstChance?: number;
  /** スクレイプ時のズレ倍率 */
  burstMul?: number;
  /** 全体が丸ごと横に飛ぶスクレイプの確率 0-1 */
  scrapeChance?: number;
  /** 全体スクレイプの最大距離(px, 1080p基準) */
  scrapeDistancePx?: number;
  /** ジッタの更新間隔(frames)。2ならカクついたビデオグリッチ感 */
  glitchHoldFrames?: number;
  /** 入りの長さ(frames) */
  inFrames?: number;
  /** 出の長さ(frames) */
  outFrames?: number;
  /** 入り/出でグリッチ強度が何倍まで膨らむか */
  inOutBoost?: number;
  /** 走査線バンドの濃さ 0-1（0で無効） */
  scanlineOpacity?: number;
  /** 走査線の周期(px, 1080p基準) */
  scanlinePeriodPx?: number;
  /** 走査線バンドの高さ（fontSize に対する倍率） */
  scanBandHeightEm?: number;
  /** 乱数シード（同じ値なら毎回同じ割れ方） */
  seed?: number;
  /** 大文字化するか */
  uppercase?: boolean;
  /** 背景。既定は透過（フッテージへの重ね用途） */
  background?: string;
}

/** 決定論的ハッシュ乱数 [0,1)。入力が同じなら常に同じ値を返す。 */
const hashRand = (...seeds: number[]): number => {
  let h = 0x811c9dc5;
  for (const s of seeds) {
    // 小数も効くよう桁を持ち上げてから混ぜる
    let x = Math.floor(s * 8191) + 0x9e3779b9;
    x = Math.imul(x ^ (x >>> 15), 0x85ebca6b);
    x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35);
    h = Math.imul(h ^ (x ^ (x >>> 16)), 0x01000193);
  }
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  return (h >>> 8) / 0x1000000;
};

/** [-1,1) の符号付き乱数 */
const signedRand = (...seeds: number[]): number => hashRand(...seeds) * 2 - 1;

interface SliceLayerSpec {
  color: string;
  /** チャンネル固有の固定オフセット(px) */
  dx: number;
  dy: number;
  /** ジッタ倍率（色チャンネルは白より大きく飛ばすと彩りが出る） */
  jitterMul: number;
  /** レイヤー識別シード */
  layerSeed: number;
  opacity: number;
  blend: React.CSSProperties["mixBlendMode"];
}

export const MvLower3rd01: React.FC<MvLower3rdNC3VProps> = ({
  text = "RIDE THE WAVE",
  durationInFrames,
  fontFamily = `${OSWALD}, 'Arial Narrow', sans-serif`,
  fontWeight = 700,
  fontSize = 138,
  color = "#ffffff",
  channelTopColor = "#ff2033",
  channelBottomColor = "#25e6d9",
  channelOffsetPx = 8,
  centerXRatio = 0.5,
  centerYRatio = 0.745,
  letterSpacingEm = 0.09,
  trackingGrowEm = 0.035,
  sliceCount = 26,
  jitterPx = 4,
  burstChance = 0.06,
  burstMul = 4.5,
  scrapeChance = 0.1,
  scrapeDistancePx = 46,
  glitchHoldFrames = 2,
  inFrames = 14,
  outFrames = 16,
  inOutBoost = 2.0,
  scanlineOpacity = 0.5,
  scanlinePeriodPx = 5,
  scanBandHeightEm = 1.6,
  seed = 1,
  uppercase = true,
  background,
}) => {
  const frame = useCurrentFrame();
  const { width, durationInFrames: compDuration } = useVideoConfig();
  const total = durationInFrames ?? compDuration;
  const s = width / 1920;

  // ジッタは glitchHoldFrames ごとに更新（カクつくビデオグリッチ感）
  const hold = Math.max(1, Math.round(glitchHoldFrames));
  const tick = Math.floor(frame / hold);

  // 入り/出の進行度（0=定常, 1=端）
  const inEdge =
    inFrames > 0 ? interpolate(frame, [0, inFrames], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }) : 0;
  const outEdge =
    outFrames > 0
      ? interpolate(frame, [total - outFrames, total - 1], [0, 1], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        })
      : 0;
  const edge = Math.max(inEdge, outEdge);
  // グリッチ強度: 定常1 → 端で inOutBoost 倍
  const intensity = 1 + (inOutBoost - 1) * edge * edge;

  // フェード（端はチラつきながら入る/消える）。入りは早めに立ち上がる
  const baseOpacity =
    Math.min(
      inFrames > 0
        ? Math.pow(
            interpolate(frame, [0, inFrames], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }),
            0.55,
          )
        : 1,
      outFrames > 0
        ? interpolate(frame, [total - outFrames, total - 1], [1, 0], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          })
        : 1,
    ) * (edge > 0.05 ? 0.65 + 0.35 * hashRand(seed, 77, tick) : 1);

  // トラッキング漸増
  const letterSpacing = letterSpacingEm + trackingGrowEm * (frame / Math.max(1, total - 1));

  // 全体スクレイプ（丸ごと横飛び）＋常時の微トレモア
  const scrapeRoll = hashRand(seed, 11, tick);
  const scrapeOffset =
    scrapeRoll < scrapeChance * intensity ? signedRand(seed, 12, tick) * scrapeDistancePx * s * intensity : 0;
  const tremorX = signedRand(seed, 13, tick) * 2 * s * intensity;
  const tremorY = signedRand(seed, 14, tick) * 1.2 * s * intensity;

  const fs = fontSize * s;
  const textStyle: React.CSSProperties = {
    fontFamily,
    fontWeight,
    fontSize: fs,
    letterSpacing: `${letterSpacing}em`,
    lineHeight: 1.12,
    whiteSpace: "pre",
    textAlign: "center",
    textTransform: uppercase ? "uppercase" : "none",
  };

  // 入り/出ではRGB分離の縦ずれ自体も膨らむ（ゴーストが上下に離れる）
  const channelDy = channelOffsetPx * s * (1 + 1.6 * edge);
  const layers: SliceLayerSpec[] = [
    {
      color: channelTopColor,
      dx: -channelOffsetPx * 0.5 * s,
      dy: -channelDy,
      jitterMul: 1.5,
      layerSeed: 101,
      opacity: Math.min(1, 0.9 + 0.4 * edge),
      blend: "screen",
    },
    {
      color: channelBottomColor,
      dx: channelOffsetPx * 0.5 * s,
      dy: channelDy,
      jitterMul: 1.5,
      layerSeed: 202,
      opacity: Math.min(1, 0.9 + 0.4 * edge),
      blend: "screen",
    },
    { color, dx: 0, dy: 0, jitterMul: 1, layerSeed: 303, opacity: 1, blend: "normal" },
  ];

  const n = Math.max(4, Math.round(sliceCount));
  const slices = Array.from({ length: n }, (_, i) => i);

  return (
    <AbsoluteFill style={{ background: background ?? "transparent", overflow: "hidden" }}>
      {/* テキストブロック（中央基準で配置） */}
      <div
        style={{
          position: "absolute",
          left: `${centerXRatio * 100}%`,
          top: `${centerYRatio * 100}%`,
          transform: `translate(-50%, -50%) translate(${scrapeOffset + tremorX}px, ${tremorY}px)`,
          opacity: baseOpacity,
        }}
      >
        {/* サイザー: ブロックの寸法を決める不可視コピー */}
        <div style={{ ...textStyle, opacity: 0 }}>{text}</div>
        {layers.map((layer) =>
          slices.map((i) => {
            const top = (i / n) * 100;
            const bottom = 100 - ((i + 1) / n) * 100;
            // スライスごとの横ズレ
            let off = signedRand(seed, layer.layerSeed, i, tick) * jitterPx * layer.jitterMul * intensity * s;
            if (hashRand(seed, layer.layerSeed + 7, i, tick) < burstChance * intensity) {
              off *= burstMul;
            }
            // 端では一部スライスが欠落してさらに崩れる
            const dropped = edge > 0.1 && hashRand(seed, layer.layerSeed + 17, i, tick) < 0.2 * edge;
            return (
              <div
                key={`${layer.layerSeed}-${i}`}
                style={{
                  ...textStyle,
                  position: "absolute",
                  inset: 0,
                  clipPath: `inset(${top}% 0% ${bottom}% 0%)`,
                  transform: `translate(${layer.dx + off}px, ${layer.dy}px)`,
                  color: layer.color,
                  opacity: dropped ? 0 : layer.opacity,
                  mixBlendMode: layer.blend,
                }}
              >
                {text}
              </div>
            );
          }),
        )}
      </div>
      {/* 走査線バンド（テキスト行を横断・文字の上にも乗る） */}
      {scanlineOpacity > 0 ? (
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            top: `${centerYRatio * 100}%`,
            height: fs * scanBandHeightEm,
            transform: "translateY(-50%)",
            backgroundImage: `repeating-linear-gradient(to bottom, rgba(0,0,0,0.7) 0px, rgba(0,0,0,0.7) ${
              Math.max(1, 1.2 * s)
            }px, transparent ${Math.max(1, 1.2 * s)}px, transparent ${scanlinePeriodPx * s}px)`,
            backgroundPositionY: `${(tick % 2) * 2 * s}px`,
            opacity: scanlineOpacity * (0.75 + 0.25 * hashRand(seed, 55, tick)),
            pointerEvents: "none",
          }}
        />
      ) : null}
    </AbsoluteFill>
  );
};
