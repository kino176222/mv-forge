import React, { useId, useMemo } from "react";
import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";

/**
 * MvTransitionCollapse — デジタル崩壊トランジション（クリーンルーム実装）
 *
 * 機能: グリッチ / ブロックノイズ / RGBずれで映像を「断ち切る」MV用トランジション。
 * 進行: 出ていく絵が徐々に崩壊 → 切替点で白ウォッシュのフラッシュ＋最大崩壊 →
 *       入ってくる絵が組み上がり、最終フレームは完全にクリーンな to で終わる。
 *
 * 設計メモ:
 * - 乱数はすべて (seed, frame, index) から決定的に生成。同フレームは何度レンダしても同じ絵。
 * - 映像は横スライスに分割して左右に変位（走査線ずらし）。全体は軽くインセット
 *   （縮小＋シェイク）してフレーム縁の崩壊を見せる。
 * - RGBずれは feColorMatrix でチャンネル分離した3層の screen 合成:
 *   G=スライス変位層 / R・B=全面を左右にずらした層。整列時は元の色を正確に再構成し、
 *   ずれた分だけ縁と変位スライスに色収差が出る。
 * - ブロックノイズは backdrop-filter（下の絵を反転/色相ずらし）を主体に、
 *   アクセント色の薄いタイルを少量。上下端のマクロブロック列も混ぜる。
 * - テキスト・フォントは一切使わない（配布フォント問題なし）。
 */

export type MvTransitionCollapseProps = {
  /** 出ていく側の絵 */
  from: React.ReactNode;
  /** 入ってくる側の絵 */
  to: React.ReactNode;
  /** トランジション全体の長さ（フレーム） */
  durationInFrames: number;
  /** 崩壊の全体強度 0..1 */
  intensity?: number;
  /** 横スライスの本数（走査線ずらしの粒度） */
  sliceCount?: number;
  /** スライスの最大横変位（画面幅に対する%） */
  maxSliceShiftPct?: number;
  /** RGBずれの最大量（px, 1080p基準） */
  rgbShiftPx?: number;
  /** ブロックノイズの密度 0..1 */
  blockDensity?: number;
  /** 走査線オーバーレイの濃さ 0..1 */
  scanlineOpacity?: number;
  /** 切替点の白ウォッシュ量 0..1（露出が飛ぶフラッシュ） */
  flash?: number;
  /** フラッシュ／崩壊の隙間から覗く色 */
  flashColor?: string;
  /** from→to が切り替わる進行位置 0..1 */
  switchAt?: number;
  /** 画面シェイクの最大量（px, 1080p基準） */
  shakePx?: number;
  /** インセット（縮小）の最大量 0..1（0.05 = 最大5%縮む） */
  insetAmount?: number;
  /** ブロックノイズのアクセント色（少量だけ乗る） */
  accentColorA?: string;
  accentColorB?: string;
  /** 乱数シード（同じ値なら同じ崩れ方） */
  seed?: number;
};

/** (a,b,c) から 0..1 の決定的な擬似乱数を返す（GLSL の定番ハッシュ） */
const rand = (a: number, b: number, c: number): number => {
  const s = Math.sin(a * 127.1 + b * 311.7 + c * 74.7) * 43758.5453123;
  return s - Math.floor(s);
};

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/**
 * interpolate の入力レンジを厳密単調増加に矯正する。
 * switchAt が端に寄った場合（例 0.05 や 0.7）でもレンジ崩れで throw しないための保険。
 * 既定値（switchAt=0.45）ではもともと単調増加なので結果は不変。
 */
const monotonic = (points: number[]): number[] => {
  const out = points.slice();
  for (let i = 1; i < out.length; i++) {
    out[i] = Math.max(out[i], out[i - 1] + 1e-5);
  }
  return out;
};

export const MvTransitionCollapse: React.FC<MvTransitionCollapseProps> = ({
  from,
  to,
  durationInFrames,
  intensity = 1,
  sliceCount = 14,
  maxSliceShiftPct = 4.5,
  rgbShiftPx = 12,
  blockDensity = 0.55,
  scanlineOpacity = 0.16,
  flash = 0.75,
  flashColor = "#ffffff",
  switchAt = 0.45,
  shakePx = 12,
  insetAmount = 0.05,
  accentColorA = "#00e5ff",
  accentColorB = "#ff2bd1",
  seed = 7,
}) => {
  const frame = useCurrentFrame();
  const rawId = useId();
  const uid = useMemo(() => rawId.replace(/[^a-zA-Z0-9_-]/g, ""), [rawId]);

  const last = Math.max(1, durationInFrames - 1);
  const p = clamp01(frame / last);
  const sAt = clamp01(switchAt);

  // ---- エンベロープ --------------------------------------------------------
  // 崩壊量: 立ち上がり → 切替点で最大 → 後半へ向けて減衰 → 最終フレームで 0
  const g =
    clamp01(intensity) *
    interpolate(
      p,
      monotonic([0, 0.1, sAt, Math.min(0.99, sAt + 0.2), 0.85, 1]),
      [0, 0.35, 1, 0.85, 0.4, 0],
      { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
    );
  // 白ウォッシュ: 切替点で最大 → 尾を引いて消える（露出が飛んで戻る）
  const wash =
    clamp01(flash) *
    interpolate(
      p,
      monotonic([Math.max(0, sAt - 0.14), sAt, Math.min(0.99, sAt + 0.18), 0.85]),
      [0, 1, 0.5, 0],
      { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
    );

  // ---- 表示コンテンツの選択（切替点の直前に1フレームの先行フリッカー） -----
  const cutFrame = Math.round(sAt * last);
  let showTo = frame >= cutFrame;
  if (frame === cutFrame - 1 && rand(seed, frame, 991) > 0.55) {
    showTo = true;
  }
  const content = showTo ? to : from;

  // ---- シェイク＋インセット ------------------------------------------------
  const shakeX = (rand(seed, frame, 11) - 0.5) * 2 * shakePx * g;
  const shakeY = (rand(seed, frame, 12) - 0.5) * 2 * shakePx * 0.6 * g;
  const rot = (rand(seed, frame, 13) - 0.5) * 0.6 * g;
  const inset = 1 - insetAmount * g;

  // ---- スライス（走査線ずらし） --------------------------------------------
  // 注記(性能): content はスライス14分割＋R/B チャンネル層で計16回マウントされる。
  // DOM複製によるスライス表現の構造上、1回化には feDisplacementMap 等への
  // 全面作り替えが必要で、承認済みの既定の絵が変わるリスクがあるため見送り。
  // 重い content を渡す場合は事前にラスタライズ（<Img>/<OffthreadVideo>）を推奨。
  const slices = useMemo(
    () => Array.from({ length: sliceCount }, (_, i) => i),
    [sliceCount]
  );
  const sliceH = 100 / sliceCount;
  const sliceLayer = (
    <AbsoluteFill>
      {slices.map((i) => {
        const active = rand(seed, frame, 200 + i) < g * 0.8;
        const amp = rand(seed + 2, frame, 300 + i) - 0.5;
        const shift = active ? amp * 2 * maxSliceShiftPct * g : 0;
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              top: `${(i * sliceH).toFixed(4)}%`,
              height: `${sliceH.toFixed(4)}%`,
              overflow: "hidden",
              transform: `translateX(${shift.toFixed(3)}%)`,
            }}
          >
            <div
              style={{
                position: "absolute",
                left: 0,
                top: `${(-i * 100).toFixed(2)}%`,
                width: "100%",
                height: `${(sliceCount * 100).toFixed(0)}%`,
              }}
            >
              <AbsoluteFill>{content}</AbsoluteFill>
            </div>
          </div>
        );
      })}
    </AbsoluteFill>
  );

  // ---- ブロックノイズ --------------------------------------------------------
  const blockTotal = Math.round(22 * clamp01(blockDensity) * g);
  const blocks = Array.from({ length: blockTotal }, (_, i) => {
    const rx = rand(seed, frame, 100 + i * 3);
    const ry = rand(seed, frame, 101 + i * 3);
    const rw = rand(seed, frame, 102 + i * 3);
    const kind = rand(seed + 1, frame, 103 + i * 3);
    // 半分弱は上下端のマクロブロック列に寄せる（Bad TV の縁ノイズ）
    const edgeBand = i % 2 === 0;
    const top = edgeBand ? (ry < 0.5 ? ry * 5 : 95 + (ry - 0.5) * 10) : ry * 92;
    return {
      left: rx * 96,
      top,
      width: edgeBand ? 5 + rw * 16 : 3 + rw * 9,
      height: edgeBand ? 0.8 + rw * 1.8 : 1 + rw * 2.6,
      kind,
      i,
    };
  });

  // ---- 端の色ノイズ柱 --------------------------------------------------------
  const edgeSide =
    rand(seed, Math.floor(frame / 2), 55) > 0.5 ? "left" : "right";
  const edgeW = 1.1 * g;

  const rgbOffset = rgbShiftPx * g;
  const splitOn = rgbOffset > 0.5;

  const grade = [
    `saturate(${(1 - wash * 0.22).toFixed(3)})`,
    `brightness(${(1 + wash * 0.3).toFixed(3)})`,
    `contrast(${(1 - wash * 0.12 + g * 0.06).toFixed(3)})`,
  ].join(" ");

  return (
    <AbsoluteFill style={{ background: "#000", overflow: "hidden" }}>
      {/* チャンネル分離用フィルタ定義 */}
      <svg width={0} height={0} style={{ position: "absolute" }} aria-hidden>
        <defs>
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
        </defs>
      </svg>

      {/* 崩壊時に隙間から覗くフラッシュ背景 */}
      <AbsoluteFill
        style={{
          background: flashColor,
          opacity: clamp01(wash * 0.95 + g * 0.05),
        }}
      />

      {/* 本体（グレード＋シェイク＋インセット） */}
      <AbsoluteFill
        style={{
          filter: grade,
          transform: `translate(${shakeX.toFixed(1)}px, ${shakeY.toFixed(
            1
          )}px) rotate(${rot.toFixed(3)}deg) scale(${inset.toFixed(4)})`,
        }}
      >
        {splitOn ? (
          <>
            {/* G: スライス変位層（緑チャンネル） */}
            <AbsoluteFill style={{ filter: `url(#${uid}-g)` }}>
              {sliceLayer}
            </AbsoluteFill>
            {/* R / B: 全面を左右にずらした層。整列部は screen 合成で元の色に戻る */}
            <AbsoluteFill
              style={{
                filter: `url(#${uid}-r)`,
                mixBlendMode: "screen",
                transform: `translateX(${(-rgbOffset).toFixed(1)}px)`,
              }}
            >
              {content}
            </AbsoluteFill>
            <AbsoluteFill
              style={{
                filter: `url(#${uid}-b)`,
                mixBlendMode: "screen",
                transform: `translateX(${rgbOffset.toFixed(1)}px)`,
              }}
            >
              {content}
            </AbsoluteFill>
          </>
        ) : (
          sliceLayer
        )}

        {/* ブロックノイズ（backdrop-filter 主体。アクセント色は少量） */}
        {blocks.map((b) => {
          const useTint = b.kind < 0.3;
          const tint =
            b.kind < 0.12
              ? accentColorA
              : b.kind < 0.22
                ? accentColorB
                : "#c8cdd2";
          return (
            <div
              key={b.i}
              style={{
                position: "absolute",
                left: `${b.left.toFixed(2)}%`,
                top: `${b.top.toFixed(2)}%`,
                width: `${b.width.toFixed(2)}%`,
                height: `${b.height.toFixed(2)}%`,
                background: useTint ? tint : undefined,
                opacity: useTint ? 0.08 + b.kind * 0.25 : 1,
                backdropFilter: useTint
                  ? undefined
                  : `invert(${(0.15 + b.kind * 0.35).toFixed(2)}) saturate(2) hue-rotate(${Math.round(
                      (b.kind - 0.5) * 140
                    )}deg)`,
              }}
            />
          );
        })}

        {/* 端の色ノイズ柱（チャンネルが縁で暴れる表現） */}
        {edgeW > 0.12 && (
          <div
            style={{
              position: "absolute",
              top: 0,
              bottom: 0,
              [edgeSide]: 0,
              width: `${edgeW.toFixed(2)}%`,
              background: `repeating-linear-gradient(180deg, ${accentColorA} 0px, ${accentColorA} 3px, #ffe400 3px, #ffe400 5px, ${accentColorB} 5px, ${accentColorB} 8px, #16f04a 8px, #16f04a 10px)`,
              opacity: clamp01(g * 0.8),
              mixBlendMode: "screen",
            }}
          />
        )}

        {/* 走査線 */}
        <AbsoluteFill
          style={{
            background:
              "repeating-linear-gradient(180deg, rgba(0,0,0,0.5) 0px, rgba(0,0,0,0.5) 1px, transparent 1px, transparent 4px)",
            opacity: clamp01(scanlineOpacity * g * 3),
            pointerEvents: "none",
          }}
        />
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
