import React, { useId, useMemo } from "react";
import { AbsoluteFill, random, useCurrentFrame, useVideoConfig } from "remotion";

/**
 * BackgroundStage05 — クリーンルーム再実装
 *
 * 漆黒の画面に縦長の「ステージ窓」パネルが並び、ライブ会場風の暖色スポット光と
 * ヘイズ（もや）、逆光に浮かぶ演者のシルエットがゆっくり揺れるフィルムルック背景。
 * バンド/ライブ系リリックビデオの下地に向く。
 *
 * 構成:
 * - パネル: 深い焦げ茶→琥珀の放射グラデをベースに、クリーム色の大きな
 *   スポットグロー（screen 合成）がゆっくりドリフト＋微フリッカー
 * - シルエット: 頭部＋肩のシルエットを強めのブラーで「すりガラス越し」に。
 *   ごく遅い横揺れ・上下のボブで生きている気配を出す
 * - フットライト: パネル内に暖色の小さな光点列（個別フリッカー、たまに白っぽい球）
 * - フィルムルック: 手続き生成グレイン（feTurbulence）、ダスト斑点、
 *   まれに現れる縦スクラッチ
 *
 * 機能記述「暖色のステージ光と演者のシルエット影が動く背景」を出発点に、
 * 旧レンダリング（見た目のものさし）と同等以上の質感を白紙から構成したもの。
 *
 * テキストを一切描画しないためフォントに依存せず、そのまま配布可能。
 */

/** 1枚のステージ窓パネルの仕様（座標・寸法はコンポジションに対する 0..1 の割合） */
export type StagePanelSpec = {
  /** パネル左端（コンポジション幅に対する割合 0..1） */
  x: number;
  /** パネル上端（コンポジション高さに対する割合 0..1） */
  y: number;
  /** パネル幅（コンポジション幅に対する割合 0..1） */
  width: number;
  /** パネル高さ（コンポジション高さに対する割合 0..1） */
  height: number;
  /** スポット光の基準位置X（パネル内 0..1） */
  lightX?: number;
  /** スポット光の基準位置Y（パネル内 0..1） */
  lightY?: number;
  /** スポット光の大きさ（パネル幅に対する割合。0.5 ≒ パネル幅の半分が光の半径） */
  lightSize?: number;
  /** シルエット（頭部中心）のX位置（パネル内 0..1） */
  silhouetteX?: number;
  /** シルエット（頭部中心）のY位置（パネル内 0..1） */
  silhouetteY?: number;
  /** シルエットの大きさ倍率（1 = 標準） */
  silhouetteScale?: number;
  /** フットライト（光点列）を表示するか */
  footlights?: boolean;
  /** フットライトのY位置（パネル内 0..1） */
  footlightY?: number;
  /** フットライトの左右スパン（パネル内 0..1 の [開始, 終了]） */
  footlightSpan?: [number, number];
  /** このパネル固有の位相（揺れ・ドリフトのタイミングをずらす） */
  phase?: number;
};

export type BackgroundStage05Props = {
  /** ステージ窓パネルのレイアウト。省略時は「左に小・右に大」の2枚 */
  panels?: StagePanelSpec[];
  /** 画面全体の地色（漆黒） */
  backgroundColor?: string;
  /** パネルの最暗部（焦げ茶） */
  deepColor?: string;
  /** ヘイズの中間色（琥珀） */
  hazeColor?: string;
  /** スポット光の芯の色（クリーム） */
  glowColor?: string;
  /** シルエットの色（ほぼ黒の焦げ茶） */
  silhouetteColor?: string;
  /** フットライトの色 */
  footlightColor?: string;
  /** フットライトの個数 */
  footlightCount?: number;
  /** 全体の動きの速さ倍率（1 = 標準） */
  speed?: number;
  /** スポット光のドリフト量（0 = 固定, 1 = 標準） */
  driftAmount?: number;
  /** シルエットの揺れ量（0 = 固定, 1 = 標準） */
  swayAmount?: number;
  /** 光の明滅の強さ（0 = なし, 1 = 標準） */
  flickerAmount?: number;
  /** パネル自体の微ドリフト量（px） */
  panelDrift?: number;
  /** フィルムグレインの濃さ（0 = なし） */
  grainOpacity?: number;
  /** ダスト斑点のおおよその個数 */
  dustAmount?: number;
  /** 縦スクラッチの出現しやすさ（0 = なし, 1 = 頻繁） */
  scratchChance?: number;
  /** 乱数シード（ダスト・フリッカーの個体差を変える） */
  seed?: number;
};

const DEFAULT_PANELS: StagePanelSpec[] = [
  {
    // 左: 小さめの窓
    x: 0.152,
    y: 0.185,
    width: 0.203,
    height: 0.655,
    lightX: 0.44,
    lightY: 0.4,
    lightSize: 0.78,
    silhouetteX: 0.73,
    silhouetteY: 0.56,
    silhouetteScale: 1,
    footlights: false,
    phase: 0.15,
  },
  {
    // 右: 大きめの窓（フットライトあり）
    x: 0.527,
    y: 0.062,
    width: 0.328,
    height: 0.882,
    lightX: 0.68,
    lightY: 0.24,
    lightSize: 0.7,
    silhouetteX: 0.69,
    silhouetteY: 0.57,
    silhouetteScale: 1.05,
    footlights: true,
    footlightY: 0.49,
    footlightSpan: [0.24, 0.93],
    phase: 0.62,
  },
];

/** 2つの正弦波を重ねた、有機的なゆらぎ（-1..1 くらい） */
const wobble = (t: number, p1: number, p2: number, phase: number): number =>
  0.65 * Math.sin(2 * Math.PI * (t / p1) + phase * 7.1) +
  0.35 * Math.sin(2 * Math.PI * (t / p2) + phase * 3.7 + 1.3);

export const BackgroundStage05: React.FC<BackgroundStage05Props> = ({
  panels = DEFAULT_PANELS,
  backgroundColor = "#040303",
  deepColor = "#180d04",
  hazeColor = "#8f5f2a",
  glowColor = "#fceccb",
  silhouetteColor = "#140b04",
  footlightColor = "#ffd9a2",
  footlightCount = 9,
  speed = 1,
  driftAmount = 1,
  swayAmount = 1,
  flickerAmount = 1,
  panelDrift = 7,
  grainOpacity = 0.055,
  dustAmount = 5,
  scratchChance = 0.18,
  seed = 5,
}) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const grainId = useId();
  const t = (frame / fps) * speed; // 秒（速度倍率込み）

  // ─── ダスト斑点（フィルムに付いた塵。短命で位置が飛ぶ） ───
  const dust = useMemo(() => {
    const specks: {
      key: string;
      x: number;
      y: number;
      size: number;
      opacity: number;
    }[] = [];
    for (let i = 0; i < dustAmount; i++) {
      const life = 14 + Math.floor(random(`bs05-dust-life-${seed}-${i}`) * 10);
      const epoch = Math.floor((frame + i * 11) / life);
      const k = `bs05-dust-${seed}-${i}-${epoch}`;
      if (random(`${k}-on`) < 0.45) {
        continue; // このサイクルは休眠
      }
      const local = (frame + i * 11) % life;
      const fade = Math.min(1, Math.min(local, life - local) / 3);
      specks.push({
        key: `${i}-${epoch}`,
        x: random(`${k}-x`),
        y: random(`${k}-y`),
        size: 1.5 + random(`${k}-s`) * 2.6,
        opacity: (0.25 + random(`${k}-o`) * 0.4) * fade,
      });
    }
    return specks;
  }, [frame, dustAmount, seed]);

  // ─── 縦スクラッチ（まれに数フレームだけ現れる細い傷） ───
  const scratches = useMemo(() => {
    const lines: {
      key: string;
      x: number;
      y: number;
      len: number;
      opacity: number;
    }[] = [];
    for (let i = 0; i < 2; i++) {
      const epoch = Math.floor((frame + i * 5) / 9);
      const k = `bs05-scr-${seed}-${i}-${epoch}`;
      if (random(`${k}-on`) < scratchChance) {
        lines.push({
          key: `${i}-${epoch}`,
          x: random(`${k}-x`),
          y: 0.1 + random(`${k}-y`) * 0.7,
          len: 30 + random(`${k}-l`) * 60,
          opacity: 0.2 + random(`${k}-o`) * 0.25,
        });
      }
    }
    return lines;
  }, [frame, scratchChance, seed]);

  return (
    <AbsoluteFill style={{ backgroundColor, overflow: "hidden" }}>
      {panels.map((panel, pi) => {
        const phase = panel.phase ?? pi * 0.4;
        const pw = panel.width * width;
        const ph = panel.height * height;

        // パネル自体のごく遅いドリフト
        const px =
          panel.x * width + panelDrift * wobble(t, 17, 29, phase + 0.2);
        const py =
          panel.y * height + panelDrift * 0.7 * wobble(t, 23, 37, phase + 0.8);

        // スポット光のドリフト（数秒〜十数秒かけて窓の中を横切る）
        const lightX =
          (panel.lightX ?? 0.55) + 0.2 * driftAmount * wobble(t, 21, 34, phase);
        const lightY =
          (panel.lightY ?? 0.3) +
          0.09 * driftAmount * wobble(t, 27, 41, phase + 2.1);
        const lightSize = panel.lightSize ?? 0.6;

        // 光の明滅（ランプの息づかい程度の微フリッカー）
        const flicker =
          1 +
          flickerAmount *
            (0.05 * Math.sin(2 * Math.PI * t * 1.7 + phase * 9) +
              0.035 * Math.sin(2 * Math.PI * t * 3.9 + phase * 5) +
              0.02 * (random(`bs05-flk-${seed}-${pi}-${frame}`) - 0.5));
        const glowOpacity = Math.max(0, Math.min(1, 0.92 * flicker));

        // シルエットの揺れ（横スウェイ＋わずかな上下ボブ）
        const swayX = pw * 0.055 * swayAmount * wobble(t, 13, 22, phase + 4.2);
        const swayY = ph * 0.016 * swayAmount * wobble(t, 9, 15, phase + 1.1);
        const sScale = panel.silhouetteScale ?? 1;
        const headW = pw * 0.24 * sScale;
        const headH = headW * 1.22;
        const headCX = (panel.silhouetteX ?? 0.7) * pw + swayX;
        const headCY = (panel.silhouetteY ?? 0.56) * ph + swayY;
        const bodyW = pw * 0.62 * sScale;
        const bodyH = ph * 0.52 * sScale;

        // フットライト
        const span = panel.footlightSpan ?? [0.24, 0.93];
        const flY = (panel.footlightY ?? 0.49) * ph;
        const dotSize = Math.max(5, pw * 0.012);

        return (
          <div
            key={pi}
            style={{
              position: "absolute",
              left: px,
              top: py,
              width: pw,
              height: ph,
              overflow: "hidden",
              // ベースのヘイズ: 焦げ茶の地に琥珀のもや
              backgroundImage: `radial-gradient(115% 92% at ${lightX * 100}% ${
                lightY * 100 + 16
              }%, ${hazeColor} 0%, ${deepColor} 78%)`,
              backgroundColor: deepColor,
              boxShadow: `inset 0 0 ${pw * 0.16}px rgba(0,0,0,0.55)`,
            }}
          >
            {/* 広いアンビエント光（もやの明るみ、なめらかな多段フォールオフ） */}
            <div
              style={{
                position: "absolute",
                inset: 0,
                backgroundImage: `radial-gradient(${lightSize * 122}% ${
                  lightSize * 98
                }% at ${lightX * 100}% ${lightY * 100}%, rgba(255,216,152,0.5) 0%, rgba(205,140,64,0.28) 28%, rgba(140,88,36,0.13) 52%, rgba(40,24,10,0.03) 74%, rgba(0,0,0,0) 90%)`,
                opacity: glowOpacity,
              }}
            />
            {/* スポット光の芯（screen 合成でふわっと飛ばす） */}
            <div
              style={{
                position: "absolute",
                inset: 0,
                backgroundImage: `radial-gradient(${lightSize * 70}% ${
                  lightSize * 54
                }% at ${lightX * 100}% ${lightY * 100}%, ${glowColor} 0%, rgba(246,205,138,0.8) 20%, rgba(226,158,84,0.5) 42%, rgba(160,100,44,0.22) 64%, rgba(0,0,0,0) 88%)`,
                mixBlendMode: "screen",
                opacity: glowOpacity,
                filter: `blur(${pw * 0.02}px)`,
              }}
            />

            {/* フットライト（光点列） */}
            {panel.footlights &&
              Array.from({ length: footlightCount }, (_, di) => {
                const fx =
                  (span[0] +
                    ((span[1] - span[0]) * di) /
                      Math.max(1, footlightCount - 1)) *
                  pw;
                const cool =
                  random(`bs05-fl-cool-${seed}-${pi}-${di}`) > 0.78;
                const dotColor = cool ? "#e9e7df" : footlightColor;
                const twinkle =
                  0.75 +
                  0.25 *
                    Math.sin(
                      2 * Math.PI * t * (1.1 + di * 0.23) + di * 2.4 + phase,
                    );
                return (
                  <div
                    key={di}
                    style={{
                      position: "absolute",
                      left: fx - dotSize / 2,
                      top: flY - dotSize / 2,
                      width: dotSize,
                      height: dotSize,
                      borderRadius: "50%",
                      backgroundColor: dotColor,
                      boxShadow: `0 0 ${dotSize * 1.1}px ${
                        dotSize * 0.25
                      }px ${dotColor}`,
                      opacity: 0.55 + 0.45 * twinkle * glowOpacity,
                    }}
                  />
                );
              })}

            {/* 演者シルエット（すりガラス越しの逆光） */}
            <div
              style={{
                position: "absolute",
                inset: 0,
                filter: `blur(${pw * 0.018}px)`,
              }}
            >
              {/* 頭部 */}
              <div
                style={{
                  position: "absolute",
                  left: headCX - headW / 2,
                  top: headCY - headH / 2,
                  width: headW,
                  height: headH,
                  borderRadius: "50%",
                  backgroundColor: silhouetteColor,
                  opacity: 0.88,
                }}
              />
              {/* 肩〜胴 */}
              <div
                style={{
                  position: "absolute",
                  left: headCX - bodyW / 2,
                  top: headCY + headH * 0.32,
                  width: bodyW,
                  height: bodyH,
                  borderRadius: "50% 50% 24% 24%",
                  backgroundColor: silhouetteColor,
                  opacity: 0.8,
                  filter: `blur(${pw * 0.03}px)`,
                }}
              />
            </div>

            {/* パネル内の締め（下端と縁を沈めるビネット） */}
            <div
              style={{
                position: "absolute",
                inset: 0,
                backgroundImage: `linear-gradient(to bottom, rgba(0,0,0,0.16) 0%, rgba(0,0,0,0) 20%, rgba(0,0,0,0) 62%, rgba(0,0,0,0.42) 100%), radial-gradient(110% 96% at ${
                  lightX * 100
                }% ${lightY * 100}%, rgba(0,0,0,0) 48%, rgba(5,2,1,0.52) 100%)`,
              }}
            />
          </div>
        );
      })}

      {/* ダスト斑点 */}
      {dust.map((d) => (
        <div
          key={d.key}
          style={{
            position: "absolute",
            left: d.x * width,
            top: d.y * height,
            width: d.size,
            height: d.size,
            borderRadius: "50%",
            backgroundColor: "#d8d4cc",
            opacity: d.opacity,
          }}
        />
      ))}

      {/* 縦スクラッチ */}
      {scratches.map((s) => (
        <div
          key={s.key}
          style={{
            position: "absolute",
            left: s.x * width,
            top: s.y * height,
            width: 1.4,
            height: s.len,
            backgroundColor: "#cfcac0",
            opacity: s.opacity,
            transform: "rotate(3deg)",
          }}
        />
      ))}

      {/* フィルムグレイン（毎フレーム seed を更新） */}
      {grainOpacity > 0 && (
        <svg
          width="100%"
          height="100%"
          style={{
            position: "absolute",
            inset: 0,
            opacity: grainOpacity,
            mixBlendMode: "overlay",
          }}
        >
          <filter id={grainId}>
            <feTurbulence
              type="fractalNoise"
              baseFrequency="0.9"
              numOctaves={2}
              seed={frame % 997}
              stitchTiles="stitch"
            />
            <feColorMatrix type="saturate" values="0" />
          </filter>
          <rect width="100%" height="100%" filter={`url(#${grainId})`} />
        </svg>
      )}
    </AbsoluteFill>
  );
};

export default BackgroundStage05;
