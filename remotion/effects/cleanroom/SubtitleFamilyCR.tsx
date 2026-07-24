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
import { renderStyledLines, type XpLineStyle } from "./line-styles";

// 配布ビルドでローカルフォント（Helvetica等）に依存しないよう、
// ラテンは Inter、和文グリフは Noto Sans JP を @remotion/google-fonts から読む。
const { fontFamily: INTER } = loadInter("normal", {
  weights: ["400", "700"],
  subsets: ["latin", "latin-ext"],
});
const { fontFamily: NOTO_SANS_JP } = loadNotoSansJP("normal", {
  weights: ["400", "700"],
  subsets: ["japanese", "latin"],
});

/**
 * SubtitleFamilyCR — 1行字幕（サブタイトル）の家族部品。
 *
 * クリーンルーム実装（機能記述と旧レンダのポスターの見た目のみを根拠に、
 * 既存実装を参照せず白紙から作成）。字幕系の多数の id を、
 * variant（0..1）による 5 つのスタイルプリセット切替で一手に賄う。
 *
 * どのプリセットも「入場 → 保持 → 退場」を durationInFrames 内に配置し、
 * 保持区間は終盤まで確実に文字が読める。退場は最終数フレームでのみ進むため
 * 早すぎる空フレームにならない。text と durationInFrames だけで完成する。
 *
 * variant の割り当て（round(variant*4) で 0..4 に量子化）:
 *   0.00 → [0] slide   : 画面下からスッと立ち上がるロワーサード。柔らかい発光で下品にならない。
 *   0.25 → [1] fade    : 画面中央でごく僅かに拡大しながら溶け込むミニマルなフェード。
 *   0.50 → [2] pop     : spring のオーバーシュートで弾けて出る中央大見出し。
 *   0.75 → [3] typewriter: 1文字ずつ左から打ち出し、点滅キャレットが追従するロワーサード。
 *   1.00 → [4] mask-wipe: 左からのクリップ・ワイプで露出し、下線バーが同期して伸びる。
 *
 * 1920x1080 前提。text は1行想定だが \n が来ても各行が段組みされて崩れない。
 */
export type SubtitleFamilyCRProps = {
  /** 表示する文言（1行想定。\n で複数行にもできる） */
  text: string;
  /** この字幕が画面に居る総フレーム数（Sequence の長さに合わせる） */
  durationInFrames: number;
  /** 文字サイズ(px) */
  fontSize?: number;
  /** フォント。既定は Inter → Noto Sans JP フォールバック */
  fontFamily?: string;
  /** スタイルプリセット選択（0..1）。round(v*4) で 5 種に量子化 */
  variant?: number;
  /** 文字色 */
  color?: string;
  /** 行（\n）単位の色上書き。index=描画行。未設定行は color のまま */
  lineStyles?: XpLineStyle[];
};

const clamp01 = (t: number): number => Math.min(1, Math.max(0, t));
const easeOutCubic = (t: number): number => 1 - Math.pow(1 - t, 3);
const easeInCubic = (t: number): number => t * t * t;
const easeInOutCubic = (t: number): number =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

/** variant(0..1) を 0..4 のプリセット番号に量子化 */
const pickPreset = (variant: number): number => {
  if (!Number.isFinite(variant)) return 0;
  return Math.min(4, Math.max(0, Math.round(clamp01(variant) * 4)));
};

export const SubtitleFamilyCR: React.FC<SubtitleFamilyCRProps> = ({
  text,
  durationInFrames,
  fontSize = 84,
  fontFamily = `'${INTER}', '${NOTO_SANS_JP}', sans-serif`,
  variant = 0,
  color = "#ffffff",
  lineStyles,
}) => {
  const frame = useCurrentFrame();
  const { width, height, fps } = useVideoConfig();

  const preset = pickPreset(variant);
  const dur = Math.max(1, durationInFrames);

  // --- 入場・退場の共通フェーズ設計 -------------------------------------
  // 保持区間が終盤まで残るよう、退場は末尾のごく短い区間でのみ進める。
  const enterDur = Math.max(1, Math.min(18, Math.floor(dur * 0.34)));
  const exitDur = Math.max(1, Math.min(14, Math.floor(dur * 0.24)));
  const enterStart = Math.min(2, Math.max(0, dur - 1));
  const enterEnd = Math.min(dur, enterStart + enterDur);
  const exitStart = Math.max(enterEnd, dur - exitDur);

  const enterT = clamp01((frame - enterStart) / Math.max(1, enterEnd - enterStart));
  const exitT = clamp01((frame - exitStart) / Math.max(1, dur - exitStart));

  // 全体の見え（保持区間は 1、終端でのみ抜ける）
  const shellOpacity = clamp01(easeOutCubic(enterT)) * (1 - easeInCubic(exitT));

  // 可読性のための共通スタイル
  const base: React.CSSProperties = {
    fontFamily,
    color,
    fontSize,
    lineHeight: 1.16,
    whiteSpace: "pre-wrap",
    wordBreak: "keep-all",
    margin: 0,
  };

  // === プリセットごとの中身を組み立てる ================================
  let content: React.ReactNode = null;

  if (preset === 0) {
    // [0] slide — 下からスッと立ち上がるロワーサード（柔らかい発光）
    const rise = interpolate(easeOutCubic(enterT), [0, 1], [70, 0]);
    const exitRise = interpolate(easeInCubic(exitT), [0, 1], [0, -46]);
    const glow = 0.5 + 0.5 * clamp01(enterT);
    content = (
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: height * 0.8,
          display: "flex",
          justifyContent: "center",
          transform: `translateY(${rise + exitRise}px)`,
          opacity: shellOpacity,
        }}
      >
        <p
          style={{
            ...base,
            fontWeight: 700,
            textAlign: "center",
            letterSpacing: "0.01em",
            padding: "0 6%",
            textShadow: `0 2px 10px rgba(0,0,0,0.55), 0 0 ${
              22 * glow
            }px rgba(255,255,255,${0.32 * glow})`,
          }}
        >
          {renderStyledLines(text, lineStyles)}
        </p>
      </div>
    );
  } else if (preset === 1) {
    // [1] fade — 中央でごく僅かに拡大しながら溶け込むミニマル
    const scale = interpolate(easeOutCubic(enterT), [0, 1], [1.06, 1]);
    const exitScale = interpolate(easeInCubic(exitT), [0, 1], [1, 0.97]);
    const ls = interpolate(easeOutCubic(enterT), [0, 1], [0.16, 0.02]);
    content = (
      <AbsoluteFill
        style={{
          alignItems: "center",
          justifyContent: "center",
          transform: `scale(${scale * exitScale})`,
          opacity: shellOpacity,
        }}
      >
        <p
          style={{
            ...base,
            fontWeight: 400,
            textAlign: "center",
            letterSpacing: `${ls}em`,
            padding: "0 8%",
            textShadow: "0 1px 8px rgba(0,0,0,0.45)",
          }}
        >
          {renderStyledLines(text, lineStyles)}
        </p>
      </AbsoluteFill>
    );
  } else if (preset === 2) {
    // [2] pop — spring のオーバーシュートで弾けて出る中央大見出し
    const enter = spring({
      frame: frame - enterStart,
      fps,
      config: { damping: 12, mass: 0.7, stiffness: 140 },
      durationInFrames: Math.max(6, enterDur + 6),
    });
    const popScale = interpolate(enter, [0, 1], [0.62, 1]);
    const exitScale = interpolate(easeInCubic(exitT), [0, 1], [1, 1.12]);
    content = (
      <AbsoluteFill
        style={{
          alignItems: "center",
          justifyContent: "center",
          transform: `scale(${popScale * exitScale})`,
          opacity: shellOpacity,
        }}
      >
        <p
          style={{
            ...base,
            fontWeight: 700,
            textAlign: "center",
            letterSpacing: "-0.01em",
            padding: "0 6%",
            textShadow:
              "0 4px 18px rgba(0,0,0,0.5), 0 0 2px rgba(0,0,0,0.4)",
          }}
        >
          {renderStyledLines(text, lineStyles)}
        </p>
      </AbsoluteFill>
    );
  } else if (preset === 3) {
    // [3] typewriter — 1文字ずつ左から打ち出し、点滅キャレットが追従
    const total = Math.max(1, [...String(text ?? "")].length);
    // 保持に入る前（enterEnd 手前）までに全文字を打ち切る
    const typeEnd = Math.max(enterStart + 1, enterEnd);
    const typeT = clamp01((frame - enterStart) / Math.max(1, typeEnd - enterStart));
    const shown = Math.min(total, Math.round(typeT * total));
    const chars = [...String(text ?? "")];
    const revealed = chars.slice(0, shown).join("");
    const typing = shown < total;
    // キャレットは入力中は常時点灯、完了後は緩く点滅、退場で消灯
    const blink = typing ? 1 : 0.35 + 0.65 * (Math.floor(frame / 8) % 2);
    const caretOpacity = (1 - exitT) * blink;
    content = (
      <div
        style={{
          position: "absolute",
          left: "8%",
          right: "8%",
          top: height * 0.78,
          opacity: shellOpacity,
        }}
      >
        <p
          style={{
            ...base,
            fontWeight: 700,
            textAlign: "left",
            letterSpacing: "0.005em",
            textShadow: "0 2px 10px rgba(0,0,0,0.55)",
          }}
        >
          {renderStyledLines(revealed, lineStyles)}
          <span
            style={{
              display: "inline-block",
              width: "0.08em",
              height: "1em",
              marginLeft: "0.06em",
              background: color,
              verticalAlign: "-0.12em",
              opacity: caretOpacity,
            }}
          />
        </p>
      </div>
    );
  } else {
    // [4] mask-wipe — 左からのクリップ・ワイプで露出、下線バーが同期して伸びる
    const wipe = easeInOutCubic(enterT); // 0..1 露出量
    const exitWipe = easeInCubic(exitT); // 退場は右から畳む
    const revealRight = interpolate(wipe, [0, 1], [100, 0]); // inset の右カット%
    const exitLeft = interpolate(exitWipe, [0, 1], [0, 100]); // 左からカット%
    const clip = `inset(0 ${revealRight}% 0 ${exitLeft}%)`;
    const barScale = clamp01(wipe) * (1 - exitWipe);
    content = (
      <AbsoluteFill
        style={{ alignItems: "center", justifyContent: "center" }}
      >
        <div style={{ display: "inline-block", padding: "0 6%" }}>
          <p
            style={{
              ...base,
              fontWeight: 700,
              textAlign: "center",
              letterSpacing: "0.06em",
              textTransform: "uppercase",
              clipPath: clip,
              WebkitClipPath: clip,
              textShadow: "0 3px 14px rgba(0,0,0,0.5)",
            }}
          >
            {renderStyledLines(text, lineStyles)}
          </p>
          <div
            style={{
              height: Math.max(3, fontSize * 0.05),
              marginTop: fontSize * 0.14,
              background: color,
              transform: `scaleX(${barScale})`,
              transformOrigin: "left center",
              opacity: 0.9,
            }}
          />
        </div>
      </AbsoluteFill>
    );
  }

  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>{content}</AbsoluteFill>
  );
};

export default SubtitleFamilyCR;
