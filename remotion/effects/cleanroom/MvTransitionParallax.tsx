import React, { useId, useMemo } from "react";
import {
  AbsoluteFill,
  Easing,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

/**
 * MvTransitionParallax — 視差スライドトランジション（クリーンルーム実装）
 *
 * 2クリップ（from→to）が方向つきの視差スクロールですれ違う映画的スライド。
 * 3幕構成: from が少し待って加速気味に退場 → 中央で全効果（ブラー/色収差/揺れ/発光）
 * がピークに達した瞬間に入れ替え → to が鏡映しに入場し減速して着地。
 * 継ぎ目はフラッシュと方向ブラーで隠す。
 *
 * direction による個体差:
 * - left  : 微skew＋常時ベース拡大の平面系。色収差→横ブラー連結。暖色グローは右端最強
 * - right : perspective＋rotateY の3D系。ズームサージ、強い揺れ、彩度低下、寒色アクセント、ビネット
 * - up    : 縦3D系。rotateX で倒れ込み/起き上がり。入れ替えは純白大フラッシュで隠すハードカット
 * - down  : 物理ワイプ型。to を下に敷き from が画面高を超えて滑り落ちる。白発光＋モノクロ寄り
 * - forward / backward : 専用個体ができるまで right / left の別名
 *
 * 決定論: 乱数はすべて (seed, frame, salt) のハッシュから生成。Math.random 不使用。
 * 解像度非依存: 全効果量は 1920px 幅基準の比率 × 実寸で算出。
 */
export interface MvTransitionParallaxProps {
  /** 旧カット */
  from: React.ReactNode;
  /** 新カット */
  to: React.ReactNode;
  /** トランジション全体の長さ（フレーム） */
  durationInFrames: number;
  /** スライド方向 */
  direction?: "left" | "right" | "up" | "down" | "forward" | "backward";
  /** 0..1 同家族内の見た目分岐（グロー強度・揺れ・色収差量などを決定論的に振る） */
  variant?: number;
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** (a,b,c) から 0..1 の決定的な擬似乱数（GLSL の定番ハッシュ） */
const rand = (a: number, b: number, c: number): number => {
  const s = Math.sin(a * 127.1 + b * 311.7 + c * 74.7) * 43758.5453123;
  return s - Math.floor(s);
};

/** ±1 の一様乱数 */
const srand = (a: number, b: number, c: number): number => rand(a, b, c) * 2 - 1;

// チャンネル抽出行列（必ず SourceGraphic を入力にする。前段結果を継がない）
const MAT_R = "1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0";
const MAT_G = "0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0";
const MAT_B = "0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0";
const MAT_CYAN = "0 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 1 0";

const CLAMP = {
  extrapolateLeft: "clamp",
  extrapolateRight: "clamp",
} as const;

type Dir = "left" | "right" | "up" | "down";

export const MvTransitionParallax: React.FC<MvTransitionParallaxProps> = ({
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

  // forward / backward は方向族契約の互換用。専用個体ができるまで 3D系 / 平面系の別名
  const dir: Dir =
    direction === "forward"
      ? "right"
      : direction === "backward"
        ? "left"
        : direction;

  const v = clamp01(variant);
  const seed = 11 + Math.floor(v * 997);

  // ---- 進行度（フレーム数に依存させない） ---------------------------------
  const p =
    durationInFrames <= 1 ? 1 : clamp01(frame / (durationInFrames - 1));

  const horizontal = dir === "left" || dir === "right";
  const sign = dir === "left" || dir === "up" ? -1 : 1;

  // ---- エンベロープ（頂点は中央） ------------------------------------------
  const tri = interpolate(p, [0, 0.5, 1], [0, 1, 0]);
  const centerEnv = interpolate(
    p,
    [0, 0.3, 0.5, 0.7, 1],
    [0, 0.55, 1, 0.55, 0]
  );
  // 色収差だけ中央で短いプラトーを持ち、終端手前でゼロへ戻る
  const chromaEnv = interpolate(
    p,
    [0.06, 0.45, 0.55, 0.96],
    [0, 1, 1, 0],
    CLAMP
  );
  const flashEnv = Math.pow(
    interpolate(p, [0.36, 0.5, 0.66], [0, 1, 0], CLAMP),
    1.7
  );
  const shakeEnv = interpolate(p, [0.05, 0.5, 0.95], [0, 1, 0], CLAMP);

  // ---- 移動（A: 少し待って加速気味に退場 / B: 反対側から入って減速着地） ---
  const paMove = interpolate(p, [0.17, 0.52], [0, 1], {
    ...CLAMP,
    easing: Easing.bezier(0.42, 0.1, 0.86, 0.7),
  });
  const pbMove = interpolate(p, [0.39, 0.78], [0, 1], {
    ...CLAMP,
    easing: Easing.bezier(0.16, 0.44, 0.32, 1),
  });

  // ---- 量（1920px幅基準の比率 × 実寸で解像度非依存） -----------------------
  const slideBase = (horizontal ? width : height) * 0.23 * (0.9 + 0.2 * v);
  // down だけ例外: 画面高を丸ごと超えて抜ける物理ワイプ
  const slide = dir === "down" ? height * 1.16 : slideBase;
  const persp = width * 0.72;

  const blurMaxBase =
    dir === "right" ? 0 : width * (dir === "down" ? 0.027 : 0.023);
  const aBlur = blurMaxBase * interpolate(p, [0.14, 0.5], [0, 1], CLAMP);
  const bBlur =
    blurMaxBase *
    (dir === "down" ? 0.45 : 1) *
    interpolate(p, [0.5, 0.9], [1, 0], CLAMP);

  const chromaMax =
    width *
    (dir === "down" ? 0.02 : dir === "right" ? 0.016 : 0.013) *
    (0.85 + 0.3 * v);
  const shift = chromaMax * chromaEnv;
  const dxS = horizontal ? shift * sign : 0;
  const dyS = horizontal ? 0 : shift * sign;

  // ---- 揺れ（ハッシュ乱数 × 中央ピーク。シードを3倍速で刻んでガタつかせる）
  const ampPx =
    (dir === "right" ? 0.009 : dir === "left" ? 0.0016 : 0.005) *
    height *
    (0.75 + 0.5 * v) *
    shakeEnv;
  const j = frame * 3;
  const shX = dir === "left" ? 0 : srand(seed, j, 31) * ampPx;
  const shY = srand(seed, j, 47) * ampPx * (dir === "right" ? 0.8 : 1);

  // ---- レイヤー変形 --------------------------------------------------------
  let aTransform: string;
  let bTransform: string;
  let aOrigin = "50% 50%";
  let bOrigin = "50% 50%";

  if (horizontal) {
    const aX = sign * paMove * slide;
    const bX = -sign * (1 - pbMove) * slide;
    if (dir === "left") {
      // 平面系: 微skew＋常時ベース拡大でフチの黒見えと奥行きをごまかす
      const skew = 2.2 * tri;
      aTransform = `translateX(${aX.toFixed(1)}px) scale(1.13) skewX(${skew.toFixed(2)}deg)`;
      bTransform = `translateX(${bX.toFixed(1)}px) scale(1.13) skewX(${(-skew).toFixed(2)}deg)`;
    } else {
      // 3D系: ズームサージ（A: 1→1.5 で膨らみ / B: 1.32→1 へ収束）
      const aScale = 1 + 0.5 * paMove;
      const bScale = 1.32 - 0.32 * pbMove;
      aTransform = `translateX(${aX.toFixed(1)}px) scale(${aScale.toFixed(3)})`;
      bTransform = `translateX(${bX.toFixed(1)}px) scale(${bScale.toFixed(3)})`;
    }
  } else if (dir === "up") {
    // 縦3D系: A は下端支点で奥へ倒れつつ上へ退場、B は上端支点で起き上がりつつ下から上昇
    const aY = -paMove * slide;
    const bY = (1 - pbMove) * slide;
    const aTilt = 17 * paMove;
    const bTilt = -17 * (1 - pbMove);
    aOrigin = "50% 100%";
    bOrigin = "50% 0%";
    aTransform = `perspective(${persp.toFixed(0)}px) translateY(${aY.toFixed(1)}px) rotateX(${aTilt.toFixed(2)}deg) scale(1.09)`;
    bTransform = `perspective(${persp.toFixed(0)}px) translateY(${bY.toFixed(1)}px) rotateX(${bTilt.toFixed(2)}deg) scale(1.09)`;
  } else {
    // down: 物理ワイプ。B を下に敷き、A が画面高を超えて滑り落ちて拭い去る
    const aY = paMove * slide;
    aTransform = `translateY(${aY.toFixed(1)}px) scale(1.1)`;
    bTransform = `scale(${(1.07 - 0.07 * pbMove).toFixed(3)})`;
  }

  // ---- 入れ替え -------------------------------------------------------------
  // 基本: B を前面に重ね、中央のごく短い窓で不透明度を立ち上げる
  // up: 完全ハードカット（純白フラッシュで隠す） / down: opacity 入れ替えなし
  const bOpacity =
    dir === "down"
      ? 1
      : dir === "up"
        ? p >= 0.5
          ? 1
          : 0
        : interpolate(p, [0.467, 0.533], [0, 1], CLAMP);

  const showA = dir === "down" ? paMove < 1 : bOpacity < 0.999;
  const showB = bOpacity > 0.001;

  const aFilterOn = aBlur > 0.4 || shift > 0.4;
  const bFilterOn = bBlur > 0.4 || shift > 0.4;

  // ---- グレード（彩度を中盤で沈めるフィルム調） -----------------------------
  let grade: string | undefined;
  if (dir === "right") {
    grade = `saturate(${(1 - 0.48 * centerEnv).toFixed(3)}) contrast(${(1 + 0.05 * centerEnv).toFixed(3)}) brightness(${(1 - 0.04 * centerEnv).toFixed(3)})`;
  } else if (dir === "up") {
    grade = `saturate(${(0.84 - 0.14 * centerEnv).toFixed(3)})`;
  } else if (dir === "down") {
    grade = `saturate(${(1 - 0.52 * centerEnv).toFixed(3)}) contrast(${(1 + 0.06 * centerEnv).toFixed(3)})`;
  }

  // ---- シーン（揺れ＋3D系の傾斜） ------------------------------------------
  const rotY = dir === "right" ? -6.5 * centerEnv : 0;
  const sceneTransform =
    `translate(${shX.toFixed(1)}px, ${shY.toFixed(1)}px)` +
    (dir === "right"
      ? ` perspective(${persp.toFixed(0)}px) rotateY(${rotY.toFixed(2)}deg)`
      : "");

  // ---- 光まわり -------------------------------------------------------------
  const glow = Math.pow(centerEnv, 1.15) * (0.85 + 0.3 * v);

  const leaks: Array<{ bg: string; op: number }> = [];
  if (dir === "left") {
    leaks.push({
      bg: "radial-gradient(115% 135% at 100% 45%, rgba(255,168,72,0.9) 0%, rgba(255,122,40,0.32) 42%, rgba(255,122,40,0) 70%)",
      op: 0.8 * glow,
    });
    leaks.push({
      bg: "radial-gradient(80% 100% at 0% 60%, rgba(255,140,60,0.5) 0%, rgba(255,140,60,0) 55%)",
      op: 0.35 * glow,
    });
  } else if (dir === "right") {
    leaks.push({
      bg: "radial-gradient(110% 130% at 0% 55%, rgba(255,158,66,0.85) 0%, rgba(255,110,36,0.3) 40%, rgba(255,110,36,0) 68%)",
      op: 0.75 * glow,
    });
    leaks.push({
      bg: "radial-gradient(85% 110% at 100% 40%, rgba(46,220,205,0.55) 0%, rgba(46,220,205,0) 55%)",
      op: 0.5 * glow,
    });
    leaks.push({
      bg: "radial-gradient(60% 80% at 96% 78%, rgba(255,64,196,0.4) 0%, rgba(255,64,196,0) 55%)",
      op: 0.4 * glow,
    });
  } else if (dir === "up") {
    leaks.push({
      bg: "radial-gradient(130% 90% at 50% 100%, rgba(255,160,70,0.8) 0%, rgba(255,160,70,0) 60%)",
      op: 0.65 * glow,
    });
    leaks.push({
      bg: "radial-gradient(130% 80% at 50% 0%, rgba(90,170,255,0.6) 0%, rgba(90,170,255,0) 58%)",
      op: 0.55 * glow,
    });
  } else {
    // down: 暖色ではなく白の発光
    leaks.push({
      bg: "radial-gradient(95% 75% at 50% 32%, rgba(255,255,255,0.65) 0%, rgba(255,255,255,0) 68%)",
      op: 0.5 * glow,
    });
  }

  const kw = width / 1920;
  const streakPeriod = Math.max(24, Math.round((96 + v * 84) * kw));
  const streakW = Math.max(2, Math.round(3 * kw));
  const streakShift = (p - 0.5) * width * 0.22 * (horizontal ? sign : 1);
  const streakColor = dir === "down" ? "255,255,255" : "255,236,208";

  const flashCol =
    dir === "up" || dir === "down" ? "255,255,255" : "255,238,216";
  const flashOp =
    flashEnv * (dir === "up" ? 0.95 : dir === "down" ? 0.55 : 0.72);
  const flashSize = dir === "up" ? "95% 85%" : "62% 56%";

  const grainOp = (dir === "down" ? 0.15 : 0.09) + 0.05 * flashEnv;
  const grainSeed = (frame * 37 + seed) % 9973;

  // ---- SVG フィルタ（色収差＋方向ブラー。オフセット欠け防止に領域を広げる） --
  const chromaFilter = (id: string, blur: number) => {
    const bx = horizontal ? blur : blur * 0.06;
    const by = horizontal ? blur * 0.06 : blur;
    const withBlur = blur > 0.3;
    if (dir === "down") {
      // down のみ: ブラー後段に R 対シアンの2チャンネル分離を連結
      return (
        <filter
          id={id}
          x="-25%"
          y="-25%"
          width="150%"
          height="150%"
          colorInterpolationFilters="sRGB"
        >
          <feGaussianBlur
            in="SourceGraphic"
            stdDeviation={`${bx.toFixed(2)} ${by.toFixed(2)}`}
            result="base"
          />
          <feColorMatrix in="base" type="matrix" values={MAT_R} result="r" />
          <feOffset
            in="r"
            dx={dxS.toFixed(2)}
            dy={dyS.toFixed(2)}
            result="ro"
          />
          <feColorMatrix in="base" type="matrix" values={MAT_CYAN} result="c" />
          <feOffset
            in="c"
            dx={(-dxS).toFixed(2)}
            dy={(-dyS).toFixed(2)}
            result="co"
          />
          <feBlend in="ro" in2="co" mode="screen" />
        </filter>
      );
    }
    return (
      <filter
        id={id}
        x="-25%"
        y="-25%"
        width="150%"
        height="150%"
        colorInterpolationFilters="sRGB"
      >
        <feColorMatrix
          in="SourceGraphic"
          type="matrix"
          values={MAT_R}
          result="r"
        />
        <feOffset in="r" dx={dxS.toFixed(2)} dy={dyS.toFixed(2)} result="ro" />
        <feColorMatrix
          in="SourceGraphic"
          type="matrix"
          values={MAT_G}
          result="g"
        />
        <feColorMatrix
          in="SourceGraphic"
          type="matrix"
          values={MAT_B}
          result="b"
        />
        <feOffset
          in="b"
          dx={(-dxS).toFixed(2)}
          dy={(-dyS).toFixed(2)}
          result="bo"
        />
        <feBlend in="ro" in2="g" mode="screen" result="rg" />
        <feBlend in="rg" in2="bo" mode="screen" result="rgb" />
        {withBlur ? (
          <feGaussianBlur
            in="rgb"
            stdDeviation={`${bx.toFixed(2)} ${by.toFixed(2)}`}
          />
        ) : null}
      </filter>
    );
  };

  const layerA = showA ? (
    <AbsoluteFill
      style={{
        transform: aTransform,
        transformOrigin: aOrigin,
        filter: aFilterOn ? `url(#${uid}-fa)` : undefined,
      }}
    >
      {from}
    </AbsoluteFill>
  ) : null;

  const layerB = showB ? (
    <AbsoluteFill
      style={{
        opacity: bOpacity,
        transform: bTransform,
        transformOrigin: bOrigin,
        filter: bFilterOn ? `url(#${uid}-fb)` : undefined,
      }}
    >
      {to}
    </AbsoluteFill>
  ) : null;

  return (
    <AbsoluteFill style={{ background: "#000", overflow: "hidden" }}>
      <svg width={0} height={0} style={{ position: "absolute" }} aria-hidden>
        <defs>
          {chromaFilter(`${uid}-fa`, aBlur)}
          {chromaFilter(`${uid}-fb`, bBlur)}
          <filter
            id={`${uid}-grain`}
            x="-10%"
            y="-10%"
            width="120%"
            height="120%"
          >
            <feTurbulence
              type="fractalNoise"
              baseFrequency="0.82"
              numOctaves={2}
              seed={grainSeed}
              stitchTiles="stitch"
              result="n"
            />
            <feColorMatrix in="n" type="saturate" values="0" />
          </filter>
        </defs>
      </svg>

      {/* 揺れ＋（3D系は）シーン傾斜のラッパー。彩度低下などのグレードもここ */}
      <AbsoluteFill style={{ transform: sceneTransform, filter: grade }}>
        {dir === "down" ? (
          <>
            {layerB}
            {layerA}
          </>
        ) : (
          <>
            {layerA}
            {layerB}
          </>
        )}
      </AbsoluteFill>

      {/* 光漏れ（screen 合成） */}
      {leaks.map((l, i) => (
        <AbsoluteFill
          key={i}
          style={{
            background: l.bg,
            mixBlendMode: "screen",
            opacity: clamp01(l.op),
          }}
        />
      ))}

      {/* 縦の細い光条（軽くぼかして光漏れと一緒にスイープ） */}
      {glow > 0.02 && (
        <div
          style={{
            position: "absolute",
            top: 0,
            bottom: 0,
            left: "-25%",
            right: "-25%",
            background: `repeating-linear-gradient(90deg, rgba(${streakColor},0) 0px, rgba(${streakColor},0) ${streakPeriod - streakW}px, rgba(${streakColor},0.5) ${streakPeriod - streakW}px, rgba(${streakColor},0.5) ${streakPeriod}px)`,
            transform: `translateX(${streakShift.toFixed(1)}px)`,
            filter: "blur(5px)",
            mixBlendMode: "screen",
            opacity: clamp01(0.38 * glow),
          }}
        />
      )}

      {/* 中央の放射フラッシュ（継ぎ目を隠す核） */}
      {flashOp > 0.01 && (
        <AbsoluteFill
          style={{
            background: `radial-gradient(${flashSize} at 50% 50%, rgba(${flashCol},0.95) 0%, rgba(${flashCol},0.4) 45%, rgba(${flashCol},0) 72%)`,
            mixBlendMode: "screen",
            opacity: clamp01(flashOp),
          }}
        />
      )}

      {/* フィルムグレイン（毎フレーム シードを変えて動かす。発光ピークで微増） */}
      <AbsoluteFill
        style={{
          filter: `url(#${uid}-grain)`,
          mixBlendMode: "overlay",
          opacity: clamp01(grainOp),
        }}
      />

      {/* ビネット（3D系個体） */}
      {dir === "right" && (
        <AbsoluteFill
          style={{
            background:
              "radial-gradient(118% 118% at 50% 50%, rgba(0,0,0,0) 58%, rgba(0,0,0,0.55) 100%)",
            opacity: 0.45 + 0.35 * centerEnv,
          }}
        />
      )}
    </AbsoluteFill>
  );
};
