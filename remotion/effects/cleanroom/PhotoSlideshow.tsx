import React, { useMemo } from "react";
import {
  AbsoluteFill,
  Easing,
  interpolate,
  random,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

/**
 * PhotoSlideshow（クリーンルーム再実装）
 * 「紙に留めた退色スナップ写真が切り替わるスライドショー」
 *
 * children（footage）を、黒い机の上にテープで留めた
 * 「紙プリントの退色フィルム写真」として提示するラッパー効果。
 * - 白フチの印画紙 + 内側はシネスコ調の黒マット（レターボックス）
 * - 退色グレード（セピア寄りの色抜け・持ち上がった黒・淡いコントラスト）
 * - 四隅のセロハンテープ / 折れ目クリース / グレイン+白埃 / ビネット
 * - 入り: 白フラッシュ（明滅つき）+ 上からのドロップ着地（回転オーバーシュート）
 * - 抜け: 終端で加速しながら下方向へスライドアウト + 減光
 *
 * レイアウト・色・タイミングはすべて props のつまみで、既定値のままで完成形。
 */

export type PhotoSlideshowTape = {
  /** 紙に対する左位置（紙幅の%） */
  x: number;
  /** 紙に対する上位置（紙高の%） */
  y: number;
  /** 紙幅に対するテープ幅（%） */
  width: number;
  /** 紙高に対するテープ高さ（%） */
  height: number;
  /** テープの傾き（度） */
  rotateDeg: number;
};

export type PhotoSlideshowProps = {
  children: React.ReactNode;
  durationInFrames: number;
  /** 全体の効き（0-1目安）。退色/フラッシュ強度に掛かる */
  intensity?: number;

  // ---- レイアウト ----
  /** 背景（机）色 */
  backgroundColor?: string;
  /** 印画紙のフチ色 */
  paperColor?: string;
  /** 紙の幅（コンポ幅に対する%） */
  paperWidthPct?: number;
  /** 紙の高さ（コンポ高に対する%） */
  paperHeightPct?: number;
  /** 白フチの太さ（コンポ短辺に対する%） */
  borderPct?: number;
  /** 紙の位置オフセット（px, 中央基準） */
  posX?: number;
  posY?: number;
  /** 静止時の傾き（度）。マイナスで反時計回り */
  restRotateDeg?: number;
  /** 紙の角丸(px) */
  cornerRadius?: number;

  // ---- 写真マット ----
  /** レターボックス帯のアスペクト比（幅/高さ） */
  matteAspect?: number;
  /** マット（帯の上下）色 */
  matteColor?: string;

  // ---- 退色ルック ----
  /** 退色の強さ 0-1 */
  fadeAmount?: number;
  /** 暖色（茶褐色）寄せの強さ 0-1 */
  warmth?: number;
  /** グレインの強さ 0-1 */
  grainAmount?: number;
  /** 白埃の量 0-1 */
  dustAmount?: number;
  /** ビネットの強さ 0-1 */
  vignetteStrength?: number;
  /** 折れ目クリースの強さ 0-1 */
  creaseStrength?: number;

  // ---- テープ ----
  /** テープの不透明度 0-1 */
  tapeOpacity?: number;
  /** テープ色 */
  tapeColor?: string;
  /** テープ配置の差し替え（null/省略で既定4枚） */
  tapes?: PhotoSlideshowTape[] | null;

  // ---- タイミング ----
  /** 入りの白フラッシュのフレーム数 */
  flashFrames?: number;
  /** ドロップ着地のフレーム数 */
  dropFrames?: number;
  /** 抜けスライドのフレーム数 */
  exitFrames?: number;
  /** 抜けの方向 */
  exitTo?: "down" | "left" | "right";
};

/** 既定のテープ4枚（上2・右1・下1）。座標は紙に対する% */
const DEFAULT_TAPES: PhotoSlideshowTape[] = [
  { x: 37.5, y: -2.6, width: 9.5, height: 5.2, rotateDeg: 5 },
  { x: 53.5, y: -2.2, width: 8.5, height: 5.6, rotateDeg: -6 },
  { x: 95.0, y: 16.0, width: 9.0, height: 5.4, rotateDeg: 33 },
  { x: 46.5, y: 95.4, width: 8.8, height: 5.2, rotateDeg: -4 },
];

/** 粒状ノイズ（白）のSVGタイル。seedを変えるとパターンが揺れる */
const grainTile = (seed: number): string => {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="220" height="220"><filter id="g"><feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" seed="${seed}" stitchTiles="stitch"/><feColorMatrix type="matrix" values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0.55 0.55 0.55 0 0"/></filter><rect width="220" height="220" filter="url(#g)"/></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
};

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

export const PhotoSlideshow: React.FC<PhotoSlideshowProps> = ({
  children,
  durationInFrames,
  intensity = 1,
  backgroundColor = "#0b0a09",
  paperColor = "#f1ecdd",
  paperWidthPct = 90.5,
  paperHeightPct = 90,
  borderPct = 2.7,
  posX = 0,
  posY = 0,
  restRotateDeg = -1.1,
  cornerRadius = 8,
  matteAspect = 2.2,
  matteColor = "#050505",
  fadeAmount = 0.75,
  warmth = 0.65,
  grainAmount = 0.5,
  dustAmount = 0.5,
  vignetteStrength = 0.6,
  creaseStrength = 0.5,
  tapeOpacity = 0.36,
  tapeColor = "255, 255, 255",
  tapes = null,
  flashFrames = 10,
  dropFrames = 10,
  exitFrames = 14,
  exitTo = "down",
}) => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();

  const k = clamp01(intensity);
  const fade = clamp01(fadeAmount * k);
  const warm = clamp01(warmth * k);

  // ---- 幾何 ----
  const paperW = (width * paperWidthPct) / 100;
  const paperH = (height * paperHeightPct) / 100;
  const paperLeft = (width - paperW) / 2 + posX;
  const paperTop = (height - paperH) / 2 + posY;
  const borderPx = (Math.min(width, height) * borderPct) / 100;
  const innerW = paperW - borderPx * 2;
  const innerH = paperH - borderPx * 2;
  const bandH = Math.min(innerH, innerW / matteAspect);
  const bandTop = (innerH - bandH) / 2;

  // ---- 入り: 白フラッシュ（明滅しながら減衰） ----
  const ff = Math.max(1, flashFrames);
  const flashBase = interpolate(
    frame,
    [0, ff * 0.4, ff * 0.6, ff * 0.8, ff],
    [0.88, 0.84, 0.52, 0.22, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );
  // 明滅: 減衰中に2フレーム周期で薄く揺らす
  const blink =
    frame < ff ? (Math.floor(frame) % 2 === 0 ? 0.05 : -0.04) : 0;
  const flash = clamp01((flashBase + blink * (flashBase > 0 ? 1 : 0)) * k);

  // ---- 入り: ドロップ着地（スケール+回転のオーバーシュート） ----
  const df = Math.max(1, dropFrames);
  const dropScale = interpolate(frame, [0, df * 0.75, df * 1.3], [1.12, 0.996, 1], {
    easing: Easing.out(Easing.cubic),
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const dropRotate = interpolate(
    frame,
    [0, df * 0.65, df * 1.1, df * 1.6],
    [restRotateDeg - 2.3, restRotateDeg + 0.45, restRotateDeg - 0.15, restRotateDeg],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );

  // ---- 抜け: 加速スライドアウト + 減光 ----
  const ef = Math.max(1, exitFrames);
  const exitStart = Math.max(0, durationInFrames - ef - 2);
  const exitP = interpolate(frame, [exitStart, exitStart + ef], [0, 1], {
    easing: Easing.in(Easing.cubic),
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const exitX =
    exitTo === "left" ? -exitP * width * 1.6 : exitTo === "right" ? exitP * width * 1.6 : 0;
  const exitY = exitTo === "down" ? exitP * height * 1.55 : 0;
  const exitRotate = exitP * -1.6;
  const exitDim = exitP * 0.55;

  const rotate = dropRotate + exitRotate;

  // ---- 白埃（フレームごとに瞬く。決定論的乱数） ----
  const dustCount = Math.round(16 * clamp01(dustAmount));
  const dustBucket = Math.floor(frame / 3);
  const dust = useMemo(() => {
    const specks: Array<{ x: number; y: number; w: number; h: number; o: number; r: number }> = [];
    for (let i = 0; i < dustCount; i++) {
      const on = random(`ps-dust-on-${dustBucket}-${i}`) < 0.55;
      if (!on) continue;
      specks.push({
        x: random(`ps-dust-x-${dustBucket}-${i}`) * 100,
        y: random(`ps-dust-y-${dustBucket}-${i}`) * 100,
        w: 1 + random(`ps-dust-w-${dustBucket}-${i}`) * 3,
        h: 1 + random(`ps-dust-h-${dustBucket}-${i}`) * 6,
        o: 0.12 + random(`ps-dust-o-${dustBucket}-${i}`) * 0.3,
        r: random(`ps-dust-r-${dustBucket}-${i}`) * 180,
      });
    }
    return specks;
  }, [dustBucket, dustCount]);

  // グレインはゆっくり揺らす（3フレーム周期でタイル差し替え）
  const grainSeed = 1 + (Math.floor(frame / 3) % 5);
  const grainUri = useMemo(() => grainTile(grainSeed), [grainSeed]);

  const tapeSpecs = tapes ?? DEFAULT_TAPES;

  // ---- 退色グレード ----
  const gradeFilter = [
    `sepia(${(0.34 * fade).toFixed(3)})`,
    `saturate(${(1 + 0.08 * warm - 0.18 * fade).toFixed(3)})`,
    `contrast(${(1 - 0.16 * fade).toFixed(3)})`,
    `brightness(${(1 - 0.06 * fade).toFixed(3)})`,
    `blur(1px)`,
  ].join(" ");

  return (
    <AbsoluteFill style={{ backgroundColor }}>
      {/* 印画紙（テープごと動く） */}
      <div
        style={{
          position: "absolute",
          left: paperLeft,
          top: paperTop,
          width: paperW,
          height: paperH,
          transform: `translate(${exitX}px, ${exitY}px) rotate(${rotate}deg) scale(${dropScale})`,
          transformOrigin: "50% 46%",
          backgroundColor: paperColor,
          borderRadius: cornerRadius,
          boxShadow: "0 14px 46px rgba(0,0,0,0.5)",
        }}
      >
        {/* 写真面（黒マット + レターボックス帯の footage） */}
        <div
          style={{
            position: "absolute",
            left: borderPx,
            top: borderPx,
            width: innerW,
            height: innerH,
            backgroundColor: matteColor,
            overflow: "hidden",
            borderRadius: Math.max(0, cornerRadius - 6),
          }}
        >
          {/* footage 帯 */}
          <div
            style={{
              position: "absolute",
              left: 0,
              top: bandTop,
              width: innerW,
              height: bandH,
              overflow: "hidden",
              filter: gradeFilter,
            }}
          >
            <AbsoluteFill>{children}</AbsoluteFill>
            {/* 暖色トーン（茶褐色寄せ・中間調を焼く） */}
            <AbsoluteFill
              style={{
                backgroundColor: `rgba(188, 122, 48, ${0.3 * warm})`,
                mixBlendMode: "overlay",
              }}
            />
            {/* 淡い暖色ハズ（全体を退色させる） */}
            <AbsoluteFill
              style={{ backgroundColor: `rgba(196, 152, 96, ${0.1 * warm})` }}
            />
            {/* 黒の持ち上げ（ミルキーな退色） */}
            <AbsoluteFill
              style={{ backgroundColor: `rgba(232, 222, 202, ${0.07 * fade})` }}
            />
          </div>

          {/* ビネット */}
          <AbsoluteFill
            style={{
              background: `radial-gradient(ellipse 74% 70% at 50% 48%, rgba(0,0,0,0) 48%, rgba(0,0,0,${
                0.52 * clamp01(vignetteStrength)
              }) 100%)`,
            }}
          />

          {/* 折れ目クリース（横一本 + 縦の淡い一本） */}
          <div
            style={{
              position: "absolute",
              left: "-2%",
              top: "36.5%",
              width: "104%",
              height: 3,
              transform: "rotate(-0.5deg)",
              background:
                "linear-gradient(180deg, rgba(255,255,255,0.09) 0%, rgba(0,0,0,0.12) 100%)",
              opacity: clamp01(creaseStrength),
            }}
          />
          <div
            style={{
              position: "absolute",
              left: "63%",
              top: "-2%",
              width: 2,
              height: "104%",
              transform: "rotate(0.6deg)",
              background:
                "linear-gradient(90deg, rgba(255,255,255,0.05) 0%, rgba(0,0,0,0.07) 100%)",
              opacity: 0.7 * clamp01(creaseStrength),
            }}
          />

          {/* グレイン */}
          <AbsoluteFill
            style={{
              backgroundImage: `url("${grainUri}")`,
              backgroundRepeat: "repeat",
              mixBlendMode: "overlay",
              opacity: 0.5 * clamp01(grainAmount),
            }}
          />

          {/* 白埃 */}
          {dust.map((d, i) => (
            <div
              key={i}
              style={{
                position: "absolute",
                left: `${d.x}%`,
                top: `${d.y}%`,
                width: d.w,
                height: d.h,
                borderRadius: 2,
                backgroundColor: `rgba(255,255,250,${d.o})`,
                transform: `rotate(${d.r}deg)`,
              }}
            />
          ))}
        </div>

        {/* セロハンテープ */}
        {tapeSpecs.map((t, i) => (
          <div
            key={i}
            style={{
              position: "absolute",
              left: `${t.x}%`,
              top: `${t.y}%`,
              width: `${t.width}%`,
              height: `${t.height}%`,
              transform: `rotate(${t.rotateDeg}deg)`,
              background: `linear-gradient(90deg, rgba(${tapeColor}, ${
                tapeOpacity * 0.82
              }) 0%, rgba(${tapeColor}, ${tapeOpacity}) 45%, rgba(${tapeColor}, ${
                tapeOpacity * 0.75
              }) 100%)`,
              boxShadow:
                "inset 0 0 1px rgba(255,255,255,0.5), 0 1px 2px rgba(0,0,0,0.22)",
            }}
          />
        ))}

        {/* 抜けの減光（紙ごと暗くなる） */}
        {exitDim > 0 && (
          <AbsoluteFill
            style={{
              backgroundColor: `rgba(0,0,0,${exitDim})`,
              borderRadius: cornerRadius,
            }}
          />
        )}
      </div>

      {/* 入りの白フラッシュ（全面） */}
      {flash > 0 && (
        <AbsoluteFill style={{ backgroundColor: `rgba(255,255,255,${flash})` }} />
      )}
    </AbsoluteFill>
  );
};
