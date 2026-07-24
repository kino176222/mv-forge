import React, { useId, useMemo } from "react";
import {
  AbsoluteFill,
  Easing,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

/**
 * MvTransitionNegativeFlash — ネガ反転フラッシュ・トランジション（クリーンルーム実装）
 *
 * 「色ネガ反転の閃光」で旧カット→新カットを切り替えるトランジション家族。
 * variant で家族内の2つの見た目に分岐する:
 *
 * - variant < 0.5（標準形・約0.4秒向け）:
 *   三角パルス1発。反転・激しいシェイク・明滅・白フラッシュ・フィルム質感
 *   （ダスト＋引っかき傷）が全部1本のパルスに乗る。反転で画が壊れている陰で
 *   旧→新をクロスディゾルブでこっそり差し替える。
 *
 * - variant >= 0.5（2連発＋急ズームブラー型・約0.67秒向け）:
 *   台形パルス2連発の反転＋放射状ブラー近似（ガウスブラー＋拡大ゴーストの
 *   screen重ね）。旧カットが加速ズームで突っ込み、新カットがその倍率を
 *   引き継いで減速着地する1本のカメラワーク。フィルム質感は捨てて
 *   スピード感が主役。
 *
 * 設計メモ:
 * - 全エンベロープは進行度 p = frame/(duration-1) の折れ線で駆動。
 * - 乱数は (seed, frame, salt) の決定的ハッシュのみ。Math.random 不使用。
 * - ネガ反転の罠: invert() の量が 0.5 付近だと画が均一グレーに潰れる。
 *   反転量を「0.5未満→0寄り（〜22%）/ 0.5以上→1寄り（78%〜）」へ再マップして
 *   ベタ灰色フレームを排除する（タイミングの窓は変えない）。
 * - 旧・新カットは同じ束に入れて transform / filter をまとめて焼く
 *   （切替の継ぎ目が反転の陰に隠れる）。
 * - 加える光は純白のみ（反転そのものが色の主役。暖色発光は使わない）。
 * - px系の量（揺れ・ブラー）は width/1920 で解像度正規化。
 */

export interface MvTransitionNegativeFlashProps {
  /** 旧カット */
  from: React.ReactNode;
  /** 新カット */
  to: React.ReactNode;
  /** トランジション全体の長さ（フレーム） */
  durationInFrames: number;
  /**
   * 方向指定（契約互換のため受けるが、この家族は無方向なので未使用）
   */
  direction?: "left" | "right" | "up" | "down" | "forward" | "backward";
  /**
   * 家族内の見た目分岐 0..1（決定論的）。
   * 0.5 未満 = 1発型（フィルム質感）/ 0.5 以上 = 2連発＋急ズームブラー型。
   * 端数は乱数シードにも混ぜる。
   */
  variant?: number;
}

/** (a,b,c) から 0..1 の決定的な擬似乱数（GLSL 定番のsinハッシュ） */
const rand = (a: number, b: number, c: number): number => {
  const s = Math.sin(a * 127.1 + b * 311.7 + c * 74.7) * 43758.5453123;
  return s - Math.floor(s);
};

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/**
 * ネガ反転量の再マップ。中間値（均一グレーに潰れる帯）を避けて
 * 0寄り／1寄りへ圧縮する。0 と 1 は不変なのでパルスの窓は変わらない。
 */
const remapInvert = (v: number): number => {
  const t = clamp01(v);
  if (t < 0.5) return t * 0.44; // 0 .. 0.22
  return 0.78 + (t - 0.5) * 0.44; // 0.78 .. 1
};

/** 台形パルス: a で急立ち上がり → 短い保持 → b で急下降 */
const trapezoid = (p: number, a: number, b: number): number => {
  const edge = Math.min(0.05, (b - a) / 3);
  return interpolate(p, [a, a + edge, b - edge, b], [0, 1, 1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
};

export const MvTransitionNegativeFlash: React.FC<
  MvTransitionNegativeFlashProps
> = ({ from, to, durationInFrames, variant = 0 }) => {
  const frame = useCurrentFrame();
  const { fps, width } = useVideoConfig();
  const rawId = useId();
  const uid = useMemo(() => rawId.replace(/[^a-zA-Z0-9_-]/g, ""), [rawId]);

  const v = clamp01(variant);
  const doubleMode = v >= 0.5;
  const seed = 7 + Math.floor(v * 1000);

  const last = Math.max(1, durationInFrames - 1);
  const p = clamp01(frame / last);

  /** 解像度正規化係数（フルHD基準） */
  const k = width / 1920;

  // =========================================================================
  // エンベロープ（すべて進行度の折れ線）
  // =========================================================================

  let invertAmount: number;
  let toOpacity: number;
  let pulse = 0; // 1発型の共通パルス
  let blurEnv = 0; // 2連発型のズームブラー包絡

  if (!doubleMode) {
    // --- 1発型: 三角パルス（45%弱で頂点、9割弱でゼロ） -------------------
    pulse = interpolate(p, [0, 0.44, 0.88, 1], [0, 1, 0, 0], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    });
    // 反転は矩形に近い鋭いパルス。頂点から 2/3 時点（~0.73）で先に抜ける
    const invRaw = interpolate(p, [0.06, 0.17, 0.6, 0.73], [0, 1, 1, 0], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    });
    invertAmount = remapInvert(invRaw);
    // クロスディゾルブ: 1/3〜2/3 の窓（反転の陰で入れ替える）
    toOpacity = interpolate(p, [1 / 3, 2 / 3], [0, 1], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
      easing: Easing.inOut(Easing.cubic),
    });
  } else {
    // --- 2連発型: 台形パルス×2（1/4〜4割強、5/8〜8割弱） -----------------
    const p1 = trapezoid(p, 0.25, 0.42);
    const p2 = trapezoid(p, 0.625, 0.78);
    invertAmount = remapInvert(Math.max(p1, p2));
    // カット切替: 4割〜5割強（1発目直後・ブラー頂点の陰）
    toOpacity = interpolate(p, [0.4, 0.53], [0, 1], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
      easing: Easing.inOut(Easing.cubic),
    });
    // ズームブラー包絡: 山型（1割弱で立ち上がり、切替点付近で頂点、9割で収束）
    blurEnv = interpolate(p, [0.08, 0.3, 0.47, 0.7, 0.9], [0, 0.7, 1, 0.35, 0], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    });
  }

  // =========================================================================
  // カメラ（揺れ・ズーム）
  // =========================================================================

  let shakeX = 0;
  let shakeY = 0;
  let camScale = 1;

  if (!doubleMode) {
    // 毎秒15回程度の連続振動 × パルス包絡。
    // 横=sin / 縦=位相3割速のcos で斜め楕円軌道、乱数ずれを3割ブレンド。
    const phase = (frame / fps) * 15 * Math.PI * 2;
    const jx = (rand(seed, frame, 21) - 0.5) * 2;
    const jy = (rand(seed, frame, 22) - 0.5) * 2;
    const amp = 46 * k * pulse; // フルHD基準で数十px級
    shakeX = (0.7 * Math.sin(phase) + 0.3 * jx) * amp;
    shakeY = (0.7 * Math.cos(phase * 1.3) + 0.3 * jy) * amp * 0.72;
    // 黒縁隠し: パルス比例で1割強までズームイン
    camScale = 1 + 0.12 * pulse;
  } else {
    // 控えめ（10px級）・ブラー包絡同期のフレーム乱数のみ（周期振動なし）
    const amp = 10 * k * blurEnv;
    shakeX = (rand(seed, frame, 23) - 0.5) * 2 * amp;
    shakeY = (rand(seed, frame, 24) - 0.5) * 2 * amp;
    // 勢いの継承ズーム: 前半で等倍→1.22へ加速、切替後はその倍率から減速着地
    camScale =
      p <= 0.46
        ? interpolate(p, [0, 0.46], [1, 1.22], {
            easing: Easing.in(Easing.quad),
          })
        : interpolate(p, [0.46, 1], [1.22, 1], {
            extrapolateRight: "clamp",
            easing: Easing.out(Easing.cubic),
          });
  }

  // =========================================================================
  // フィルタ（反転・明滅・ブラー）
  // =========================================================================

  // 明滅: フレーム乱数で輝度1〜1.35倍（反転中は元々明るいので控えめ）
  const flickerBright = doubleMode
    ? 1
    : 1 + rand(seed, frame, 31) * 0.35 * pulse;

  const wrapFilters: string[] = [];
  if (invertAmount > 0.004) {
    wrapFilters.push(`invert(${invertAmount.toFixed(4)})`);
  }
  if (Math.abs(flickerBright - 1) > 0.004) {
    wrapFilters.push(`brightness(${flickerBright.toFixed(3)})`);
  }

  const baseBlurPx = doubleMode ? 26 * k * blurEnv : 0;

  // =========================================================================
  // コンテンツ束（旧を下地に、新を不透明度クロスで上乗せ）
  // =========================================================================

  const contentStack = (
    <>
      <AbsoluteFill>{from}</AbsoluteFill>
      <AbsoluteFill style={{ opacity: clamp01(toOpacity) }}>{to}</AbsoluteFill>
    </>
  );

  // 放射状ブラー近似の拡大ゴースト（2連発型のみ・包絡ほぼゼロなら描かない）
  const ghosts =
    doubleMode && blurEnv > 0.02
      ? [
          { scale: 1.06, blur: baseBlurPx * 1.7, opacity: 0.55 * blurEnv },
          { scale: 1.13, blur: baseBlurPx * 2.6, opacity: 0.38 * blurEnv },
        ]
      : [];

  // =========================================================================
  // フィルム質感オーバーレイ（1発型のみ・SVG手続き生成・screen焼き込み）
  // =========================================================================

  const dustCount = 14;
  // 固定位置（seedのみ依存）・フレーム毎に半分程度が乱数点滅
  const dusts = Array.from({ length: dustCount }, (_, i) => ({
    x: rand(seed + 31, i, 5) * 1920,
    y: rand(seed + 31, i, 9) * 1080,
    r: 2 + rand(seed + 31, i, 13) * 5,
    on: rand(seed, frame, 40 + i) > 0.45,
    i,
  }));

  // 引っかき傷: パルスが半分を超えた区間だけ、ほぼ垂直の細線を乱数位置に1本
  const scratchOn = !doubleMode && pulse > 0.5;
  const scratchX = rand(seed, frame, 71) * 1920;
  const scratchTilt = (rand(seed, frame, 72) - 0.5) * 60;

  const overlayOpacity = clamp01(pulse);
  const whiteFlashOpacity = doubleMode ? 0 : clamp01(0.4 * pulse);

  return (
    <AbsoluteFill style={{ background: "#000", overflow: "hidden" }}>
      {/* 本体束: 旧+新+ゴーストをまとめて transform（揺れ・ズーム）＋
          filter（ネガ反転・輝度）で焼く */}
      <AbsoluteFill
        style={{
          transform: `translate(${shakeX.toFixed(1)}px, ${shakeY.toFixed(
            1
          )}px) scale(${camScale.toFixed(4)})`,
          filter: wrapFilters.length > 0 ? wrapFilters.join(" ") : undefined,
        }}
      >
        {/* 基層（2連発型はガウスブラー） */}
        <AbsoluteFill
          style={{
            filter:
              baseBlurPx > 0.25 ? `blur(${baseBlurPx.toFixed(1)}px)` : undefined,
          }}
        >
          {contentStack}
        </AbsoluteFill>

        {/* 拡大ゴースト: screen合成で中心から光が流れる放射状ブラー近似 */}
        {ghosts.map((g, i) => (
          <AbsoluteFill
            key={i}
            style={{
              transform: `scale(${g.scale})`,
              filter: `blur(${g.blur.toFixed(1)}px)`,
              mixBlendMode: "screen",
              opacity: clamp01(g.opacity),
            }}
          >
            {contentStack}
          </AbsoluteFill>
        ))}
      </AbsoluteFill>

      {/* 白フラッシュ: 純白ベタをscreen合成（頂点でも4割・反転の絵柄を殺さない） */}
      {whiteFlashOpacity > 0.01 && (
        <AbsoluteFill
          style={{
            background: "#ffffff",
            mixBlendMode: "screen",
            opacity: whiteFlashOpacity,
            pointerEvents: "none",
          }}
        />
      )}

      {/* フィルム質感（ダスト＋引っかき傷）: 1発型のみ */}
      {!doubleMode && overlayOpacity > 0.01 && (
        <AbsoluteFill style={{ pointerEvents: "none" }}>
          <svg
            width="100%"
            height="100%"
            viewBox="0 0 1920 1080"
            preserveAspectRatio="xMidYMid slice"
            style={{
              position: "absolute",
              inset: 0,
              mixBlendMode: "screen",
              opacity: overlayOpacity,
            }}
            aria-hidden
          >
            <g id={`${uid}-film`}>
              {dusts.map(
                (d) =>
                  d.on && (
                    <ellipse
                      key={d.i}
                      cx={d.x.toFixed(1)}
                      cy={d.y.toFixed(1)}
                      rx={(d.r * 1.3).toFixed(1)}
                      ry={d.r.toFixed(1)}
                      fill="#ffffff"
                      opacity={0.5 + rand(seed, frame, 60 + d.i) * 0.5}
                    />
                  )
              )}
              {scratchOn && (
                <line
                  x1={scratchX.toFixed(1)}
                  y1={-20}
                  x2={(scratchX + scratchTilt).toFixed(1)}
                  y2={1100}
                  stroke="#ffffff"
                  strokeWidth={2}
                  opacity={0.4 + rand(seed, frame, 73) * 0.35}
                />
              )}
            </g>
          </svg>
        </AbsoluteFill>
      )}
    </AbsoluteFill>
  );
};
