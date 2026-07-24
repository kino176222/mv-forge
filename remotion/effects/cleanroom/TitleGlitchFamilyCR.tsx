import React from "react";
import {
  AbsoluteFill,
  useCurrentFrame,
  useVideoConfig,
  interpolate,
  spring,
} from "remotion";
import { loadFont as loadInter } from "@remotion/google-fonts/Inter";
import { loadFont as loadNotoSansJP } from "@remotion/google-fonts/NotoSansJP";
import type { XpLineStyle } from "./line-styles";

// 配布ビルドでローカルフォント（Helvetica 等）に依存しないよう、
// ラテンは Inter 700、和文グリフは Noto Sans JP 700 で受ける。
const { fontFamily: INTER } = loadInter("normal", {
  weights: ["700"],
  subsets: ["latin", "latin-ext"],
});
const { fontFamily: NOTO_SANS_JP } = loadNotoSansJP("normal", {
  weights: ["700"],
  subsets: ["japanese", "latin"],
});

/**
 * TitleGlitchFamilyCR — グリッチ見出し（RGBずれ／走査線／ブロックノイズ／文字化け）。
 *
 * クリーンルーム実装（機能記述と旧レンダのポスターの見た目のみを根拠に白紙から作成。
 * 機能記述だけから実装している）。
 *
 * 共通の流れ: 入場でノイズが最大 → 保持中は時折バーストする残留グリッチ →
 * 退場で再びノイズが膨らみながら最終数フレームで拭き取る。主役テキストは
 * 最終2フレームを除き常に画面に存在するため renderStill で空フレームにならない。
 *
 * variant(0..1) で【5種】のプリセットに分岐する（1コンポで title-glitch 系22本を賄う）:
 *   - 0.00–0.15 : RGB DISPLACE  … 上品な色収差。R/G/Bチャンネルがわずかにずれて整う（glitch-01系）
 *   - 0.15–0.375: CHROMA CHAOS  … 激しい色収差＋行単位の水平テア。汚し強め（glitch-27系）
 *   - 0.375–0.625: SCANLINE CRT … 走査線マスク＋転がる輝線バンド＋縦ロール。ブラウン管質感
 *   - 0.625–0.85 : BLOCK NOISE  … テキストを横帯にスライスし各帯を水平ずらし。データモッシュ風
 *   - 0.85–1.00  : DECODE       … 文字化けグリフが左から順に本来の文字へ解決（和文/ラテン両対応）
 *
 * すべての省略可プロップに既定値があり、text と durationInFrames だけで完成する
 * （XpTitleProps 互換）。決定論的（Math.random/Date は不使用、useCurrentFrame ベース）。
 */
export type TitleGlitchFamilyCRProps = {
  /** 表示する文言（1行想定。\n を含んでも複数行として描画される） */
  text: string;
  /** この見出しが画面に居る総フレーム数 */
  durationInFrames: number;
  /** 文字サイズ(px) */
  fontSize?: number;
  /** フォント。既定は Inter+NotoSansJP フォールバック */
  fontFamily?: string;
  /** 0..1。5種のプリセットへ振り分ける */
  variant?: number;
  /** 主役テキストの基調色（DISPLACE/CHAOS ではRGB分解が主役のため主に発光色に影響） */
  color?: string;
  /** 行（\n）単位の色上書き。基調色プレートにのみ適用（RGB分解チャンネルは維持） */
  lineStyles?: XpLineStyle[];
};

const clamp01 = (t: number): number => Math.min(1, Math.max(0, t));

/** sin ベースの決定論的擬似乱数 0..1（Math.random 代替） */
const rand = (seed: number): number => {
  const x = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};
/** -1..1 版 */
const srand = (seed: number): number => rand(seed) * 2 - 1;

/** 文字化け用グリフプール（ラテン・数字・記号・カタカナを混在） */
const GLYPHS =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#%&@$*!?/\\<>=+アイウエオカキクケコサシスセソタチツテトナニヌネノ";

export const TitleGlitchFamilyCR: React.FC<TitleGlitchFamilyCRProps> = ({
  text,
  durationInFrames,
  fontSize = 190,
  fontFamily = `'${INTER}', '${NOTO_SANS_JP}', sans-serif`,
  variant = 0,
  color = "#ffffff",
  lineStyles,
}) => {
  const frame = useCurrentFrame();
  const { width, height, fps } = useVideoConfig();

  // ---- プリセット選択 ---------------------------------------------------
  const v = clamp01(variant);
  const preset =
    v < 0.15 ? 0 : v < 0.375 ? 1 : v < 0.625 ? 2 : v < 0.85 ? 3 : 4;

  // ---- タイムライン -----------------------------------------------------
  const enterStart = 2;
  const enterDur = Math.min(20, Math.max(6, Math.round(durationInFrames * 0.35)));
  const enterEnd = enterStart + enterDur;
  const exitDur = Math.min(16, Math.max(5, Math.round(durationInFrames * 0.28)));
  const exitStart = Math.max(enterEnd + 1, durationInFrames - exitDur);

  // 入場: 1→0 で沈静化 / 退場: 0→1 で再燃
  const entryGlitch = 1 - clamp01((frame - enterStart) / enterDur);
  const exitGlitch = clamp01((frame - exitStart) / Math.max(1, exitDur));

  // 保持中の散発バースト（6フレーム量子化・確率的に発火）
  const inHold = frame > enterEnd && frame < exitStart;
  const burstSeed = Math.floor(frame / 6);
  const holdBurst =
    inHold && rand(burstSeed * 1.7 + 4.1) > 0.82
      ? 0.35 + 0.45 * rand(burstSeed * 2.3 + 9.9)
      : 0;

  // 総グリッチ強度
  const g = Math.max(entryGlitch, exitGlitch, holdBurst);

  // 最終2フレームで確実に消す（残留ゴーストの拭き取り）
  const tailFade = 1 - clamp01((frame - (durationInFrames - 2)) / 2);

  // 入場で全体がフッと立ち上がる不透明度の下限（空フレーム防止のため0.35で床止め）
  const revealFloor = interpolate(
    frame,
    [enterStart, enterStart + 3],
    [0.35, 1],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );

  // 3フレーム量子化した時間シード（滑らかでなくカクッと切り替わるノイズにする）
  const step = Math.floor(frame / 3);
  const chaosX = srand(step * 3.1 + 7.7);
  const chaosY = srand(step * 5.3 + 2.2);

  // ---- 行分割と文字化け解決 --------------------------------------------
  const rawLines = text.split("\n");
  // DECODE プリセットのみ、入場中に文字を左から順に解決する
  let displayLines = rawLines;
  if (preset === 4) {
    const resolveProgress = clamp01((frame - enterStart) / enterDur);
    let ci = 0;
    const total = Math.max(1, rawLines.join("").length);
    displayLines = rawLines.map((line) =>
      Array.from(line)
        .map((ch) => {
          if (ch === " ") {
            ci++;
            return " ";
          }
          const threshold = (ci / total) * 0.9;
          ci++;
          if (resolveProgress >= threshold + 0.08) return ch;
          const gi = Math.floor(rand(frame * 0.5 + ci * 7.3) * GLYPHS.length);
          return GLYPHS[gi];
        })
        .join(""),
    );
  }

  // ---- テキストプレート生成ヘルパー ------------------------------------
  const centerY = height * 0.5;
  const letterSpacingEm = preset <= 1 ? 0.06 : 0.02;
  const glowPx = fontSize * 0.05;

  const baseTextStyle: React.CSSProperties = {
    position: "absolute",
    left: "50%",
    top: centerY,
    fontFamily,
    fontWeight: 700,
    fontSize,
    lineHeight: 1.12,
    letterSpacing: `${letterSpacingEm}em`,
    whiteSpace: "pre",
    textAlign: "center",
    userSelect: "none",
  };

  /** 1枚のテキストプレート（中央基準・任意オフセット/色/合成/クリップ） */
  const plate = (
    key: string,
    dx: number,
    dy: number,
    plateColor: string,
    blend: React.CSSProperties["mixBlendMode"],
    opacity: number,
    extra?: React.CSSProperties,
  ): React.ReactNode => (
    <div
      key={key}
      style={{
        ...baseTextStyle,
        transform: `translate(-50%, -50%) translate(${dx}px, ${dy}px)`,
        color: plateColor,
        mixBlendMode: blend,
        opacity,
        ...extra,
      }}
    >
      {displayLines.map((l, i) => (
        // 行単位の色は「基調色のプレート」にだけ適用（RGB分解チャンネルの色は演出の骨格なので維持）
        <div
          key={i}
          style={
            plateColor === color && lineStyles?.[i]?.color
              ? { color: lineStyles[i]!.color }
              : undefined
          }
        >
          {l === "" ? " " : l}
        </div>
      ))}
    </div>
  );

  // ---- プリセット別レイヤー構築 ----------------------------------------
  const layers: React.ReactNode[] = [];

  if (preset === 0 || preset === 1) {
    // RGB DISPLACE / CHROMA CHAOS: R/G/B チャンネルを screen 合成で重ね、
    // ずれ量が一致すると白、ずれると縁に色収差が出る。
    const amp = preset === 0 ? 10 : 46;
    const jitter = amp * g;
    const ox = jitter * chaosX + (preset === 1 ? 6 * chaosX : 0);
    const oy = jitter * 0.25 * chaosY;
    // CHAOS は行全体を稀に大きく水平テアさせる
    const tear =
      preset === 1 && g > 0.15 ? srand(step * 8.8 + 1.3) * 60 * g : 0;

    layers.push(
      plate("r", -ox + tear, -oy, "#ff0033", "screen", 1, {
        textShadow: `0 0 ${glowPx}px rgba(255,0,60,0.5)`,
      }),
      plate("g", tear * 0.4, oy, "#00ff66", "screen", 1),
      plate("b", ox + tear, oy, "#0066ff", "screen", 1, {
        textShadow: `0 0 ${glowPx}px rgba(0,100,255,0.5)`,
      }),
    );

    if (preset === 1) {
      // 走査ノイズの薄い横縞をテキスト帯に重ねる
      layers.push(
        <div
          key="scan"
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            top: centerY - fontSize * 0.85 * displayLines.length,
            height: fontSize * 1.7 * displayLines.length,
            mixBlendMode: "overlay",
            opacity: 0.35 + 0.35 * g,
            backgroundImage:
              "repeating-linear-gradient(0deg, rgba(0,0,0,0.55) 0px, rgba(0,0,0,0.55) 2px, rgba(0,0,0,0) 2px, rgba(0,0,0,0) 5px)",
          }}
        />,
      );
    }
  } else if (preset === 2) {
    // SCANLINE CRT: 白プレート＋走査線マスク＋転がる輝線バンド＋縦ロール。
    // 入場は spring で縦にわずかにロールしながら定位する。
    const roll = spring({
      frame: frame - enterStart,
      fps,
      config: { damping: 12, stiffness: 120, mass: 0.7 },
    });
    const rollY = (1 - roll) * fontSize * 0.9 + srand(step * 4.4) * 8 * g;
    const rgb = 4 * g;
    const blockH = fontSize * 1.4 * displayLines.length;
    const blockTop = centerY - blockH / 2;
    // 転がる輝線の位置（ループ）
    const bandY =
      blockTop + ((frame * 6) % (blockH + 40)) - 20;

    layers.push(
      plate("cr", -rgb, rollY, "#ff2244", "screen", 0.9),
      plate("cb", rgb, rollY, "#22aaff", "screen", 0.9),
      plate("cw", 0, rollY, color, "normal", 1, {
        textShadow: `0 0 ${glowPx * 1.4}px rgba(180,220,255,0.55)`,
      }),
      // 走査線マスク
      <div
        key="scan2"
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: blockTop,
          height: blockH,
          transform: `translateY(${rollY}px)`,
          mixBlendMode: "multiply",
          opacity: 0.45,
          backgroundImage:
            "repeating-linear-gradient(0deg, rgba(0,0,0,0.85) 0px, rgba(0,0,0,0.85) 2px, rgba(0,0,0,0) 2px, rgba(0,0,0,0) 6px)",
        }}
      />,
      // 転がる輝線バンド
      <div
        key="band"
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: bandY,
          height: 26,
          mixBlendMode: "screen",
          opacity: 0.28,
          background:
            "linear-gradient(0deg, rgba(255,255,255,0) 0%, rgba(255,255,255,0.9) 50%, rgba(255,255,255,0) 100%)",
        }}
      />,
    );
  } else if (preset === 3) {
    // BLOCK NOISE: テキストを横帯にスライスし、各帯を g に応じて水平ずらし。
    // 一致時（g≈0）は完全なテキストに戻る。空フレーム防止に薄い母体プレートを敷く。
    const slices = 9;
    layers.push(plate("base", 0, 0, color, "normal", 0.18));
    for (let s = 0; s < slices; s++) {
      const topPct = (s / slices) * 100;
      const botPct = 100 - ((s + 1) / slices) * 100;
      const active = rand(step * 1.9 + s * 3.7) > 0.55 ? 1 : 0;
      const dx = srand(step * 2.7 + s * 5.1) * 70 * g * active;
      const tint =
        active && rand(step + s * 2.2) > 0.7
          ? s % 2 === 0
            ? "#ff2a6d"
            : "#2de2e6"
          : color;
      layers.push(
        plate(`sl${s}`, dx, 0, tint, tint === color ? "normal" : "screen", 1, {
          clipPath: `inset(${topPct}% 0 ${botPct}% 0)`,
        }),
      );
    }
    // 走査縞を薄く重ねてデジタル質感
    const blockH = fontSize * 1.4 * displayLines.length;
    layers.push(
      <div
        key="scan3"
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: centerY - blockH / 2,
          height: blockH,
          mixBlendMode: "overlay",
          opacity: 0.3,
          backgroundImage:
            "repeating-linear-gradient(0deg, rgba(0,0,0,0.5) 0px, rgba(0,0,0,0.5) 3px, rgba(0,0,0,0) 3px, rgba(0,0,0,0) 7px)",
        }}
      />,
    );
  } else {
    // DECODE: 文字化けグリフが解決していく。軽い色収差を添える。
    const rgb = 6 * g + 2;
    layers.push(
      plate("dr", -rgb, 0, "#ff2a6d", "screen", 0.85),
      plate("db", rgb, 0, "#2de2e6", "screen", 0.85),
      plate("dw", 0, srand(step * 6.6) * 4 * g, color, "normal", 1, {
        textShadow: `0 0 ${glowPx}px rgba(200,255,220,0.5)`,
      }),
    );
  }

  return (
    <AbsoluteFill
      style={{
        pointerEvents: "none",
        opacity: tailFade * revealFloor,
      }}
    >
      {layers}
    </AbsoluteFill>
  );
};
