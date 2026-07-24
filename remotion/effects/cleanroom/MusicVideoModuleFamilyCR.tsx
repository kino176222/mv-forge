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

// 旧既定は Mac ローカルの Helvetica 系ネオグロテスク。配布ビルドで化けないよう、
// 字形の近い Inter 700/800 に置換し、和文グリフは Noto Sans JP 700 で受ける。
const { fontFamily: INTER } = loadInter("normal", {
  weights: ["700", "800"],
  subsets: ["latin", "latin-ext"],
});
const { fontFamily: NOTO_SANS_JP } = loadNotoSansJP("normal", {
  weights: ["700"],
  subsets: ["japanese", "latin"],
});

/**
 * MusicVideoModuleFamilyCR — MV用「モジュール」タイトルカードの家族部品。
 *
 * クリーンルーム実装（機能記述と旧レンダのポスターの見た目のみを根拠に白紙から作成。
 * 機能記述だけから実装している）。
 *
 * 役割: 中央に主題（タイトル）、周囲に小さなメタ情報と装飾フレームを配し、
 *       ビート的な明滅（周期的なパルス）で音楽らしい鼓動を与える。
 *       music-video-module / retro-music-video-module 系の 11 本を variant で賄う。
 *
 * variant は 0..1 の数値。内部で Math.round(variant*4) により【5種】のプリセットへ振り分ける:
 *   0.00 → FRAMED   : 二重罫の矩形フレーム＋コーナー刻み。枠が呼吸するようにビートで明滅。
 *                     ネオン水色アクセント。落ち着いた王道モジュール。
 *   0.25 → ECHO     : 中央に主題、左右の画面端に巨大なアウトライン反復語（縦組み）。
 *                     ビートで側面語がフリッカーする。モノトーンの「TUNE」ポスター系。
 *   0.50 → RETRO    : 画面下のローワーサード風モジュール。左にタイトル、右に
 *                     ビートに合わせて上下する棒グラフ（イコライザ）。暖色ヴィンテージ配色。
 *   0.75 → GLITCH   : RGBチャンネルが左右にズレる色収差グリッチ＋走査線。
 *                     ビートでズレ幅がスパイクする。マゼンタ×グリーンのヴェイパー配色。
 *   1.00 → BRACKET  : 角括弧 [ ] で主題を挟むミニマルなカード。四隅にメタ情報。
 *                     ビートで括弧が開閉する。モノスペース調の端正な設計。
 *
 * 契約: text と durationInFrames だけで完成した見た目になる（他プロップは全て既定値あり）。
 *       決定論的（Math.random/Date 不使用、useCurrentFrame 基準）。renderStill でも
 *       例外を出さず・空フレームにしない。入場→保持→退場を durationInFrames 内に配置。
 */
export type MusicVideoModuleFamilyCRProps = {
  /** 表示する主題（1行想定。改行 \n が来ても崩れない） */
  text: string;
  /** このモジュールが画面に居る総フレーム数（Sequence の長さに合わせる） */
  durationInFrames: number;
  /** 主題の文字サイズ(px)。省略時は 150 */
  fontSize?: number;
  /** フォント。既定はグロテスク系サンセリフ（Inter + Noto Sans JP） */
  fontFamily?: string;
  /** 0..1。5種のスタイルプリセットに振り分ける */
  variant?: number;
  /** 主題テキストのメインカラー */
  color?: string;
};

const clamp01 = (t: number): number => Math.min(1, Math.max(0, t));
const easeOutCubic = (t: number): number => 1 - Math.pow(1 - t, 3);
const easeInCubic = (t: number): number => t * t * t;

/** 決定論的な擬似乱数（フレーム値から安定した 0..1 を返す。Math.random 不使用） */
const hashNoise = (n: number): number => {
  const x = Math.sin(n * 12.9898) * 43758.5453;
  return x - Math.floor(x);
};

/** プリセット別のパレット定義 */
type Palette = {
  bg: string;
  accent: string;
  accent2: string;
};
const PALETTES: Palette[] = [
  { bg: "#0b0e14", accent: "#54d6e6", accent2: "#7b8496" }, // FRAMED
  { bg: "#08080a", accent: "#ffffff", accent2: "#5a5a66" }, // ECHO
  { bg: "#17110a", accent: "#f0a24b", accent2: "#e8d9c2" }, // RETRO
  { bg: "#0a0a12", accent: "#ff2fb0", accent2: "#35ff9e" }, // GLITCH
  { bg: "#0c0c0f", accent: "#cdd0dc", accent2: "#6d7180" }, // BRACKET
];

export const MusicVideoModuleFamilyCR: React.FC<
  MusicVideoModuleFamilyCRProps
> = ({
  text,
  durationInFrames,
  fontSize = 150,
  fontFamily = `'${INTER}', '${NOTO_SANS_JP}', sans-serif`,
  variant = 0,
  color = "#ffffff",
}) => {
  const frame = useCurrentFrame();
  const { width, height, fps } = useVideoConfig();

  // ---- プリセット選択（0..1 → 0..4） ------------------------------------
  const preset = Math.max(0, Math.min(4, Math.round((variant || 0) * 4)));
  const pal = PALETTES[preset];

  // ---- 入場→保持→退場エンベロープ --------------------------------------
  const enterDur = Math.max(1, Math.min(20, Math.floor(durationInFrames * 0.28)));
  const exitDur = Math.max(1, Math.min(16, Math.floor(durationInFrames * 0.2)));
  const outStart = durationInFrames - exitDur;

  const enterSpring = spring({
    frame,
    fps,
    config: { damping: 200, mass: 0.7 },
    durationInFrames: enterDur,
  });
  const outT = clamp01((frame - outStart) / Math.max(1, exitDur));
  // 保持中は appear=1、退場は末尾 exitDur のみで 0 へ。終盤以外は必ず文字が見える。
  const appear = enterSpring * (1 - easeInCubic(outT));

  // ---- ビート（周期パルス）: ビート頭で 1、以後減衰 --------------------
  const beatFrames = 22;
  const beatRaw = (frame % beatFrames) / beatFrames; // 0..1 のこぎり波
  const beat = Math.pow(1 - beatRaw, 1.7); // 打点で 1、次打点直前で 0

  // ---- テキスト整形 -----------------------------------------------------
  const rawLines = String(text ?? "").split("\n");
  const lines = rawLines.length ? rawLines : [""];
  const oneLine = lines.join(" ");
  const upper = oneLine.toUpperCase();

  // 主題（複数行対応）を返す共通ノード
  const TitleLines: React.FC<{
    size: number;
    weight: number;
    col: string;
    stroke?: string;
    strokeW?: number;
    letterSpacing?: number;
    align?: "center" | "left";
  }> = ({
    size,
    weight,
    col,
    stroke,
    strokeW = 0,
    letterSpacing = 0,
    align = "center",
  }) => (
    <div style={{ textAlign: align, lineHeight: 1.02 }}>
      {lines.map((ln, i) => (
        <div
          key={i}
          style={{
            fontFamily,
            fontWeight: weight,
            fontSize: size,
            letterSpacing: `${letterSpacing}em`,
            color: stroke ? "transparent" : col,
            WebkitTextStroke: stroke ? `${strokeW}px ${stroke}` : undefined,
            whiteSpace: "pre",
          }}
        >
          {ln === "" ? " " : ln}
        </div>
      ))}
    </div>
  );

  const cx = width / 2;
  const cy = height / 2;

  // =====================================================================
  // プリセット 0: FRAMED — 二重罫の矩形フレーム＋コーナー刻み
  // =====================================================================
  const renderFramed = () => {
    const fw = width * 0.62;
    const fh = height * 0.5;
    const grow = interpolate(enterSpring, [0, 1], [0.9, 1]);
    const borderA = 0.35 + 0.55 * beat;
    const tick = 46;
    const corner = (
      top: boolean,
      left: boolean,
    ): React.CSSProperties => ({
      position: "absolute",
      width: tick,
      height: tick,
      [top ? "top" : "bottom"]: -3,
      [left ? "left" : "right"]: -3,
      borderTop: top ? `4px solid ${pal.accent}` : undefined,
      borderBottom: !top ? `4px solid ${pal.accent}` : undefined,
      borderLeft: left ? `4px solid ${pal.accent}` : undefined,
      borderRight: !left ? `4px solid ${pal.accent}` : undefined,
    });
    return (
      <div
        style={{
          position: "absolute",
          left: cx,
          top: cy,
          transform: `translate(-50%,-50%) scale(${grow})`,
          width: fw,
          height: fh,
          opacity: appear,
        }}
      >
        {/* 外枠（呼吸する明滅） */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            border: `2px solid ${pal.accent}`,
            opacity: borderA,
            boxShadow: `0 0 ${18 + 26 * beat}px ${pal.accent}55`,
          }}
        />
        {/* 内枠 */}
        <div
          style={{
            position: "absolute",
            inset: 14,
            border: `1px solid ${pal.accent2}`,
            opacity: 0.45,
          }}
        />
        {/* コーナー刻み */}
        <div style={corner(true, true)} />
        <div style={corner(true, false)} />
        <div style={corner(false, true)} />
        <div style={corner(false, false)} />
        {/* 上部メタ */}
        <div
          style={{
            position: "absolute",
            top: 26,
            left: 34,
            fontFamily,
            fontWeight: 700,
            fontSize: 22,
            letterSpacing: "0.42em",
            color: pal.accent,
          }}
        >
          NOW PLAYING
        </div>
        <div
          style={{
            position: "absolute",
            top: 26,
            right: 34,
            fontFamily,
            fontWeight: 700,
            fontSize: 22,
            letterSpacing: "0.28em",
            color: pal.accent2,
          }}
        >
          MODULE·01
        </div>
        {/* 中央タイトル */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 18,
          }}
        >
          <TitleLines size={fontSize} weight={800} col={color} letterSpacing={0.01} />
          <div
            style={{
              fontFamily,
              fontWeight: 700,
              fontSize: 26,
              letterSpacing: "0.5em",
              color: pal.accent,
              opacity: 0.85,
            }}
          >
            STEREO · 24BIT
          </div>
        </div>
      </div>
    );
  };

  // =====================================================================
  // プリセット 1: ECHO — 左右端に巨大アウトライン反復語（縦組み）＋中央主題
  // =====================================================================
  const renderEcho = () => {
    const len = Math.max(3, upper.length);
    const sideFont = Math.min(300, (height * 1.7) / len);
    const sideFlickerL = 0.5 + 0.5 * Math.pow(1 - ((frame + 4) % beatFrames) / beatFrames, 2);
    const sideFlickerR = 0.5 + 0.5 * beat;
    const slide = interpolate(enterSpring, [0, 1], [80, 0]);
    const Side: React.FC<{ side: "left" | "right"; flick: number; dir: number }> = ({
      side,
      flick,
      dir,
    }) => (
      <div
        style={{
          position: "absolute",
          top: cy,
          [side]: 40,
          transform: `translateY(-50%) rotate(${dir * 90}deg) translateY(${dir * slide}px)`,
          transformOrigin: "center",
          fontFamily,
          fontWeight: 800,
          fontSize: sideFont,
          letterSpacing: "0.02em",
          whiteSpace: "nowrap",
          color: "transparent",
          WebkitTextStroke: `2px ${color}`,
          opacity: 0.55 * flick * appear,
        }}
      >
        {upper}
      </div>
    );
    return (
      <>
        <Side side="left" flick={sideFlickerL} dir={-1} />
        <Side side="right" flick={sideFlickerR} dir={1} />
        {/* 中央主題（ソリッド） */}
        <div
          style={{
            position: "absolute",
            left: cx,
            top: cy,
            transform: `translate(-50%,-50%) translateY(${(1 - enterSpring) * -30}px)`,
            opacity: appear,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 14,
          }}
        >
          <TitleLines size={fontSize * 0.86} weight={800} col={color} letterSpacing={0.02} />
          <div
            style={{
              width: fontSize * 2.2,
              height: 3,
              background: pal.accent,
              opacity: 0.6 + 0.4 * beat,
            }}
          />
          <div
            style={{
              fontFamily,
              fontWeight: 700,
              fontSize: 24,
              letterSpacing: "0.6em",
              color: pal.accent2,
            }}
          >
            VINTAGE SOUND
          </div>
        </div>
      </>
    );
  };

  // =====================================================================
  // プリセット 2: RETRO — 下部ローワーサード＋ビート連動イコライザ（暖色）
  // =====================================================================
  const renderRetro = () => {
    const barH = height * 0.28;
    const slideX = interpolate(enterSpring, [0, 1], [-width * 0.5, 0]);
    const bars = 22;
    return (
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 0,
          height: barH + 60,
          opacity: appear,
        }}
      >
        {/* 帯の背景グラデ */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: `linear-gradient(0deg, ${pal.bg} 0%, ${pal.bg}00 100%)`,
          }}
        />
        {/* 上罫線 */}
        <div
          style={{
            position: "absolute",
            top: 30,
            left: 60,
            right: 60,
            height: 2,
            background: pal.accent,
            opacity: 0.5 + 0.5 * beat,
            transform: `translateX(${slideX}px)`,
          }}
        />
        {/* タイトル（左寄せ） */}
        <div
          style={{
            position: "absolute",
            left: 70,
            bottom: 44,
            transform: `translateX(${slideX}px)`,
          }}
        >
          <div
            style={{
              fontFamily,
              fontWeight: 700,
              fontSize: 24,
              letterSpacing: "0.4em",
              color: pal.accent,
              marginBottom: 12,
            }}
          >
            ♪ TRACK 01 — RETRO MIX
          </div>
          <TitleLines
            size={fontSize * 0.82}
            weight={800}
            col={color}
            align="left"
            letterSpacing={0.005}
          />
        </div>
        {/* イコライザ（右下・ビート連動、決定論的） */}
        <div
          style={{
            position: "absolute",
            right: 70,
            bottom: 46,
            display: "flex",
            alignItems: "flex-end",
            gap: 7,
            height: fontSize * 0.9,
            opacity: interpolate(enterSpring, [0.4, 1], [0, 1], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
            }),
          }}
        >
          {Array.from({ length: bars }).map((_, i) => {
            const wob = Math.abs(Math.sin(frame * 0.16 + i * 0.7));
            const h = 0.15 + 0.85 * (0.45 * wob + 0.55 * beat * (0.4 + 0.6 * hashNoise(i)));
            return (
              <div
                key={i}
                style={{
                  width: 9,
                  height: `${clamp01(h) * 100}%`,
                  background: i % 3 === 0 ? pal.accent : pal.accent2,
                  opacity: 0.9,
                }}
              />
            );
          })}
        </div>
      </div>
    );
  };

  // =====================================================================
  // プリセット 3: GLITCH — RGB色収差＋走査線（マゼンタ×グリーン）
  // =====================================================================
  const renderGlitch = () => {
    const jitter = (hashNoise(Math.floor(frame / 2)) - 0.5) * 10;
    const split = 6 + jitter + beat * 20;
    const rise = interpolate(enterSpring, [0, 1], [40, 0]);
    const layer = (dx: number, col: string, blend: string): React.CSSProperties => ({
      position: "absolute",
      left: 0,
      top: 0,
      transform: `translateX(${dx}px)`,
      color: col,
      mixBlendMode: blend as React.CSSProperties["mixBlendMode"],
      opacity: 0.9,
    });
    return (
      <div
        style={{
          position: "absolute",
          left: cx,
          top: cy,
          transform: `translate(-50%,-50%) translateY(${rise}px)`,
          opacity: appear,
        }}
      >
        <div style={{ position: "relative" }}>
          {/* マゼンタ・グリーンのズレ層＋白の基準層 */}
          <div style={layer(-split, pal.accent, "screen")}>
            <TitleLines size={fontSize} weight={800} col={pal.accent} letterSpacing={0} />
          </div>
          <div style={layer(split, pal.accent2, "screen")}>
            <TitleLines size={fontSize} weight={800} col={pal.accent2} letterSpacing={0} />
          </div>
          <div style={{ position: "relative" }}>
            <TitleLines size={fontSize} weight={800} col={color} letterSpacing={0} />
          </div>
        </div>
        <div
          style={{
            marginTop: 22,
            textAlign: "center",
            fontFamily,
            fontWeight: 700,
            fontSize: 24,
            letterSpacing: "0.55em",
            color: pal.accent,
            transform: `translateX(${beat * jitter}px)`,
          }}
        >
          SIGNAL // LOST
        </div>
      </div>
    );
  };

  // 走査線オーバーレイ（GLITCH 用・全面）
  const scanlines =
    preset === 3 ? (
      <div
        style={{
          position: "absolute",
          inset: 0,
          pointerEvents: "none",
          backgroundImage:
            "repeating-linear-gradient(0deg, rgba(0,0,0,0.28) 0px, rgba(0,0,0,0.28) 1px, rgba(0,0,0,0) 2px, rgba(0,0,0,0) 4px)",
          opacity: 0.6 * appear,
        }}
      />
    ) : null;

  // =====================================================================
  // プリセット 4: BRACKET — 角括弧で挟むミニマルカード＋四隅メタ
  // =====================================================================
  const renderBracket = () => {
    const gap = interpolate(beat, [0, 1], [0, 26]);
    const bracketSize = fontSize * 1.1;
    const fade = appear;
    const cornerMeta = (
      pos: React.CSSProperties,
      label: string,
      align: "left" | "right",
    ) => (
      <div
        style={{
          position: "absolute",
          ...pos,
          fontFamily,
          fontWeight: 700,
          fontSize: 20,
          letterSpacing: "0.36em",
          color: pal.accent2,
          textAlign: align,
          opacity: 0.85,
        }}
      >
        {label}
      </div>
    );
    return (
      <div style={{ position: "absolute", inset: 0, opacity: fade }}>
        {/* 十字マーカー（中央十字の目印） */}
        <div
          style={{
            position: "absolute",
            left: cx,
            top: cy,
            transform: "translate(-50%,-50%)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <div
            style={{
              fontFamily,
              fontWeight: 700,
              fontSize: bracketSize,
              color: pal.accent,
              transform: `translateX(${-gap}px)`,
              opacity: 0.9,
            }}
          >
            [
          </div>
          <div
            style={{
              margin: "0 34px",
              transform: `translateY(${(1 - enterSpring) * 20}px)`,
            }}
          >
            <TitleLines size={fontSize} weight={800} col={color} letterSpacing={0.02} />
            <div
              style={{
                marginTop: 16,
                textAlign: "center",
                fontFamily,
                fontWeight: 700,
                fontSize: 22,
                letterSpacing: "0.5em",
                color: pal.accent,
                opacity: 0.6 + 0.4 * beat,
              }}
            >
              MODERN FLAIR
            </div>
          </div>
          <div
            style={{
              fontFamily,
              fontWeight: 700,
              fontSize: bracketSize,
              color: pal.accent,
              transform: `translateX(${gap}px)`,
              opacity: 0.9,
            }}
          >
            ]
          </div>
        </div>
        {cornerMeta({ top: 60, left: 70 }, "NOW·PLAYING", "left")}
        {cornerMeta({ top: 60, right: 70 }, "STEREO", "right")}
        {cornerMeta({ bottom: 60, left: 70 }, "24BIT·48K", "left")}
        {cornerMeta({ bottom: 60, right: 70 }, "MODULE·05", "right")}
      </div>
    );
  };

  // ---- ディスパッチ -----------------------------------------------------
  let body: React.ReactNode;
  if (preset === 0) body = renderFramed();
  else if (preset === 1) body = renderEcho();
  else if (preset === 2) body = renderRetro();
  else if (preset === 3) body = renderGlitch();
  else body = renderBracket();

  // 背景スクリム（各プリセットのダーク下地。renderStill でも非空を保証） ----
  const bgGradient =
    preset === 2
      ? `radial-gradient(120% 120% at 50% 100%, ${pal.bg} 0%, #05050a 100%)`
      : `radial-gradient(130% 130% at 50% 40%, ${pal.bg} 0%, #050507 100%)`;

  return (
    <AbsoluteFill style={{ backgroundColor: "#050507" }}>
      <AbsoluteFill style={{ background: bgGradient, opacity: appear * 0.96 + 0.04 }} />
      {body}
      {scanlines}
    </AbsoluteFill>
  );
};

export default MusicVideoModuleFamilyCR;
