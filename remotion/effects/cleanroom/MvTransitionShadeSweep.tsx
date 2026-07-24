import React, { useId, useMemo } from "react";
import {
  AbsoluteFill,
  Easing,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

/**
 * MvTransitionShadeSweep — 暗幕スイープ・トランジション家族（クリーンルーム実装）
 *
 * 黒い暗幕で画面を一度沈め、その暗転の底で旧カットから新カットへ差し替える。
 * 進行度の 1/4 で黒が立ち上がり、中間で最大（完全な黒の少し手前）、3/4 で解消。
 * 破壊系（異方性ブラー・色分解・シェイク）は「序盤ゼロ→中盤プラトー→終盤ゼロ」
 * の台形エンベロープで駆動し、全エンベロープの頂点を中間点に集めて勢いを作る。
 *
 * 方向表現は2方式:
 * - 濃度ローブ方式（left）: 一様な黒土台＋横長の放射グラデの黒ローブを
 *   画面外→中央→反対側画面外へスイープさせる。柔らかい暗がりが走って見える。
 * - 物理幕方式（up）: 画面同寸の黒板が下から上へ通過し、満覆の瞬間にハードカット。
 * right / down は一様三角パルスのまま from/to のスライド方向で向きを表現する。
 *
 * 設計メモ:
 * - 乱数はすべて (seed, counter, index) の決定論ハッシュ。Math.random 不使用。
 * - CSS blur は等方なので、SVG の feGaussianBlur で水平（or 垂直）優勢の
 *   異方性ブラーを作る。
 * - 色分解は feColorMatrix で R/G/B を分離し、R と B を逆方向へオフセットして
 *   screen 合成で再結合。ずれ量ゼロなら原画が完全復元される。
 * - 色分解・ドリフト・シェイクで縁に黒が透けるため、映像スタックは 7% 拡大。
 * - px 系の量はすべて 1920 幅基準 ×(実幅/1920) で解像度非依存化。
 * - テキスト・フォント・外部素材は一切使わない。
 */

export interface MvTransitionShadeSweepProps {
  /** 旧カット */
  from: React.ReactNode;
  /** 新カット */
  to: React.ReactNode;
  /** トランジション全体の長さ（フレーム） */
  durationInFrames: number;
  /** 暗幕の走る方向。省略時は方向なし（一様暗転） */
  direction?: "left" | "right" | "up" | "down" | "forward" | "backward";
  /**
   * 同家族内の見た目分岐 0..1（決定論的）。
   * 方向なしのとき: 0.5 未満 = 質感なしの最短形 / 0.5 以上 = フィルム調全部盛り。
   * 方向つきのときは乱数シードと質感の匙加減に効く。
   */
  variant?: number;
}

/** (a,b,c) から 0..1 の決定的な擬似乱数（GLSL の定番ハッシュ） */
const rand = (a: number, b: number, c: number): number => {
  const s = Math.sin(a * 127.1 + b * 311.7 + c * 74.7) * 43758.5453123;
  return s - Math.floor(s);
};

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

const CLAMP = {
  extrapolateLeft: "clamp",
  extrapolateRight: "clamp",
} as const;

export const MvTransitionShadeSweep: React.FC<MvTransitionShadeSweepProps> = ({
  from,
  to,
  durationInFrames,
  direction,
  variant = 0.5,
}) => {
  const frame = useCurrentFrame();
  const { width } = useVideoConfig();
  const rawId = useId();
  const uid = useMemo(() => rawId.replace(/[^a-zA-Z0-9_-]/g, ""), [rawId]);

  const sc = width / 1920; // 解像度スケール
  const last = Math.max(1, durationInFrames - 1);
  const p = clamp01(frame / last);
  const v = clamp01(variant);
  const seed = 17 + Math.floor(v * 997);

  // ---- 家族内の性格分け ------------------------------------------------------
  // rich: 質感オーバーレイ（グレイン・リーク・ヴィネット・ダスト・脱色）の濃さ 0..1
  const isDirectional = direction !== undefined;
  const rich = !isDirectional
    ? v < 0.5
      ? 0
      : 1
    : direction === "left"
      ? 1
      : direction === "right" || direction === "down"
        ? 0.7
        : direction === "forward" || direction === "backward"
          ? 0.5
          : 0; // up は最小構成
  const minimalBase = !isDirectional && v < 0.5;

  // 色分解の軸（左右系=水平 / 上下系=垂直）
  const splitAxis: "x" | "y" =
    direction === "up" || direction === "down" ? "y" : "x";
  // ブラーの優勢軸も同じ向きに揃える
  const blurAxis = splitAxis;

  // ---- エンベロープ ----------------------------------------------------------
  // 黒シェード: 1/4 で立ち上がり → 中間で最大（完全な黒の少し手前）→ 3/4 で解消
  const shadeEnv = interpolate(p, [0.24, 0.5, 0.76], [0, 1, 0], {
    ...CLAMP,
    easing: Easing.inOut(Easing.sin),
  });

  // 破壊系: 序盤ゼロ→前半いっぱいかけてじわっと→中盤プラトー→終盤1割弱を残して収束
  const wreck = interpolate(p, [0.04, 0.44, 0.62, 0.91], [0, 1, 1, 0], {
    ...CLAMP,
    easing: Easing.inOut(Easing.quad),
  });

  // 質感群: 冒頭と末尾のごく短い区間だけフェードし、ほぼ全域 ON
  const texEnv =
    rich * interpolate(p, [0, 0.06, 0.94, 1], [0, 1, 1, 0], CLAMP);

  // リーク・ヴィネットは暗転の底で一段強める（暗い画面ほど色が乗って見える）
  const midBoost = interpolate(p, [0.1, 0.5, 0.9], [0.35, 1, 0.35], {
    ...CLAMP,
    easing: Easing.inOut(Easing.quad),
  });

  // ---- カットの入替 ----------------------------------------------------------
  // 基本形はやや手前から短いクロスフェード、方向つきは暗黒底でのハードスワップ
  const cutFrame = Math.round(0.5 * last);
  const hardSwap = isDirectional || !minimalBase;
  const toOpacity = hardSwap
    ? frame >= cutFrame
      ? 1
      : 0
    : interpolate(p, [0.41, 0.55], [0, 1], {
        ...CLAMP,
        easing: Easing.inOut(Easing.quad),
      });
  const showFrom = toOpacity < 1;
  const showTo = toOpacity > 0;

  // ---- シェイク（決定論ハッシュ・速い整数カウンタでシード更新） ---------------
  const counter = Math.floor(p * durationInFrames * 3);
  const shakeAmp = (minimalBase ? 5 : 10) * sc * wreck * (0.85 + v * 0.3);
  const crossMul = 0.65; // 進行方向と直交する軸は6〜7割に抑える
  const shakeRawX = (rand(seed, counter, 11) - 0.5) * 2 * shakeAmp;
  const shakeRawY = (rand(seed, counter, 12) - 0.5) * 2 * shakeAmp;
  const shakeX = splitAxis === "x" ? shakeRawX : shakeRawX * crossMul;
  const shakeY = splitAxis === "y" ? shakeRawY : shakeRawY * crossMul;

  // ---- スライド／ドリフト -----------------------------------------------------
  // from は進行方向へ抜け、to は逆側から入って定位置に収まる（暗転の下で気配だけ）
  let fromX = 0;
  let fromY = 0;
  let toX = 0;
  let toY = 0;
  let stackDriftX = 0;
  let stackDriftY = 0;
  let zoom = 1;

  const easeIn = Easing.in(Easing.quad);
  const easeOut = Easing.out(Easing.cubic);

  if (direction === "right") {
    // from を右へ抜き、to を左から入れる（画面幅の1割弱）
    const amt = width * 0.085;
    fromX = interpolate(p, [0.18, 0.55], [0, amt], { ...CLAMP, easing: easeIn });
    toX = interpolate(p, [0.45, 0.82], [-amt, 0], { ...CLAMP, easing: easeOut });
  } else if (direction === "left") {
    // 画面全体を左へゆっくりドリフト
    stackDriftX = interpolate(p, [0, 1], [55 * sc, -55 * sc], {
      ...CLAMP,
      easing: Easing.inOut(Easing.sin),
    });
    const amt = 70 * sc;
    fromX = interpolate(p, [0.18, 0.55], [0, -amt], { ...CLAMP, easing: easeIn });
    toX = interpolate(p, [0.45, 0.82], [amt, 0], { ...CLAMP, easing: easeOut });
  } else if (direction === "down") {
    // from を下へ・to を上から降ろす縦ドリフト
    const amt = 115 * sc;
    fromY = interpolate(p, [0.15, 0.55], [0, amt], { ...CLAMP, easing: easeIn });
    toY = interpolate(p, [0.45, 0.85], [-amt, 0], { ...CLAMP, easing: easeOut });
  } else if (direction === "up") {
    // 幕の通過に合わせた緩いズームイン
    zoom = interpolate(p, [0, 1], [1, 1.05], {
      ...CLAMP,
      easing: Easing.inOut(Easing.sin),
    });
  } else if (direction === "forward") {
    // 奥から手前へ: from が膨らみながら抜け、to が奥から寄ってくる
    zoom = interpolate(p, [0, 0.5, 1], [1, 1.06, 1], {
      ...CLAMP,
      easing: Easing.inOut(Easing.quad),
    });
  } else if (direction === "backward") {
    zoom = interpolate(p, [0, 0.5, 1], [1.06, 1, 1.04], {
      ...CLAMP,
      easing: Easing.inOut(Easing.quad),
    });
  } else if (minimalBase) {
    // 基本形: 水平の小スライドだけ
    const amt = 45 * sc;
    fromX = interpolate(p, [0.12, 0.6], [0, -amt], { ...CLAMP, easing: easeIn });
    toX = interpolate(p, [0.38, 0.88], [amt, 0], { ...CLAMP, easing: easeOut });
  }

  // スケールポップ: 切替の瞬間に数%膨らみ→わずかに収縮して戻すスナップ（up 系）
  let pop = 0;
  if (direction === "up" || direction === "forward") {
    const fs = frame - cutFrame;
    if (fs >= 0) {
      pop = interpolate(fs, [0, 2, 6], [0.05, -0.012, 0], CLAMP);
    }
  }

  // ---- 異方性ブラー -----------------------------------------------------------
  const blurMax = (minimalBase ? 16 : 12) * sc;
  const blurMain = blurMax * wreck;
  const blurCross = blurMain / 3.2; // 主軸の 1/3 強
  const blurX = blurAxis === "x" ? blurMain : blurCross;
  const blurY = blurAxis === "y" ? blurMain : blurCross;
  const blurOn = blurMain > 0.15;

  // ---- 色分解（プリズム） -----------------------------------------------------
  // 最大ずれは 1920px 幅基準で十数〜三十px 程度、方向つきはスイープ方向に揃える
  const splitBase = minimalBase
    ? 0
    : (direction === "left" ? 26 : direction === "up" ? 18 : 22) * sc;
  const splitAmt = splitBase * wreck;
  const splitOn = splitAmt > 0.4;
  // left は赤側を強めて左寄り / down は赤を上・シアン(=G+B側)を下
  const redBias = direction === "left" ? 1.25 : 1;
  const rOff = -splitAmt * redBias;
  const bOff = splitAmt;

  // ---- 黒シェードの方式 -------------------------------------------------------
  // uniform: 一様三角パルス / lobe: 一様土台＋放射ローブのスイープ / curtain: 物理幕
  const shadeMode =
    direction === "left" ? "lobe" : direction === "up" ? "curtain" : "uniform";
  const shadePeak = 0.965; // 完全な黒よりわずかに手前で止めると自然
  const uniformShade =
    shadeMode === "uniform"
      ? shadeEnv * shadePeak
      : shadeMode === "lobe"
        ? shadeEnv * 0.7 // ローブ方式の一様土台は最大7割程度
        : 0;

  // ローブ: 横長の放射グラデの中心を右画面外→中央→左画面外へスイープ
  const lobeCx = interpolate(p, [0.14, 0.5, 0.86], [1.4, 0.5, -0.4], {
    ...CLAMP,
    easing: Easing.inOut(Easing.sin),
  });
  const lobeOpacity = interpolate(p, [0.12, 0.42, 0.58, 0.88], [0, 1, 1, 0], {
    ...CLAMP,
    easing: Easing.inOut(Easing.quad),
  });

  // 物理幕: 画面同寸（少し大きめ）の黒板を 下の画面外→満覆→上の画面外 へ
  const curtainY = interpolate(p, [0.14, 0.5, 0.86], [112, 0, -112], {
    ...CLAMP,
    easing: Easing.inOut(Easing.cubic),
  });

  // ---- ライトリーク -----------------------------------------------------------
  // 主役は無彩色。色味はリークが担う。基本は暖色、down だけ青→紫→暖色の対角線
  const leakBackground =
    direction === "down"
      ? "linear-gradient(135deg, rgba(64,96,255,0.55) 0%, rgba(150,60,220,0.4) 45%, rgba(255,140,60,0.45) 100%)"
      : direction === "left"
        ? "radial-gradient(90% 70% at 6% 32%, rgba(255,122,40,0.7) 0%, rgba(200,64,24,0.32) 45%, transparent 72%)"
        : direction === "right"
          ? "radial-gradient(90% 70% at 94% 55%, rgba(255,130,44,0.7) 0%, rgba(210,70,26,0.32) 45%, transparent 72%)"
          : "radial-gradient(80% 65% at 84% 10%, rgba(255,126,42,0.65) 0%, rgba(205,66,26,0.3) 45%, transparent 72%)";
  // right は中盤パルスの暖色（底で一瞬灯る）
  const leakPulse =
    direction === "right"
      ? interpolate(p, [0.32, 0.5, 0.68], [0.15, 1, 0.15], {
          ...CLAMP,
          easing: Easing.inOut(Easing.quad),
        })
      : midBoost;
  const leakOpacity = clamp01(texEnv * leakPulse * 0.85);

  // ---- ヴィネット / 脱色 ------------------------------------------------------
  const vigOpacity = clamp01(texEnv * (0.3 + 0.45 * midBoost));
  // 中盤で彩度を落としコントラストを1割ほど上げる
  const grade = [
    `saturate(${(1 - 0.32 * wreck * rich).toFixed(3)})`,
    `contrast(${(1 + 0.1 * wreck * rich).toFixed(3)})`,
  ].join(" ");

  // ---- グレイン / ダスト ------------------------------------------------------
  const grainOn = rich > 0.45 && direction !== "up";
  const grainSeed = (counter * 31 + seed) % 9973;
  const dustCount = grainOn ? 5 : 0;
  const dust = Array.from({ length: dustCount }, (_, i) => {
    const x = rand(seed + 3, counter, 40 + i) * 100;
    const y = rand(seed + 5, counter, 60 + i) * 100;
    const size = (2.5 + rand(seed + 7, counter, 80 + i) * 7) * sc;
    const isWhite = rand(seed + 9, counter, 100 + i) < 0.5;
    return { x, y, size, isWhite, i };
  });

  // ---- 映像スタック（from / to の合成） ---------------------------------------
  const mediaStack = (
    <AbsoluteFill>
      {showFrom && (
        <AbsoluteFill
          style={{
            transform: `translate(${fromX.toFixed(2)}px, ${fromY.toFixed(2)}px)`,
          }}
        >
          {from}
        </AbsoluteFill>
      )}
      {showTo && (
        <AbsoluteFill
          style={{
            opacity: toOpacity,
            transform: `translate(${toX.toFixed(2)}px, ${toY.toFixed(2)}px)`,
          }}
        >
          {to}
        </AbsoluteFill>
      )}
    </AbsoluteFill>
  );

  const stackScale = 1.07 * zoom * (1 + pop);
  const stackTransform = `translate(${(shakeX + stackDriftX).toFixed(2)}px, ${(
    shakeY + stackDriftY
  ).toFixed(2)}px) scale(${stackScale.toFixed(4)})`;

  const splitX = splitAxis === "x";

  return (
    <AbsoluteFill style={{ background: "#000", overflow: "hidden" }}>
      {/* フィルタ定義（異方性ブラー＋チャンネル分離） */}
      <svg width={0} height={0} style={{ position: "absolute" }} aria-hidden>
        <defs>
          <filter id={`${uid}-blur`} colorInterpolationFilters="sRGB">
            <feGaussianBlur
              stdDeviation={`${blurX.toFixed(2)} ${blurY.toFixed(2)}`}
            />
          </filter>
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

      {/* 映像スタック（シェイク＋ドリフト＋縁隠しの拡大＋グレード） */}
      <AbsoluteFill
        style={{
          transform: stackTransform,
          filter: rich > 0 ? grade : undefined,
        }}
      >
        <AbsoluteFill
          style={{ filter: blurOn ? `url(#${uid}-blur)` : undefined }}
        >
          {splitOn ? (
            <>
              {/* G: 基準層。R/B を逆方向へオフセットし screen 合成で再結合 */}
              <AbsoluteFill style={{ filter: `url(#${uid}-g)` }}>
                {mediaStack}
              </AbsoluteFill>
              <AbsoluteFill
                style={{
                  filter: `url(#${uid}-r)`,
                  mixBlendMode: "screen",
                  transform: splitX
                    ? `translateX(${rOff.toFixed(2)}px)`
                    : `translateY(${rOff.toFixed(2)}px)`,
                }}
              >
                {mediaStack}
              </AbsoluteFill>
              <AbsoluteFill
                style={{
                  filter: `url(#${uid}-b)`,
                  mixBlendMode: "screen",
                  transform: splitX
                    ? `translateX(${bOff.toFixed(2)}px)`
                    : `translateY(${bOff.toFixed(2)}px)`,
                }}
              >
                {mediaStack}
              </AbsoluteFill>
            </>
          ) : (
            mediaStack
          )}
        </AbsoluteFill>
      </AbsoluteFill>

      {/* 質感オーバーレイ群 --------------------------------------------------- */}
      {vigOpacity > 0.01 && (
        <AbsoluteFill
          style={{
            background:
              "radial-gradient(ellipse at 50% 50%, transparent 52%, rgba(0,0,0,0.72) 100%)",
            opacity: vigOpacity,
            pointerEvents: "none",
          }}
        />
      )}

      {leakOpacity > 0.01 && (
        <AbsoluteFill
          style={{
            background: leakBackground,
            mixBlendMode: "screen",
            opacity: leakOpacity,
            pointerEvents: "none",
          }}
        />
      )}

      {dust.map((d) => (
        <div
          key={d.i}
          style={{
            position: "absolute",
            left: `${d.x.toFixed(2)}%`,
            top: `${d.y.toFixed(2)}%`,
            width: `${d.size.toFixed(1)}px`,
            height: `${d.size.toFixed(1)}px`,
            borderRadius: "50%",
            background: d.isWhite ? "rgba(255,252,240,0.9)" : "rgba(0,0,0,0.9)",
            mixBlendMode: d.isWhite ? "screen" : "multiply",
            opacity: clamp01(texEnv * 0.55),
            pointerEvents: "none",
          }}
        />
      ))}

      {grainOn && (
        <svg
          width="100%"
          height="100%"
          style={{
            position: "absolute",
            inset: 0,
            mixBlendMode: "overlay",
            opacity: clamp01(texEnv * 0.16),
            pointerEvents: "none",
          }}
          aria-hidden
        >
          <filter id={`${uid}-grain`}>
            <feTurbulence
              type="fractalNoise"
              baseFrequency="0.82"
              numOctaves={2}
              seed={grainSeed}
              stitchTiles="stitch"
            />
            {/* 脱色して輝度ノイズだけ乗せる */}
            <feColorMatrix type="saturate" values="0" />
          </filter>
          <rect width="100%" height="100%" filter={`url(#${uid}-grain)`} />
        </svg>
      )}

      {/* 黒シェード本体（最上段） --------------------------------------------- */}
      {uniformShade > 0.003 && (
        <AbsoluteFill
          style={{
            background: "#000",
            opacity: clamp01(uniformShade),
            pointerEvents: "none",
          }}
        />
      )}

      {shadeMode === "lobe" && lobeOpacity > 0.003 && (
        <div
          style={{
            position: "absolute",
            top: "-15%",
            left: `${((lobeCx - 0.85) * 100).toFixed(2)}%`,
            width: "170%",
            height: "130%",
            background:
              "radial-gradient(50% 50% at 50% 50%, rgba(0,0,0,0.97) 0%, rgba(0,0,0,0.8) 42%, transparent 72%)",
            opacity: lobeOpacity,
            pointerEvents: "none",
          }}
        />
      )}

      {shadeMode === "curtain" && curtainY > -112 && curtainY < 112 && (
        <div
          style={{
            position: "absolute",
            left: 0,
            width: "100%",
            top: "-6%",
            height: "112%",
            // エッジがそのまま見える物理幕。先端/後端に短いグラデの縁を持たせる
            background:
              "linear-gradient(to top, transparent 0%, #000 4.5%, #000 95.5%, transparent 100%)",
            transform: `translateY(${curtainY.toFixed(2)}%)`,
            pointerEvents: "none",
          }}
        />
      )}
    </AbsoluteFill>
  );
};
