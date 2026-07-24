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

// 配布ビルドでローカルフォント（Helvetica等）に依存しないよう、ラテンは Inter、
// 和文グリフは Noto Sans JP を @remotion/google-fonts から読み込む。
const { fontFamily: INTER } = loadInter("normal", {
  weights: ["400", "600", "800"],
  subsets: ["latin", "latin-ext"],
});
const { fontFamily: NOTO_SANS_JP } = loadNotoSansJP("normal", {
  weights: ["400", "700"],
  subsets: ["japanese", "latin"],
});

/**
 * LowerThirdFamilyCR — 角に寄せたバー付き2段テロップ（下部テロップ／コールアウト家族部品）。
 *
 * クリーンルーム実装（機能記述と旧レンダのポスターの見た目のみを根拠に白紙から作成。
 * 機能記述だけから実装している）。
 *
 * 役割: description / callout / credits / details / lower3rd を1コンポで賄う。
 * text は1段（改行なし）でも、"主題\n補足" のように \n で2段にしても崩れない。
 * lines[0]=主題（大・太）, lines[1..]=補足（小・字間広め）として描画する。
 *
 * variant(0..1) は内部で5つのスタイルプリセットに振り分ける。枠形状と動きが変わる:
 *   preset 0 (variant<0.2)  BAR     … 左端に縦アクセントバー。バーが縦に伸び、
 *                                      文字が左からスライドイン（コールアウト調）。
 *   preset 1 (0.2..0.4)     BOX     … 半透明の暗幕付き矩形フレーム。角に塗りタブ。
 *                                      枠と中身が左→右へワイプで現れる。
 *   preset 2 (0.4..0.6)     LINE    … テキスト下にアンダーバー。下線が左→右へ伸びる
 *                                      （"VOICE MERGE" のような下線演出）。
 *   preset 3 (0.6..0.8)     PILL    … 角丸ピルの暗幕。左端にドットマーカー。
 *                                      左基点でポンと弾んで拡大（spring）。
 *   preset 4 (0.8..1.0)     BRACKET … 対角のL字コーナーブラケット。ブラケットが
 *                                      内側へ寄って締まる（クレジット／詳細調）。
 *
 * 共通: 画面左下（下部テロップ位置）にアンカー。durationInFrames に対して
 * 入場→保持→退場 を自動配置し、終盤フレームまで文字を見せる。決定論的
 * （Math.random/Date 不使用・useCurrentFrame 基準）で renderStill 安全。
 */
export type LowerThirdFamilyCRProps = {
  /** 表示文言。改行 \n で 主題／補足 の2段になる（1段でも可） */
  text: string;
  /** この部品が画面に居る総フレーム数（Sequence の長さに合わせる） */
  durationInFrames: number;
  /** 主題行の文字サイズ(px)。補足行はこの約0.42倍 */
  fontSize?: number;
  /** フォント。既定は Inter→Noto Sans JP フォールバック */
  fontFamily?: string;
  /** スタイルプリセット選択 0..1（0/0.25/0.5/0.75/1.0 で明確に変わる） */
  variant?: number;
  /** 文字とアクセント（バー・枠・下線）の基調色 */
  color?: string;
  /** 行（\n）単位の色上書き。[0]=主題、[1..]=補足の各行。アクセントは color のまま */
  lineStyles?: XpLineStyle[];
};

const clamp01 = (t: number): number => Math.min(1, Math.max(0, t));

export const LowerThirdFamilyCR: React.FC<LowerThirdFamilyCRProps> = ({
  text,
  durationInFrames,
  fontSize = 66,
  fontFamily = `'${INTER}', '${NOTO_SANS_JP}', sans-serif`,
  variant = 0,
  color = "#ffffff",
  lineStyles,
}) => {
  const frame = useCurrentFrame();
  const { width, height, fps } = useVideoConfig();

  // ---- プリセット選択（0..1 → 0..4）----
  const preset = Math.min(4, Math.max(0, Math.floor(clamp01(variant) * 5 - 1e-6)));

  // ---- タイミング（入場→保持→退場）----
  const enterDur = Math.max(1, Math.min(18, Math.floor(durationInFrames * 0.32)));
  const exitDur = Math.max(1, Math.min(14, Math.floor(durationInFrames * 0.24)));
  const exitStart = Math.max(enterDur + 1, durationInFrames - exitDur - 1);

  // 入場: バネ（0→1、末尾で軽く行き過ぎる）
  const enter = spring({
    frame,
    fps,
    durationInFrames: enterDur,
    config: { damping: 18, mass: 0.7, stiffness: 130 },
  });
  const reveal = clamp01(enter); // ワイプ・拡大などクランプが要る所で使う

  // フェード（入場は素早く、退場でゼロへ）
  const fadeIn = interpolate(frame, [0, Math.max(1, Math.min(enterDur, 10))], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const exitT = interpolate(frame, [exitStart, exitStart + exitDur], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const exitEase = exitT * exitT;
  const opacity = fadeIn * (1 - exitEase);
  const exitSlide = exitEase * Math.round(fontSize * 0.5);

  // 補足行はほんの少し遅れて満ちる
  const secReveal = clamp01((enter - 0.28) / 0.72);

  // ---- 文言を2段に分解 ----
  const parts = String(text).split("\n");
  const primary = parts[0] ?? "";
  const secondaryParts = parts.slice(1);
  const secondary = secondaryParts.join("  ").trim();
  // 行単位の色: [0]=主題 / [1..]=補足の各行（未設定行は textColor のまま）
  const primaryColor = lineStyles?.[0]?.color;
  const secondaryColors = secondaryParts.map((_, k) => lineStyles?.[k + 1]?.color);

  // ---- 色・寸法 ----
  const accent = color;
  const textColor = color;
  const backdrop = "rgba(9,11,18,0.52)";
  const shadow = "0 2px 14px rgba(0,0,0,0.55), 0 0 2px rgba(0,0,0,0.4)";
  const secSize = Math.round(fontSize * 0.42);
  const barW = Math.max(6, Math.round(fontSize * 0.11));
  const gap = Math.round(fontSize * 0.1);

  // ---- 位置（左下・下部テロップ）----
  const anchorLeft = Math.round(width * 0.07);
  const anchorBottom = Math.round(height * 0.13);

  const textBlock = (extraStyle?: React.CSSProperties): React.ReactNode => (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap,
        ...extraStyle,
      }}
    >
      <div
        style={{
          fontFamily,
          fontWeight: 800,
          fontSize,
          lineHeight: 1.04,
          letterSpacing: "-0.01em",
          color: primaryColor ?? textColor,
          textShadow: shadow,
          whiteSpace: "nowrap",
        }}
      >
        {primary || " "}
      </div>
      {secondary ? (
        <div
          style={{
            fontFamily,
            fontWeight: 600,
            fontSize: secSize,
            lineHeight: 1.1,
            letterSpacing: "0.16em",
            textTransform: "uppercase",
            color: textColor,
            opacity: 0.82 * secReveal,
            transform: `translateY(${(1 - secReveal) * 6}px)`,
            textShadow: shadow,
            whiteSpace: "nowrap",
          }}
        >
          {secondaryColors.some(Boolean)
            ? secondaryParts.map((s, k) => (
                <React.Fragment key={k}>
                  {k > 0 ? "  " : null}
                  {secondaryColors[k] ? (
                    <span style={{ color: secondaryColors[k] }}>{s}</span>
                  ) : (
                    s
                  )}
                </React.Fragment>
              ))
            : secondary}
        </div>
      ) : null}
    </div>
  );

  // ---- プリセットごとの装飾ノード ----
  let node: React.ReactNode;

  if (preset === 0) {
    // BAR: 左に縦アクセントバー。バーが縦に伸び、文字が左からスライド。
    node = (
      <div style={{ display: "flex", alignItems: "stretch", gap: Math.round(fontSize * 0.4) }}>
        <div
          style={{
            width: barW,
            alignSelf: "stretch",
            background: accent,
            borderRadius: barW / 2,
            transformOrigin: "center",
            transform: `scaleY(${reveal})`,
            boxShadow: `0 0 12px ${accent}66`,
          }}
        />
        <div style={{ transform: `translateX(${(1 - reveal) * -26}px)` }}>{textBlock()}</div>
      </div>
    );
  } else if (preset === 1) {
    // BOX: 半透明暗幕の矩形フレーム。左→右へワイプ。左上に塗りタブ。
    const bw = Math.max(2, Math.round(fontSize * 0.045));
    node = (
      <div
        style={{
          position: "relative",
          display: "inline-block",
          padding: `${Math.round(fontSize * 0.34)}px ${Math.round(fontSize * 0.5)}px`,
          border: `${bw}px solid ${accent}`,
          background: backdrop,
          clipPath: `inset(0 ${(1 - reveal) * 100}% 0 0)`,
        }}
      >
        <div
          style={{
            position: "absolute",
            top: -bw,
            left: -bw,
            width: Math.round(fontSize * 0.7),
            height: bw * 3,
            background: accent,
          }}
        />
        {textBlock()}
      </div>
    );
  } else if (preset === 2) {
    // LINE: テキスト下のアンダーバーが左→右へ伸びる。
    const uh = Math.max(4, Math.round(fontSize * 0.07));
    node = (
      <div
        style={{
          position: "relative",
          display: "inline-block",
          paddingBottom: Math.round(fontSize * 0.28),
        }}
      >
        {textBlock({ transform: `translateY(${(1 - reveal) * 10}px)` })}
        <div
          style={{
            position: "absolute",
            left: 0,
            bottom: 0,
            width: "100%",
            height: uh,
            background: accent,
            borderRadius: uh / 2,
            transformOrigin: "left center",
            transform: `scaleX(${reveal})`,
            boxShadow: `0 0 12px ${accent}55`,
          }}
        />
      </div>
    );
  } else if (preset === 3) {
    // PILL: 角丸ピルの暗幕が左基点でポンと拡大。左端にドット。
    const pop = 0.7 + 0.3 * Math.min(1.08, enter);
    const dot = Math.round(fontSize * 0.22);
    node = (
      <div
        style={{
          position: "relative",
          display: "inline-flex",
          alignItems: "center",
          gap: Math.round(fontSize * 0.32),
          padding: `${Math.round(fontSize * 0.3)}px ${Math.round(fontSize * 0.55)}px ${Math.round(
            fontSize * 0.3,
          )}px ${Math.round(fontSize * 0.45)}px`,
          borderRadius: 999,
          background: backdrop,
          border: `${Math.max(1, Math.round(fontSize * 0.03))}px solid ${accent}55`,
          transformOrigin: "left center",
          transform: `scale(${pop})`,
        }}
      >
        <div
          style={{
            width: dot,
            height: dot,
            borderRadius: "50%",
            background: accent,
            flex: "none",
            boxShadow: `0 0 12px ${accent}88`,
            transform: `scale(${reveal})`,
          }}
        />
        {textBlock()}
      </div>
    );
  } else {
    // BRACKET: 対角のL字コーナーが内側へ寄って締まる。
    const bt = Math.max(3, Math.round(fontSize * 0.06)); // 線の太さ
    const bl = Math.round(fontSize * 0.55); // 線の長さ
    const off = (1 - reveal) * Math.round(fontSize * 0.5); // 寄せ量
    const corner = (pos: "tl" | "br"): React.ReactNode => {
      const isTL = pos === "tl";
      const dxy = isTL ? -off : off;
      const lineBg: React.CSSProperties = {
        position: "absolute",
        background: accent,
        boxShadow: `0 0 10px ${accent}44`,
      };
      const wrap: React.CSSProperties = {
        position: "absolute",
        top: isTL ? 0 : undefined,
        bottom: isTL ? undefined : 0,
        left: isTL ? 0 : undefined,
        right: isTL ? undefined : 0,
        width: bl,
        height: bl,
        transform: `translate(${dxy}px, ${dxy}px)`,
      };
      const hLine: React.CSSProperties = {
        ...lineBg,
        top: isTL ? 0 : undefined,
        bottom: isTL ? undefined : 0,
        left: isTL ? 0 : undefined,
        right: isTL ? undefined : 0,
        width: bl,
        height: bt,
      };
      const vLine: React.CSSProperties = {
        ...lineBg,
        top: isTL ? 0 : undefined,
        bottom: isTL ? undefined : 0,
        left: isTL ? 0 : undefined,
        right: isTL ? undefined : 0,
        width: bt,
        height: bl,
      };
      return (
        <div key={pos} style={wrap}>
          <div style={hLine} />
          <div style={vLine} />
        </div>
      );
    };
    node = (
      <div
        style={{
          position: "relative",
          display: "inline-block",
          padding: `${Math.round(fontSize * 0.4)}px ${Math.round(fontSize * 0.62)}px`,
        }}
      >
        {corner("tl")}
        {corner("br")}
        {textBlock()}
      </div>
    );
  }

  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      <div
        style={{
          position: "absolute",
          left: anchorLeft,
          bottom: anchorBottom,
          opacity,
          transform: `translateY(${exitSlide}px)`,
        }}
      >
        {node}
      </div>
    </AbsoluteFill>
  );
};
