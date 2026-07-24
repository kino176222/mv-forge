/**
 * SubtitleGold45（クリーンルーム再実装 / 配布可能ライン）
 *
 * 機能: セリフ体（明朝/serif）の歌詞テロップを金色に染める上品な字幕。
 * 小文字のセリフ体（既定 Playfair Display Bold）が画面左寄りに1行で置かれ、
 * 文字は「間欠的」（左から右への流れ＋不規則なゆらぎ）に、淡いグレーから
 * 白へふわっと現れる。少し遅れて、金色のハイライトが柔らかい境界で
 * 左から右へカラオケ風に染めていき、最後は全体が静かに沈んで消える。
 * バラード・ミディアムテンポのリリックビデオ向け。
 *
 * 実装は機能記述と自前レンダリングの見た目比較のみを根拠にした白紙書き起こし。
 * 旧ポートのコード・定数は参照していない。
 *
 * タイムライン（既定値, durationInFrames=D, fps基準）:
 *   revealStart(=0)         … 文字の出現開始。各文字は左→右の流れ＋ゆらぎで間欠的に
 *   revealWindow(≈1.7s)     … この窓の中で全文字が出揃う
 *   sweepStart(≈0.65s)      … 金の染め開始（柔らかい境界のワイプ）
 *   sweepEnd(≈D-0.6s)       … 染め完了（全文字が金になる）
 *   outStart(≈D-0.45s)      … 全体フェードアウト開始 → Dで消灯
 */
import React, { useMemo } from "react";
import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { loadFont } from "@remotion/google-fonts/PlayfairDisplay";

const { fontFamily: PLAYFAIR } = loadFont("normal", {
  weights: ["700"],
  subsets: ["latin"],
});

export type SubtitleGold45Props = {
  /** 表示テキスト。改行(\n)で複数行 */
  text: string;
  /** この字幕の表示フレーム数 */
  durationInFrames: number;

  // ---- レイアウトのつまみ ----
  /** フォントサイズ(px) */
  fontSize?: number;
  /** フォントファミリー。既定は Playfair Display（セリフ体） */
  fontFamily?: string;
  /** フォントウェイト */
  fontWeight?: number;
  /** 字間（em推奨） */
  letterSpacing?: string | number;
  /** 行の詰まり具合（fontSizeに対する倍率） */
  lineHeight?: number;
  /** 行揃え。既定は左寄せ */
  textAlign?: "left" | "center" | "right";
  /** 左右の余白(px)。textAlign=left なら左端からの距離になる */
  insetX?: number;
  /** 画面中央からの位置オフセット(px) */
  posX?: number;
  posY?: number;

  // ---- 色のつまみ ----
  /** 染まった後の金色 */
  goldColor?: string;
  /** 染まる前の文字色（白） */
  baseColor?: string;
  /** 出現直後の淡い色（ここから白へ立ち上がる） */
  dimColor?: string;
  /** グローの強さ 0(無し)〜1(強め) */
  glow?: number;

  // ---- タイミングのつまみ（すべてフレーム単位） ----
  /** 文字の出現開始フレーム */
  revealStart?: number;
  /** 全文字が出揃うまでの窓。既定 fps*1.7 */
  revealWindow?: number;
  /** 出現順のゆらぎ 0(整然)〜1(かなり不規則)。既定 0.55 */
  revealJitter?: number;
  /** 1文字が淡色→白に立ち上がる時間。既定 fps*0.25 */
  charRise?: number;
  /** 金の染め開始。既定 fps*0.65 */
  sweepStart?: number;
  /** 金の染め完了。既定 durationInFrames - fps*0.6 */
  sweepEnd?: number;
  /** 染め境界の柔らかさ（行幅に対する割合 0〜0.5）。既定 0.18 */
  sweepSoftness?: number;
  /** 全体フェードアウト開始。既定 durationInFrames - fps*0.45 */
  outStart?: number;
};

/** 決定的な擬似乱数（文字ごとの出現ゆらぎ用） */
const hash01 = (i: number): number => {
  let x = (i + 1) * 2654435761;
  x = Math.imul(x ^ (x >>> 15), 2246822519);
  x = Math.imul(x ^ (x >>> 13), 3266489917);
  return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
};

/** #RRGGBB → rgba(r,g,b,a)。それ以外の表記はそのまま返す */
const withAlpha = (color: string, alpha: number): string => {
  const m = /^#([0-9a-fA-F]{6})$/.exec(color.trim());
  if (!m) return color;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${Math.max(
    0,
    Math.min(1, alpha),
  ).toFixed(3)})`;
};

/** 2つの #RRGGBB を t(0〜1) で線形補間 */
const mixHex = (a: string, b: string, t: number): string => {
  const pa = /^#([0-9a-fA-F]{6})$/.exec(a.trim());
  const pb = /^#([0-9a-fA-F]{6})$/.exec(b.trim());
  if (!pa || !pb) return t < 0.5 ? a : b;
  const na = parseInt(pa[1], 16);
  const nb = parseInt(pb[1], 16);
  const ch = (sa: number, sb: number) => Math.round(sa + (sb - sa) * t);
  const r = ch((na >> 16) & 255, (nb >> 16) & 255);
  const g = ch((na >> 8) & 255, (nb >> 8) & 255);
  const bl = ch(na & 255, nb & 255);
  return `#${((r << 16) | (g << 8) | bl).toString(16).padStart(6, "0")}`;
};

export const SubtitleGold45: React.FC<SubtitleGold45Props> = ({
  text,
  durationInFrames,
  fontSize = 123,
  fontFamily,
  fontWeight = 700,
  letterSpacing = "0.005em",
  lineHeight = 1.18,
  textAlign = "left",
  insetX = 232,
  posX = 0,
  posY = -6,
  goldColor = "#F7DE67",
  baseColor = "#F4F2EE",
  dimColor = "#5A5A5A",
  glow = 0.6,
  revealStart = 0,
  revealWindow,
  revealJitter = 0.55,
  charRise,
  sweepStart,
  sweepEnd,
  sweepSoftness = 0.18,
  outStart,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const lines = useMemo(() => text.split("\n").map((l) => Array.from(l)), [text]);
  const totalChars = lines.reduce((n, l) => n + l.length, 0);

  const revealWin = revealWindow ?? Math.round(fps * 1.7);
  const rise = charRise ?? Math.max(2, Math.round(fps * 0.25));
  const sweepT0 = sweepStart ?? Math.round(fps * 0.65);
  const sweepT1 =
    sweepEnd ?? Math.max(sweepT0 + 1, durationInFrames - Math.round(fps * 0.6));
  const outT0 = outStart ?? Math.max(0, durationInFrames - Math.round(fps * 0.45));

  if (totalChars === 0) return null;

  // 全体フェードアウト（最後に静かに沈む）
  const globalOpacity = interpolate(frame, [outT0, durationInFrames], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  if (globalOpacity <= 0) return null;

  // 文字ごとの出現開始フレーム: 左→右の流れ + 決定的なゆらぎ。
  // 一部の文字は「早出し」され、飛び地のように先に現れる（間欠感）
  const revealAt = (gi: number): number => {
    const base = totalChars <= 1 ? 0 : gi / (totalChars - 1);
    const h = hash01(gi);
    const early = h < revealJitter * 0.4 ? 0.45 : 1;
    const wobble = (hash01(gi * 7 + 3) - 0.5) * revealJitter * 0.25;
    const t = Math.min(1, Math.max(0, base * early + wobble));
    return revealStart + t * (revealWin - rise);
  };

  // 出現進行度 0→1（淡色→白の立ち上がりにも使う）
  const riseOf = (gi: number): number =>
    interpolate(frame, [revealAt(gi), revealAt(gi) + rise], [0, 1], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    });

  // 金の染め進行（行の左端0→右端1）。境界は sweepSoftness 表示分だけ柔らかい
  const sweepP = interpolate(frame, [sweepT0, sweepT1], [0, 1 + sweepSoftness], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const family = fontFamily ?? PLAYFAIR;

  const lineStyle: React.CSSProperties = {
    fontFamily: family,
    fontWeight,
    fontSize,
    lineHeight,
    letterSpacing,
    whiteSpace: "pre",
  };

  // グロー: 白は涼しく控えめ、金は暖かく強め
  const whiteGlow =
    glow <= 0
      ? undefined
      : `0 0 ${0.06 * glow}em ${withAlpha("#FFFFFF", 0.55 * glow)}, 0 0 ${
          0.18 * glow
        }em ${withAlpha("#FFFFFF", 0.35 * glow)}`;
  const goldGlow =
    glow <= 0
      ? undefined
      : `0 0 ${0.08 * glow}em ${withAlpha(goldColor, 0.8 * glow)}, 0 0 ${
          0.24 * glow
        }em ${withAlpha(goldColor, 0.55 * glow)}, 0 0 ${0.5 * glow}em ${withAlpha(
          goldColor,
          0.28 * glow,
        )}`;

  let running = 0;

  return (
    <AbsoluteFill
      style={{
        flexDirection: "column",
        justifyContent: "center",
        alignItems:
          textAlign === "left"
            ? "flex-start"
            : textAlign === "right"
              ? "flex-end"
              : "center",
        paddingLeft: insetX,
        paddingRight: insetX,
        transform: `translate(${posX}px, ${posY}px)`,
        opacity: globalOpacity,
      }}
    >
      {lines.map((chars, li) => {
        const startIndex = running;
        running += chars.length;
        const softPx = sweepSoftness; // 行幅比
        return (
          <div key={li} style={{ position: "relative" }}>
            {/* 下地: 淡色→白に立ち上がる文字（間欠出現） */}
            <div style={{ ...lineStyle, color: baseColor }}>
              {chars.map((ch, ci) => {
                const r = riseOf(startIndex + ci);
                if (r <= 0) return (
                  <span key={ci} style={{ opacity: 0 }}>
                    {ch}
                  </span>
                );
                const color = mixHex(dimColor, baseColor, Math.min(1, r * 1.25));
                return (
                  <span
                    key={ci}
                    style={{
                      color,
                      opacity: Math.min(1, r * 2.2),
                      textShadow: r > 0.85 ? whiteGlow : undefined,
                    }}
                  >
                    {ch}
                  </span>
                );
              })}
            </div>
            {/* 金の染め: 柔らかい境界のマスクで左→右へ */}
            {sweepP > 0 && (
              <div
                style={{
                  position: "absolute",
                  inset: "-0.35em",
                  padding: "0.35em",
                  WebkitMaskImage: `linear-gradient(90deg, #000 ${
                    (sweepP - softPx) * 100
                  }%, transparent ${sweepP * 100}%)`,
                  maskImage: `linear-gradient(90deg, #000 ${
                    (sweepP - softPx) * 100
                  }%, transparent ${sweepP * 100}%)`,
                }}
              >
                <div style={{ ...lineStyle, color: goldColor }}>
                  {chars.map((ch, ci) => {
                    const r = riseOf(startIndex + ci);
                    return (
                      <span
                        key={ci}
                        style={{
                          opacity: Math.min(1, r * 2.2),
                          textShadow: goldGlow,
                        }}
                      >
                        {ch}
                      </span>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </AbsoluteFill>
  );
};

export default SubtitleGold45;
