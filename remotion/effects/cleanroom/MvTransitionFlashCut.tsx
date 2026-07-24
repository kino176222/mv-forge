import React, { useId, useMemo } from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";

/**
 * MvTransitionFlashCut — 白閃光トランジション家族（クリーンルーム実装）
 *
 * 機能: 白い閃光の頂点でカットの入れ替えを隠すトランジション。
 * 進行: 前半は旧カットのまま効果が立ち上がる → 頂点で白飛び＋クロス入れ替え →
 *       後半は新カットの上で効果が減衰し、最終フレームは素の to で終わる。
 *
 * variant による家族内分岐（決定論的）:
 * - variant < 1/3 … クイック版: 白膜の三角パルス＋広めディゾルブ＋微小な横揺れのみ
 * - variant < 2/3 … 標準形: 強ブラー・屈折ゆらぎ・ズームパンチ・水平発光バー・二次余韻
 * - それ以外     … 装飾版: ズーム突進・RGB色分離・白ブルーム・放射光線・虹リング・粒状
 *
 * 設計メモ:
 * - すべてのエンベロープは p = frame/(dur-1) 駆動。乱数は (seed, frame, k) の
 *   決定的ハッシュのみ（Math.random 不使用）。同フレームは何度レンダしても同じ絵。
 * - クリップ層は from の真上に to を重ねて不透明度でクロス。ズーム・ブラー・
 *   発光補正は両者をまとめた親に掛け、入れ替え前後の質感を連続させる。
 * - 白飛び膜は「単色白の全画面を screen 合成し、不透明度エンベロープだけで制御」。
 * - 閃光は非対称パルス（速い立ち上がり→短いホールド→急落→長い余韻）。
 * - px 系定数はフルHD横幅基準で決め、width/1920 倍率で解像度非依存化。
 * - この家族は非方向性のため direction は受け取るが見た目には使わない。
 */

export interface MvTransitionFlashCutProps {
  /** 旧カット */
  from: React.ReactNode;
  /** 新カット */
  to: React.ReactNode;
  /** トランジション全体の長さ（フレーム） */
  durationInFrames: number;
  /** 方向族のみ有効（この家族は非方向性のため未使用） */
  direction?: "left" | "right" | "up" | "down" | "forward" | "backward";
  /** 0..1 家族内の見た目分岐（決定論的） */
  variant?: number;
}

const clamp01 = (t: number): number => Math.min(1, Math.max(0, t));

/** 0..1 smoothstep（ease-in-out 丸め） */
const smooth01 = (t: number): number => {
  const x = clamp01(t);
  return x * x * (3 - 2 * x);
};

/** 山型: a→b で滑らかに 0→1、b→c で 1→0 */
const hump = (p: number, a: number, b: number, c: number): number => {
  if (p <= a || p >= c) return 0;
  return p < b ? smooth01((p - a) / (b - a)) : 1 - smooth01((p - b) / (c - b));
};

/** 線形の三角パルス: a→b で 0→1、b→c で 1→0（丸めなし） */
const tri = (p: number, a: number, b: number, c: number): number => {
  if (p <= a || p >= c) return 0;
  return p < b ? (p - a) / (b - a) : 1 - (p - b) / (c - b);
};

/** 台形: a→b で 0→1、b..c プラトー、c→d で 1→0 */
const trap = (
  p: number,
  a: number,
  b: number,
  c: number,
  d: number
): number => {
  if (p <= a || p >= d) return 0;
  if (p < b) return smooth01((p - a) / (b - a));
  if (p < c) return 1;
  return 1 - smooth01((p - c) / (d - c));
};

/**
 * 非対称閃光パルス。
 * 速い立ち上がり(riseW) → 頂点ホールド(holdW) → 急落(dropW で 1→0.32) →
 * 長い余韻(tailW で 0.32→0)。減衰側が鋭く尾を引く。
 */
const flashPulse = (
  p: number,
  apex: number,
  riseW: number,
  holdW: number,
  dropW: number,
  tailW: number
): number => {
  if (p < apex - riseW) return 0;
  if (p < apex) return smooth01((p - (apex - riseW)) / riseW);
  if (p < apex + holdW) return 1;
  const d = p - (apex + holdW);
  if (d < dropW) return 1 - 0.68 * smooth01(d / dropW);
  const t = (d - dropW) / tailW;
  return t >= 1 ? 0 : 0.32 * (1 - smooth01(t));
};

/** (a,b,c) から 0..1 の決定的な擬似乱数（sin ハッシュ） */
const rand = (a: number, b: number, c: number): number => {
  const s = Math.sin(a * 127.1 + b * 311.7 + c * 74.7) * 43758.5453123;
  return s - Math.floor(s);
};

export const MvTransitionFlashCut: React.FC<MvTransitionFlashCutProps> = ({
  from,
  to,
  durationInFrames,
  variant = 0.5,
}) => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const rawId = useId();
  const uid = useMemo(() => rawId.replace(/[^a-zA-Z0-9_-]/g, ""), [rawId]);

  // ゼロ除算ガード（総フレーム1以下は p=1 に倒れる）
  const last = Math.max(1, durationInFrames - 1);
  const p = clamp01(frame / last);

  const sc = width / 1920; // フルHD横幅基準の解像度倍率
  const minDim = Math.min(width, height);

  // ---- variant → 個体分岐（決定論的） -------------------------------------
  const v = clamp01(variant);
  // 0=クイック / 1=標準 / 2=装飾
  const mode = v < 1 / 3 ? 0 : v < 2 / 3 ? 1 : 2;
  const fract = clamp01((v * 3) % 1); // 帯内の端数で微差をつける
  const seed = 13 + Math.floor(v * 977);
  // 閃光の頂点は中央より気持ち手前
  const apex =
    (mode === 0 ? 0.5 : mode === 1 ? 0.45 : 0.46) + (fract - 0.5) * 0.03;

  // 装飾版のみ: 両端を完全に素の画へ戻す総合 in/out
  const io =
    mode === 2 ? smooth01(p / 0.1) * (1 - smooth01((p - 0.9) / 0.1)) : 1;

  // ---- 白飛び膜（screen 合成の不透明度エンベロープ） -----------------------
  let wash = 0;
  if (mode === 0) {
    // 単純な三角パルス。減衰は立ち上がりの半分強
    wash = 0.92 * tri(p, 0.06, apex, apex + 0.29);
  } else if (mode === 1) {
    // 非対称パルス＋尺7割の二次余韻パルス（強さ6割）
    wash =
      flashPulse(p, apex, 0.16, 0.05, 0.07, 0.38) +
      0.58 * hump(p, 0.6, 0.71, 0.9);
  } else {
    // 中央やや手前に短いプラトーの台形
    wash = 0.88 * trap(p, 0.16, 0.4, 0.53, 0.87) * io;
  }
  wash = clamp01(wash);

  // ---- クロスディゾルブ（頂点をまたぐ短い窓・範囲外 clamp） -----------------
  const crossCenter = apex + (mode === 0 ? 0.04 : 0.02);
  const crossHalf = mode === 0 ? 0.16 : 0.1;
  const toOpacity = smooth01(
    (p - (crossCenter - crossHalf)) / (crossHalf * 2)
  );

  // ---- クリップ親に掛ける変形・フィルタ ------------------------------------
  // ズームパンチ（山型・頂点最大）
  const zoom =
    mode === 1
      ? 1 + 0.08 * hump(p, 0.12, apex, 0.82)
      : mode === 2
        ? 1 + 0.3 * hump(p, 0.12, apex + 0.01, 0.85) * io
        : 1;

  // 強ブラー（標準形のみ・画面幅の2%弱）
  const blurPx = mode === 1 ? 0.017 * width * hump(p, 0.1, apex, 0.8) : 0;

  // 固定シードノイズの屈折ゆらぎ（標準形のみ・幅の1%）
  const dispPx = mode === 1 ? 0.01 * width * hump(p, 0.14, apex, 0.78) : 0;

  // RGB水平色分離（装飾版のみ・幅の1.5%弱）
  const splitEnv = mode === 2 ? trap(p, 0.14, 0.42, 0.52, 0.88) * io : 0;
  const splitPx = 0.013 * width * splitEnv;
  const splitOn = splitPx > 0.5;

  // 露出の谷→山: 頂点直前に明度8割へ沈め、頂点で2割強オーバー（装飾版は3倍弱）
  let brightness = 1;
  if (mode === 1) {
    brightness =
      1 -
      0.2 * hump(p, apex - 0.28, apex - 0.1, apex - 0.01) +
      0.25 * hump(p, apex - 0.06, apex + 0.01, apex + 0.22);
  } else if (mode === 2) {
    brightness = 1 + 1.7 * trap(p, 0.16, 0.42, 0.52, 0.88) * io;
  }

  // ---- 揺れ（決定論的乱数・毎フレーム更新） --------------------------------
  let shakeX = 0;
  let shakeY = 0;
  if (mode === 0) {
    // 微小な横揺れ。頂点最大で尺の7/8あたりに収束
    const amp = 4 * sc * hump(p, 0.06, apex, 0.875);
    shakeX = (rand(seed, frame, 11) - 0.5) * 2 * amp;
  } else if (mode === 2) {
    // 中盤最大の微振動（縦は横の7割）
    const amp = 5 * sc * hump(p, 0.18, 0.5, 0.82) * io;
    shakeX = (rand(seed, frame, 11) - 0.5) * 2 * amp;
    shakeY = (rand(seed, frame, 12) - 0.5) * 2 * amp * 0.7;
  }

  // ---- 標準形: 水平発光バー -------------------------------------------------
  const barPulse =
    mode === 1
      ? clamp01(
          flashPulse(p, apex, 0.14, 0.05, 0.08, 0.34) +
            0.5 * hump(p, 0.6, 0.71, 0.88)
        )
      : 0;
  const barStretch = 1 + 0.55 * hump(p, 0.14, apex, 0.8); // 頂点で縦1.5倍強

  // ---- 装飾版: オーバーレイ群 ----------------------------------------------
  const bloomEnv = mode === 2 ? trap(p, 0.15, 0.41, 0.53, 0.87) * io : 0;
  const bloomScale = 1 + 0.7 * bloomEnv; // 頂点で7割膨張
  const spokesEnv = mode === 2 ? trap(p, 0.16, 0.42, 0.52, 0.86) * io : 0;
  const spokesScale = 0.5 + 1.4 * spokesEnv; // 見かけ半分→2倍近く
  const spokesWobble = (rand(seed, frame, 5) - 0.5) * 8; // 数度の首振り
  const ringOpacity = 0.6 * splitEnv; // 色分離量に連動
  const grainEnv = mode === 2 ? trap(p, 0.12, 0.32, 0.68, 0.9) * io : 0;
  const grainSeed = (seed + frame * 37) % 9973; // 毎フレームシード更新

  // ---- クリップ積層（from の上に to を重ねてクロス） ------------------------
  const clipStack = (
    <AbsoluteFill>
      <AbsoluteFill>{from}</AbsoluteFill>
      <AbsoluteFill style={{ opacity: clamp01(toOpacity) }}>{to}</AbsoluteFill>
    </AbsoluteFill>
  );

  const clipFilters: string[] = [];
  if (dispPx > 0.5) clipFilters.push(`url(#${uid}-disp)`);
  if (blurPx > 0.3) clipFilters.push(`blur(${blurPx.toFixed(1)}px)`);
  if (Math.abs(brightness - 1) > 0.005)
    clipFilters.push(`brightness(${brightness.toFixed(3)})`);

  const spokesMask =
    "radial-gradient(circle at center, rgba(0,0,0,0) 0%, rgba(0,0,0,1) 30%, rgba(0,0,0,0.85) 62%, rgba(0,0,0,0) 78%)";

  return (
    <AbsoluteFill style={{ background: "#000", overflow: "hidden" }}>
      {/* フィルタ定義（屈折ゆらぎ／チャンネル分離／粒状） */}
      <svg width={0} height={0} style={{ position: "absolute" }} aria-hidden>
        <defs>
          {mode === 1 && (
            <filter
              id={`${uid}-disp`}
              x="-10%"
              y="-10%"
              width="120%"
              height="120%"
              colorInterpolationFilters="sRGB"
            >
              {/* ノイズは固定シード。形は動かさず変位量だけ振る */}
              <feTurbulence
                type="fractalNoise"
                baseFrequency="0.012 0.02"
                numOctaves={2}
                seed={seed % 100}
                result="n"
              />
              <feDisplacementMap
                in="SourceGraphic"
                in2="n"
                scale={(dispPx * 2).toFixed(1)}
                xChannelSelector="R"
                yChannelSelector="G"
              />
            </filter>
          )}
          {mode === 2 && (
            <>
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
              {grainEnv > 0.01 && (
                <filter id={`${uid}-grain`}>
                  <feTurbulence
                    type="fractalNoise"
                    baseFrequency="0.8"
                    numOctaves={2}
                    seed={grainSeed}
                    stitchTiles="stitch"
                  />
                  {/* Rチャンネルをグレースケール化して不透明に */}
                  <feColorMatrix
                    type="matrix"
                    values="1 0 0 0 0  1 0 0 0 0  1 0 0 0 0  0 0 0 0 1"
                  />
                </filter>
              )}
            </>
          )}
        </defs>
      </svg>

      {/* クリップ層（変形・フィルタは from/to をまとめた親に掛ける） */}
      <AbsoluteFill
        style={{
          transform: `translate(${shakeX.toFixed(2)}px, ${shakeY.toFixed(
            2
          )}px) scale(${zoom.toFixed(4)})`,
          filter: clipFilters.length > 0 ? clipFilters.join(" ") : undefined,
        }}
      >
        {splitOn ? (
          <>
            {/* G: 中央のまま。R を左・B を右へずらし screen で再合成 */}
            <AbsoluteFill style={{ filter: `url(#${uid}-g)` }}>
              {clipStack}
            </AbsoluteFill>
            <AbsoluteFill
              style={{
                filter: `url(#${uid}-r)`,
                mixBlendMode: "screen",
                transform: `translateX(${(-splitPx).toFixed(1)}px)`,
              }}
            >
              {clipStack}
            </AbsoluteFill>
            <AbsoluteFill
              style={{
                filter: `url(#${uid}-b)`,
                mixBlendMode: "screen",
                transform: `translateX(${splitPx.toFixed(1)}px)`,
              }}
            >
              {clipStack}
            </AbsoluteFill>
          </>
        ) : (
          clipStack
        )}
      </AbsoluteFill>

      {/* 白飛び膜（screen・不透明度のみで制御） */}
      {wash > 0.003 && (
        <AbsoluteFill
          style={{
            background: "#ffffff",
            mixBlendMode: "screen",
            opacity: wash,
          }}
        />
      )}

      {/* 標準形: 水平発光バー（広い光輪＋明るい芯の2層） */}
      {mode === 1 && barPulse > 0.01 && (
        <>
          <AbsoluteFill
            style={{
              mixBlendMode: "screen",
              opacity: barPulse * 0.85,
              justifyContent: "center",
            }}
          >
            <div
              style={{
                height: "34%",
                transform: `scaleY(${barStretch.toFixed(3)})`,
                background:
                  "linear-gradient(180deg, rgba(255,255,255,0) 0%, rgba(255,255,255,0.75) 50%, rgba(255,255,255,0) 100%)",
              }}
            />
          </AbsoluteFill>
          <AbsoluteFill
            style={{
              mixBlendMode: "screen",
              opacity: barPulse,
              justifyContent: "center",
            }}
          >
            <div
              style={{
                height: "7%",
                transform: `scaleY(${barStretch.toFixed(3)})`,
                background:
                  "linear-gradient(180deg, rgba(255,255,255,0) 0%, #ffffff 50%, rgba(255,255,255,0) 100%)",
                filter: `blur(${(6 * sc).toFixed(1)}px)`,
              }}
            />
          </AbsoluteFill>
        </>
      )}

      {/* 装飾版: 中心の白ブルーム */}
      {bloomEnv > 0.01 && (
        <AbsoluteFill
          style={{
            mixBlendMode: "screen",
            opacity: bloomEnv,
            justifyContent: "center",
            alignItems: "center",
          }}
        >
          <div
            style={{
              width: minDim * 0.9,
              height: minDim * 0.9,
              flexShrink: 0,
              transform: `scale(${bloomScale.toFixed(3)})`,
              background:
                "radial-gradient(circle closest-side, rgba(255,255,255,1) 0%, rgba(255,255,255,0.9) 30%, rgba(255,255,255,0) 70%)",
            }}
          />
        </AbsoluteFill>
      )}

      {/* 装飾版: 放射光線（細スポーク・radialマスクで中心減衰・首振り） */}
      {spokesEnv > 0.01 && (
        <AbsoluteFill
          style={{
            mixBlendMode: "screen",
            opacity: spokesEnv * 0.85,
            justifyContent: "center",
            alignItems: "center",
          }}
        >
          <div
            style={{
              width: minDim * 2.4,
              height: minDim * 2.4,
              flexShrink: 0,
              transform: `rotate(${spokesWobble.toFixed(2)}deg) scale(${spokesScale.toFixed(3)})`,
              background:
                "repeating-conic-gradient(rgba(255,255,255,0.9) 0deg 0.7deg, rgba(255,255,255,0) 0.7deg 5.6deg)",
              WebkitMaskImage: spokesMask,
              maskImage: spokesMask,
            }}
          />
        </AbsoluteFill>
      )}

      {/* 装飾版: ブルーム外周の虹リング（色分離量に連動） */}
      {ringOpacity > 0.01 && (
        <AbsoluteFill
          style={{
            mixBlendMode: "screen",
            opacity: ringOpacity,
            justifyContent: "center",
            alignItems: "center",
          }}
        >
          <div
            style={{
              width: minDim * 1.5,
              height: minDim * 1.5,
              flexShrink: 0,
              transform: `scale(${(bloomScale * 1.05).toFixed(3)})`,
              background:
                "radial-gradient(circle closest-side, rgba(0,0,0,0) 0%, rgba(0,0,0,0) 54%, rgba(255,70,70,0.8) 58%, rgba(255,220,90,0.8) 62%, rgba(100,230,130,0.8) 66%, rgba(90,150,255,0.8) 70%, rgba(190,100,255,0.8) 74%, rgba(0,0,0,0) 79%)",
              filter: `blur(${(8 * sc).toFixed(1)}px)`,
            }}
          />
        </AbsoluteFill>
      )}

      {/* 装飾版: 粒状ノイズ（毎フレームシード更新・overlay） */}
      {grainEnv > 0.01 && (
        <AbsoluteFill
          style={{
            mixBlendMode: "overlay",
            opacity: 0.12 * grainEnv,
            pointerEvents: "none",
          }}
        >
          <svg width="100%" height="100%">
            <rect width="100%" height="100%" filter={`url(#${uid}-grain)`} />
          </svg>
        </AbsoluteFill>
      )}
    </AbsoluteFill>
  );
};
