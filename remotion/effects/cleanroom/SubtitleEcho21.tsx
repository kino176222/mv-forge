import React from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import { loadFont as loadInter } from "@remotion/google-fonts/Inter";
import { loadFont as loadNotoSansJP } from "@remotion/google-fonts/NotoSansJP";

// 旧既定は Mac ローカルの 'Helvetica Neue'。配布ビルドで化けないよう、
// 字形の近いネオグロテスク Inter 700 に置換し、和文グリフは Noto Sans JP で受ける。
const { fontFamily: INTER } = loadInter("normal", {
  weights: ["700"],
  subsets: ["latin", "latin-ext"],
});
const { fontFamily: NOTO_SANS_JP } = loadNotoSansJP("normal", {
  weights: ["700"],
  subsets: ["japanese", "latin"],
});

/**
 * SubtitleEcho21 — エコー（残像）が重なって浮遊するタイポグラフィ字幕。
 *
 * クリーンルーム実装（機能記述と旧レンダの見た目のみを根拠に白紙から作成）。
 * 構成:
 *   1. 入場: 白ベタの主役行が画面下から中央へ減速しながらスライドイン
 *   2. 浮遊: 主役行の上下に同じ文言のアウトライン行（エコー）が
 *      じわじわとフェードインし、タイポグラフィの壁になる
 *   3. 退場: 全体が上方向へ加速して抜ける。エコー行は主役行の動きを
 *      数フレーム遅れて追いかけるため、下側は間隔が開き上側は詰まる
 *      「残像が引き伸ばされる」抜け感になる
 * レイアウト・色・サイズ・タイミングはすべて props のつまみで調整可能。
 */
export type SubtitleEcho21Props = {
  /** 表示する文言（1行・改行なし） */
  text: string;
  /** この字幕が画面に居る総フレーム数（Sequence の長さに合わせる） */
  durationInFrames: number;
  /** 文字サイズ(px)。画面幅からはみ出すくらい大きいのがこの効果の流儀 */
  fontSize?: number;
  /** フォント。既定はグロテスク系サンセリフ */
  fontFamily?: string;
  /** フォントウェイト */
  fontWeight?: number;
  /** 字間(em) */
  letterSpacingEm?: number;
  /** 主役行（ベタ塗り）の色 */
  color?: string;
  /** エコー行（アウトライン）の線色。省略時は color と同じ */
  echoColor?: string;
  /** エコー行のアウトライン太さ(px) */
  echoStrokeWidth?: number;
  /** 主役行の上に重ねるエコー行数 */
  echoRowsAbove?: number;
  /** 主役行の下に重ねるエコー行数 */
  echoRowsBelow?: number;
  /** 行送り(px)。省略時は fontSize * 0.85（少し詰めて壁にする） */
  lineSpacing?: number;
  /** 行の左端位置。画面幅に対する割合（負値で左へはみ出し） */
  posX?: number;
  /** 主役行の垂直中心 0..1（0.5=画面中央） */
  posY?: number;
  /** 入場が始まるフレーム */
  enterDelayFrames?: number;
  /** 入場スライドの長さ(フレーム) */
  enterDurationFrames?: number;
  /** 退場スライドの長さ(フレーム)。終了間際に完了するよう自動配置 */
  exitDurationFrames?: number;
  /** エコー1行あたりの追従遅れ(フレーム)。大きいほど退場時に間隔が開く */
  echoLagFrames?: number;
  /** エコーの最大不透明度 */
  maxEchoOpacity?: number;
  /** 入場距離(px)。省略時は画面下からちょうど隠れる距離 */
  enterDistance?: number;
  /** 退場距離(px)。省略時は画面上へ確実に抜ける距離 */
  exitDistance?: number;
  /** 文言を大文字化するか */
  uppercase?: boolean;
};

/** 減速イージング（入場用）: 速く入ってスッと止まる */
const easeOutCubic = (t: number): number => 1 - Math.pow(1 - t, 3);

/** 加速イージング（退場用）: じわっと動き出して一気に抜ける */
const easeInQuad = (t: number): number => t * t;

const clamp01 = (t: number): number => Math.min(1, Math.max(0, t));

export const SubtitleEcho21: React.FC<SubtitleEcho21Props> = ({
  text,
  durationInFrames,
  fontSize = 288,
  fontFamily = `'${INTER}', '${NOTO_SANS_JP}', sans-serif`,
  fontWeight = 700,
  letterSpacingEm = 0,
  color = "#ffffff",
  echoColor,
  echoStrokeWidth = 4,
  echoRowsAbove = 3,
  echoRowsBelow = 3,
  lineSpacing,
  posX = -0.006,
  posY = 0.5,
  enterDelayFrames = 4,
  enterDurationFrames = 14,
  exitDurationFrames = 14,
  echoLagFrames = 2.5,
  maxEchoOpacity = 1,
  enterDistance,
  exitDistance,
  uppercase = false,
}) => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();

  const spacing = lineSpacing ?? fontSize * 0.85;
  const strokeColor = echoColor ?? color;
  const centerY = posY * height;

  // 入場: 画面の下端よりさらに下から始める（行の高さぶんの余白込み）
  const fromBelow = enterDistance ?? height - centerY + fontSize;
  // 退場: 主役行が確実に画面上へ消える距離
  const toAbove = exitDistance ?? centerY + fontSize + spacing;

  const enterEnd = enterDelayFrames + enterDurationFrames;
  // 退場は最終フレームの少し手前で完了させ、残りは後端フェードで拭き取る
  const exitEnd = durationInFrames - 3;
  const exitStart = Math.max(enterEnd + 1, exitEnd - exitDurationFrames);

  /** 主役行の縦オフセット(px)。エコー行はこれを遅れて評価する */
  const basePath = (f: number): number => {
    const enterT = clamp01((f - enterDelayFrames) / Math.max(1, enterDurationFrames));
    // 短尺（≤20f程度）では exitStart > exitEnd になり分母が負→冒頭から退場扱いに
    // なるため、echoOpacity と同様に Math.max で分母の下限を保証する。
    const exitT = clamp01((f - exitStart) / Math.max(1, exitEnd - exitStart));
    return fromBelow * (1 - easeOutCubic(enterT)) - toAbove * easeInQuad(exitT);
  };

  // エコーは入場完了後にゆっくり浮かび上がり、退場開始までに満ちる
  const echoOpacity =
    maxEchoOpacity *
    clamp01((frame - (enterEnd + 2)) / Math.max(1, exitStart - (enterEnd + 2)));

  // 後端フェード: 遅れて追いかけるエコーが残っても最終フレームで必ず消す
  const tailFade = 1 - clamp01((frame - (durationInFrames - 4)) / 3);

  const displayText = uppercase ? text.toUpperCase() : text;

  const rows: React.ReactNode[] = [];
  for (let i = -echoRowsAbove; i <= echoRowsBelow; i++) {
    const isMain = i === 0;
    const lag = Math.abs(i) * echoLagFrames;
    const y = basePath(Math.max(0, frame - lag)) + i * spacing;
    const rowCenter = centerY + y;
    // 画面外の行は描画しない
    if (rowCenter < -fontSize || rowCenter > height + fontSize) continue;
    rows.push(
      <div
        key={i}
        style={{
          position: "absolute",
          left: posX * width,
          top: rowCenter,
          transform: "translateY(-50%)",
          whiteSpace: "nowrap",
          fontFamily,
          fontWeight,
          fontSize,
          letterSpacing: `${letterSpacingEm}em`,
          lineHeight: 1,
          color: isMain ? color : "transparent",
          WebkitTextStroke: isMain
            ? undefined
            : `${echoStrokeWidth}px ${strokeColor}`,
          opacity: isMain ? 1 : echoOpacity,
        }}
      >
        {displayText}
      </div>,
    );
  }

  return (
    <AbsoluteFill style={{ pointerEvents: "none", opacity: tailFade }}>
      {rows}
    </AbsoluteFill>
  );
};
