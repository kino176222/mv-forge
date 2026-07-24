/**
 * SubtitleDefocus01 — 映画風「デフォーカス解像」テロップ（クリーンルーム再実装）。
 *
 * 挙動（機能記述から設計）:
 *  1. 冒頭、全文字が左から高速タイプオンで出現する。ただし出現直後は
 *     「その場にあるがボケて薄いグレー」＝デフォーカス状態（弱い色収差つき）。
 *  2. 左→右へシャープ化スイープ（カラオケ風の前線）が走り、通過済みの文字だけが
 *     鮮明な白＋ソフトグローに解像していく。
 *  3. 全文解像後しばらく保持し、終端で左から順に文字がフェードアウトする。
 *  4. 全体に薄い粒状ノイズを重ねて映画フィルムの質感を足す。
 *
 * レイアウト・色・タイミングはすべて props のつまみ。既定値だけで完成した見た目になる。
 * 既定フォントは Google Fonts の Antonio（配布可能・Macローカル非依存）。
 */
import React, { useMemo } from "react";
import { AbsoluteFill, interpolate, interpolateColors, useCurrentFrame } from "remotion";
import { loadFont as loadAntonio } from "@remotion/google-fonts/Antonio";

const { fontFamily: ANTONIO } = loadAntonio("normal", {
  weights: ["400", "500", "600"],
  subsets: ["latin"],
});

export type SubtitleDefocusLW5RProps = {
  /** 表示テキスト。"\n" で複数行（中央揃え） */
  text: string;
  /** エフェクト全体の尺（frames）。終端フェードの基準になる */
  durationInFrames: number;

  // ---- 文字組み ----
  /** フォント。既定は Antonio（Google Fonts、配布可） */
  fontFamily?: string;
  fontWeight?: number;
  fontSize?: number;
  /** 行送り（em） */
  lineHeightEm?: number;
  /** 字間（em） */
  letterSpacingEm?: number;
  /** true で大文字化して表示 */
  uppercase?: boolean;

  // ---- 配置 ----
  /** テキストブロック中心の縦位置（画面高さに対する%。50=ど真ん中） */
  centerYPct?: number;
  /** 横方向の中心位置（%。50=中央） */
  centerXPct?: number;

  // ---- 色と質感 ----
  /** 解像後の文字色 */
  sharpColor?: string;
  /** デフォーカス中の文字色 */
  defocusColor?: string;
  /** デフォーカス中の不透明度 (0..1) */
  defocusOpacity?: number;
  /** デフォーカスのボケ量（px、スイープ前線から遠い文字の定常値） */
  defocusBlurPx?: number;
  /** 冒頭タイプオン中に上乗せする追加ボケ（px）。スイープ開始までに0へ戻る */
  introBlurPx?: number;
  /** 解像後のソフトグロー強度 (0=無し, 1=標準, それ以上も可) */
  glowStrength?: number;
  /** デフォーカス中の色収差オフセット（px、0で無効） */
  aberrationPx?: number;
  /** 粒状ノイズの不透明度 (0..1、0で無効) */
  grainOpacity?: number;

  // ---- タイミング ----
  /** 冒頭タイプオンに使うフレーム数（全文字がこの間に出現） */
  typeOnFrames?: number;
  /** シャープ化スイープの開始フレーム */
  sweepStartFrame?: number;
  /** スイープが全文字を通過し終えるタイミング（durationに対する割合 0..1） */
  sweepEndRatio?: number;
  /** 白く冴える境目の幅（文字数。小さいほどキレのある前線） */
  sweepFrontChars?: number;
  /** 前線の先でボケが徐々に強まる勾配の幅（文字数） */
  blurSpreadChars?: number;
  /** 終端フェードアウトに使うフレーム数（最終フレームで尻尾が残る、映画的なカット） */
  fadeOutFrames?: number;
};

/** 0..1 に丸めた smoothstep */
const smooth = (t: number): number => {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
};

export const SubtitleDefocus01: React.FC<SubtitleDefocusLW5RProps> = ({
  text,
  durationInFrames,
  fontFamily = ANTONIO,
  fontWeight = 500,
  fontSize = 104,
  lineHeightEm = 1.24,
  letterSpacingEm = 0.008,
  uppercase = false,
  centerYPct = 50,
  centerXPct = 50,
  sharpColor = "#ffffff",
  defocusColor = "#b0b0b0",
  defocusOpacity = 0.55,
  defocusBlurPx = 8,
  introBlurPx = 6,
  glowStrength = 1,
  aberrationPx = 2.5,
  grainOpacity = 0.045,
  typeOnFrames = 6,
  sweepStartFrame = 8,
  sweepEndRatio = 0.85,
  sweepFrontChars = 2.5,
  blurSpreadChars = 9,
  fadeOutFrames = 6,
}) => {
  const frame = useCurrentFrame();

  const lines = useMemo(() => {
    const src = uppercase ? text.toUpperCase() : text;
    return src.split("\n").map((line) => Array.from(line));
  }, [text, uppercase]);

  const totalChars = useMemo(
    () => lines.reduce((sum, chars) => sum + chars.length, 0),
    [lines],
  );

  // --- タイムライン ---
  // タイプオン: 文字 i は charAppearAt(i) で出現し始める
  const appearAt = (i: number): number =>
    totalChars <= 1 ? 0 : (i / (totalChars - 1)) * Math.max(1, typeOnFrames);

  // シャープ化スイープ前線（文字インデックス空間を進む）。
  // 序盤やや速く終盤ゆっくり＝映画的なease-out。
  const sweepEndFrame = Math.max(
    sweepStartFrame + 1,
    Math.round(durationInFrames * sweepEndRatio),
  );
  const front = interpolate(
    frame,
    [sweepStartFrame, sweepEndFrame],
    [-sweepFrontChars, totalChars + sweepFrontChars],
    {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
      easing: (t) => 1 - Math.pow(1 - t, 1.5),
    },
  );

  // 冒頭だけ追加ボケ（タイプオン中は全体がより深くデフォーカス）
  const introBlur = interpolate(
    frame,
    [0, Math.max(1, sweepStartFrame)],
    [introBlurPx, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );

  // 終端フェード前線。旧作同様、最終フレームでも右端の尻尾は残る勢いで左から消す
  const fadeWidth = 2;
  const fadeStart = durationInFrames - Math.max(1, fadeOutFrames);
  const fadeRate = totalChars / (Math.max(1, fadeOutFrames) + 0.5);
  const fadeFront = Math.max(0, frame - fadeStart) * fadeRate;

  // 粒状ノイズ（SVG feTurbulence の data URI タイル。frameで位置をずらす）
  const grainUri = useMemo(() => {
    const svg =
      `<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'>` +
      `<filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/>` +
      `<feColorMatrix type='saturate' values='0'/></filter>` +
      `<rect width='160' height='160' filter='url(%23n)'/></svg>`;
    return `url("data:image/svg+xml;utf8,${svg}")`;
  }, []);
  const grainX = ((frame * 53) % 160) - 80;
  const grainY = ((frame * 97) % 160) - 80;

  let charIndex = -1;

  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      <div
        style={{
          position: "absolute",
          left: `${centerXPct}%`,
          top: `${centerYPct}%`,
          transform: "translate(-50%, -50%)",
          textAlign: "center",
          whiteSpace: "pre",
          fontFamily,
          fontWeight,
          fontSize,
          lineHeight: `${lineHeightEm}em`,
          letterSpacing: `${letterSpacingEm}em`,
        }}
      >
        {lines.map((chars, lineIdx) => (
          <div key={lineIdx}>
            {chars.map((ch, i) => {
              charIndex += 1;
              const idx = charIndex;

              // 出現（タイプオン）
              const a0 = appearAt(idx);
              const appear = interpolate(frame, [a0, a0 + 1.2], [0, 1], {
                extrapolateLeft: "clamp",
                extrapolateRight: "clamp",
              });

              // 解像度（0=デフォーカス, 1=シャープ）。白+グローの前線はキレよく
              const sharp = smooth(
                (front - idx) / Math.max(0.001, sweepFrontChars),
              );
              // ボケは前線の先に向かってなだらかに深くなる勾配
              const defocus = smooth(
                (idx - front) / Math.max(0.001, blurSpreadChars),
              );

              // 終端フェード（左から順に消える）
              const alive = 1 - smooth((fadeFront - idx) / fadeWidth);

              const opacity =
                appear * alive * (defocusOpacity + (1 - defocusOpacity) * sharp);
              if (opacity <= 0.001) {
                // 見えない文字も幅は保つ（行内レイアウトを崩さない）
                return (
                  <span key={i} style={{ visibility: "hidden" }}>
                    {ch}
                  </span>
                );
              }

              const blurPx = introBlur * (1 - sharp) + defocus * defocusBlurPx;
              const color = interpolateColors(
                sharp,
                [0, 1],
                [defocusColor, sharpColor],
              );

              const shadows: string[] = [];
              if (glowStrength > 0 && sharp > 0.01) {
                shadows.push(
                  `0 0 ${(16 * glowStrength * sharp).toFixed(1)}px rgba(255,255,255,${(0.55 * sharp).toFixed(3)})`,
                  `0 0 ${(3 * glowStrength * sharp).toFixed(1)}px rgba(255,255,255,${(0.75 * sharp).toFixed(3)})`,
                );
              }
              const ab = aberrationPx * Math.max(defocus, introBlur / Math.max(0.001, introBlurPx || 1)) * (1 - sharp);
              if (ab > 0.05) {
                shadows.push(
                  `${ab.toFixed(2)}px 0 0 rgba(255,70,70,0.35)`,
                  `${(-ab).toFixed(2)}px 0 0 rgba(70,200,255,0.35)`,
                );
              }

              return (
                <span
                  key={i}
                  style={{
                    display: "inline-block",
                    whiteSpace: "pre",
                    color,
                    opacity,
                    filter: blurPx > 0.1 ? `blur(${blurPx.toFixed(2)}px)` : undefined,
                    textShadow: shadows.length ? shadows.join(", ") : undefined,
                  }}
                >
                  {ch}
                </span>
              );
            })}
          </div>
        ))}
      </div>

      {grainOpacity > 0 && (
        <AbsoluteFill
          style={{
            backgroundImage: grainUri,
            backgroundRepeat: "repeat",
            backgroundPosition: `${grainX}px ${grainY}px`,
            opacity: grainOpacity,
            mixBlendMode: "screen",
          }}
        />
      )}
    </AbsoluteFill>
  );
};
