/**
 * BackgroundTornReveal10 — クリーンルーム再実装（外部非参照）。
 *
 * 機能記述: 「破れた紙の隙間から映像が覗く背景」。
 * - 上下 2 枚のクリーム色の紙が画面を覆い、中央の破れ目から奥の映像が覗く。
 * - ちぎれ縁は白い紙繊維のケバ＋暗いスレート色の落ち影で立体感を出す。
 * - イントロ: 黒からの明転と同時に、全体がわずかに傾いた状態から水平へ整定
 *   しつつ、紙がオーバーシュート気味にビリッと開く。
 * - アウトロ: 逆方向に傾きながら紙が閉じ、黒へ暗転して終わる。
 * - children を渡すとそれが破れ目の奥の映像になる。省略時は青灰のソフトな
 *   グラデーション（光だまり付き）をプレースホルダとして敷く。
 *
 * テキストを一切描画しないためフォントに依存しない（Mac 内蔵限定フォント
 * 非依存・配布可）。色/開口量/破れの粗さ/タイミングはすべて props で調整可。
 */
import React, { useId, useMemo } from "react";
import {
  AbsoluteFill,
  Easing,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

/** 決定論的な 0..1 ハッシュ */
const hash01 = (n: number, seed: number): number => {
  const s = Math.sin(n * 127.1 + seed * 269.5 + 311.7) * 43758.5453;
  return s - Math.floor(s);
};

/** 1 次元バリューノイズ（0..1、滑らか補間） */
const valueNoise = (x: number, step: number, seed: number): number => {
  const i = Math.floor(x / step);
  const t = x / step - i;
  const u = t * t * (3 - 2 * t);
  const a = hash01(i, seed);
  const b = hash01(i + 1, seed);
  return a + (b - a) * u;
};

/** ちぎれ線の縦オフセット（0 中心、px）。大うねり＋中うねり＋細かいギザ */
const tearOffset = (
  x: number,
  seed: number,
  roughness: number,
  detail: number
): number => {
  const big = (valueNoise(x, 190, seed) - 0.5) * 2 * roughness;
  const mid = (valueNoise(x, 62, seed + 13) - 0.5) * 1.6 * roughness * 0.55;
  const fine = (valueNoise(x, 13, seed + 29) - 0.5) * 2 * detail;
  // ときどき深い V 字の裂け目を紙側に食い込ませる（ノイズの山を尖らせる）
  const spikeN = valueNoise(x, 110, seed + 47);
  const spike =
    spikeN > 0.76 ? -(((spikeN - 0.76) / 0.24) ** 2) * roughness * 1.8 : 0;
  const spikeN2 = valueNoise(x, 150, seed + 71);
  const spike2 =
    spikeN2 > 0.84 ? ((spikeN2 - 0.84) / 0.16) ** 2 * roughness * 1.1 : 0;
  return big + mid + fine + spike + spike2;
};

/**
 * 紙 1 枚ぶんの閉じたパスを作る。
 * edgeY: x → ちぎれ縁の y。side="top" なら上端側へ、"bottom" なら下端側へ閉じる。
 */
const buildPaperPath = (
  edgeY: (x: number) => number,
  side: "top" | "bottom",
  width: number,
  height: number,
  margin: number,
  dx: number
): string => {
  const backY = side === "top" ? -margin : height + margin;
  const parts: string[] = [`M ${-margin} ${backY}`];
  for (let x = -margin; x <= width + margin; x += dx) {
    parts.push(`L ${x.toFixed(1)} ${edgeY(x).toFixed(1)}`);
  }
  parts.push(`L ${(width + margin).toFixed(1)} ${backY}`);
  parts.push("Z");
  return parts.join(" ");
};

export interface BackgroundTornReveal10Props {
  /** 総尺(フレーム)。省略時はコンポジションの尺。アウトロがこれに追随 */
  durationInFrames?: number;
  /** 破れ目の奥に覗かせる映像。省略時は青灰グラデのプレースホルダ */
  children?: React.ReactNode;

  // ---- 紙の色味 ----
  /** 紙の基本色（クリーム） */
  paperColor?: string;
  /** 紙の陰側の色（外周がわずかに沈む） */
  paperShadeColor?: string;
  /** ちぎれ縁の紙繊維（ケバ）の色 */
  fiberColor?: string;
  /** ちぎれ縁の落ち影の色（暗いスレート） */
  shadowColor?: string;

  // ---- レイアウト ----
  /** 整定時の開口の高さ（画面高さに対する 0..1） */
  openRatio?: number;
  /** 開口の中心の縦位置（0=上端, 1=下端） */
  centerY?: number;

  // ---- 破れの形 ----
  /** 乱数シード（破れ方の個体差） */
  seed?: number;
  /** 大きなうねりの振幅(px) */
  roughness?: number;
  /** 細かいギザギザの振幅(px) */
  detail?: number;
  /** 紙繊維のケバの幅(px) */
  fiberWidth?: number;

  // ---- タイミング・動き ----
  /** イントロ（開き＋整定）の長さ(フレーム) */
  introFrames?: number;
  /** アウトロ（閉じ＋暗転）の長さ(フレーム) */
  outroFrames?: number;
  /** イントロ/アウトロ時の傾き(度) */
  tiltDegrees?: number;
  /** 明転前・暗転後の地の色 */
  fadeColor?: string;

  // ---- プレースホルダ背景 ----
  /** 奥の映像プレースホルダの明るい側の色 */
  backdropLightColor?: string;
  /** 奥の映像プレースホルダの暗い側の色 */
  backdropDarkColor?: string;
}

export const BackgroundTornReveal10: React.FC<BackgroundTornReveal10Props> = ({
  durationInFrames,
  children,
  paperColor = "#ece4d4",
  paperShadeColor = "#ddd2bc",
  fiberColor = "#fdfbf3",
  shadowColor = "#3f5a64",
  openRatio = 0.74,
  centerY = 0.5,
  seed = 10,
  roughness = 30,
  detail = 9,
  fiberWidth = 21,
  introFrames = 16,
  outroFrames = 14,
  tiltDegrees = 7,
  fadeColor = "#0a0e12",
  backdropLightColor = "#dce6ee",
  backdropDarkColor = "#98abbd",
}) => {
  const frame = useCurrentFrame();
  const { fps, width, height, durationInFrames: compDuration } = useVideoConfig();
  const total = durationInFrames ?? compDuration;
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");

  // ---- アニメーション ----
  // 開き: ばねでオーバーシュート気味にビリッと開く
  const openSpring = spring({
    frame: Math.max(0, frame - 2),
    fps,
    config: { damping: 9.5, stiffness: 50, mass: 1 },
  });
  // 整定: 傾き・ズレが水平に落ち着く
  const settle = interpolate(frame, [0, introFrames], [0, 1], {
    easing: Easing.inOut(Easing.cubic),
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  // アウトロ: 紙が閉じる量（素早くビリッと閉じる）
  const outroStart = Math.max(0, total - outroFrames);
  const closeT = interpolate(
    frame,
    [outroStart, Math.max(outroStart + 1, total - Math.round(outroFrames / 2))],
    [0, 1],
    {
      easing: Easing.inOut(Easing.cubic),
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    }
  );
  // アウトロ: 傾き戻し（イントロと逆方向）
  const outT = interpolate(
    frame,
    [outroStart, Math.max(outroStart + 1, total - 2)],
    [0, 1],
    {
      easing: Easing.inOut(Easing.cubic),
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    }
  );
  // 明るさ（黒からの明転／黒への暗転）
  const brightIn = interpolate(frame, [1, introFrames * 0.8], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const brightOut = interpolate(
    frame,
    [Math.max(0, total - outroFrames * 0.8), Math.max(1, total - 2)],
    [1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );
  const brightness = Math.min(brightIn, brightOut);

  const maxOpening = openRatio * height;
  const closedSlit = height * 0.008;
  const opening =
    (closedSlit + (maxOpening - closedSlit) * Math.max(0, openSpring)) *
    (1 - closeT * 0.95);
  const rotation = -tiltDegrees * (1 - settle) + tiltDegrees * 0.9 * outT;
  const scale = (0.93 + 0.07 * settle) * (1 - 0.04 * outT);

  const midY = centerY * height;
  const topEdgeBase = midY - opening / 2;
  const botEdgeBase = midY + opening / 2;

  // ---- ちぎれパス（形は静的、開閉は縦オフセットのみ） ----
  const margin = 80;
  const dx = 12;
  const geom = useMemo(() => {
    const seedTop = seed;
    const seedBot = seed + 101;
    const topTear = (x: number) => tearOffset(x, seedTop, roughness, detail);
    const botTear = (x: number) => -tearOffset(x, seedBot, roughness, detail);
    const topFiber = (x: number) =>
      5 + fiberWidth * (0.25 + 0.75 * valueNoise(x, 26, seedTop + 41));
    const botFiber = (x: number) =>
      5 + fiberWidth * (0.25 + 0.75 * valueNoise(x, 26, seedBot + 41));
    const topShadow = (x: number) =>
      2 + 7 * valueNoise(x, 24, seedTop + 57);
    const botShadow = (x: number) =>
      2 + 7 * valueNoise(x, 24, seedBot + 57);
    return { topTear, botTear, topFiber, botFiber, topShadow, botShadow };
  }, [seed, roughness, detail, fiberWidth]);

  const topBody = buildPaperPath(
    (x) => topEdgeBase + geom.topTear(x),
    "top",
    width,
    height,
    margin,
    dx
  );
  const topFiberPath = buildPaperPath(
    (x) => topEdgeBase + geom.topTear(x) + geom.topFiber(x),
    "top",
    width,
    height,
    margin,
    dx
  );
  const topShadowPath = buildPaperPath(
    (x) => topEdgeBase + geom.topTear(x) + geom.topFiber(x) + geom.topShadow(x),
    "top",
    width,
    height,
    margin,
    dx
  );
  const botBody = buildPaperPath(
    (x) => botEdgeBase + geom.botTear(x),
    "bottom",
    width,
    height,
    margin,
    dx
  );
  const botFiberPath = buildPaperPath(
    (x) => botEdgeBase + geom.botTear(x) - geom.botFiber(x),
    "bottom",
    width,
    height,
    margin,
    dx
  );
  const botShadowPath = buildPaperPath(
    (x) => botEdgeBase + geom.botTear(x) - geom.botFiber(x) - geom.botShadow(x),
    "bottom",
    width,
    height,
    margin,
    dx
  );

  const defaultBackdrop = (
    <AbsoluteFill
      style={{
        background: [
          `radial-gradient(${width * 0.62}px ${height * 0.72}px at 27% 17%, ${backdropLightColor}e6, ${backdropLightColor}00 65%)`,
          `radial-gradient(${width * 0.5}px ${height * 0.6}px at 74% 47%, ${backdropLightColor}66, ${backdropLightColor}00 62%)`,
          `linear-gradient(148deg, ${backdropDarkColor} 0%, ${backdropDarkColor} 100%)`,
        ].join(", "),
      }}
    />
  );

  return (
    <AbsoluteFill style={{ background: fadeColor, overflow: "hidden" }}>
      <AbsoluteFill
        style={{
          transform: `rotate(${rotation}deg) scale(${scale})`,
          transformOrigin: "50% 50%",
        }}
      >
        {/* 破れ目の奥の映像 */}
        <AbsoluteFill>{children ?? defaultBackdrop}</AbsoluteFill>

        {/* 上下の紙 */}
        <svg
          width={width}
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          style={{ position: "absolute", inset: 0, display: "block" }}
        >
          <defs>
            {/* 紙面の淡い陰影 */}
            <linearGradient id={`pgTop${uid}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={paperShadeColor} />
              <stop offset="70%" stopColor={paperColor} />
              <stop offset="100%" stopColor={paperColor} />
            </linearGradient>
            <linearGradient id={`pgBot${uid}`} x1="0" y1="1" x2="0" y2="0">
              <stop offset="0%" stopColor={paperShadeColor} />
              <stop offset="70%" stopColor={paperColor} />
              <stop offset="100%" stopColor={paperColor} />
            </linearGradient>
            {/* ケバ・影を有機的に波打たせる変位 */}
            <filter
              id={`rough${uid}`}
              x="-5%"
              y="-15%"
              width="110%"
              height="130%"
            >
              <feTurbulence
                type="turbulence"
                baseFrequency="0.045 0.12"
                numOctaves="2"
                seed={seed}
                result="t"
              />
              <feDisplacementMap in="SourceGraphic" in2="t" scale="12" />
            </filter>
            <filter
              id={`roughSoft${uid}`}
              x="-5%"
              y="-15%"
              width="110%"
              height="130%"
            >
              <feTurbulence
                type="turbulence"
                baseFrequency="0.06 0.16"
                numOctaves="2"
                seed={seed + 3}
                result="t"
              />
              <feDisplacementMap in="SourceGraphic" in2="t" scale="9" />
              <feGaussianBlur stdDeviation="0.6" />
            </filter>
            {/* 紙の微細な質感 */}
            <filter id={`grain${uid}`} x="0" y="0" width="100%" height="100%">
              <feTurbulence
                type="fractalNoise"
                baseFrequency="0.75"
                numOctaves="2"
                seed={seed + 7}
              />
              <feColorMatrix
                type="matrix"
                values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0.8 0.8 0.8 0 0"
              />
            </filter>
            <clipPath id={`papers${uid}`}>
              <path d={topBody} />
              <path d={botBody} />
            </clipPath>
          </defs>

          {/* 落ち影（奥の映像へ落ちる暗い縁） */}
          <g filter={`url(#roughSoft${uid})`} opacity={0.92}>
            <path d={topShadowPath} fill={shadowColor} />
            <path d={botShadowPath} fill={shadowColor} />
          </g>
          {/* 紙繊維のケバ（白） */}
          <g filter={`url(#rough${uid})`}>
            <path d={topFiberPath} fill={fiberColor} />
            <path d={botFiberPath} fill={fiberColor} />
          </g>
          {/* 紙本体 */}
          <path d={topBody} fill={`url(#pgTop${uid})`} />
          <path d={botBody} fill={`url(#pgBot${uid})`} />
          {/* 紙の質感 */}
          <rect
            x={0}
            y={0}
            width={width}
            height={height}
            filter={`url(#grain${uid})`}
            clipPath={`url(#papers${uid})`}
            opacity={0.05}
          />
        </svg>

        {/* 紙面のごく淡い環境光（左上が明るい） */}
        <AbsoluteFill
          style={{
            background: `radial-gradient(${width * 0.9}px ${height * 0.9}px at 30% 20%, rgba(255,255,255,0.10), rgba(0,0,0,0.06) 85%)`,
            pointerEvents: "none",
          }}
        />
      </AbsoluteFill>

      {/* 明転・暗転 */}
      <AbsoluteFill
        style={{ background: fadeColor, opacity: 1 - brightness }}
      />
    </AbsoluteFill>
  );
};

export default BackgroundTornReveal10;
