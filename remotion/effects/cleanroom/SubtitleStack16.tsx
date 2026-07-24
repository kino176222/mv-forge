import React, { useMemo } from "react";
import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { loadFont as loadNunito } from "@remotion/google-fonts/Nunito";
import { loadFont as loadNotoSansJP } from "@remotion/google-fonts/NotoSansJP";

/**
 * SubtitleStack16 — 複数行が連なり、上から順に黄色く染まっていくカラオケ字幕。
 *
 * クリーンルーム実装（機能記述と旧レンダの見た目のみを根拠に白紙から作成）。
 * 3幕すべてを「読み順（上→下・左→右）の文字カスケード」で統一している:
 *   1. 入場: 文字が読み順に灰色でフェードイン（先頭行から雪崩れ込む）
 *   2. 塗り: 歌唱済みの文字が読み順に 灰→黄 へ染まっていく
 *   3. 退場: 読み順に文字がフェードアウト（上の行から消えていく）
 * レイアウト・色・サイズ・タイミングはすべて props のつまみで調整可能。
 */

const { fontFamily: nunitoFamily } = loadNunito("normal", {
  weights: ["400"],
  subsets: ["latin"],
});

// 和文グリフ用フォールバック。旧既定の 'Helvetica Neue'/'Noto Sans JP'（未ロード名指し）は
// Mac ローカル頼みだったため、Noto Sans JP を実際にロードして配布ビルドでも同一にする。
const { fontFamily: notoSansJpFamily } = loadNotoSansJP("normal", {
  weights: ["400"],
  subsets: ["japanese", "latin"],
});

export type SubtitleStack16Props = {
  /** 歌詞ブロック。"\n" 区切りで複数行。長い行は maxWidthFrac で自動折返し */
  text: string;
  /** この字幕が画面に居る総フレーム数（Sequence の長さに合わせる） */
  durationInFrames: number;
  /** 文字サイズ(px) */
  fontSize?: number;
  /** フォント。既定は Nunito（丸みのあるヒューマニスト系サンセリフ） */
  fontFamily?: string;
  /** フォントウェイト */
  fontWeight?: number;
  /** 行送り(em) */
  lineHeightEm?: number;
  /** 字間(em) */
  letterSpacingEm?: number;
  /** 歌唱前の文字色（薄灰） */
  baseColor?: string;
  /** 歌唱済みの文字色（黄） */
  fillColor?: string;
  /** ブロックの水平中心 0..1（0.5=画面中央） */
  posX?: number;
  /** ブロックの垂直中心 0..1（0.5=画面中央） */
  posY?: number;
  /** 折返し幅（画面幅に対する割合）。歌詞カード風の細身ブロックが既定 */
  maxWidthFrac?: number;
  /** 入場カスケードの先端が全文を駆け抜ける時間(フレーム) */
  inSpreadFrames?: number;
  /** 入場時の1文字あたりフェード時間(フレーム) */
  inFadeFrames?: number;
  /** 黄染めが始まるフレーム。省略時は総尺の20% */
  fillStartFrame?: number;
  /** 黄染めが完了するフレーム。省略時は総尺の82% */
  fillEndFrame?: number;
  /** 黄染め先端のぼかし幅（文字数）。大きいほど柔らかく染まる */
  fillEdgeChars?: number;
  /** 退場カスケードの先端が全文を駆け抜ける時間(フレーム) */
  outSpreadFrames?: number;
  /** 退場時の1文字あたりフェード時間(フレーム) */
  outFadeFrames?: number;
};

/** "#rrggbb" → [r,g,b]（#rgb 省略形も許容） */
const hexToRgb = (hex: string): [number, number, number] => {
  const h = hex.replace("#", "");
  const full =
    h.length === 3 ? h.split("").map((c) => c + c).join("") : h.padEnd(6, "0");
  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16),
  ];
};

const mixRgb = (
  a: [number, number, number],
  b: [number, number, number],
  t: number,
): string => {
  const m = (i: number) => Math.round(a[i] + (b[i] - a[i]) * t);
  return `rgb(${m(0)}, ${m(1)}, ${m(2)})`;
};

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** CJK（日本語・中国語等）の文字か。スペース無しの和文行を文字単位で折り返すための判定 */
const CJK_RE =
  /[\u3000-\u30FF\u31F0-\u31FF\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF\uFF00-\uFFEF]/;

/** 行→単語→文字に分解し、各文字へ読み順の通し番号を振る */
type Word = { chars: { ch: string; index: number }[] };
type Line = { words: Word[] };

const tokenize = (text: string): { lines: Line[]; total: number } => {
  let index = 0;
  const lines: Line[] = text.split("\n").map((lineText) => {
    const words: Word[] = lineText
      .split(" ")
      .filter((w) => w.length > 0)
      .map((wordText) => ({
        chars: Array.from(wordText).map((ch) => ({ ch, index: index++ })),
      }));
    // 単語間スペースも1文字としてカウント（掃引速度を実文字幅に近づける）
    index += Math.max(0, words.length - 1);
    return { words };
  });
  return { lines, total: Math.max(index, 1) };
};

export const SubtitleStack16: React.FC<SubtitleStack16Props> = ({
  text,
  durationInFrames,
  fontSize = 56,
  fontFamily,
  fontWeight = 400,
  lineHeightEm = 1.4,
  letterSpacingEm = 0,
  baseColor = "#ababab",
  fillColor = "#ffeb69",
  posX = 0.5,
  posY = 0.485,
  maxWidthFrac = 0.31,
  inSpreadFrames = 7,
  inFadeFrames = 9,
  fillStartFrame,
  fillEndFrame,
  fillEdgeChars = 3,
  outSpreadFrames = 4,
  outFadeFrames = 8,
}) => {
  const frame = useCurrentFrame();
  const { lines, total } = useMemo(() => tokenize(text), [text]);

  const fillFrom = fillStartFrame ?? durationInFrames * 0.2;
  // fillStartFrame===fillEndFrame でも interpolate が [x,x] で throw しないよう下限保証
  const fillTo = Math.max(
    fillFrom + 1e-4,
    fillEndFrame ?? durationInFrames * 0.82,
  );
  const outStart = durationInFrames - (outSpreadFrames + outFadeFrames);

  // 黄染めスイープの先端位置（文字番号）。エッジぶんだけ余分に走らせて最後まで染め切る
  const fillEdge = interpolate(
    frame,
    [fillFrom, fillTo],
    [0, total + fillEdgeChars],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );

  const baseRgb = useMemo(() => hexToRgb(baseColor), [baseColor]);
  const fillRgb = useMemo(() => hexToRgb(fillColor), [fillColor]);
  const family =
    fontFamily ?? `'${nunitoFamily}', '${notoSansJpFamily}', sans-serif`;

  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      <div
        style={{
          position: "absolute",
          left: `${posX * 100}%`,
          top: `${posY * 100}%`,
          transform: "translate(-50%, -50%)",
          width: `${maxWidthFrac * 100}%`,
          textAlign: "center",
          fontFamily: family,
          fontWeight,
          fontSize,
          letterSpacing: `${letterSpacingEm}em`,
          lineHeight: lineHeightEm,
        }}
      >
        {lines.map((line, li) => (
          <div key={li}>
            {line.words.map((word, wi) => {
              // CJK を含む単語（スペース無しの和文行など）は文字単位の
              // inline-block にして文字境界で折り返せるようにする。
              // 英語は従来どおり単語単位の inline-block（単語の途中では折れない）。
              const cjkWrap = word.chars.some(({ ch }) => CJK_RE.test(ch));
              const charSpans = word.chars.map(({ ch, index }) => {
                // 入場: 読み順に遅延をつけた個別フェードイン
                const inDelay = (index / total) * inSpreadFrames;
                const appear = clamp01((frame - inDelay) / inFadeFrames);
                // 退場: 同じ向きのカスケードで個別フェードアウト
                const outDelay =
                  outStart + (index / total) * outSpreadFrames;
                const vanish = clamp01((frame - outDelay) / outFadeFrames);
                // 塗り: スイープ先端からエッジ幅ぶんの勾配で 灰→黄
                const paint = clamp01(
                  (fillEdge - index) / Math.max(fillEdgeChars, 0.001),
                );
                return (
                  <span
                    key={index}
                    style={{
                      color: mixRgb(baseRgb, fillRgb, paint),
                      opacity: appear * (1 - vanish),
                      display: cjkWrap ? "inline-block" : undefined,
                    }}
                  >
                    {ch}
                  </span>
                );
              });
              return (
                <React.Fragment key={wi}>
                  {wi > 0 ? " " : null}
                  {cjkWrap ? (
                    <span>{charSpans}</span>
                  ) : (
                    <span style={{ display: "inline-block", whiteSpace: "pre" }}>
                      {charSpans}
                    </span>
                  )}
                </React.Fragment>
              );
            })}
          </div>
        ))}
      </div>
    </AbsoluteFill>
  );
};
