import React, { useId, useMemo } from "react";
import {
  AbsoluteFill,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

/**
 * MvTransitionFlicker — ストロボ明滅トランジション（クリーンルーム実装）
 *
 * 機能: 「明滅・まばたき」で旧カット(A)から新カット(B)へ乗り換える発光系トランジション家族。
 * 構造: 黒地の上に A(常時) + B(不透明度) を全画面で重ね、束ごと揺れ/ズーム/ブラーを一括適用。
 *       その上に白飛びフラッシュ・縦光帯・ライトリーク等を screen 合成、色被り/グレインは overlay。
 *
 * variant による家族内分岐（決定論的）:
 * - variant < 1/3 … 最短・最硬派。A/B を矩形波的に高速交替（B二瞬き→一拍→B確定）。
 *   白フラッシュ＋縦10:1ブラーのスパイク3発が交替と完全同期。無彩色・装飾なし。
 * - 1/3 <= variant < 2/3 … 装飾フル装備。二連の三角パルス（1/3・5/8地点）の"間"で
 *   通常クロスディゾルブ。暖色リーク＋縦光帯掃引＋シアン色被り＋毎フレームグレイン＋
 *   頂点ズーム＋2発目直前の縦ジョルト。
 * - variant >= 2/3 … 単発まばたき。A が露出/コントラスト上昇・彩度低下で白に溶け、
 *   B が白飛びから露出を落ち着けて浮かぶ。コンテンツ自体にもブラーブルーム。
 *
 * 設計メモ:
 * - 進行度 p = frame/(duration-1) の 0..1 正規化で全カーブを駆動（尺を変えても形が保たれる）
 * - イージングではなく区分線形カーブと三角パルスが主役。フラッシュは数フレームの鋭い針
 * - 乱数は (seed, frame, channel) のハッシュで完全決定論。Math.random 不使用
 * - ブラー px / 揺れ px はフルHD基準幅に対する倍率でスケール（解像度非依存）
 * - フラッシュはコンテンツのブラー対象外（束の外）に置き、クリスプに光らせる
 */

export interface MvTransitionFlickerProps {
  /** 旧カット */
  from: React.ReactNode;
  /** 新カット */
  to: React.ReactNode;
  /** トランジション全体の長さ（フレーム） */
  durationInFrames: number;
  /** 方向族のみ使用。この家族では縦光帯の掃引向きにだけ反映（"up" で下→上） */
  direction?: "left" | "right" | "up" | "down" | "forward" | "backward";
  /** 0..1 同家族内の見た目分岐（決定論的） */
  variant?: number;
}

/** (a,b,c) から 0..1 の決定的な擬似乱数を返す */
const hash01 = (a: number, b: number, c: number): number => {
  const s = Math.sin(a * 127.1 + b * 311.7 + c * 74.7) * 43758.5453123;
  return s - Math.floor(s);
};

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** 三角パルス: center で 1、±halfWidth で 0 になる針 */
const tri = (p: number, center: number, halfWidth: number): number =>
  Math.max(0, 1 - Math.abs(p - center) / Math.max(1e-6, halfWidth));

export const MvTransitionFlicker: React.FC<MvTransitionFlickerProps> = ({
  from,
  to,
  durationInFrames,
  direction = "down",
  variant = 0.5,
}) => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const rawId = useId();
  const uid = useMemo(() => rawId.replace(/[^a-zA-Z0-9_-]/g, ""), [rawId]);

  const last = Math.max(1, durationInFrames - 1);
  const p = clamp01(frame / last);
  const v = clamp01(variant);
  // 家族内の個体: 0=硬派ストロボ / 1=装飾フレア / 2=輝度まばたき
  const mode = v < 1 / 3 ? 0 : v < 2 / 3 ? 1 : 2;
  const seed = 11 + Math.floor(v * 977);
  // フルHD基準のスケール係数（ブラー・揺れの px をここで換算）
  const sx = width / 1920;

  // ---- 個体別タイムライン ---------------------------------------------------
  let bOpacity = 0; // B の不透明度（入れ替えの本体）
  let flash = 0; // 白飛びフラッシュ量 0..1
  let jitterEnv = 0; // 揺れエンベロープ
  let zoom = 1; // パンチズーム
  let blurH = 0; // 横ブラー px (1080p基準)
  let blurV = 0; // 縦ブラー px
  let joltY = 0; // 縦ジョルト（%）
  let leakEnv = 0; // 暖色ライトリーク
  let bandEnv = 0; // 縦光帯
  let grainEnv = 0; // グレイン
  let castEnv = 0; // シアン色被り
  let filterA = ""; // A 個別グレード（まばたき用）
  let filterB = ""; // B 個別グレード

  if (mode === 0) {
    // -- 最短・最硬派: 矩形波交替（B二瞬き→一拍→B確定）＋針3発 --------------
    const blinkLen = Math.max(1, Math.round(last * 0.055));
    const f1 = Math.round(last * 0.17);
    const f2 = Math.round(last * 0.34);
    const fCut = Math.round(last * 0.625); // 本命の一発（5/8）
    const inBlink1 = frame >= f1 && frame < f1 + blinkLen;
    const inBlink2 = frame >= f2 && frame < f2 + blinkLen;
    bOpacity = inBlink1 || inBlink2 || frame >= fCut ? 1 : 0;

    // フラッシュ＋縦ブラーは交替の瞬間に完全同期した針（1〜2フレームで0→1→0）
    const spikeW = Math.max(1, Math.round(last * 0.045));
    const spike =
      Math.max(0, 1 - Math.abs(frame - f1) / spikeW) +
      Math.max(0, 1 - Math.abs(frame - f2) / spikeW) +
      Math.max(0, 1 - Math.abs(frame - fCut) / spikeW) * 1.15;
    flash = clamp01(spike) * 0.88;
    blurH = 1.6 * flash;
    blurV = 16 * flash; // 縦を横の10倍（縦モーションブラー近似）
    // 揺れは中盤のみ・両端ゼロの三角エンベロープ
    jitterEnv = tri(p, 0.45, 0.35) * 0.7;
    // ズーム・リーク・グレイン・色被りなし（無彩色）
  } else if (mode === 1) {
    // -- 最長・装飾フル装備: 二連三角パルスの"間"でクロスディゾルブ ----------
    const pulse1 = tri(p, 1 / 3, 0.055);
    const pulse2 = tri(p, 5 / 8, 0.07);
    flash = clamp01(pulse1 * 0.8 + pulse2 * 0.95);
    // A→B はパルスの間（1/3〜5/8）で普通のクロスディゾルブ
    bOpacity = interpolate(p, [0.38, 0.6], [0, 1], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    });
    blurH = 1.3 * flash;
    blurV = 13 * flash;
    zoom = 1 + 0.035 * flash; // 明滅の頂点に同期した数%のパンチ
    // 2発目直前の縦ジョルト
    const jolt = tri(p, 0.575, 0.03);
    joltY = jolt * 2.6 * (hash01(seed, 3, 7) > 0.5 ? 1 : -1);
    jitterEnv = tri(p, 0.5, 0.4) * 0.6;
    // 暖色リーク: 中盤で山なり、尻すぼみ
    leakEnv = interpolate(p, [0, 0.15, 0.5, 0.9, 1], [0.12, 0.3, 0.55, 0.08, 0], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    });
    bandEnv = 1;
    grainEnv = interpolate(p, [0, 0.15, 0.5, 0.85, 1], [0, 0.16, 0.3, 0.1, 0], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    });
    // シアン色被り: フラッシュ頂点では引っ込める（飛んで見えるように）
    castEnv = clamp01(0.2 - flash * 0.18) *
      interpolate(p, [0, 0.1, 0.85, 1], [0, 1, 1, 0], {
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
      });
  } else {
    // -- 単発まばたき・輝度ブロー入替 ----------------------------------------
    // w = 白への溶け具合（区分線形: 立ち上がり→頂点保持→減衰）
    const w = interpolate(p, [0.28, 0.46, 0.54, 0.82], [0, 1, 1, 0], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    });
    // 白の下でこっそり入れ替える
    bOpacity = interpolate(p, [0.46, 0.54], [0, 1], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    });
    // A: 露出/コントラストを上げ彩度を抜いて白へ溶ける
    filterA = `brightness(${(1 + 1.7 * w).toFixed(3)}) contrast(${(
      1 + 0.45 * w
    ).toFixed(3)}) saturate(${(1 - 0.85 * w).toFixed(3)})`;
    // B: 白飛びから露出が落ち着いて浮かぶ
    filterB = `brightness(${(1 + 1.25 * w).toFixed(3)}) saturate(${(
      1 - 0.6 * w
    ).toFixed(3)})`;
    // コンテンツ自体にもブラーブルーム（家族標準より内側に掛かる）
    blurH = 2.5 * w;
    blurV = 11 * w;
    flash = w * 0.8;
    zoom = 1 + 0.02 * w;
    jitterEnv = tri(p, 0.5, 0.25) * 0.35;
    bandEnv = 1;
  }

  // ---- 揺れ（フレーム毎ハッシュ × 三角エンベロープ、振幅は画面高の1〜2%） ----
  const jitterAmp = height * 0.014 * jitterEnv;
  const jx = (hash01(seed, frame, 21) - 0.5) * 2 * jitterAmp;
  const jy = (hash01(seed, frame, 22) - 0.5) * 2 * jitterAmp;

  // ---- 縦光帯（透明→暖白→透明の帯を上→下へ通過、進行3/4で終える） ----------
  const sweepUp = direction === "up";
  const bandTravel = interpolate(p, [0, 0.75], [-45, 110], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const bandTop = sweepUp ? 65 - bandTravel : bandTravel;
  const bandOpacity =
    bandEnv *
    interpolate(p, [0, 0.08, 0.6, 0.78], [0, 0.55, 0.4, 0], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    });

  // ---- コンテンツ束のブラー（縦優位のガウス、SVGフィルタで縦横別指定） --------
  const bH = blurH * sx;
  const bV = blurV * sx;
  const blurOn = bH > 0.15 || bV > 0.15;
  // ブラー時は縁の透けを隠すため僅かに外へ広げる
  const edgeGuard = blurOn ? 1.03 : 1;

  const bundleTransform = `translate(${jx.toFixed(1)}px, ${(
    jy + (joltY / 100) * height
  ).toFixed(1)}px) scale(${(zoom * edgeGuard).toFixed(4)})`;

  return (
    <AbsoluteFill style={{ background: "#000", overflow: "hidden" }}>
      {/* 縦優位ブラー（縦:横 ≒ 10:1）の定義 */}
      {blurOn && (
        <svg width={0} height={0} style={{ position: "absolute" }} aria-hidden>
          <defs>
            <filter
              id={`${uid}-vblur`}
              x="-20%"
              y="-20%"
              width="140%"
              height="140%"
              colorInterpolationFilters="sRGB"
            >
              <feGaussianBlur
                stdDeviation={`${bH.toFixed(2)} ${bV.toFixed(2)}`}
              />
            </filter>
          </defs>
        </svg>
      )}

      {/* コンテンツ束 = A(常時) + B(不透明度)。束ごと揺れ・ズーム・ブラーを一括 */}
      <AbsoluteFill
        style={{
          transform: bundleTransform,
          filter: blurOn ? `url(#${uid}-vblur)` : undefined,
        }}
      >
        <AbsoluteFill style={{ filter: filterA || undefined }}>
          {from}
        </AbsoluteFill>
        {bOpacity > 0 && (
          <AbsoluteFill
            style={{
              opacity: clamp01(bOpacity),
              filter: filterB || undefined,
            }}
          >
            {to}
          </AbsoluteFill>
        )}
      </AbsoluteFill>

      {/* 暖色ライトリーク（対角の隅から放射状、screen） */}
      {leakEnv > 0.01 && (
        <>
          <AbsoluteFill
            style={{
              background:
                "radial-gradient(ellipse 70% 60% at 0% 100%, rgba(255,138,52,0.85) 0%, rgba(255,170,80,0.35) 40%, rgba(255,180,90,0) 68%)",
              mixBlendMode: "screen",
              opacity: leakEnv,
              pointerEvents: "none",
            }}
          />
          <AbsoluteFill
            style={{
              background:
                "radial-gradient(ellipse 60% 55% at 100% 0%, rgba(255,176,72,0.7) 0%, rgba(255,150,60,0.25) 42%, rgba(255,160,70,0) 66%)",
              mixBlendMode: "screen",
              opacity: leakEnv * 0.8,
              pointerEvents: "none",
            }}
          />
        </>
      )}

      {/* シアン色被り（overlay で薄く全体に。フラッシュ頂点では引っ込む） */}
      {castEnv > 0.01 && (
        <AbsoluteFill
          style={{
            background: "#1ea8c4",
            mixBlendMode: "overlay",
            opacity: castEnv,
            pointerEvents: "none",
          }}
        />
      )}

      {/* 縦光帯: 透明→暖白→透明の帯（画面高の4割・強ボカシ）が縦に通過 */}
      {bandOpacity > 0.01 && (
        <div
          style={{
            position: "absolute",
            left: "-8%",
            right: "-8%",
            height: "40%",
            top: `${bandTop.toFixed(2)}%`,
            background:
              "linear-gradient(180deg, rgba(255,246,228,0) 0%, rgba(255,242,218,0.9) 50%, rgba(255,246,228,0) 100%)",
            filter: `blur(${(34 * sx).toFixed(1)}px)`,
            mixBlendMode: "screen",
            opacity: bandOpacity,
            pointerEvents: "none",
          }}
        />
      )}

      {/* 白飛びフラッシュ: ブラー対象外でクリスプに。
          硬派個体は無彩色、他はわずかに暖色寄りの白（クリーム）。頂点でも 1.0 未満 */}
      {flash > 0.01 && (
        <AbsoluteFill
          style={{
            background:
              mode === 0
                ? "radial-gradient(circle at 50% 46%, rgba(255,255,255,0.98) 0%, rgba(255,255,255,0.55) 52%, rgba(255,255,255,0) 82%)"
                : "radial-gradient(circle at 50% 44%, rgba(255,249,238,0.98) 0%, rgba(255,244,226,0.55) 50%, rgba(255,246,232,0) 80%)",
            mixBlendMode: "screen",
            opacity: clamp01(flash) * 0.92,
            pointerEvents: "none",
          }}
        />
      )}

      {/* グレイン: フレーム番号でシードを変え毎フレーム描き直し、彩度を抜いて overlay */}
      {grainEnv > 0.01 && (
        <AbsoluteFill
          style={{
            mixBlendMode: "overlay",
            opacity: grainEnv,
            pointerEvents: "none",
          }}
        >
          <svg width="100%" height="100%" aria-hidden>
            <filter id={`${uid}-grain`} x="0" y="0" width="100%" height="100%">
              <feTurbulence
                type="fractalNoise"
                baseFrequency="0.9"
                numOctaves={2}
                seed={seed * 131 + frame * 17}
                stitchTiles="stitch"
              />
              {/* 彩度を抜いて（輝度化）アルファを立てる */}
              <feColorMatrix
                type="matrix"
                values="0.33 0.33 0.33 0 0  0.33 0.33 0.33 0 0  0.33 0.33 0.33 0 0  0 0 0 0 1"
              />
              {/* コントラストを立てる */}
              <feComponentTransfer>
                <feFuncR type="linear" slope={2.4} intercept={-0.7} />
                <feFuncG type="linear" slope={2.4} intercept={-0.7} />
                <feFuncB type="linear" slope={2.4} intercept={-0.7} />
              </feComponentTransfer>
            </filter>
            <rect width="100%" height="100%" filter={`url(#${uid}-grain)`} />
          </svg>
        </AbsoluteFill>
      )}
    </AbsoluteFill>
  );
};
