import React, { useId, useMemo } from "react";
import {
  AbsoluteFill,
  Easing,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

/**
 * MvTransitionMeltFlow — 液状メルトトランジション（クリーンルーム実装）
 *
 * 機能: 液状の溶け歪み＋方向つきブラー＋色収差で画面を「溶かして」
 *       旧カットから新カットへ切り替える約1秒の短尺トランジション。
 *       4方向（left / right / up / down）のバリアントを持つ。
 *
 * 設計メモ:
 * - クロスフェードではなく「溶け隠しカット」。前半で旧カットを溶かしきり、
 *   画面が最も崩れた中盤の頂点で新カットへ短窓フェード（実質ハードカット）、
 *   後半は新カットが溶けた状態から像を結ぶ。継ぎ目は最大の歪み・ブラー・
 *   発光で完全に隠れる。
 * - 溶けフィルタは SVG フィルタ1本の直列: 歪み(フラクタルノイズ変位) →
 *   方向ブラー(非対称ガウス) → 色収差(RGB分離を主軸方向に互い違いオフセット
 *   して screen 再合成)。ノイズ周波数は流れ方向だけ低周波にして
 *   「ドリップ筋」を出す。フィルタ領域は±25%広げて強変位の見切れを防ぐ。
 * - 旧/新でフィルタ2本（別シード・独立エンベロープ）。left のみ1本を
 *   旧新共用（同一エンベロープ・同一ノイズ）で、非対称ズームが強い個体。
 * - 発光はすべて screen 合成のCSSグラデーションで手続き生成（画像素材なし）。
 *   彩度の高い色は周縁、白は中央・カット瞬間。
 * - 乱数はすべて (seed, index) から決定的に生成。Math.random 不使用。
 * - 全px量は基準幅1920に対する比で持ち、実解像度でスケールする。
 */

export interface MvTransitionMeltFlowProps {
  /** 旧カット */
  from: React.ReactNode;
  /** 新カット */
  to: React.ReactNode;
  /** トランジション全体の長さ（フレーム） */
  durationInFrames: number;
  /** 溶けの流れる方向（forward→up / backward→down に正規化） */
  direction?: "left" | "right" | "up" | "down" | "forward" | "backward";
  /** 0..1 同家族内の見た目分岐（シード・強度を決定論的に揺らす） */
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
  d: NonNullable<MvTransitionMeltFlowProps["direction"]>
): Dir4 => {
  if (d === "forward") return "up";
  if (d === "backward") return "down";
  return d;
};

/** チャンネル分離行列（アルファ維持） */
const MAT_R = "1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0";
const MAT_G = "0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0";
const MAT_B = "0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0";

export const MvTransitionMeltFlow: React.FC<MvTransitionMeltFlowProps> = ({
  from,
  to,
  durationInFrames,
  direction = "left",
  variant = 0.5,
}) => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const rawId = useId();
  const uid = useMemo(() => rawId.replace(/[^a-zA-Z0-9_-]/g, ""), [rawId]);

  const dir = normalizeDirection(direction);
  const v = clamp01(variant);
  const px = width / 1920; // 解像度非依存の基準スケール

  const last = Math.max(1, durationInFrames - 1);
  const p = clamp01(frame / last);

  // ---- 方向パラメータ --------------------------------------------------------
  const horizontal = dir === "left" || dir === "right";
  // 流れの符号（left/up = 負方向へ去る）
  const sign = dir === "left" || dir === "up" ? -1 : 1;
  const dirIndex = { left: 0, right: 1, up: 2, down: 3 }[dir];
  const seedBase = 17 + dirIndex * 31 + Math.round(v * 97);

  // ---- 時間フェーズ ----------------------------------------------------------
  // カット点: 尺のほぼ半分。right はわずかに手前。variant で微揺らし
  const cutAt = clamp01(
    (dir === "right" ? 0.47 : 0.5) + (rand2(seedBase, 5) - 0.5) * 0.03
  );
  const sharedEnvelope = dir === "left"; // left のみ旧新共用フィルタ

  // 旧カットの溶け量: 0→カット点で最大（立ち上がりは軽い加速）
  const envRise = interpolate(p, [0, sharedEnvelope ? 0.46 : cutAt], [0, 1], {
    easing: Easing.in(Easing.sin),
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  // 新カットの溶け量: カット点で最大→終端で0（解けは減速で像を結ぶ）
  const envFall = interpolate(
    p,
    [sharedEnvelope ? 0.52 : cutAt, 1],
    [1, 0],
    {
      easing: Easing.out(Easing.sin),
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    }
  );
  // left は短いプラトー付きの共用三角エンベロープ
  const envShared = Math.min(envRise, envFall);
  const meltOld = sharedEnvelope ? envShared : envRise;
  const meltNew = sharedEnvelope ? envShared : envFall;

  // 差し替え窓: 尺の1割弱の短いフェード（実質カット）
  const cutHalf = 0.045;
  const toOpacity = interpolate(
    p,
    [Math.max(0, cutAt - cutHalf), Math.min(1, cutAt + cutHalf)],
    [0, 1],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );
  const showOld = toOpacity < 0.999;
  const showNew = toOpacity > 0.001;

  // 発光: 三角エンベロープで中盤ピーク
  const glow = interpolate(p, [0.17, cutAt, 0.84], [0, 1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  // 白フラッシュ: さらに鋭い三角。頂点でも4割程度に留める
  const flash =
    interpolate(p, [0.36, cutAt, 0.64], [0, 1, 0], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    }) * (dir === "down" ? 0.46 : 0.4);

  // ---- 溶けフィルタのパラメータ ----------------------------------------------
  // ノイズ周波数: 流れ方向だけ低周波にしてドリップ筋を出す
  const lowFreq = dir === "right" ? 0.004 : 0.006;
  const highFreq = dir === "right" ? 0.045 : 0.03;
  const bfX = horizontal ? lowFreq : highFreq;
  const bfY = horizontal ? highFreq : lowFreq;

  // シードは数フレームごとに更新してフローを流す（旧新は別シード）
  const seedStep = Math.floor(frame / 4);
  const seedOld = seedBase + seedStep * 7;
  const seedNew = seedBase + 53 + seedStep * 7;

  // 歪み量（最大）: 画面幅の6〜8%程度
  const dispMax = (110 + v * 45) * px;
  // 方向ブラー: 主軸は副軸の4〜6.5倍。最大で画面幅の2.5〜3.5%
  const blurMainMax = width * (dir === "right" ? 0.034 : 0.024);
  const blurRatio = dir === "right" ? 6.5 : 4.2;
  // 色収差: 主軸方向に最大12〜20px（1920基準）
  const chromaMax = (12 + v * 8) * px;
  // 色収差の符号（up は R を下・B を上 / down は反転 / 横は水平）
  const chromaSign = dir === "up" ? 1 : dir === "down" ? -1 : sign;

  const filterParams = (melt: number) => {
    const blurMain = melt * blurMainMax;
    const blurCross = blurMain / blurRatio;
    const d = melt * chromaMax * chromaSign;
    return {
      disp: melt * dispMax,
      blurX: horizontal ? blurMain : blurCross,
      blurY: horizontal ? blurCross : blurMain,
      dx: horizontal ? d : 0,
      dy: horizontal ? 0 : d,
    };
  };
  const fpOld = filterParams(meltOld);
  const fpNew = filterParams(meltNew);

  const meltFilterDef = (
    id: string,
    seed: number,
    fp: ReturnType<typeof filterParams>
  ) => (
    <filter
      id={id}
      x="-25%"
      y="-25%"
      width="150%"
      height="150%"
      colorInterpolationFilters="sRGB"
    >
      {/* 1) 歪み: フラクタルノイズを変位マップに */}
      <feTurbulence
        type="fractalNoise"
        baseFrequency={`${bfX} ${bfY}`}
        numOctaves={2}
        seed={seed}
        result="noise"
      />
      <feDisplacementMap
        in="SourceGraphic"
        in2="noise"
        scale={fp.disp.toFixed(1)}
        xChannelSelector="R"
        yChannelSelector="G"
        result="displaced"
      />
      {/* 2) 方向ブラー: 非対称ガウスで流れを作る */}
      <feGaussianBlur
        in="displaced"
        stdDeviation={`${fp.blurX.toFixed(2)} ${fp.blurY.toFixed(2)}`}
        result="blurred"
      />
      {/* 3) 色収差: R/B を主軸方向に互い違いにずらして screen 再合成 */}
      <feColorMatrix in="blurred" type="matrix" values={MAT_R} result="cr" />
      <feColorMatrix in="blurred" type="matrix" values={MAT_G} result="cg" />
      <feColorMatrix in="blurred" type="matrix" values={MAT_B} result="cb" />
      <feOffset
        in="cr"
        dx={fp.dx.toFixed(1)}
        dy={fp.dy.toFixed(1)}
        result="crO"
      />
      <feOffset
        in="cb"
        dx={(-fp.dx).toFixed(1)}
        dy={(-fp.dy).toFixed(1)}
        result="cbO"
      />
      <feBlend in="crO" in2="cg" mode="screen" result="rg" />
      <feBlend in="rg" in2="cbO" mode="screen" />
    </filter>
  );

  // ---- 動き（ドリフト＋ズーム＋縦伸び） --------------------------------------
  const driftAmt = width * 0.032;
  const pOld = clamp01(p / Math.max(0.01, cutAt));
  const pNew = clamp01((p - cutAt) / Math.max(0.01, 1 - cutAt));

  // 溶け量比例の微拡大で変位・ブラー由来の黒フチを隠す（オーバースキャン）
  const overscanOld = 1 + 0.06 * meltOld;
  const overscanNew = 1 + 0.06 * meltNew;

  let oldTransform: string;
  let newTransform: string;
  let oldOrigin = "50% 50%";
  let newOrigin = "50% 50%";

  if (dir === "left") {
    // 個体差: ステージ全体を左へ等速ドリフト＋強い非対称ズーム
    const zoomOld = interpolate(pOld, [0, 1], [1.04, 1.5], {
      easing: Easing.in(Easing.quad),
      extrapolateRight: "clamp",
    });
    const zoomNew = interpolate(pNew, [0, 1], [1.3, 1.08], {
      easing: Easing.out(Easing.cubic),
      extrapolateRight: "clamp",
    });
    oldTransform = `scale(${(zoomOld * overscanOld).toFixed(4)})`;
    newTransform = `scale(${(zoomNew * overscanNew).toFixed(4)})`;
  } else if (dir === "right") {
    // 旧新とも右流れ。微拡大で黒フチ隠し
    const oldX = driftAmt * pOld;
    const newX = interpolate(pNew, [0, 1], [-driftAmt * 0.7, 0], {
      easing: Easing.out(Easing.cubic),
      extrapolateRight: "clamp",
    });
    oldTransform = `translateX(${oldX.toFixed(1)}px) scale(${(
      1.02 + 0.1 * meltOld
    ).toFixed(4)})`;
    newTransform = `translateX(${newX.toFixed(1)}px) scale(${(
      1.02 + 0.1 * meltNew
    ).toFixed(4)})`;
  } else {
    // 縦版: 流れの根元側を基点にした縦伸びで「垂れて溶ける」
    const stretchOld = 1 + 0.32 * meltOld;
    const stretchNew = 1 + 0.32 * meltNew;
    const rootEdge = dir === "up" ? "100%" : "0%"; // 上溶け=下辺基点/下溶け=上辺基点
    oldOrigin = `50% ${rootEdge}`;
    newOrigin = `50% ${rootEdge}`;
    const oldY = sign * height * 0.04 * pOld;
    const newY = interpolate(pNew, [0, 1], [-sign * height * 0.04, 0], {
      easing: Easing.out(Easing.cubic),
      extrapolateRight: "clamp",
    });
    oldTransform = `translateY(${oldY.toFixed(1)}px) scaleY(${stretchOld.toFixed(
      4
    )}) scale(${overscanOld.toFixed(4)})`;
    newTransform = `translateY(${newY.toFixed(1)}px) scaleY(${stretchNew.toFixed(
      4
    )}) scale(${overscanNew.toFixed(4)})`;
  }

  // left のみステージ全体の等速ドリフト
  const stageTransform =
    dir === "left" ? `translateX(${(-driftAmt * p).toFixed(1)}px)` : undefined;

  // 新カットは共用フィルタ（left）のときも旧と同じ絵にならないよう別idにしない:
  // left は本体1本共用（同一ノイズ・同一エンベロープ）が個体の性格
  const oldFilterId = `${uid}-melt-a`;
  const newFilterId = sharedEnvelope ? oldFilterId : `${uid}-melt-b`;

  // ---- 化粧（発光オーバーレイ・方向別） --------------------------------------
  const burnEnv =
    dir === "left"
      ? interpolate(p, [0.35, 0.62, 1], [0, 1, 0.32], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        })
      : 0;

  const glowLayers: React.CSSProperties[] = [];
  if (dir === "left") {
    // 斜めマゼンタ光条
    glowLayers.push({
      background:
        "linear-gradient(112deg, transparent 32%, rgba(252,44,188,0.55) 45%, rgba(255,158,232,0.92) 50%, rgba(252,44,188,0.55) 55%, transparent 68%)",
      opacity: glow * 0.85,
    });
    // 中央の白コア
    glowLayers.push({
      background:
        "radial-gradient(ellipse 34% 46% at 50% 50%, rgba(255,255,255,0.9), rgba(255,255,255,0) 72%)",
      opacity: glow * 0.8,
    });
    // 左下から立ち上がる暖色の焼け（終端でも3割残す）
    glowLayers.push({
      background:
        "radial-gradient(circle at 10% 92%, rgba(255,116,36,0.75), rgba(210,40,20,0.35) 34%, rgba(0,0,0,0) 60%)",
      opacity: burnEnv * 0.75,
    });
  } else if (dir === "right") {
    // 左端マゼンタ・右端シアンの対置光漏れ
    glowLayers.push({
      background:
        "linear-gradient(90deg, rgba(236,32,180,0.8), rgba(236,32,180,0) 26%), linear-gradient(270deg, rgba(0,196,214,0.72), rgba(0,196,214,0) 30%)",
      opacity: glow * 0.85,
    });
    // 中央やや右の白い楕円ブルーム
    glowLayers.push({
      background:
        "radial-gradient(ellipse 30% 38% at 62% 50%, rgba(255,255,255,0.88), rgba(255,255,255,0) 70%)",
      opacity: glow * 0.75,
    });
  } else if (dir === "up") {
    // 左赤・右青のラジアル対置（赤青マーブル）
    glowLayers.push({
      background:
        "radial-gradient(circle 42% at 22% 40%, rgba(255,64,72,0.62), rgba(255,64,72,0) 68%), radial-gradient(circle 44% at 78% 42%, rgba(72,108,255,0.62), rgba(72,108,255,0) 68%)",
      opacity: glow * 0.8,
    });
    // 中央下から立ち上がる青白い光
    glowLayers.push({
      background:
        "radial-gradient(ellipse 44% 34% at 50% 96%, rgba(206,228,255,0.85), rgba(206,228,255,0) 72%)",
      opacity: glow * 0.7,
    });
  } else {
    // 左上の紫〜マゼンタのラジアルバースト
    glowLayers.push({
      background:
        "radial-gradient(circle 46% at 18% 10%, rgba(196,72,255,0.72), rgba(255,52,214,0.3) 40%, rgba(0,0,0,0) 68%)",
      opacity: glow * 0.85,
    });
    // 中央の暖色白ブルーム
    glowLayers.push({
      background:
        "radial-gradient(ellipse 34% 40% at 50% 46%, rgba(255,240,222,0.9), rgba(255,240,222,0) 70%)",
      opacity: glow * 0.75,
    });
  }

  // ---- グレイン --------------------------------------------------------------
  const grainSeed = 900 + Math.floor(frame / 2) * 3 + dirIndex;
  const grainOpacity = 0.07 + glow * 0.05;

  return (
    <AbsoluteFill style={{ background: "#000", overflow: "hidden" }}>
      {/* 溶けフィルタ定義（フレームごとに再レンダリング） */}
      <svg width={0} height={0} style={{ position: "absolute" }} aria-hidden>
        <defs>
          {meltFilterDef(oldFilterId, seedOld, fpOld)}
          {!sharedEnvelope && meltFilterDef(`${uid}-melt-b`, seedNew, fpNew)}
        </defs>
      </svg>

      <AbsoluteFill style={{ transform: stageTransform }}>
        {/* 旧カット層: 溶けて退場 */}
        {showOld && (
          <AbsoluteFill
            style={{
              filter: `url(#${oldFilterId})`,
              transform: oldTransform,
              transformOrigin: oldOrigin,
            }}
          >
            {from}
          </AbsoluteFill>
        )}

        {/* 新カット層: 溶けた状態から像を結ぶ。中盤の短窓で乗る */}
        {showNew && (
          <AbsoluteFill
            style={{
              filter: `url(#${newFilterId})`,
              transform: newTransform,
              transformOrigin: newOrigin,
              opacity: toOpacity,
            }}
          >
            {to}
          </AbsoluteFill>
        )}
      </AbsoluteFill>

      {/* 発光オーバーレイ群（screen 合成・手続き生成） */}
      {glowLayers.map((s, i) => (
        <AbsoluteFill
          key={i}
          style={{ ...s, mixBlendMode: "screen", pointerEvents: "none" }}
        />
      ))}

      {/* 白フラッシュ（鋭い三角・白飛びさせない） */}
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

      {/* フィルムグレイン（overlay・常時薄く、中盤やや強め） */}
      <AbsoluteFill
        style={{
          mixBlendMode: "overlay",
          opacity: grainOpacity,
          pointerEvents: "none",
        }}
      >
        <svg width="100%" height="100%" aria-hidden>
          <filter id={`${uid}-grain`} x="0" y="0" width="100%" height="100%">
            <feTurbulence
              type="fractalNoise"
              baseFrequency="0.82"
              numOctaves={2}
              seed={grainSeed}
            />
            <feColorMatrix type="saturate" values="0" />
          </filter>
          <rect width="100%" height="100%" filter={`url(#${uid}-grain)`} />
        </svg>
      </AbsoluteFill>

      {/* 周辺減光ヴィネット（left のみ） */}
      {dir === "left" && (
        <AbsoluteFill
          style={{
            background:
              "radial-gradient(ellipse at 50% 50%, rgba(0,0,0,0) 55%, rgba(0,0,0,0.4) 100%)",
            opacity: clamp01(glow * 1.2) * 0.6,
            pointerEvents: "none",
          }}
        />
      )}
    </AbsoluteFill>
  );
};
