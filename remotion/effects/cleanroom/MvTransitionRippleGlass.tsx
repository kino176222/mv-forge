import React, { useId, useMemo } from "react";
import {
  AbsoluteFill,
  Easing,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

/**
 * MvTransitionRippleGlass — ガラス歪み／液状波紋トランジション（クリーンルーム実装）
 *
 * 機能: ガラス越し・液面のような波打ち歪みで前カットを「溶かし」、
 *       歪みが頂点の瞬間に短窓ハードクロスで次カットへ入れ替える。
 *       variant で2つの性格に分岐する。
 *       - variant < 0.5 … 超短尺ガラス版（静的ノイズ・横引き伸ばし・軽い白フラッシュ）
 *       - variant >= 0.5 … 豪華版（動くノイズ・脈打つブラー・膨張サージ・
 *                          スミア・シネマ調グレード・青/桃ライトリーク）
 *
 * 設計メモ:
 * - 歪みチェーンは SVG フィルタ1本の直列: フラクタルノイズ → 変位 →
 *   異方性ガウスぼかし → 色収差（R右/B左の水平プリズム・screen 再合成）。
 *   同じフィルタを from / to の両層に共通適用する。
 * - クロスはディゾルブではなく、全尺中央付近の約1割の短窓 S字で 0→1。
 *   歪み・ぼかしの頂点で入れ替わるので継ぎ目は視認できない。
 * - すべての効果量は「両端でゼロ・中央で最大」の山型エンベロープ。
 *   開始・終了フレームではフィルタが恒等変換になり前後カットに完全接続する。
 * - 変位・ぼかしで画面端が透けるため、層を数%拡大（オーバースキャン）し、
 *   フィルタ領域を上下左右 ±25% 広げる。
 * - px量は基準幅1920に対する比で持ち、実解像度でスケールする。
 * - 乱数はすべて (seed, index) から決定的に生成。Math.random 不使用。
 * - 外部素材・追加依存なし（CSS / SVG / remotion 標準のみ）。
 */

export interface MvTransitionRippleGlassProps {
  /** 出ていく側の絵 */
  from: React.ReactNode;
  /** 入ってくる側の絵 */
  to: React.ReactNode;
  /** トランジション全体の長さ（フレーム） */
  durationInFrames: number;
  /**
   * 歪みの主軸方向。
   * 横（left/right）= 横縞ガラス・横引き伸ばし優勢 /
   * 縦（up/down・forward→up / backward→down）= 縦揺れ優勢。
   * スミアの流れる向きにも影響する。
   */
  direction?: "left" | "right" | "up" | "down" | "forward" | "backward";
  /** 0..1 個体分岐。0.5未満=短尺ガラス版 / 0.5以上=豪華波紋版 */
  variant?: number;
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** (a,b) から 0..1 の決定的な擬似乱数 */
const rand2 = (a: number, b: number): number => {
  const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453123;
  return s - Math.floor(s);
};

type Dir4 = "left" | "right" | "up" | "down";

const normalizeDirection = (
  d: NonNullable<MvTransitionRippleGlassProps["direction"]>
): Dir4 => {
  if (d === "forward") return "up";
  if (d === "backward") return "down";
  return d;
};

/** チャンネル分離行列（アルファ維持） */
const MAT_R = "1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0";
const MAT_G = "0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0";
const MAT_B = "0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0";

export const MvTransitionRippleGlass: React.FC<MvTransitionRippleGlassProps> = ({
  from,
  to,
  durationInFrames,
  direction,
  variant = 0.25,
}) => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const rawId = useId();
  const uid = useMemo(() => rawId.replace(/[^a-zA-Z0-9_-]/g, ""), [rawId]);

  const v = clamp01(variant);
  const rich = v >= 0.5; // 豪華波紋版か
  const local = rich ? (v - 0.5) * 2 : v * 2; // モード内の個体揺らし 0..1
  const px = width / 1920;

  // 既定方向: ガラス版=横縞（left）/ 波紋版=縦揺れ（down）
  const dir = normalizeDirection(direction ?? (rich ? "down" : "left"));
  const horizontalAxis = dir === "left" || dir === "right";
  const dirIndex = { left: 0, right: 1, up: 2, down: 3 }[dir];
  const seedBase = 29 + dirIndex * 17 + Math.round(local * 127) + (rich ? 251 : 0);

  const last = Math.max(1, durationInFrames - 1);
  const p = clamp01(frame / last);

  // ---- 時間フェーズ ----------------------------------------------------------
  // 頂点: ガラス版は中央よりやや手前 / 波紋版は中央
  const peakAt = rich ? 0.5 : 0.44;

  // 主エンベロープ（変位）: 両端ゼロ・頂点で最大の素直な山型
  const dispEnv = interpolate(p, [0, peakAt, 1], [0, 1, 0], {
    easing: Easing.inOut(Easing.sin),
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  // 色収差: 山型（頂点同相・立ち上がりをやや遅らせる）
  const chromaEnv = interpolate(
    p,
    [0.05, peakAt, 0.95],
    [0, 1, 0],
    {
      easing: Easing.inOut(Easing.sin),
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    }
  );

  // ぼかし: ガラス版は単純な山 / 波紋版は「強→弱→強→弱→強」の3拍パルス
  const blurEnv = rich
    ? interpolate(
        p,
        [0, 0.12, 0.28, 0.44, 0.6, 0.76, 0.9, 1],
        [0, 0.9, 0.35, 1, 0.4, 0.85, 0.25, 0],
        { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
      )
    : dispEnv;

  // クロス: 全尺の約1割の短窓 S字（実質ハードカット）
  const crossHalf = 0.05;
  const toOpacity = interpolate(
    p,
    [Math.max(0, peakAt - crossHalf), Math.min(1, peakAt + crossHalf)],
    [0, 1],
    {
      easing: Easing.inOut(Easing.cubic),
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    }
  );
  const showOld = toOpacity < 0.999;
  const showNew = toOpacity > 0.001;

  // ---- ノイズ（周波数・シード） ----------------------------------------------
  let bfX: number;
  let bfY: number;
  let noiseSeed: number;
  if (rich) {
    // 生きているノイズ: シードを毎フレーム進め、周波数も三角関数で微揺らし
    const wobble = 1 + 0.18 * Math.sin(frame * 0.83 + seedBase);
    const wobble2 = 1 + 0.14 * Math.sin(frame * 0.61 + seedBase * 0.7 + 1.7);
    const bfBase = (0.0052 + local * 0.0012) * wobble;
    // 既定は縦周波数=横の2倍で縦揺れ優勢。横方向指定時は入れ替え
    if (horizontalAxis) {
      bfX = bfBase * 2.1 * wobble2;
      bfY = bfBase;
    } else {
      bfX = bfBase;
      bfY = bfBase * 2.1 * wobble2;
    }
    noiseSeed = seedBase + frame * 11;
  } else {
    // 静的ノイズ: seed固定。水平に潰れた低周波＝横縞のガラス模様
    const lo = 0.0042 + local * 0.001;
    const hi = 0.02 + local * 0.005;
    bfX = horizontalAxis ? lo : hi;
    bfY = horizontalAxis ? hi : lo;
    noiseSeed = seedBase;
  }

  // ---- 効果量（1920基準px → 実解像度スケール） -------------------------------
  // 変位: ガラス版=画面幅の約2.8% / 波紋版=約7%弱（2.5倍級）
  const dispMax = (rich ? 126 + local * 12 : 50 + local * 8) * px;
  // ぼかし: 主軸が副軸の1.5〜2倍の異方性（引き伸ばし）。
  // ガラス版は常に横主軸（横引き伸ばしが主役）/ 波紋版は方向軸に追従
  const blurMainMax = (rich ? 13 : 8.5) * px;
  const blurCrossMax = blurMainMax / (rich ? 1.6 : 1.8);
  const blurA = blurEnv * blurMainMax; // 横（主）
  const blurB = blurEnv * blurCrossMax; // 縦（副）
  const blurX = horizontalAxis || !rich ? blurA : blurB;
  const blurY = horizontalAxis || !rich ? blurB : blurA;
  // 色収差: 赤=右 / 青=左の水平プリズム（家族の signature）
  const chromaMax = (rich ? 20 + local * 6 : 9 + local * 3) * px;
  const chromaDx = chromaEnv * chromaMax;

  const disp = dispEnv * dispMax;

  // ---- 動き（ズーム・シェイク・オーバースキャン） -----------------------------
  let stageScale: number;
  let shakeX = 0;
  let shakeY = 0;
  if (rich) {
    // 中央で1.5倍強まで膨らむサージ＋球面バルジ近似（さらに+3割弱）
    const surge = interpolate(p, [0.08, 0.5, 0.92], [0, 1, 0], {
      easing: Easing.inOut(Easing.cubic),
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    });
    stageScale = (1 + 0.52 * surge) * (1 + 0.26 * surge);
    // 波紋と同位相の小刻みシェイク（振幅=画面幅の1%弱・フレームの3倍速で更新）
    const t3 = frame * 3;
    shakeX = (rand2(seedBase + 1, t3) - 0.5) * 2 * width * 0.009 * dispEnv;
    shakeY = (rand2(seedBase + 2, t3) - 0.5) * 2 * width * 0.009 * dispEnv;
  } else {
    // ズーム補正は最大+6%
    stageScale = 1 + 0.06 * dispEnv;
  }
  // 変位・ぼかしの黒フチを隠すオーバースキャン
  const overscan = 1 + 0.05 * dispEnv;
  const layerScale = stageScale * overscan;

  // ---- 化粧（フラッシュ・グロー・リーク・スミア・グレイン） -------------------
  // ガラス版: 2割弱までのごく軽い白フラッシュ
  const flash = rich
    ? 0
    : 0.18 *
      interpolate(p, [0.18, peakAt, 0.72], [0, 1, 0], {
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
      });

  // 波紋版: 発光・汚しは中央で台地状に張り付く
  const plateau = interpolate(
    p,
    [0.18, 0.34, 0.66, 0.82],
    [0, 1, 1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );
  const glow = rich ? plateau : 0;
  const grain = rich
    ? 0.5 *
      interpolate(p, [0.25, 0.38, 0.62, 0.78], [0, 1, 1, 0], {
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
      })
    : 0;

  // モーションスミア: 中盤のみ。screen 合成 4割で左下へ画面の1割ほど尾を引く
  const smearEnv = rich ? plateau : 0;
  const smearProg = interpolate(p, [0.22, 0.78], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const smearSignX = dir === "right" ? 1 : -1;
  const smearSignY = dir === "up" ? -1 : 1;
  const smearX = smearSignX * width * 0.1 * smearProg;
  const smearY = smearSignY * height * 0.06 * smearProg;
  const showSmear = rich && smearEnv > 0.01;

  // 常時グレード（波紋版のみ）: 彩度4割弱減・明度微減・コントラスト微増
  const stageGrade = rich
    ? "saturate(0.63) brightness(0.94) contrast(1.07)"
    : undefined;

  const grainSeed = 700 + Math.floor(frame / 2) * 5 + dirIndex;
  const filterId = `${uid}-rg`;

  // 歪みチェーン本体（from / to 共通適用）
  const distortFilter = (
    <filter
      id={filterId}
      x="-25%"
      y="-25%"
      width="150%"
      height="150%"
      colorInterpolationFilters="sRGB"
    >
      {/* 1) フラクタルノイズ生成 */}
      <feTurbulence
        type="fractalNoise"
        baseFrequency={`${bfX.toFixed(5)} ${bfY.toFixed(5)}`}
        numOctaves={2}
        seed={noiseSeed}
        result="noise"
      />
      {/* 2) ノイズで元絵を変位 */}
      <feDisplacementMap
        in="SourceGraphic"
        in2="noise"
        scale={disp.toFixed(1)}
        xChannelSelector="R"
        yChannelSelector="G"
        result="displaced"
      />
      {/* 3) 異方性ガウスぼかし（引き伸ばし） */}
      <feGaussianBlur
        in="displaced"
        stdDeviation={`${blurX.toFixed(2)} ${blurY.toFixed(2)}`}
        result="blurred"
      />
      {/* 4) 色収差: R右 / B左の水平プリズム・screen 再合成 */}
      <feColorMatrix in="blurred" type="matrix" values={MAT_R} result="cr" />
      <feColorMatrix in="blurred" type="matrix" values={MAT_G} result="cg" />
      <feColorMatrix in="blurred" type="matrix" values={MAT_B} result="cb" />
      <feOffset in="cr" dx={chromaDx.toFixed(1)} dy="0" result="crO" />
      <feOffset in="cb" dx={(-chromaDx).toFixed(1)} dy="0" result="cbO" />
      <feBlend in="crO" in2="cg" mode="screen" result="rg" />
      <feBlend in="rg" in2="cbO" mode="screen" />
    </filter>
  );

  // 本体スタック（スミア用に再利用）
  // 注記(性能): スミア表示中は from/to がクローンで再マウントされる。
  // 重い content を渡す場合は事前ラスタライズ（<Img>/<OffthreadVideo>）推奨。
  const contentStack = (
    <>
      {showOld && (
        <AbsoluteFill style={{ filter: `url(#${filterId})` }}>
          {from}
        </AbsoluteFill>
      )}
      {showNew && (
        <AbsoluteFill
          style={{ filter: `url(#${filterId})`, opacity: toOpacity }}
        >
          {to}
        </AbsoluteFill>
      )}
    </>
  );

  return (
    <AbsoluteFill style={{ background: "#000", overflow: "hidden" }}>
      {/* 歪みフィルタ定義（フレームごとに更新） */}
      <svg width={0} height={0} style={{ position: "absolute" }} aria-hidden>
        <defs>{distortFilter}</defs>
      </svg>

      {/* シネマ調グレード（波紋版のみ常時） */}
      <AbsoluteFill style={{ filter: stageGrade }}>
        {/* 本体（ズーム・シェイク・オーバースキャン） */}
        <AbsoluteFill
          style={{
            transform: `translate(${shakeX.toFixed(1)}px, ${shakeY.toFixed(
              1
            )}px) scale(${layerScale.toFixed(4)})`,
          }}
        >
          {contentStack}
        </AbsoluteFill>

        {/* モーションスミア: クローンを screen 合成で滑らせて尾を引かせる */}
        {showSmear && (
          <AbsoluteFill
            style={{
              transform: `translate(${(shakeX + smearX).toFixed(1)}px, ${(
                shakeY + smearY
              ).toFixed(1)}px) scale(${layerScale.toFixed(4)})`,
              mixBlendMode: "screen",
              opacity: 0.4 * smearEnv,
              pointerEvents: "none",
            }}
          >
            {contentStack}
          </AbsoluteFill>
        )}

        {/* 中央グロー（暖色寄りの白・控えめ） */}
        {glow > 0.005 && (
          <AbsoluteFill
            style={{
              background:
                "radial-gradient(ellipse 38% 44% at 50% 48%, rgba(255,238,218,0.8), rgba(255,238,218,0) 72%)",
              mixBlendMode: "screen",
              opacity: glow * 0.5,
              pointerEvents: "none",
            }}
          />
        )}

        {/* ライトリーク: 左から青・右からピンク（screen） */}
        {glow > 0.005 && (
          <AbsoluteFill
            style={{
              background:
                "linear-gradient(90deg, rgba(74,118,255,0.55), rgba(74,118,255,0) 34%), linear-gradient(270deg, rgba(255,108,190,0.55), rgba(255,108,190,0) 34%)",
              mixBlendMode: "screen",
              opacity: glow * 0.7,
              pointerEvents: "none",
            }}
          />
        )}

        {/* フィルムグレイン（overlay・中盤のみ） */}
        {grain > 0.01 && (
          <AbsoluteFill
            style={{
              mixBlendMode: "overlay",
              opacity: grain,
              pointerEvents: "none",
            }}
          >
            <svg width="100%" height="100%" aria-hidden>
              <filter
                id={`${uid}-grain`}
                x="0"
                y="0"
                width="100%"
                height="100%"
              >
                <feTurbulence
                  type="fractalNoise"
                  baseFrequency="0.8"
                  numOctaves={2}
                  seed={grainSeed}
                />
                <feColorMatrix type="saturate" values="0" />
              </filter>
              <rect width="100%" height="100%" filter={`url(#${uid}-grain)`} />
            </svg>
          </AbsoluteFill>
        )}
      </AbsoluteFill>

      {/* 白フラッシュ（ガラス版のみ・2割弱まで） */}
      {flash > 0.005 && (
        <AbsoluteFill
          style={{
            background: "#fff",
            mixBlendMode: "screen",
            opacity: flash,
            pointerEvents: "none",
          }}
        />
      )}
    </AbsoluteFill>
  );
};
