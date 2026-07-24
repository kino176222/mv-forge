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

// 旧既定は Mac ローカルのシネマ系サンセリフ（Helvetica Neue / Futura など）。
// 配布ビルドで化けないよう、字形の近い幾何学的グロテスク Inter に置換し、
// 和文グリフは Noto Sans JP で受ける。細字（300）を主役にして「上品な見出し」を作る。
const { fontFamily: INTER } = loadInter("normal", {
  weights: ["300", "400", "700"],
  subsets: ["latin", "latin-ext"],
});
const { fontFamily: NOTO_SANS_JP } = loadNotoSansJP("normal", {
  weights: ["300", "400", "700"],
  subsets: ["japanese", "latin"],
});

/**
 * CinematicTitleFamilyCR — 映画的タイトルの「家族部品」。
 *
 * クリーンルーム実装（機能記述と旧レンダの見た目のみを根拠に、白紙から作成）。
 * 機能記述だけから実装している。字間の広いエレガントな細字見出しが、
 * 光・線・フェードで静かに立ち上がり、保持し、静かに抜ける——を共通の骨格とし、
 * variant(0..1) で 5 つのレイアウト／演出プリセットに振り分けて cinematic-title 系 14 本を賄う。
 *
 * variant → プリセット（0.0 / 0.25 / 0.5 / 0.75 / 1.0 で見た目がはっきり変わる）:
 *   0 (variant < 0.20)  センター・ブルーム: 中央寄せの細字ワイドトラッキング見出しが
 *                        下からわずかに浮上しつつ、開幕の強いグロー（にじみ）が徐々に落ち着く。
 *   1 (0.20–0.40) アンダーライン: 見出しがフェードインした後、細い水平線が中央から
 *                        左右へ引かれて下線になる。クレジット／章題の趣。
 *   2 (0.40–0.60) キッカー2行: 上に小さなキッカー（小見出し）、下に大きなタイトル。
 *                        text に改行があれば1行目をキッカー扱い。1行のみなら左右に
 *                        短い罫線を添えてタイトルを挟む（ポスターの2行クレジット型）。
 *   3 (0.60–0.80) レターリビール: 1文字ずつ、下からわずかに立ち上がりながら
 *                        ブラーが晴れて出現する。文字が順に組み上がる高級感。
 *   4 (0.80–1.00) ライトスイープ: 画面を横切る光の帯がタイトルを左→右へ舐めるように
 *                        現し（clip 反転）、通過点に明るいエッジグローが走る。
 *
 * すべての省略可プロップに既定値を持ち、text と durationInFrames だけで完成する
 * （XpTitleProps 互換）。決定論的（Math.random/Date 不使用・useCurrentFrame 基準）で、
 * durationInFrames に入場→保持→退場を必ず収め、renderStill で例外・空フレームを出さない。
 */
export type CinematicTitleFamilyCRProps = {
  /** 表示する文言（1行想定。\n で複数行も可） */
  text: string;
  /** この見出しが画面に居る総フレーム数 */
  durationInFrames: number;
  /** 文字サイズ(px)。主役タイトルの基準サイズ */
  fontSize?: number;
  /** フォント。既定は Inter + Noto Sans JP */
  fontFamily?: string;
  /** 0..1 のスタイルつまみ。内部で5プリセットに分岐 */
  variant?: number;
  /** 文字色 */
  color?: string;
};

const clamp01 = (t: number): number => Math.min(1, Math.max(0, t));
/** 減速: 速く入ってスッと止まる */
const easeOutCubic = (t: number): number => 1 - Math.pow(1 - t, 3);
/** 加速: じわっと動いて一気に抜ける */
const easeInCubic = (t: number): number => t * t * t;

export const CinematicTitleFamilyCR: React.FC<CinematicTitleFamilyCRProps> = ({
  text,
  durationInFrames,
  fontSize = 120,
  fontFamily = `'${INTER}', '${NOTO_SANS_JP}', sans-serif`,
  variant = 0,
  color = "#ffffff",
}) => {
  const frame = useCurrentFrame();
  const { width, height, fps } = useVideoConfig();

  // ---- 共通タイムライン（入場→保持→退場） -------------------------------
  const dur = Math.max(1, durationInFrames);
  const enterDur = Math.max(6, Math.min(26, dur * 0.32));
  const exitDur = Math.max(4, Math.min(18, dur * 0.24));
  const exitStart = Math.max(enterDur + 1, dur - exitDur);
  // 退場フェードは最終フレームの直前で完了（終盤フレームでも文字は見えている）
  const exitFade = 1 - clamp01((frame - exitStart) / Math.max(1, dur - 1 - exitStart));
  // 入場の全体フェード
  const enterFade = clamp01(frame / Math.max(1, enterDur * 0.8));

  const v = clamp01(variant);
  const preset = v < 0.2 ? 0 : v < 0.4 ? 1 : v < 0.6 ? 2 : v < 0.8 ? 3 : 4;

  // シネマ見出しは大文字・ワイドトラッキングが定番（和文には無害）
  const upper = (s: string): string => s.toUpperCase();
  const lines = text.split("\n");

  // 退場時の共通の抜け味（わずかに拡大＋ブラー）
  const exitT = clamp01((frame - exitStart) / Math.max(1, dur - exitStart));
  const exitScale = 1 + 0.05 * easeInCubic(exitT);
  const exitBlur = 6 * easeInCubic(exitT);

  // 各プリセットの中身
  let content: React.ReactNode = null;

  if (preset === 0) {
    // ---- 0: センター・ブルーム ------------------------------------------
    // 入場はバネで減速上昇（overshoot なしの落ち着いた寄り）
    const enterSpring = spring({
      frame,
      fps,
      config: { damping: 200, mass: 1, stiffness: 90 },
      durationInFrames: Math.round(enterDur),
    });
    const rise = interpolate(enterSpring, [0, 1], [34, 0]);
    const enterScale = interpolate(enterSpring, [0, 1], [0.965, 1]);
    // 開幕は強いにじみ、保持でスッと収束
    const glow = interpolate(clamp01(frame / (enterDur * 1.4)), [0, 1], [26, 8]);
    content = (
      <div
        style={{
          fontFamily,
          fontWeight: 300,
          fontSize,
          letterSpacing: "0.22em",
          lineHeight: 1.15,
          color,
          textAlign: "center",
          whiteSpace: "pre-line",
          transform: `translateY(${rise}px) scale(${exitScale * enterScale})`,
          opacity: enterFade,
          filter: `blur(${exitBlur}px)`,
          textShadow: `0 0 ${glow}px rgba(255,255,255,0.55), 0 0 ${glow * 2}px rgba(160,190,255,0.28)`,
          // 右に伸びるトラッキング分を中央へ寄せ直す
          paddingLeft: "0.22em",
        }}
      >
        {upper(text)}
      </div>
    );
  } else if (preset === 1) {
    // ---- 1: アンダーライン（下線ドロー） --------------------------------
    const titleFade = clamp01((frame - 2) / Math.max(1, enterDur * 0.7));
    const rise = interpolate(easeOutCubic(titleFade), [0, 1], [16, 0]);
    // 下線はタイトルが出そろってから中央→左右に伸びる
    const lineStart = enterDur * 0.55;
    const lineT = easeOutCubic(clamp01((frame - lineStart) / Math.max(1, enterDur * 0.9)));
    content = (
      <div style={{ textAlign: "center", opacity: enterFade }}>
        <div
          style={{
            fontFamily,
            fontWeight: 300,
            fontSize,
            letterSpacing: "0.2em",
            lineHeight: 1.15,
            color,
            whiteSpace: "pre-line",
            transform: `translateY(${rise}px) scale(${exitScale})`,
            filter: `blur(${exitBlur}px)`,
            opacity: titleFade,
            textShadow: "0 0 14px rgba(255,255,255,0.25)",
            paddingLeft: "0.2em",
          }}
        >
          {upper(text)}
        </div>
        <div
          style={{
            margin: `${fontSize * 0.28}px auto 0`,
            width: `${lineT * Math.min(0.5, fontSize / width + 0.28) * 100}%`,
            height: 2,
            background: color,
            opacity: 0.85 * exitFade,
            boxShadow: `0 0 10px ${color}`,
          }}
        />
      </div>
    );
  } else if (preset === 2) {
    // ---- 2: キッカー2行 / 罫線挟み --------------------------------------
    const hasKicker = lines.length > 1;
    const kicker = hasKicker ? lines[0] : "";
    const title = hasKicker ? lines.slice(1).join("\n") : text;

    const kickerFade = clamp01((frame - 2) / Math.max(1, enterDur * 0.5));
    const titleStart = enterDur * 0.3;
    const titleFade = clamp01((frame - titleStart) / Math.max(1, enterDur * 0.7));
    const titleRise = interpolate(easeOutCubic(titleFade), [0, 1], [26, 0]);
    // 1行タイトル時の左右罫線
    const ruleT = easeOutCubic(clamp01((frame - enterDur * 0.5) / Math.max(1, enterDur)));

    content = (
      <div style={{ textAlign: "center", opacity: enterFade, transform: `scale(${exitScale})`, filter: `blur(${exitBlur}px)` }}>
        {hasKicker && (
          <div
            style={{
              fontFamily,
              fontWeight: 400,
              fontSize: fontSize * 0.28,
              letterSpacing: "0.5em",
              color,
              opacity: kickerFade * 0.9 * exitFade,
              marginBottom: fontSize * 0.34,
              paddingLeft: "0.5em",
              whiteSpace: "pre-line",
            }}
          >
            {upper(kicker)}
          </div>
        )}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: fontSize * 0.5,
          }}
        >
          {!hasKicker && (
            <div
              style={{
                width: ruleT * fontSize * 1.4,
                height: 1,
                background: color,
                opacity: 0.7 * exitFade,
              }}
            />
          )}
          <div
            style={{
              fontFamily,
              fontWeight: 300,
              fontSize,
              letterSpacing: "0.18em",
              lineHeight: 1.12,
              color,
              whiteSpace: "pre-line",
              opacity: titleFade * exitFade,
              transform: `translateY(${titleRise}px)`,
              textShadow: "0 0 16px rgba(255,255,255,0.3)",
              paddingLeft: "0.18em",
            }}
          >
            {upper(title)}
          </div>
          {!hasKicker && (
            <div
              style={{
                width: ruleT * fontSize * 1.4,
                height: 1,
                background: color,
                opacity: 0.7 * exitFade,
              }}
            />
          )}
        </div>
      </div>
    );
  } else if (preset === 3) {
    // ---- 3: レターリビール（1文字ずつ立ち上がる） ----------------------
    const revealSpan = enterDur * 0.75;
    const perCharLen = 9; // 1文字あたりの出現にかける長さ
    // 文字通し番号の割り当て用に総数を先に数える
    const totalChars = Math.max(
      1,
      lines.reduce((n, l) => n + Array.from(l).length, 0),
    );
    const renderLine = (lineText: string, li: number, offsetChars: number) => {
      const chars = Array.from(upper(lineText));
      return (
        <div key={li} style={{ whiteSpace: "nowrap", lineHeight: 1.2 }}>
          {chars.map((ch, ci) => {
            const idx = offsetChars + ci;
            const delay = (idx / totalChars) * revealSpan;
            const cp = clamp01((frame - delay) / perCharLen);
            const rise = interpolate(easeOutCubic(cp), [0, 1], [0.45, 0]); // em単位
            const blur = interpolate(cp, [0, 1], [10, 0]);
            return (
              <span
                key={ci}
                style={{
                  display: "inline-block",
                  fontFamily,
                  fontWeight: 300,
                  fontSize,
                  letterSpacing: "0.16em",
                  color,
                  opacity: cp,
                  transform: `translateY(${rise}em)`,
                  filter: `blur(${blur}px)`,
                  textShadow: "0 0 14px rgba(255,255,255,0.28)",
                }}
              >
                {ch === " " ? " " : ch}
              </span>
            );
          })}
        </div>
      );
    };
    let acc = 0;
    const rendered = lines.map((l, li) => {
      const node = renderLine(l, li, acc);
      acc += Array.from(l).length;
      return node;
    });
    content = (
      <div
        style={{
          textAlign: "center",
          opacity: exitFade,
          transform: `scale(${exitScale})`,
          filter: `blur(${exitBlur}px)`,
          paddingLeft: "0.16em",
        }}
      >
        {rendered}
      </div>
    );
  } else {
    // ---- 4: ライトスイープ（光の帯が横切って現す） ----------------------
    const sweepT = easeOutCubic(clamp01((frame - 2) / Math.max(1, enterDur)));
    // 左から sweepT の割合まで露出（clip を右から詰める）
    const hideRight = (1 - sweepT) * 100;
    // 露出エッジの明るい帯の位置（画面幅基準）。露出しきったら消す
    const edgeX = sweepT * width;
    const edgeOpacity = (sweepT < 0.02 ? 0 : 1 - Math.pow(sweepT, 2)) * exitFade;
    content = (
      <div style={{ position: "relative", width: "100%", textAlign: "center", opacity: exitFade }}>
        <div
          style={{
            fontFamily,
            fontWeight: 300,
            fontSize,
            letterSpacing: "0.2em",
            lineHeight: 1.15,
            color,
            whiteSpace: "pre-line",
            width: "100%",
            transform: `scale(${exitScale})`,
            filter: `blur(${exitBlur}px)`,
            clipPath: `inset(0 ${hideRight}% 0 0)`,
            textShadow: "0 0 16px rgba(255,255,255,0.3)",
            paddingLeft: "0.2em",
          }}
        >
          {upper(text)}
        </div>
        {/* 露出エッジを走る光の帯 */}
        <div
          style={{
            position: "absolute",
            top: "50%",
            left: edgeX,
            width: 220,
            height: fontSize * 2,
            transform: "translate(-50%, -50%)",
            background:
              "radial-gradient(closest-side, rgba(255,255,255,0.9), rgba(190,215,255,0.35) 45%, rgba(255,255,255,0) 75%)",
            mixBlendMode: "screen",
            opacity: edgeOpacity,
            pointerEvents: "none",
          }}
        />
      </div>
    );
  }

  return (
    <AbsoluteFill
      style={{
        pointerEvents: "none",
        justifyContent: "center",
        alignItems: "center",
        padding: "0 6%",
      }}
    >
      {content}
    </AbsoluteFill>
  );
};
