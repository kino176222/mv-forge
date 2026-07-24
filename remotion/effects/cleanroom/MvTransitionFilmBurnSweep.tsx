import React, { useId, useMemo } from "react";
import {
  AbsoluteFill,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

/**
 * MvTransitionFilmBurnSweep — 方向つきフィルムバーン切替（クリーンルーム実装）
 *
 * 機能: 旧カットの上に白熱した「フィルム焼け」の光を被せ、光が最も眩しい瞬間の
 *       裏で新カットへ差し替える約1秒のトランジション。焼け・色収差・ズーム・
 *       揺れが中央ピークの山型カーブで同期し、後半で素の新カットに戻る。
 *
 * 設計メモ:
 * - カーブはすべて区分線形（台形/三角）。切替だけ急峻（中央±5%のクイックディゾルブ）。
 * - 乱数は (seed, tick, index) の決定的ハッシュのみ。同フレームは何度レンダしても同じ絵。
 * - RGB分光は feColorMatrix でチャンネル分解 → feOffset → feBlend(screen) 再合成。
 *   in を明示しないと直前結果が引き継がれて色が壊れるため全段で明示する。
 * - 粒子は feTurbulence(fractalNoise) を毎フレーム seed 替えで overlay 合成。
 * - px 系の量は幅1920基準の係数に width/1920 を掛けて解像度非依存にする。
 * - 方向（left/right/up/down）は焼けの流れ・分光軸・付随モチーフで表現。
 *   forward/backward は最も近い見た目の up/down に写像する。
 */

export interface MvTransitionFilmBurnSweepProps {
  /** 旧カット */
  from: React.ReactNode;
  /** 新カット */
  to: React.ReactNode;
  /** トランジション全体の長さ（フレーム） */
  durationInFrames: number;
  /** 焼けの流れる方向 */
  direction?: "left" | "right" | "up" | "down" | "forward" | "backward";
  /** 0..1 同家族内の見た目分岐（決定論的） */
  variant?: number;
}

type Dir4 = "left" | "right" | "up" | "down";

/** (a,b,c) から 0..1 の決定的な擬似乱数（GLSL定番ハッシュ） */
const rand = (a: number, b: number, c: number): number => {
  const s = Math.sin(a * 127.1 + b * 311.7 + c * 74.7) * 43758.5453123;
  return s - Math.floor(s);
};

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

const CLAMP = {
  extrapolateLeft: "clamp",
  extrapolateRight: "clamp",
} as const;

// チャンネル分解用マトリクス
const MAT_R =
  "1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0";
const MAT_G =
  "0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0";
const MAT_B =
  "0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0";
const MAT_GB =
  "0 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 1 0";
// ノイズRGB→グレー（アルファ1固定）
const MAT_GRAIN =
  "0.33 0.33 0.33 0 0  0.33 0.33 0.33 0 0  0.33 0.33 0.33 0 0  0 0 0 0 1";

const DIR_INDEX: Record<Dir4, number> = { left: 0, right: 1, up: 2, down: 3 };

const normalizeDir = (
  d: NonNullable<MvTransitionFilmBurnSweepProps["direction"]>
): Dir4 => (d === "forward" ? "up" : d === "backward" ? "down" : d);

export const MvTransitionFilmBurnSweep: React.FC<
  MvTransitionFilmBurnSweepProps
> = ({ from, to, durationInFrames, direction = "left", variant = 0.5 }) => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const rawId = useId();
  const uid = useMemo(() => rawId.replace(/[^a-zA-Z0-9_-]/g, ""), [rawId]);

  const dir = normalizeDir(direction);
  const horizontal = dir === "left" || dir === "right";
  const k = width / 1920;

  // ---- シード（variant × 方向で決定的に分岐） ------------------------------
  const seedI = 17 + DIR_INDEX[dir] * 131 + Math.floor(clamp01(variant) * 991);
  const vr1 = rand(seedI, 0, 5); // ズーム量ゆらぎ
  const vr2 = rand(seedI, 0, 6); // 分光量ゆらぎ
  const vr3 = rand(seedI, 0, 7); // スポーク初期角 / グラデ角ゆらぎ
  const vr4 = rand(seedI, 0, 8); // フリッカー振幅ゆらぎ

  // ---- 進捗（最終キーフレームは尺の約96%地点へ写像） -----------------------
  const last = Math.max(1, durationInFrames - 1);
  const p = clamp01(frame / last / 0.96);

  // ---- エンベロープ（区分線形の台形/三角） ---------------------------------
  // 焼け: 1/8から直線上昇 → 中央プラトー → 立ち上がりよりやや長い減衰
  const burn = interpolate(p, [0.12, 0.47, 0.52, 0.86], [0, 1, 1, 0], CLAMP);
  // 色収差・ズーム・揺れ: 序盤から静かに立ち上がり中央で最大、終盤で0へ
  const peakEnv = interpolate(
    p,
    [0, 0.1, 0.46, 0.54, 0.92, 1],
    [0, 0.15, 1, 1, 0.12, 0],
    CLAMP
  );
  // 光線/ブルーム: 焼けより先行して1/4で全開、約3/4地点まで残る
  const raysMix = interpolate(p, [0.05, 0.25, 0.6, 0.78], [0, 1, 0.8, 0], CLAMP);
  // 切替: 中央±5%のクイックディゾルブ（白飛びの裏でほぼハードカット）
  const toOp = interpolate(p, [0.45, 0.55], [0, 1], CLAMP);
  // 端フレームを完全クリーンに保つゲート（縁隠しズーム・粒子・ビネット用）
  const gate = interpolate(p, [0, 0.05, 0.95, 1], [0, 1, 1, 0], CLAMP);

  // ---- フリッカー（中盤のみ、数フレーム単位の矩形波） ----------------------
  const flickGate = interpolate(p, [0.3, 0.36, 0.66, 0.72], [0, 1, 1, 0], CLAMP);
  const flickStep = rand(seedI, Math.floor(frame / 2), 51) < 0.5 ? 1 : 0;
  const flicker = 1 - flickGate * flickStep * (0.1 + vr4 * 0.1);

  // ---- 揺れ（フレームの2.5倍レートのtickでハッシュを引く） -----------------
  const tick = Math.floor(frame * 2.5);
  const shakeAmp = 0.008 * width * peakEnv;
  const shakeX =
    (rand(seedI, tick, 21) - 0.5) * 2 * shakeAmp * (horizontal ? 1.35 : 0.75);
  const shakeY =
    (rand(seedI, tick, 22) - 0.5) * 2 * shakeAmp * (horizontal ? 0.75 : 1.35);

  // ---- ズーム / 伸び / ドリフト --------------------------------------------
  // 縁隠しの常時拡大（ゲート付き）× 中央ピークのズームパンチ
  const zoomPunch = (0.2 + vr1 * 0.09) * peakEnv;
  const upDrift = dir === "up" ? 0.05 * p * peakEnv : 0; // ゆっくり追いズーム
  const zoom = (1 + 0.03 * gate) * (1 + zoomPunch + upDrift);
  const stretchX = dir === "right" ? 1 + 0.035 * peakEnv : 1;
  const stretchY = dir === "up" || dir === "down" ? 1 + 0.05 * peakEnv : 1;
  const driftY = dir === "down" ? 0.04 * height * peakEnv : 0;

  // ---- RGB分光 --------------------------------------------------------------
  const shift = (14 + vr2 * 22) * k * peakEnv;
  const axX = horizontal ? (dir === "left" ? -1 : 1) : 0;
  const axY = horizontal ? 0 : dir === "up" ? -1 : 1;
  const dx = axX * shift;
  const dy = axY * shift;
  const splitOn = shift > 0.4;
  // left は R片側 / G+B 逆側の2分割方式、他は R/G/B 3分割方式
  const twoWay = dir === "left";
  const splitId = `${uid}-split`;

  // ---- 焼け核の位置（right: 1/3 → 2/3 へ水平移動） -------------------------
  const cx = 33 + 33 * p;

  // ---- 全面白フラッシュ（個体差） -------------------------------------------
  const flashAmt =
    dir === "up"
      ? 0.95 * burn // 家族中最強・焼け量にほぼ比例（ほぼホワイトアウト）
      : dir === "down"
        ? 0.9 * burn * burn // 2乗で頂点のみ鋭く
        : dir === "left"
          ? 0.75 * Math.pow(burn, 1.25)
          : 0.4 * burn * burn; // right は核と光線が主役なので控えめ

  // ---- 方向別の焼けグラデ ----------------------------------------------------
  const whiteEdge = 6 + burn * 42; // left: 白領域の右端（%）
  const burnLayer: React.CSSProperties = (() => {
    if (dir === "left") {
      const ang = 90 + (vr3 - 0.5) * 10; // 楔らしいわずかな傾き
      return {
        background: `linear-gradient(${ang.toFixed(1)}deg,
          rgba(255,255,255,0.96) 0%,
          rgba(255,255,255,0.93) ${(whiteEdge * 0.6).toFixed(1)}%,
          rgba(255,244,222,0.88) ${whiteEdge.toFixed(1)}%,
          rgba(255,196,120,0.6) ${(whiteEdge + 14).toFixed(1)}%,
          rgba(255,132,52,0.3) ${(whiteEdge + 28).toFixed(1)}%,
          rgba(255,100,40,0) ${Math.min(99, whiteEdge + 44).toFixed(1)}%)`,
      };
    }
    if (dir === "right") {
      const rw = 28 + burn * 27;
      const rh = 36 + burn * 32;
      return {
        background: `radial-gradient(ellipse ${rw.toFixed(1)}% ${rh.toFixed(1)}% at ${cx.toFixed(1)}% 50%,
          rgba(255,255,255,0.98) 0%,
          rgba(255,214,150,0.9) 18%,
          rgba(255,120,60,0.75) 38%,
          rgba(255,40,130,0.5) 60%,
          rgba(160,10,40,0.25) 78%,
          rgba(80,0,20,0) 100%)`,
      };
    }
    if (dir === "up") {
      return {
        background: `linear-gradient(0deg,
          rgba(255,255,255,0.96) 0%,
          rgba(255,248,232,0.9) ${(8 + burn * 18).toFixed(1)}%,
          rgba(255,214,150,0.6) ${(20 + burn * 28).toFixed(1)}%,
          rgba(255,170,100,0.25) ${(34 + burn * 32).toFixed(1)}%,
          rgba(255,150,80,0) ${Math.min(99, 48 + burn * 40).toFixed(1)}%)`,
      };
    }
    // down
    return {
      background: `linear-gradient(180deg,
        rgba(255,252,246,0.95) 0%,
        rgba(255,236,200,0.8) ${(8 + burn * 20).toFixed(1)}%,
        rgba(255,180,110,0.4) ${(20 + burn * 30).toFixed(1)}%,
        rgba(255,160,90,0) ${Math.min(99, 40 + burn * 35).toFixed(1)}%)`,
    };
  })();

  // ---- 方向別の光線/ブルーム -------------------------------------------------
  const spokeMask = `radial-gradient(circle at ${cx.toFixed(1)}% 50%, rgba(0,0,0,1) 0%, rgba(0,0,0,0.85) 22%, rgba(0,0,0,0) 52%)`;
  const shaftMask =
    "radial-gradient(ellipse 90% 85% at 50% 100%, rgba(0,0,0,1) 0%, rgba(0,0,0,0.7) 45%, rgba(0,0,0,0) 72%)";

  const grainSeed = 1 + ((seedI + frame * 7) % 997);
  const chevOp =
    interpolate(p, [0.3, 0.38, 0.62, 0.7], [0, 1, 1, 0], CLAMP) * 0.9;

  return (
    <AbsoluteFill style={{ background: "#000", overflow: "hidden" }}>
      {/* 分光フィルタ定義（in明示・screenで再合成） */}
      <svg width={0} height={0} style={{ position: "absolute" }} aria-hidden>
        <defs>
          {twoWay ? (
            <filter
              id={splitId}
              colorInterpolationFilters="sRGB"
              x="-20%"
              y="-20%"
              width="140%"
              height="140%"
            >
              <feColorMatrix
                in="SourceGraphic"
                type="matrix"
                values={MAT_R}
                result="cr"
              />
              <feOffset in="cr" dx={dx} dy={dy} result="cro" />
              <feColorMatrix
                in="SourceGraphic"
                type="matrix"
                values={MAT_GB}
                result="cgb"
              />
              <feOffset in="cgb" dx={-dx} dy={-dy} result="cgbo" />
              <feBlend in="cro" in2="cgbo" mode="screen" />
            </filter>
          ) : (
            <filter
              id={splitId}
              colorInterpolationFilters="sRGB"
              x="-20%"
              y="-20%"
              width="140%"
              height="140%"
            >
              <feColorMatrix
                in="SourceGraphic"
                type="matrix"
                values={MAT_R}
                result="cr"
              />
              <feOffset in="cr" dx={dx} dy={dy} result="cro" />
              <feColorMatrix
                in="SourceGraphic"
                type="matrix"
                values={MAT_G}
                result="cg"
              />
              <feColorMatrix
                in="SourceGraphic"
                type="matrix"
                values={MAT_B}
                result="cb"
              />
              <feOffset in="cb" dx={-dx} dy={-dy} result="cbo" />
              <feBlend in="cro" in2="cg" mode="screen" result="crg" />
              <feBlend in="crg" in2="cbo" mode="screen" />
            </filter>
          )}
        </defs>
      </svg>

      {/* 映像レイヤー: 揺れ(translate) → ズーム/伸び(scale) → 分光(filter) */}
      <AbsoluteFill
        style={{
          transform: `translate(${shakeX.toFixed(1)}px, ${(shakeY + driftY).toFixed(1)}px)`,
        }}
      >
        <AbsoluteFill
          style={{
            transform: `scale(${(zoom * stretchX).toFixed(4)}, ${(zoom * stretchY).toFixed(4)})`,
          }}
        >
          <AbsoluteFill
            style={{ filter: splitOn ? `url(#${splitId})` : undefined }}
          >
            <AbsoluteFill>{from}</AbsoluteFill>
            <AbsoluteFill style={{ opacity: toOp }}>{to}</AbsoluteFill>
          </AbsoluteFill>
        </AbsoluteFill>
      </AbsoluteFill>

      {/* ---- 発光レイヤー群（すべて screen 合成） ---- */}

      {/* 光線 / ブルーム（焼けより先行して全開、遅くまで残る） */}
      {dir === "left" && (
        <AbsoluteFill
          style={{
            background:
              "radial-gradient(ellipse 55% 70% at 8% 45%, rgba(255,236,210,0.95) 0%, rgba(255,200,150,0.5) 40%, rgba(255,180,120,0) 70%)",
            mixBlendMode: "screen",
            opacity: raysMix,
          }}
        />
      )}
      {dir === "right" && (
        <>
          {/* 核に追従する放射状スポーク（conic＋ラジアルマスク） */}
          <AbsoluteFill
            style={{
              background: `repeating-conic-gradient(from ${(p * 50 + vr3 * 360).toFixed(1)}deg at ${cx.toFixed(1)}% 50%, rgba(255,244,226,0.55) 0deg 1.6deg, rgba(255,244,226,0) 1.6deg 6.4deg)`,
              WebkitMaskImage: spokeMask,
              maskImage: spokeMask,
              mixBlendMode: "screen",
              opacity: raysMix * (0.35 + 0.65 * burn),
            }}
          />
          {/* ティール光漏れ */}
          <AbsoluteFill
            style={{
              background: `radial-gradient(ellipse 42% 60% at ${Math.max(2, cx - 30).toFixed(1)}% 28%, rgba(50,205,190,0.35) 0%, rgba(50,205,190,0) 70%)`,
              mixBlendMode: "screen",
              opacity: burn * 0.6,
            }}
          />
        </>
      )}
      {dir === "up" && (
        <AbsoluteFill
          style={{
            background: `repeating-linear-gradient(90deg, rgba(255,250,240,0.5) 0px, rgba(255,250,240,0.5) ${(2 * k).toFixed(1)}px, rgba(255,250,240,0) ${(2 * k).toFixed(1)}px, rgba(255,250,240,0) ${(24 * k).toFixed(1)}px)`,
            WebkitMaskImage: shaftMask,
            maskImage: shaftMask,
            mixBlendMode: "screen",
            opacity: raysMix * 0.85,
          }}
        />
      )}
      {dir === "down" && (
        <>
          {/* 中央の横帯ブルーム */}
          <AbsoluteFill
            style={{
              background:
                "radial-gradient(ellipse 80% 18% at 45% 50%, rgba(255,255,255,0.9) 0%, rgba(255,255,255,0) 70%)",
              mixBlendMode: "screen",
              opacity: raysMix,
            }}
          />
          {/* 左からの暖色ライトリーク */}
          <AbsoluteFill
            style={{
              background:
                "linear-gradient(90deg, rgba(255,166,88,0.55) 0%, rgba(255,166,88,0.18) 22%, rgba(255,166,88,0) 45%)",
              mixBlendMode: "screen",
              opacity: raysMix * 0.9,
            }}
          />
          {/* 縦スキャンライン */}
          <AbsoluteFill
            style={{
              background: `repeating-linear-gradient(90deg, rgba(255,255,255,0.12) 0px, rgba(255,255,255,0.12) ${(1.5 * k).toFixed(1)}px, rgba(255,255,255,0) ${(1.5 * k).toFixed(1)}px, rgba(255,255,255,0) ${(7 * k).toFixed(1)}px)`,
              mixBlendMode: "screen",
              opacity: 0.45 * peakEnv,
            }}
          />
        </>
      )}

      {/* 焼け本体（白熱コア→暖色→透明、フリッカーで脈打つ） */}
      <AbsoluteFill
        style={{
          ...burnLayer,
          mixBlendMode: "screen",
          opacity: clamp01(burn * flicker),
        }}
      />

      {/* 補色の縁被り（left: 焼けの縁に薄いティール） */}
      {dir === "left" && (
        <AbsoluteFill
          style={{
            background: `linear-gradient(90deg, rgba(64,205,190,0) ${whiteEdge.toFixed(1)}%, rgba(64,205,190,0.28) ${Math.min(96, whiteEdge + 20).toFixed(1)}%, rgba(64,205,190,0) ${Math.min(100, whiteEdge + 38).toFixed(1)}%)`,
            mixBlendMode: "screen",
            opacity: burn * 0.8,
          }}
        />
      )}

      {/* 全面白フラッシュ（頂点の切替隠蔽） */}
      <AbsoluteFill
        style={{ background: "#fff", opacity: clamp01(flashAmt) }}
      />

      {/* multiply の茶系ビネット（down 常設） */}
      {dir === "down" && (
        <AbsoluteFill
          style={{
            background:
              "radial-gradient(ellipse 75% 75% at 50% 50%, rgba(74,46,20,0) 52%, rgba(74,46,20,0.6) 100%)",
            mixBlendMode: "multiply",
            opacity: 0.8 * gate,
          }}
        />
      )}

      {/* フィルム粒子（overlay、seed を毎フレーム替えてチラつかせる） */}
      <svg
        width="100%"
        height="100%"
        style={{
          position: "absolute",
          inset: 0,
          mixBlendMode: "overlay",
          opacity: 0.1 * gate,
          pointerEvents: "none",
        }}
        aria-hidden
      >
        <defs>
          <filter
            id={`${uid}-grain`}
            x="0%"
            y="0%"
            width="100%"
            height="100%"
          >
            <feTurbulence
              type="fractalNoise"
              baseFrequency={0.82}
              numOctaves={2}
              seed={grainSeed}
              stitchTiles="stitch"
              result="noise"
            />
            <feColorMatrix in="noise" type="matrix" values={MAT_GRAIN} />
          </filter>
        </defs>
        <rect
          x="0"
          y="0"
          width="100%"
          height="100%"
          filter={`url(#${uid}-grain)`}
        />
      </svg>

      {/* 方向マーカー（down: 中盤だけ白い下向きシェブロン2段） */}
      {dir === "down" && chevOp > 0.01 && (
        <svg
          viewBox="0 0 120 120"
          style={{
            position: "absolute",
            left: "50%",
            top: "50%",
            width: `${(90 * k).toFixed(1)}px`,
            height: `${(90 * k).toFixed(1)}px`,
            transform: "translate(-50%, -50%)",
            opacity: chevOp,
            filter: `drop-shadow(0 0 ${(6 * k).toFixed(1)}px rgba(255,255,255,0.7))`,
          }}
          aria-hidden
        >
          <polyline
            points="35,28 60,53 85,28"
            stroke="#ffffff"
            strokeWidth={6}
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <polyline
            points="35,62 60,87 85,62"
            stroke="#ffffff"
            strokeWidth={6}
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )}
    </AbsoluteFill>
  );
};
