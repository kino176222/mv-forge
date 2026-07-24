import React from "react";
import {
  AbsoluteFill,
  interpolate,
  interpolateColors,
  Sequence,
  spring,
  useCurrentFrame,
  useVideoConfig,
  Easing,
} from "remotion";
import { resolveParams } from "@/lib/effects-meta";
import { lyricWindow } from "@/lib/telop-window";
import { isXpLyricId, xpPortIdFromEffectId } from "@/lib/xp/bridge";
import { XP_TITLE_COMPONENTS } from "../effects/xp/registry-components";
import {
  mergeTextStyle,
  type CharFx,
  type EffectInstance,
  type LineTextStyle,
  type LineWord,
  type SlotStyle,
  type TextStyle,
} from "@/lib/schema";
import { karaokeFillProgress, charStartFramesVocal } from "@/lib/lyric-words";
import { fontById } from "../fonts";
import { hashRand } from "../effects/rand";
import { beatPulse, type BeatClock } from "../effects/beat";
import { StrokedText } from "./StrokedText";
import { telopEdgePct } from "./telop-position";
import { decorById } from "./decor/registry";
import type { DecorContext } from "./decor/types";
import { TitleSignalGlitch01 } from "../effects/TitleSignalGlitch01";

/**
 * 歌詞・字幕の1行表示（lyricカテゴリ）。
 * スタイル（フォント・色・縦横）は meta.textStyle が全体固定（貼り紙1枚方式）。
 * アニメは行ごと。orientation を読んで位置・向きを自動で合わせる。
 *
 * リリックビデオ演出:
 * - lyric-stagger    … 一文字ずつ浮かび上がる（行の尺の中で演出。音素同期はしない）
 * - lyric-hero-pop   … 中央デカ文字がバンッと弾む
 * - lyric-hero-glitch… 中央デカ文字がノイズ混じりに明滅
 * - lyric-glow       … ネオン発光が脈打つ
 */

const EXIT_FRAMES = 9; // 入替型: 行の終わりでふっと消える

// MPテロップ流モーション25部品（25部品×パラメータで45プリセット相当をカバー）
const MP_MOTION_IDS = new Set<string>([
  "lyric-mp-slide", "lyric-mp-turn", "lyric-mp-mask", "lyric-mp-pop",
  "lyric-mp-scale", "lyric-mp-fly", "lyric-mp-blur", "lyric-mp-fade",
  "lyric-mp-crop", "lyric-mp-stripe", "lyric-mp-scrape", "lyric-mp-fall",
  "lyric-mp-move", "lyric-mp-jitter", "lyric-mp-bound", "lyric-mp-stretch",
  "lyric-mp-vibrate", "lyric-mp-sway", "lyric-mp-echo", "lyric-mp-wave",
  "lyric-mp-blink", "lyric-mp-shockwave", "lyric-mp-sparkle", "lyric-mp-twinkle",
  "lyric-mp-flash",
]);

type LyricLineProps = {
  text: string;
  anim: EffectInstance | null;
  textStyle: TextStyle;
  durationInFrames: number;
  placement?: "lyrics" | "prologue";
  /** 🔡 文字ごとの個別制御（遅れ・位置・回転・大きさの上書き） */
  charFx?: CharFx[];
  /** 装飾（座布団など）。出方とは独立の軸 */
  decor?: EffectInstance | null;
  /** ビート同期用クロック（lyric-glow の脈動を拍に合わせる） */
  beatClock?: BeatClock | null;
  /** 単語タイムスタンプ（曲内絶対秒）。カラオケ塗り・単語ごと出現の単語精度化に使う */
  words?: LineWord[];
  /** この行の表示開始の曲内秒（words の絶対時刻をローカルフレームへ換算するため） */
  lineStartSec?: number;
  /** 🎨 拡張テロップの行（\n）単位スタイル（line.lyricSlotStyles）。拡張以外の出方では未使用 */
  slotStyles?: SlotStyle[];
};

/**
 * 外殻: 表示窓（出だし遅れ/表示時間つまみ＋歌い終わり自動消灯）を全歌詞演出に共通適用。
 * 窓が行全域なら Sequence を挟まず従来経路そのまま（回帰ゼロ）。
 * 窓を切る場合は本体の frame/durationInFrames/lineStartSec/beatClock を窓基準に載せ替える
 * （本体の入場アニメ・行末フェード・words同期・ビート同期がそのまま窓に追従する）。
 */
export const LyricLine: React.FC<
  LyricLineProps & {
    /** 歌い終わりで自動で消す（project.meta.lyricAutoHide。wordsが無い行は行末まで） */
    autoHide?: boolean;
    /** 🅰️ この行だけの様式上書き（line.textStyle）。未設定項目は textStyle（全体）へフォールバック */
    textStyleOverride?: LineTextStyle | null;
  }
> = ({ autoHide, textStyleOverride, ...props }) => {
  const { fps } = useVideoConfig();
  // 行上書きを全体様式にマージ（上書き無しなら同一参照＝従来と完全に同じ描画）
  const textStyle = mergeTextStyle(props.textStyle, textStyleOverride);
  const animId = props.anim?.id ?? "lyric-fade";
  if (animId === "lyric-none" || !props.text.trim()) return null;
  const p = resolveParams(animId, props.anim?.params);
  const win = lyricWindow({
    delaySec: Number(p.delay ?? 0),
    durationSec: Number(p.duration ?? 0),
    autoHide: autoHide ?? false,
    words: props.words ?? [],
    lineStartSec: props.lineStartSec ?? 0,
    lineDurF: props.durationInFrames,
    fps,
  });
  if (win.fromF === 0 && win.durF === props.durationInFrames) {
    return <LyricLineBody {...props} textStyle={textStyle} />;
  }
  return (
    <Sequence from={win.fromF} durationInFrames={win.durF} layout="none">
      <LyricLineBody
        {...props}
        textStyle={textStyle}
        durationInFrames={win.durF}
        lineStartSec={(props.lineStartSec ?? 0) + win.fromF / fps}
        beatClock={
          props.beatClock
            ? {
                ...props.beatClock,
                offsetFrames: props.beatClock.offsetFrames + win.fromF,
              }
            : props.beatClock
        }
      />
    </Sequence>
  );
};

const LyricLineBody: React.FC<LyricLineProps> = ({
  text,
  anim,
  textStyle,
  durationInFrames,
  placement = "lyrics",
  charFx,
  decor,
  beatClock,
  words,
  lineStartSec,
  slotStyles,
}) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const vertical = textStyle.orientation === "vertical";

  // 文字ごと制御のルックアップ
  const fxMap = new Map<number, CharFx>();
  (charFx ?? []).forEach((f) => fxMap.set(f.i, f));
  const fxTransform = (i: number): string => {
    const f = fxMap.get(i);
    if (!f) return "";
    const parts: string[] = [];
    if (f.dx || f.dy) parts.push(`translate(${f.dx}px, ${f.dy}px)`);
    if (f.rotate) parts.push(`rotate(${f.rotate}deg)`);
    if (f.scale !== 1) parts.push(`scale(${f.scale})`);
    return parts.length ? ` ${parts.join(" ")}` : "";
  };
  const fxDelayFrames = (i: number): number =>
    Math.round((fxMap.get(i)?.delay ?? 0) * fps);

  const animId = anim?.id ?? "lyric-fade";
  if (animId === "lyric-none" || !text.trim()) return null;
  const p = resolveParams(animId, anim?.params);

  // 拡張テロップ（デザインごと使う）: 拡張コンポーネントが行を丸ごと描く。
  // 縦書きはポートが横書き前提なので lyric-fade へ自動フォールバック（lyric-type と同じ流儀）。
  // コンポーネント未解決も既存のフェードフォールバックに落ちる。
  const XpSubtitle =
    isXpLyricId(animId) && !vertical
      ? XP_TITLE_COMPONENTS[xpPortIdFromEffectId(animId)]
      : undefined;

  // タイプライターは横書き専用（縦は沼なのでフェードへ自動フォールバック）
  const effectiveAnim =
    (animId === "lyric-type" && vertical) ||
    (isXpLyricId(animId) && !XpSubtitle)
      ? "lyric-fade"
      : animId;
  const isHero =
    effectiveAnim === "lyric-hero-pop" || effectiveAnim === "lyric-hero-glitch";
  // うにょうにょ集合の中央配置オプション（参考動画は画面中央に歌詞が出る）
  const isCentered =
    isHero ||
    (effectiveAnim === "lyric-gather" &&
      String(p.pos ?? "bottom") === "center" &&
      !vertical);

  const exit = interpolate(
    frame,
    [Math.max(0, durationInFrames - EXIT_FRAMES), durationInFrames],
    [1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );

  const font = fontById(textStyle.font);
  const sizeMul = isHero ? Number(p.scale ?? 1.7) : 1;

  // ==== 1行固定: 自動折り返しはしない（歌詞データ内の明示的な \n だけ尊重）。
  //      収まらない長い行は文字サイズを縮めて1行に収める ====
  const trackingEm = isHero ? 0.1 : 0.06;
  // 全角≈1em・半角≈0.6em の推定幅で行の長さを見積もる
  const estLineEm = (line: string): number => {
    let em = 0;
    for (const ch of line) {
      const cp = ch.codePointAt(0) ?? 0;
      em += (cp < 0x2000 ? 0.6 : 1) + trackingEm;
    }
    return em;
  };
  const longestEm = Math.max(0.01, ...text.split("\n").map(estLineEm));
  // lyric-gather は漢字を最大1.22倍に拡大＋字間paddingがあるため、その分も見込む
  const charGrowMul = effectiveAnim === "lyric-gather" ? 1.3 : 1;
  const fitFontSize = (base: number, availFrac: number): number => {
    const availPx = (vertical ? height : width) * availFrac;
    return Math.min(base, availPx / (longestEm * charGrowMul));
  };

  const fontStyle: React.CSSProperties = {
    fontFamily: font.family,
    fontWeight: isHero ? Math.min(900, font.weight + 200) : font.weight,
    fontSize: fitFontSize(
      textStyle.size * sizeMul,
      isCentered ? (vertical ? 0.86 : 0.9) : vertical ? 0.84 : 0.88,
    ),
    lineHeight: 1.5,
    letterSpacing: isHero ? "0.1em" : "0.06em",
    whiteSpace: "pre",
  };

  // 配置: hero・中央指定=画面中央 / 通常=下部センター（縦書きは右側）
  const positioned: React.CSSProperties = isCentered
    ? {
        position: "absolute",
        left: "50%",
        top: "50%",
        textAlign: "center",
        whiteSpace: "pre",
        ...(vertical
          ? { writingMode: "vertical-rl" as const, textOrientation: "mixed" as const }
          : {}),
      }
    : vertical
      ? {
          position: "absolute",
          right: telopEdgePct(textStyle, placement),
          top: "50%",
          whiteSpace: "pre",
          writingMode: "vertical-rl" as const,
          textOrientation: "mixed" as const,
        }
      : {
          position: "absolute",
          left: "50%",
          bottom: telopEdgePct(textStyle, placement),
          textAlign: "center",
          whiteSpace: "pre",
        };
  const baseTranslate = isCentered
    ? "translate(-50%, -50%)"
    : vertical
      ? "translateY(-50%)"
      : "translateX(-50%)";

  // ==== 装飾レイヤー: 出方(lyricAnim)とは独立の軸。実装は ./decor/ のレジストリ ====
  const decorRenderer = decor ? decorById(decor.id) : undefined;
  const decorCtx: DecorContext | null =
    decor && decorRenderer
      ? {
          frame,
          fps,
          durationInFrames,
          text,
          textStyle,
          fontStyle,
          positioned,
          baseTranslate,
          exit,
          vertical,
          params: resolveParams(decor.id, decor.params),
          fxTransform,
          fxDelayFrames,
        }
      : null;

  // 自己完結モード（tile型など）: 行全体を装飾側が描く
  if (decorCtx && decorRenderer?.standalone) {
    const node = decorRenderer.standalone(decorCtx);
    if (node) return <>{node}</>;
  }

  // 文字レイヤーの下に敷く装飾レイヤー
  const decorLayer =
    decorCtx && decorRenderer?.layer ? decorRenderer.layer(decorCtx) : null;

  const withDecor = (motion: React.ReactNode): React.ReactElement => (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      {decorLayer}
      {motion}
    </AbsoluteFill>
  );

  const motionNode = ((): React.ReactNode => {
  // ---- 拡張テロップ: ポートが自前レイアウトを持つため1行フィット/配置処理は通さない。
  //      つまみ: font（project=全体フォント / design=ポート原設計 / 個別id）、
  //      scale/offsetX/offsetY（ポート無改造でテロップ丸ごとをラッパーdivで変形）、
  //      delay/duration（telopWindow の表示窓。Sequence でポートの入退場ごと窓に追従）----
  if (XpSubtitle) {
    const fontSel = String(p.font ?? "project");
    const xpFontFamily =
      fontSel === "design"
        ? undefined
        : fontSel === "project"
          ? font.family
          : fontById(fontSel).family;
    const xpScale = Number(p.scale ?? 1);
    const xpOx = Number(p.offsetX ?? 0);
    const xpOy = Number(p.offsetY ?? 0);
    // 文字色つまみ: 空文字=デザイン既定（渡さない＝従来と同一描画）
    const xpColor = String(p.color ?? "") || undefined;
    const xpLineStyles =
      slotStyles && slotStyles.some((s) => s?.color) ? slotStyles : undefined;
    // 表示窓（delay/duration/自動消灯）は外殻の LyricLine が適用済み。
    // ここでは窓の尺＝durationInFrames として行末フェード（exit）を掛けるだけ
    return (
      <AbsoluteFill
        style={{
          pointerEvents: "none",
          opacity: exit,
          transform: `translate(${xpOx}%, ${xpOy}%) scale(${xpScale})`,
        }}
      >
        <XpSubtitle
          text={text}
          durationInFrames={durationInFrames}
          fontFamily={xpFontFamily}
          color={xpColor}
          lineStyles={xpLineStyles}
        />
      </AbsoluteFill>
    );
  }

  // ---- カラオケフィル: 行の尺に合わせて文字色が塗り進む（単語時刻は不要の行レベル疑似カラオケ） ----
  if (effectiveAnim === "lyric-karaoke-fill") {
    const hue = Number(p.hue ?? 340);
    const dim = Number(p.dim ?? 0.55);
    const enter = interpolate(frame, [0, Math.round(0.25 * fps)], [0, 1], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    });
    // 単語タイムスタンプがあれば「歌に合わせて」塗り進む（発声中は進み、間は保持）。
    // 無ければ従来どおり行の尺で均等塗り。
    const wordProgress =
      words && words.length > 0
        ? karaokeFillProgress(
            words,
            [...text].length,
            (lineStartSec ?? 0) + frame / fps,
          )
        : -1;
    const progress =
      wordProgress >= 0
        ? Math.max(0.02, wordProgress)
        : interpolate(
            frame,
            [Math.round(0.15 * fps), Math.max(1, durationInFrames - EXIT_FRAMES)],
            [0.04, 1],
            { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
          );
    const rest = (1 - progress) * 100;
    // 横書き: 左→右 / 縦書き(vertical-rl): 上→下
    const clip = vertical ? `inset(0 0 ${rest}% 0)` : `inset(0 ${rest}% 0 0)`;
    const fill = `hsl(${hue}, 90%, 62%)`;
    return (
      <AbsoluteFill style={{ pointerEvents: "none" }}>
        <div style={{ ...positioned, transform: baseTranslate, opacity: enter * exit }}>
          <span style={{ position: "relative", display: "inline-block" }}>
            {/* 未達部分: 通常色を暗くしたベース */}
            <span style={{ display: "inline-block", opacity: 1 - dim }}>
              <StrokedText text={text} fontStyle={fontStyle} textStyle={textStyle} />
            </span>
            {/* 塗り済み部分: クリップで進行 */}
            <span
              aria-hidden
              style={{ position: "absolute", inset: 0, clipPath: clip }}
            >
              <StrokedText
                text={text}
                fontStyle={fontStyle}
                textStyle={textStyle}
                fillColor={fill}
                extraShadow={`0 0 ${textStyle.size * 0.35}px hsla(${hue}, 95%, 65%, 0.55)`}
              />
            </span>
          </span>
        </div>
      </AbsoluteFill>
    );
  }

  // ---- タイトルグリッチ（実装は effects/TitleSignalGlitch01.tsx） ----
  // 中央固定のタイトル様式なので配置は本体に任せ、行末フェードだけ重ねる
  if (effectiveAnim === "lyric-title-glitch") {
    const scaleMul = Number(p.scale ?? 1.6);
    return (
      <AbsoluteFill style={{ pointerEvents: "none", opacity: exit }}>
        <TitleSignalGlitch01
          text={text}
          durationInFrames={durationInFrames}
          fontSize={fitFontSize(textStyle.size * scaleMul, 0.9)}
          fontFamily={font.family}
          color={textStyle.color}
        />
      </AbsoluteFill>
    );
  }

  // ---- 現像ワイプ: スミアの帯が左→右に「現像」されて文字になる（タイポグラフィタイトル様式） ----
  // 退場は exit="line" で各行が走査線に潰れて消える
  if (effectiveAnim === "lyric-develop") {
    const inDur = Math.max(3, Math.round(Number(p.inDuration ?? 0.45) * fps));
    const lineExit = String(p.exit ?? "line") === "line";
    const barInF = Math.max(2, Math.round(inDur * 0.3));
    // phase1: スミアの帯が先頭からシュッと伸びる
    const barE = interpolate(frame, [0, barInF], [0, 1], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
      easing: Easing.out(Easing.cubic),
    });
    // phase2: 帯の中から文字が先頭→末尾に現像されていく
    const reveal = interpolate(frame, [barInF, barInF + inDur], [0, 1], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
      easing: Easing.bezier(0.3, 0.6, 0.2, 1),
    });
    // 退場: 行が走査線に潰れて（scale→0.04）、最後の3フレームでふっと消える
    const exF = Math.round(0.3 * fps);
    const collapse = lineExit
      ? interpolate(
          frame,
          [Math.max(0, durationInFrames - exF), Math.max(1, durationInFrames - 3)],
          [1, 0.04],
          { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.in(Easing.quad) },
        )
      : 1;
    const endFade = interpolate(
      frame,
      [Math.max(0, durationInFrames - 3), durationInFrames],
      [1, 0],
      { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
    );
    const opacity = lineExit ? endFade : exit;
    // 潰れるほど熱く光る（走査線の残光）
    const heat = 1 + (1 - collapse) * 1.6;
    const clipText = vertical
      ? `inset(0 0 ${(1 - reveal) * 100}% 0)`
      : `inset(0 ${(1 - reveal) * 100}% 0 0)`;
    // 現像の熱: 現像中だけ文字がほのかに発光し、現像し終わると落ち着く
    const devHeat = reveal > 0 && reveal < 1 ? 1 - reveal : 0;
    const devGlow =
      devHeat > 0.01
        ? `0 0 ${(textStyle.size * 0.32).toFixed(1)}px rgba(255,250,240,${(0.4 * devHeat).toFixed(3)}), 0 0 ${(textStyle.size * 0.12).toFixed(1)}px rgba(255,255,255,${(0.3 * devHeat).toFixed(3)})`
        : undefined;
    return (
      <AbsoluteFill style={{ pointerEvents: "none" }}>
        <div style={{ ...positioned, transform: baseTranslate, opacity }}>
          <span
            style={{
              position: "relative",
              display: "inline-block",
              transform: vertical ? `scaleX(${collapse})` : `scaleY(${collapse})`,
              transformOrigin: "center",
              filter: collapse < 1 ? `brightness(${heat})` : undefined,
            }}
          >
            {/* 現像済みの文字（先頭側から見えていく） */}
            <span style={{ display: "inline-block", clipPath: clipText }}>
              <StrokedText
                text={text}
                fontStyle={fontStyle}
                textStyle={textStyle}
                extraShadow={devGlow}
              />
            </span>
            {/* 未現像部分のスミア帯: インライン背景+cloneで行折返しでも行ごとに帯が出る */}
            {reveal < 1 && barE > 0 && (
              <span
                aria-hidden
                style={{
                  position: "absolute",
                  inset: 0,
                  clipPath: vertical
                    ? `inset(${reveal * 100}% 0 ${(1 - barE) * 100}% 0)`
                    : `inset(0 ${(1 - barE) * 100}% 0 ${reveal * 100}%)`,
                  filter: "blur(3px)",
                  opacity: 0.92,
                }}
              >
                <span
                  style={{
                    background: vertical
                      ? `linear-gradient(90deg, transparent 12%, ${textStyle.color} 12% 88%, transparent 88%)`
                      : `linear-gradient(180deg, transparent 14%, ${textStyle.color} 14% 86%, transparent 86%)`,
                    WebkitBoxDecorationBreak: "clone",
                    boxDecorationBreak: "clone",
                  }}
                >
                  <span style={{ visibility: "hidden" }}>
                    <StrokedText text={text} fontStyle={fontStyle} textStyle={textStyle} />
                  </span>
                </span>
              </span>
            )}
          </span>
        </div>
      </AbsoluteFill>
    );
  }

  // ---- 単語ごと出現: 歌唱のタイミングで単語単位にポンと出る（words無しは文字送りへ） ----
  if (effectiveAnim === "lyric-word-pop") {
    const rise = Number(p.rise ?? 12);
    const popScale = Number(p.pop ?? 0.22);
    const chars = [...text];
    const vocal = charStartFramesVocal(words ?? [], chars.length, lineStartSec ?? 0, fps);
    const inF = Math.max(2, Math.round(0.22 * fps));
    return (
      <AbsoluteFill style={{ pointerEvents: "none" }}>
        <div style={{ ...positioned, transform: baseTranslate, opacity: exit }}>
          {chars.map((ch, i) => {
            const startF = vocal ? vocal[i] : i * 2;
            const e = interpolate(
              frame,
              [startF + fxDelayFrames(i), startF + fxDelayFrames(i) + inF],
              [0, 1],
              {
                extrapolateLeft: "clamp",
                extrapolateRight: "clamp",
                easing: Easing.out(Easing.cubic),
              },
            );
            // 出た瞬間だけ軽くovershoot（強調しすぎない）
            const s = interpolate(e, [0, 0.7, 1], [0.7, 1 + popScale, 1]);
            const d = (1 - e) * rise;
            return (
              <span
                key={i}
                style={{
                  position: "relative",
                  display: "inline-block",
                  opacity: e,
                  transform: `${vertical ? `translateX(${d}px)` : `translateY(${d}px)`} scale(${s})${fxTransform(i)}`,
                }}
              >
                <StrokedText
                  text={ch === " " ? " " : ch}
                  fontStyle={fontStyle}
                  textStyle={textStyle}
                />
              </span>
            );
          })}
        </div>
      </AbsoluteFill>
    );
  }

  // ---- ブラーエコー: 残像が遅れてついてくる ----
  if (effectiveAnim === "lyric-echo") {
    const ghosts = Math.max(1, Math.round(Number(p.ghosts ?? 2)));
    const gapF = Math.max(1, Math.round(Number(p.gap ?? 0.12) * fps));
    const tintRgb = String(p.tint ?? "none") === "rgb";
    const inF = Math.max(2, Math.round(0.45 * fps));
    const rise = 26;
    const prog = (f: number): number =>
      interpolate(f, [0, inF], [0, 1], {
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
        easing: Easing.out(Easing.cubic),
      });
    const layers: React.ReactNode[] = [];
    // 後ろのゴーストから描く（k=ghosts が最も遅れて薄い）。
    // 奥行き: 遠い層ほど大きく・ボケて・薄い（前後差）。移動中はさらにボケて着地で締まる
    for (let k = ghosts; k >= 1; k--) {
      const e = prog(frame - k * gapF);
      if (e <= 0) continue;
      const d = (1 - e) * rise;
      const shadow = tintRgb
        ? `${k * 3}px 0 0 rgba(255,70,90,0.5), ${-k * 3}px 0 0 rgba(70,150,255,0.5)`
        : undefined;
      const depthBlur = k * 1.4 + (1 - e) * 2.5;
      const depthScale = 1 + k * 0.045;
      layers.push(
        <div
          key={`g${k}`}
          style={{
            ...positioned,
            transform: `${baseTranslate} ${vertical ? `translateX(${d + k * 10}px)` : `translateY(${d + k * 10}px)`} scale(${depthScale})`,
            opacity: e * Math.max(0.2, 0.5 - (k - 1) * 0.12) * exit,
            filter: `blur(${depthBlur.toFixed(2)}px)`,
          }}
        >
          <StrokedText
            text={text}
            fontStyle={fontStyle}
            textStyle={textStyle}
            extraShadow={shadow}
          />
        </div>,
      );
    }
    const e0 = prog(frame);
    const d0 = (1 - e0) * rise;
    // 本体: 入場の瞬間だけわずかに発光し、着地でスッと落ち着く
    const mainGlow =
      e0 < 1
        ? `0 0 ${(textStyle.size * 0.3).toFixed(1)}px rgba(255,255,255,${(0.4 * (1 - e0)).toFixed(3)})`
        : undefined;
    layers.push(
      <div
        key="main"
        style={{
          ...positioned,
          transform: `${baseTranslate} ${vertical ? `translateX(${d0}px)` : `translateY(${d0}px)`}`,
          opacity: e0 * exit,
        }}
      >
        <StrokedText
          text={text}
          fontStyle={fontStyle}
          textStyle={textStyle}
          extraShadow={mainGlow}
        />
      </div>,
    );
    return <AbsoluteFill style={{ pointerEvents: "none" }}>{layers}</AbsoluteFill>;
  }

  // ---- 波乗りテキスト: 文字がサイン波に乗ってゆらゆら動き続ける ----
  if (effectiveAnim === "lyric-wave") {
    const amp = Number(p.amp ?? 10);
    const speed = Number(p.speed ?? 0.6);
    const wl = Math.max(2, Number(p.wavelength ?? 6));
    const beatMode = p.beatSync === "beat" && beatClock;
    const ampNow = beatMode
      ? amp * (0.35 + 0.9 * beatPulse(beatClock, frame, fps, 0.3))
      : amp;
    const staggerF = 2;
    const charInF = Math.max(2, Math.round(0.3 * fps));
    const chars = [...text];
    const vocal = charStartFramesVocal(words ?? [], chars.length, lineStartSec ?? 0, fps);
    return (
      <AbsoluteFill style={{ pointerEvents: "none" }}>
        <div style={{ ...positioned, transform: baseTranslate, opacity: exit }}>
          {chars.map((ch, i) => {
            const start = (vocal ? vocal[i] : i * staggerF) + fxDelayFrames(i);
            const e = interpolate(frame, [start, start + charInF], [0, 1], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
              easing: Easing.out(Easing.cubic),
            });
            const w =
              Math.sin(((frame / fps) * speed * Math.PI * 2) + (i / wl) * Math.PI * 2) *
              ampNow;
            const move = vertical
              ? `translateX(${w * 0.8}px)`
              : `translateY(${w}px)`;
            return (
              <span
                key={i}
                style={{
                  position: "relative",
                  display: "inline-block",
                  opacity: e,
                  transform: `${move}${fxTransform(i)}`,
                }}
              >
                <StrokedText
                  text={ch === " " ? " " : ch}
                  fontStyle={fontStyle}
                  textStyle={textStyle}
                />
              </span>
            );
          })}
        </div>
      </AbsoluteFill>
    );
  }

  // ---- 一文字ずつ登場（リリックビデオ基本形） ----
  if (effectiveAnim === "lyric-stagger") {
    const staggerFrames = Math.max(1, Math.round(Number(p.stagger ?? 0.05) * fps));
    const rise = Number(p.rise ?? 14);
    const charInFrames = Math.max(2, Math.round(0.3 * fps));
    const chars = [...text];
    const vocal = charStartFramesVocal(words ?? [], chars.length, lineStartSec ?? 0, fps);
    return (
      <AbsoluteFill style={{ pointerEvents: "none" }}>
        <div style={{ ...positioned, transform: baseTranslate, opacity: exit }}>
          {chars.map((ch, i) => {
            const start = (vocal ? vocal[i] : i * staggerFrames) + fxDelayFrames(i);
            const e = interpolate(frame, [start, start + charInFrames], [0, 1], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
              easing: Easing.out(Easing.cubic),
            });
            const d = (1 - e) * rise;
            return (
              <span
                key={i}
                style={{
                  position: "relative",
                  display: "inline-block",
                  opacity: e,
                  transform: `${vertical ? `translateX(${d}px)` : `translateY(${d}px)`}${fxTransform(i)}`,
                }}
              >
                <StrokedText
                  text={ch === " " ? " " : ch}
                  fontStyle={fontStyle}
                  textStyle={textStyle}
                />
              </span>
            );
          })}
        </div>
      </AbsoluteFill>
    );
  }

  // ---- デカ文字ポップ（中央でバンッ） ----
  if (effectiveAnim === "lyric-hero-pop") {
    const inFrames = Math.max(3, Math.round(Number(p.inDuration ?? 0.35) * fps));
    const s = spring({
      frame,
      fps,
      durationInFrames: inFrames * 2,
      config: { damping: 11, stiffness: 180, mass: 0.7 },
    });
    const scale = interpolate(s, [0, 1], [0.55, 1]);
    const opacity = Math.min(1, s * 1.6) * exit;
    // バンッの瞬間だけ白い閃光がふわっと乗り、着地で消える（保持中は従来と同一）
    const flash = interpolate(frame, [0, Math.round(inFrames * 1.6)], [1, 0], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
      easing: Easing.out(Easing.quad),
    });
    const popGlow =
      flash > 0.01
        ? `0 0 ${(textStyle.size * 0.5 * flash).toFixed(1)}px rgba(255,255,255,${(0.45 * flash).toFixed(3)}), 0 0 ${(textStyle.size * 0.18 * flash).toFixed(1)}px rgba(255,255,255,${(0.35 * flash).toFixed(3)})`
        : undefined;
    // 拡大しきる前のごく短いブラー（勢いの残像。すぐ消える）
    const popBlur = (1 - Math.min(1, s * 1.8)) * 5;
    return (
      <AbsoluteFill style={{ pointerEvents: "none" }}>
        <div
          style={{
            ...positioned,
            transform: `${baseTranslate} scale(${scale})`,
            opacity,
            filter: popBlur > 0.1 ? `blur(${popBlur.toFixed(2)}px)` : undefined,
          }}
        >
          <StrokedText
            text={text}
            fontStyle={fontStyle}
            textStyle={textStyle}
            extraShadow={popGlow}
          />
        </div>
      </AbsoluteFill>
    );
  }

  // ---- デカ文字グリッチ（明滅しながら現れる） ----
  if (effectiveAnim === "lyric-hero-glitch") {
    const shift = Number(p.shift ?? 8);
    const entranceFrames = Math.round(0.4 * fps);
    // ノイズは出だしが最も激しく、easeOutでスッと収まる（線形より着地が気持ちいい）
    const settle = interpolate(frame, [0, entranceFrames], [1, 0], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
      easing: Easing.out(Easing.quad),
    });
    const flicker = settle > 0 ? (hashRand(frame, 31) > 0.35 * settle ? 1 : 0.15) : 1;
    const dx = (hashRand(frame, 32) - 0.5) * 2 * shift * settle;
    const residual = 0.25; // 出た後もわずかに残るRGBずれ
    const rgb = shift * (settle + residual) * 0.6;
    // 明滅している間だけ白の閃光がかすかに乗る（ブラウン管の残光。着地で消える）
    const glitchGlow =
      settle > 0.01
        ? `, 0 0 ${(textStyle.size * 0.4 * settle).toFixed(1)}px rgba(255,255,255,${(0.35 * settle).toFixed(3)})`
        : "";
    const extraShadow = `${rgb}px 0 0 rgba(255,60,80,0.75), ${-rgb}px 0 0 rgba(60,160,255,0.75)${glitchGlow}`;
    return (
      <AbsoluteFill style={{ pointerEvents: "none" }}>
        <div
          style={{
            ...positioned,
            transform: `${baseTranslate} translateX(${dx}px)`,
            opacity: flicker * exit,
          }}
        >
          <StrokedText
            text={text}
            fontStyle={fontStyle}
            textStyle={textStyle}
            extraShadow={extraShadow}
          />
        </div>
      </AbsoluteFill>
    );
  }

  // ---- ネオングロウ（発光が脈打つ） ----
  if (effectiveAnim === "lyric-glow") {
    const hue = Number(p.hue ?? 320);
    const pulse = Number(p.pulse ?? 0.5);
    const inFrames = Math.max(2, Math.round(0.4 * fps));
    const enter = interpolate(frame, [0, inFrames], [0, 1], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    });
    // ビート同期時は曲の拍で発光が跳ねる。それ以外は固定周期のサイン波
    const beat =
      p.beatSync === "beat" && beatClock
        ? 1 + beatPulse(beatClock, frame, fps, 0.22) * pulse * 0.7
        : 1 + Math.sin((frame / fps) * 4.2) * pulse * 0.35;
    const glow = `0 0 ${10 * beat}px hsla(${hue}, 100%, 70%, 0.95), 0 0 ${28 * beat}px hsla(${hue}, 100%, 60%, 0.7), 0 0 ${60 * beat}px hsla(${hue}, 100%, 55%, 0.4)`;
    return (
      <AbsoluteFill style={{ pointerEvents: "none" }}>
        <div style={{ ...positioned, transform: baseTranslate, opacity: enter * exit }}>
          <StrokedText
            text={text}
            fontStyle={fontStyle}
            textStyle={textStyle}
            extraShadow={glow}
            fillColor="#ffffff"
          />
        </div>
      </AbsoluteFill>
    );
  }

  // ---- 黒場/白場: 画面を塗りつぶして歌詞だけを見せる ----
  if (effectiveAnim === "lyric-blackout" || effectiveAnim === "lyric-whiteout") {
    const isWhite = effectiveAnim === "lyric-whiteout";
    const reveal = String(p.reveal ?? "fade");
    const textScale = Number(p.textScale ?? 1.3);
    const bgIn = interpolate(frame, [0, 6], [0, 1], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    });
    const cardFont: React.CSSProperties = {
      ...fontStyle,
      fontSize: fitFontSize(textStyle.size * textScale, vertical ? 0.86 : 0.88),
      color: isWhite ? "#111111" : textStyle.color,
      textShadow: "none",
    };
    const centerPos: React.CSSProperties = {
      position: "absolute",
      left: "50%",
      top: "50%",
      textAlign: "center",
      whiteSpace: "pre",
      ...(vertical
        ? { writingMode: "vertical-rl" as const, textOrientation: "mixed" as const }
        : {}),
    };
    const staggerFrames = 2;
    const charInFrames = Math.max(2, Math.round(0.25 * fps));
    const chars = [...text];
    const vocal = charStartFramesVocal(words ?? [], chars.length, lineStartSec ?? 0, fps);
    return (
      <AbsoluteFill style={{ pointerEvents: "none" }}>
        <AbsoluteFill
          style={{
            background: isWhite ? "#f5f5f2" : "#000",
            opacity: bgIn * exit,
          }}
        />
        <div
          style={{
            ...centerPos,
            transform: "translate(-50%, -50%)",
            opacity:
              reveal === "fade"
                ? Math.min(
                    interpolate(frame, [3, 3 + Math.round(0.5 * fps)], [0, 1], {
                      extrapolateLeft: "clamp",
                      extrapolateRight: "clamp",
                    }),
                    exit,
                  )
                : exit,
          }}
        >
          {reveal === "stagger"
            ? chars.map((ch, i) => {
                // 歌クロック時も黒場/白場のフェードイン（6f）より先に文字は出さない
                const start = vocal ? Math.max(3, vocal[i]) : 3 + i * staggerFrames;
                const e = interpolate(
                  frame,
                  [start, start + charInFrames],
                  [0, 1],
                  { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
                );
                return (
                  <span
                    key={i}
                    style={{ ...cardFont, position: "relative", display: "inline-block", opacity: e }}
                  >
                    {ch === " " ? " " : ch}
                  </span>
                );
              })
            : (
                <span style={{ ...cardFont, position: "relative" }}>{text}</span>
              )}
        </div>
      </AbsoluteFill>
    );
  }

  // ---- バラバラ→集合: 散らばった文字が集まって歌詞になる ----
  if (effectiveAnim === "lyric-scatter") {
    const spread = Number(p.spread ?? 120);
    const inFrames = Math.max(3, Math.round(Number(p.inDuration ?? 0.7) * fps));
    const chars = [...text];
    return (
      <AbsoluteFill style={{ pointerEvents: "none" }}>
        <div style={{ ...positioned, transform: baseTranslate, opacity: exit }}>
          {chars.map((ch, i) => {
            const e = interpolate(frame, [0, inFrames], [0, 1], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
              easing: Easing.bezier(0.2, 0.9, 0.3, 1),
            });
            const dx = (hashRand(i, 51) - 0.5) * 2 * spread * (1 - e);
            const dy = (hashRand(i, 52) - 0.5) * 2 * spread * (1 - e);
            const rot = (hashRand(i, 53) - 0.5) * 160 * (1 - e);
            return (
              <span
                key={i}
                style={{
                  position: "relative",
                  display: "inline-block",
                  opacity: Math.min(1, e * 2),
                  transform: `translate(${dx}px, ${dy}px) rotate(${rot}deg)`,
                }}
              >
                <StrokedText
                  text={ch === " " ? " " : ch}
                  fontStyle={fontStyle}
                  textStyle={textStyle}
                />
              </span>
            );
          })}
        </div>
      </AbsoluteFill>
    );
  }

  // ---- うにょうにょ集合: シアンの光の粒として現れた文字が時間差で漂いながら
  //      定位置へ集まり、白く灯る。漢字は大きく・かなは小さく、着地後も浮遊し続ける ----
  if (effectiveAnim === "lyric-gather") {
    const spread = Number(p.spread ?? 90);
    const stagger = Number(p.stagger ?? 0.5);
    const inFrames = Math.max(3, Math.round(Number(p.inDuration ?? 1.2) * fps));
    const wobble = Number(p.wobble ?? 0.6);
    const chroma = Number(p.chroma ?? 0.4);
    const chars = [...text];
    const sz = textStyle.size;
    const vocal = charStartFramesVocal(words ?? [], chars.length, lineStartSec ?? 0, fps);
    // 色収差: 文字の輪郭に赤/青のフリンジ（映像っぽい質感）
    const chromaOff = 0.045 * sz * chroma;
    const chromaShadow =
      chroma > 0
        ? `, ${chromaOff.toFixed(1)}px 0 0 rgba(255,60,90,0.5), ${(-chromaOff).toFixed(1)}px 0 0 rgba(40,160,255,0.5)`
        : "";
    const isKanji = (ch: string) => /[㐀-鿿豈-﫿]/.test(ch);
    return (
      <AbsoluteFill style={{ pointerEvents: "none" }}>
        <div style={{ ...positioned, transform: baseTranslate, opacity: exit }}>
          {chars.map((ch, i) => {
            // 歌クロックがあれば発声時刻を漂い始めの基準に（無ければ従来のランダム時間差）
            const delayF = vocal
              ? vocal[i]
              : Math.round(hashRand(i, 71) * stagger * fps);
            const e = interpolate(frame, [delayF, delayF + inFrames], [0, 1], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
              // ふわっと漂って着地する（scatterのシュッより緩い）
              easing: Easing.bezier(0.3, 0.55, 0.25, 1),
            });
            // 縦方向メインのばらけ（元位置の上下に浮いている感じ）
            const dy0 = (hashRand(i, 72) - 0.5) * 2 * spread;
            const dx0 = (hashRand(i, 73) - 0.5) * 2 * spread * 0.22;
            // 移動中は大きく、着地後も小さく「うにょうにょ」揺れ続ける
            const phase = hashRand(i, 74) * Math.PI * 2;
            const wobAmp = wobble * (14 * (1 - e) + 0.05 * sz);
            const wob = Math.sin((frame / fps) * (5.2 - 3.9 * e) + phase) * wobAmp;
            const wobX = Math.cos((frame / fps) * 4.1 + phase) * wobble * 8 * (1 - e);
            const rot = (hashRand(i, 75) - 0.5) * 14 * (1 - e);
            // ベースラインのゆらぎは着地後も残す（きれいに整列させない）
            const resid = (hashRand(i, 76) - 0.5) * 0.1 * sz;
            // 漢字は大きく明るく、かなは小さく控えめ（参考動画の文字組）
            const mul = (isKanji(ch) ? 1.22 : 0.92) * (0.98 + hashRand(i, 77) * 0.05);
            const scale = 0.8 + 0.2 * e;
            // 出現時はシアンの光の粒 → 着地で白く灯る
            const fill = interpolateColors(
              e,
              [0, 0.55, 1],
              ["hsl(192, 95%, 78%)", "hsl(195, 60%, 88%)", textStyle.color],
            );
            // 漂っている間はチラチラ明滅（火花の質感）
            const shimmer =
              e < 0.85 ? 0.72 + 0.28 * Math.sin((frame / fps) * 17 + phase * 7) : 1;
            const op = interpolate(e, [0, 0.1, 1], [0, 0.55, 1]) * shimmer;
            const glowR = (1 - e) * 14 + (isKanji(ch) ? 8 : 4);
            const glowC =
              e < 0.7
                ? `hsla(192, 95%, 75%, ${0.9 - 0.5 * e})`
                : `hsla(48, 90%, 88%, 0.55)`;
            return (
              <span
                key={i}
                style={{
                  position: "relative",
                  display: "inline-block",
                  padding: "0 0.045em",
                  opacity: op,
                  transform: `translate(${dx0 * (1 - e) + wobX}px, ${dy0 * (1 - e) + wob + resid}px) rotate(${rot}deg) scale(${scale})`,
                }}
              >
                <StrokedText
                  text={ch === " " ? " " : ch}
                  fontStyle={{ ...fontStyle, fontSize: sz * mul }}
                  textStyle={textStyle}
                  fillColor={fill}
                  extraShadow={`0 0 ${glowR}px ${glowC}, 0 0 ${glowR * 2.2}px ${glowC}${e > 0.6 ? chromaShadow : ""}`}
                />
              </span>
            );
          })}
        </div>
      </AbsoluteFill>
    );
  }

  // ---- バーンとばらける: ポンッと現れ→行の終わりに爆発四散 ----
  if (effectiveAnim === "lyric-explode") {
    const spread = Number(p.spread ?? 180);
    const rotMax = Number(p.rotate ?? 120);
    const inFrames = Math.max(3, Math.round(0.25 * fps));
    const exFrames = Math.round(0.4 * fps);
    const enter = spring({
      frame,
      fps,
      durationInFrames: inFrames * 2,
      config: { damping: 12, stiffness: 200, mass: 0.6 },
    });
    const ex = interpolate(
      frame,
      [Math.max(0, durationInFrames - exFrames), durationInFrames],
      [0, 1],
      { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.in(Easing.quad) },
    );
    const chars = [...text];
    return (
      <AbsoluteFill style={{ pointerEvents: "none" }}>
        <div
          style={{
            ...positioned,
            transform: `${baseTranslate} scale(${interpolate(enter, [0, 1], [0.7, 1])})`,
            opacity: Math.min(1, enter * 1.5),
          }}
        >
          {chars.map((ch, i) => {
            const dx = (hashRand(i, 61) - 0.5) * 2 * spread * ex;
            const dy = (hashRand(i, 62) - 0.7) * 2 * spread * ex; // やや上方向に飛ぶ
            const rot = (hashRand(i, 63) - 0.5) * 2 * rotMax * ex;
            return (
              <span
                key={i}
                style={{
                  position: "relative",
                  display: "inline-block",
                  opacity: 1 - ex,
                  transform: `translate(${dx}px, ${dy}px) rotate(${rot}deg)`,
                }}
              >
                <StrokedText
                  text={ch === " " ? " " : ch}
                  fontStyle={fontStyle}
                  textStyle={textStyle}
                />
              </span>
            );
          })}
        </div>
      </AbsoluteFill>
    );
  }

  // ---- 書かれていく: 1字ずつ、線が走る方向にワイプで現れる（簡易書き文字） ----
  if (effectiveAnim === "lyric-write") {
    const charFrames = Math.max(2, Math.round(Number(p.charTime ?? 0.18) * fps));
    const chars = [...text];
    const vocal = charStartFramesVocal(words ?? [], chars.length, lineStartSec ?? 0, fps);
    return (
      <AbsoluteFill style={{ pointerEvents: "none" }}>
        <div style={{ ...positioned, transform: baseTranslate, opacity: exit }}>
          {chars.map((ch, i) => {
            const start = (vocal ? vocal[i] : i * charFrames) + fxDelayFrames(i);
            const e = interpolate(frame, [start, start + charFrames], [0, 1], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
            });
            if (e <= 0) return null;
            // 横書き=左→右 / 縦書き=上→下 に「書き進む」ワイプ
            const clip = vertical
              ? `inset(0 0 ${(1 - e) * 100}% 0)`
              : `inset(0 ${(1 - e) * 100}% 0 0)`;
            return (
              <span
                key={i}
                style={{
                  position: "relative",
                  display: "inline-block",
                  clipPath: clip,
                  transform: fxTransform(i) || undefined,
                }}
              >
                <StrokedText
                  text={ch === " " ? " " : ch}
                  fontStyle={fontStyle}
                  textStyle={textStyle}
                />
              </span>
            );
          })}
        </div>
      </AbsoluteFill>
    );
  }

  // ---- 字のパーツが集まる/離れる: 文字を破片（4分割/偏と旁/冠と脚）に割って動かす ----
  if (effectiveAnim === "lyric-parts") {
    const mode = String(p.mode ?? "gather");
    const split = String(p.split ?? "quad");
    const spread = Number(p.spread ?? 60);
    const inFrames = Math.max(3, Math.round(0.6 * fps));
    const exFrames = Math.round(0.5 * fps);
    const gather =
      mode === "break"
        ? 1
        : interpolate(frame, [0, inFrames], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: Easing.bezier(0.2, 0.9, 0.3, 1),
          });
    const breakUp =
      mode === "gather"
        ? 0
        : interpolate(
            frame,
            [Math.max(0, durationInFrames - exFrames), durationInFrames],
            [0, 1],
            { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.in(Easing.quad) },
          );
    const apart = Math.max(1 - gather, breakUp); // 0=完全な字, 1=バラバラ
    // 破片の割り方: 4分割 / 左右（偏と旁: 明→日|月）/ 上下（冠と脚）
    const QUADS =
      split === "lr"
        ? ["inset(0 50% 0 0)", "inset(0 0 0 50%)"]
        : split === "tb"
          ? ["inset(0 0 50% 0)", "inset(50% 0 0 0)"]
          : [
              "inset(0 50% 50% 0)", // 左上
              "inset(0 0 50% 50%)", // 右上
              "inset(50% 50% 0 0)", // 左下
              "inset(50% 0 0 50%)", // 右下
            ];
    // 左右/上下割りは部品がスッと離れる方向を固定（部首分解らしく見せる）
    const directional = split !== "quad";
    const chars = [...text];
    return (
      <AbsoluteFill style={{ pointerEvents: "none" }}>
        <div
          style={{
            ...positioned,
            transform: baseTranslate,
            opacity: Math.min(exit, 1 - breakUp * 0.9 + 0.1),
          }}
        >
          {chars.map((ch, i) => (
            <span
              key={i}
              style={{ position: "relative", display: "inline-block" }}
            >
              {/* 位置決め用の透明文字（レイアウトを保つ） */}
              <span style={{ ...fontStyle, visibility: "hidden" }}>
                {ch === " " ? " " : ch}
              </span>
              {QUADS.map((clip, q) => {
                // 方向固定モード（偏と旁）: 左パーツは左へ、右パーツは右へ素直に離れる
                const dir = q === 0 ? -1 : 1;
                const dx = directional
                  ? (split === "lr" ? dir * spread * apart : (hashRand(i, 71 + q) - 0.5) * 14 * apart)
                  : (hashRand(i, 71 + q) - 0.5) * 2 * spread * apart;
                const dy = directional
                  ? (split === "tb" ? dir * spread * apart : (hashRand(i, 75 + q) - 0.5) * 14 * apart)
                  : (hashRand(i, 75 + q) - 0.5) * 2 * spread * apart;
                const rot = directional
                  ? (hashRand(i, 79 + q) - 0.5) * 16 * apart
                  : (hashRand(i, 79 + q) - 0.5) * 90 * apart;
                return (
                  <span
                    key={q}
                    style={{
                      position: "absolute",
                      inset: 0,
                      clipPath: clip,
                      transform: `translate(${dx}px, ${dy}px) rotate(${rot}deg)`,
                      opacity: Math.max(0, 1 - apart * 0.25),
                    }}
                  >
                    <StrokedText
                      text={ch === " " ? " " : ch}
                      fontStyle={fontStyle}
                      textStyle={textStyle}
                    />
                  </span>
                );
              })}
            </span>
          ))}
        </div>
      </AbsoluteFill>
    );
  }

  // ---- 波線が走る: 歌詞の下に線が描かれてから一緒に消える ----
  if (effectiveAnim === "lyric-underline") {
    const shape = String(p.shape ?? "wave");
    const drawFrames = Math.max(3, Math.round(Number(p.drawTime ?? 0.6) * fps));
    const thickness = Number(p.thickness ?? 3);
    const textIn = interpolate(frame, [0, Math.round(0.4 * fps)], [0, 1], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    });
    const draw = interpolate(frame, [4, 4 + drawFrames], [0, 1], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
      easing: Easing.bezier(0.3, 0.7, 0.2, 1),
    });
    // 波線パス（pathLength=100 で正規化。縦書き時は縦方向に走る）
    const wavePathH = "M0,5 Q6.25,0 12.5,5 T25,5 T37.5,5 T50,5 T62.5,5 T75,5 T87.5,5 T100,5";
    const wavePathV = "M5,0 Q0,6.25 5,12.5 T5,25 T5,37.5 T5,50 T5,62.5 T5,75 T5,87.5 T5,100";
    const d =
      shape === "wave"
        ? vertical
          ? wavePathV
          : wavePathH
        : vertical
          ? "M5,0 L5,100"
          : "M0,5 L100,5";
    const svgStyle: React.CSSProperties = vertical
      ? { position: "absolute", top: 0, left: -thickness * 3.5, height: "100%", width: thickness * 4 }
      : { position: "absolute", left: 0, bottom: -thickness * 3, width: "100%", height: thickness * 4 };
    return (
      <AbsoluteFill style={{ pointerEvents: "none" }}>
        <div style={{ ...positioned, transform: baseTranslate, opacity: Math.min(textIn, exit) }}>
          <span style={{ position: "relative", display: "inline-block" }}>
            <StrokedText text={text} fontStyle={fontStyle} textStyle={textStyle} />
            <svg
              style={{ ...svgStyle, overflow: "visible" }}
              viewBox={vertical ? "0 0 10 100" : "0 0 100 10"}
              preserveAspectRatio="none"
            >
              {/* 発光層: 描き終わったら少し沈静して余韻にする */}
              <path
                d={d}
                pathLength={100}
                fill="none"
                stroke={textStyle.color}
                strokeWidth={thickness * 2.4}
                strokeLinecap="round"
                strokeDasharray={100}
                strokeDashoffset={100 - draw * 100}
                opacity={draw < 1 ? 0.5 : 0.32}
                style={{ filter: `blur(${thickness * 1.1}px)` }}
              />
              <path
                d={d}
                pathLength={100}
                fill="none"
                stroke={textStyle.color}
                strokeWidth={thickness}
                strokeLinecap="round"
                strokeDasharray={100}
                strokeDashoffset={100 - draw * 100}
                style={{
                  filter: `drop-shadow(0 1px 3px rgba(0,0,0,${textStyle.shadow}))`,
                }}
              />
              {/* ペン先の光点: 描いている間だけ先端が明るく走る */}
              {draw > 0.02 && (
                <path
                  d={d}
                  pathLength={100}
                  fill="none"
                  stroke="#ffffff"
                  strokeWidth={thickness * 1.5}
                  strokeLinecap="round"
                  strokeDasharray="4 96"
                  strokeDashoffset={-(draw * 100 - 4)}
                  opacity={interpolate(draw, [0.88, 1], [0.85, 0], {
                    extrapolateLeft: "clamp",
                    extrapolateRight: "clamp",
                  })}
                  style={{ filter: `blur(${thickness * 0.35}px)` }}
                />
              )}
            </svg>
          </span>
        </div>
      </AbsoluteFill>
    );
  }

  // ---- ブラーイン: ピンボケから焦点が合う ----
  if (effectiveAnim === "lyric-blur-in") {
    const maxBlur = Number(p.blur ?? 16);
    const inFrames = Math.max(2, Math.round(Number(p.inDuration ?? 0.6) * fps));
    const e = interpolate(frame, [0, inFrames], [0, 1], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
      easing: Easing.out(Easing.quad),
    });
    return (
      <AbsoluteFill style={{ pointerEvents: "none" }}>
        <div
          style={{
            ...positioned,
            transform: baseTranslate,
            opacity: Math.min(e * 1.4, 1) * exit,
            filter: `blur(${(1 - e) * maxBlur}px)`,
          }}
        >
          <StrokedText text={text} fontStyle={fontStyle} textStyle={textStyle} />
        </div>
      </AbsoluteFill>
    );
  }

  // ---- ゆらぎ: 1字ずつ不規則に震え続ける ----
  if (effectiveAnim === "lyric-wiggle") {
    const amp = Number(p.amount ?? 4);
    const speed = Number(p.speed ?? 3);
    const t = (frame / fps) * speed;
    const enter = interpolate(frame, [0, Math.round(0.3 * fps)], [0, 1], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    });
    const chars = [...text];
    return (
      <AbsoluteFill style={{ pointerEvents: "none" }}>
        <div style={{ ...positioned, transform: baseTranslate, opacity: Math.min(enter, exit) }}>
          {chars.map((ch, i) => {
            const dx = (Math.sin(t * 5.3 + i * 2.7) * 0.6 + Math.sin(t * 9.1 + i * 1.3) * 0.4) * amp;
            const dy = (Math.cos(t * 4.7 + i * 3.1) * 0.6 + Math.cos(t * 8.3 + i * 0.7) * 0.4) * amp;
            const rot = Math.sin(t * 6.1 + i * 1.9) * amp * 0.8;
            return (
              <span
                key={i}
                style={{
                  position: "relative",
                  display: "inline-block",
                  transform: `translate(${dx}px, ${dy}px) rotate(${rot}deg)${fxTransform(i)}`,
                }}
              >
                <StrokedText text={ch === " " ? " " : ch} fontStyle={fontStyle} textStyle={textStyle} />
              </span>
            );
          })}
        </div>
      </AbsoluteFill>
    );
  }

  // ---- 字間ひらき: 映画タイトル風のトラッキング ----
  if (effectiveAnim === "lyric-tracking") {
    const dir = String(p.direction ?? "close");
    const spacing = Number(p.spacing ?? 0.4);
    const inFrames = Math.max(3, Math.round(Number(p.inDuration ?? 0.9) * fps));
    const e = interpolate(frame, [0, inFrames], [0, 1], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
      easing: Easing.bezier(0.2, 0.6, 0.2, 1),
    });
    const ls =
      dir === "close"
        ? spacing - (spacing - 0.06) * e
        : 0.06 + spacing * e * 0.6; // openは行の間ずっとゆっくり開き続ける
    const opacity = dir === "close" ? Math.min(e * 1.5, 1) : 1;
    // 映画タイトルの質感: 字間が動いている間はわずかにピンボケ＋微発光、決まると同時に締まる
    const unfocus = 1 - e;
    const trackGlow =
      unfocus > 0.01
        ? `0 0 ${(textStyle.size * 0.35 * unfocus).toFixed(1)}px rgba(255,255,255,${(0.35 * unfocus).toFixed(3)})`
        : undefined;
    return (
      <AbsoluteFill style={{ pointerEvents: "none" }}>
        <div
          style={{
            ...positioned,
            transform: baseTranslate,
            opacity: Math.min(opacity, exit),
            filter: unfocus > 0.01 ? `blur(${(unfocus * 2.5).toFixed(2)}px)` : undefined,
          }}
        >
          <StrokedText
            text={text}
            fontStyle={{ ...fontStyle, letterSpacing: `${ls}em` }}
            textStyle={textStyle}
            extraShadow={trackGlow}
          />
        </div>
      </AbsoluteFill>
    );
  }

  // ---- バウンス: 1字ずつ弾んで着地 ----
  if (effectiveAnim === "lyric-bounce") {
    const staggerFrames = Math.max(1, Math.round(Number(p.stagger ?? 0.05) * fps));
    const height = Number(p.height ?? 30);
    const chars = [...text];
    const vocal = charStartFramesVocal(words ?? [], chars.length, lineStartSec ?? 0, fps);
    return (
      <AbsoluteFill style={{ pointerEvents: "none" }}>
        <div style={{ ...positioned, transform: baseTranslate, opacity: exit }}>
          {chars.map((ch, i) => {
            const local = frame - (vocal ? vocal[i] : i * staggerFrames) - fxDelayFrames(i);
            const s = spring({
              frame: Math.max(0, local),
              fps,
              config: { damping: 9, stiffness: 160, mass: 0.6 },
            });
            const dy = (1 - s) * -height; // 上から弾んで落ちる
            const visible = local >= 0 ? 1 : 0;
            return (
              <span
                key={i}
                style={{
                  position: "relative",
                  display: "inline-block",
                  opacity: visible * Math.min(1, s * 2),
                  transform: `translateY(${dy}px)${fxTransform(i)}`,
                }}
              >
                <StrokedText text={ch === " " ? " " : ch} fontStyle={fontStyle} textStyle={textStyle} />
              </span>
            );
          })}
        </div>
      </AbsoluteFill>
    );
  }

  // ---- 3Dフリップ: 1字ずつパタパタ起き上がる ----
  if (effectiveAnim === "lyric-flip3d") {
    const axis = String(p.axis ?? "x") === "y" ? "rotateY" : "rotateX";
    const staggerFrames = Math.max(1, Math.round(Number(p.stagger ?? 0.04) * fps));
    const chars = [...text];
    const vocal = charStartFramesVocal(words ?? [], chars.length, lineStartSec ?? 0, fps);
    return (
      <AbsoluteFill style={{ pointerEvents: "none" }}>
        <div
          style={{
            ...positioned,
            transform: baseTranslate,
            opacity: exit,
            perspective: 600,
          }}
        >
          {chars.map((ch, i) => {
            const local = frame - (vocal ? vocal[i] : i * staggerFrames) - fxDelayFrames(i);
            const e = interpolate(local, [0, Math.round(0.35 * fps)], [0, 1], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
              easing: Easing.out(Easing.cubic),
            });
            return (
              <span
                key={i}
                style={{
                  position: "relative",
                  display: "inline-block",
                  opacity: e,
                  transform: `${axis}(${(1 - e) * 90}deg)${fxTransform(i)}`,
                  transformOrigin: "center bottom",
                }}
              >
                <StrokedText text={ch === " " ? " " : ch} fontStyle={fontStyle} textStyle={textStyle} />
              </span>
            );
          })}
        </div>
      </AbsoluteFill>
    );
  }

  // ---- デカ文字書き文字: 巨大な手書き風文字を自由配置して1字ずつ書いていく ----
  if (effectiveAnim === "lyric-mega-write") {
    // AI提案は範囲外パラメータがありうるためここでclampする
    const clamp = (v: number, lo: number, hi: number) =>
      Math.min(hi, Math.max(lo, v));
    const posX = clamp(Number(p.posX ?? 50), 0, 100);
    const posY = clamp(Number(p.posY ?? 50), 0, 100);
    const mwAngle = clamp(Number(p.angle ?? -10), -45, 45);
    const mwScale = clamp(Number(p.scale ?? 3.5), 1, 8);
    const charFrames = Math.max(
      2,
      Math.round(clamp(Number(p.charTime ?? 0.14), 0.03, 1) * fps),
    );
    const splitLayout = String(p.layout ?? "single") === "split";

    // デカさはフレーム基準（textStyle.size上限160に縛られず、プレビューと本番で比率が揃う）
    const mwFont: React.CSSProperties = {
      ...fontStyle,
      fontSize: (height * mwScale) / 10,
      fontWeight: Math.min(900, font.weight + 300),
      letterSpacing: "0.04em",
      lineHeight: 1.1,
      whiteSpace: "nowrap",
    };

    const chars = [...text];
    // 分割点: 中点に最も近い区切り文字（無ければ真ん中）。第2ブロックは対角へミラー
    let splitAt = chars.length;
    if (splitLayout && chars.length >= 4) {
      const seps = new Set([" ", "　", "、", "・"]);
      const mid = chars.length / 2;
      let best = -1;
      chars.forEach((ch, i) => {
        if (!seps.has(ch)) return;
        if (best < 0 || Math.abs(i - mid) < Math.abs(best - mid)) best = i;
      });
      splitAt = best >= 0 ? best + 1 : Math.ceil(chars.length / 2);
    }
    const blocks = [
      { chars: chars.slice(0, splitAt), startIndex: 0, x: posX, y: posY },
      ...(splitAt < chars.length
        ? [
            {
              chars: chars.slice(splitAt),
              startIndex: splitAt,
              x: 100 - posX,
              y: 100 - posY,
            },
          ]
        : []),
    ];

    return (
      <AbsoluteFill style={{ pointerEvents: "none", overflow: "hidden" }}>
        {blocks.map((block, bi) => (
          <div
            key={bi}
            style={{
              position: "absolute",
              left: `${block.x}%`,
              top: `${block.y}%`,
              whiteSpace: "nowrap",
              transform: `translate(-50%, -50%) rotate(${mwAngle}deg)`,
              opacity: exit,
              ...(vertical
                ? {
                    writingMode: "vertical-rl" as const,
                    textOrientation: "mixed" as const,
                  }
                : {}),
            }}
          >
            {block.chars.map((ch, i) => {
              const gi = block.startIndex + i;
              const start = gi * charFrames + fxDelayFrames(gi);
              const e = interpolate(frame, [start, start + charFrames], [0, 1], {
                extrapolateLeft: "clamp",
                extrapolateRight: "clamp",
              });
              if (e <= 0) return null;
              // 書き進む方向のワイプ（lyric-writeと同じ）
              const clip = vertical
                ? `inset(0 0 ${(1 - e) * 100}% 0)`
                : `inset(0 ${(1 - e) * 100}% 0 0)`;
              // 手書きの揺らぎ: 字ごとに固定の微傾き＋ベースラインのゆれ
              const wobble = `rotate(${((hashRand(gi, 97) - 0.5) * 5).toFixed(2)}deg) translateY(${((hashRand(gi, 98) - 0.5) * 0.08).toFixed(3)}em)`;
              return (
                <span
                  key={i}
                  style={{
                    position: "relative",
                    display: "inline-block",
                    clipPath: clip,
                    transform: `${wobble}${fxTransform(gi)}`,
                  }}
                >
                  <StrokedText
                    text={ch === " " ? " " : ch}
                    fontStyle={mwFont}
                    textStyle={textStyle}
                  />
                </span>
              );
            })}
          </div>
        ))}
      </AbsoluteFill>
    );
  }

  // ---- メガ文字: 画面からはみ出す巨大文字が斜めにドーン ----
  if (effectiveAnim === "lyric-mega") {
    const megaScale = Number(p.scale ?? 2.8);
    const angle = Number(p.angle ?? -8);
    const perChar = String(p.unit ?? "slam") === "chars";
    const megaFont: React.CSSProperties = {
      ...fontStyle,
      fontWeight: Math.min(900, font.weight + 300),
      letterSpacing: "0.02em",
      whiteSpace: "nowrap",
    };
    const containerStyle: React.CSSProperties = {
      position: "absolute",
      left: "50%",
      top: "50%",
      whiteSpace: "nowrap",
      ...(vertical
        ? { writingMode: "vertical-rl" as const, textOrientation: "mixed" as const }
        : {}),
    };

    if (perChar) {
      // 一文字ずつドン、ドン、ドン（判子を順に叩きつける）
      const chars = [...text];
      const staggerFrames = Math.max(2, Math.round(0.12 * fps));
      return (
        <AbsoluteFill style={{ pointerEvents: "none", overflow: "hidden" }}>
          <div
            style={{
              ...containerStyle,
              transform: `translate(-50%, -50%) rotate(${angle}deg) scale(${megaScale})`,
              opacity: exit,
            }}
          >
            {chars.map((ch, i) => {
              const local = frame - i * staggerFrames - fxDelayFrames(i);
              const s = spring({
                frame: Math.max(0, local),
                fps,
                config: { damping: 13, stiffness: 300, mass: 0.7 },
              });
              const cScale = interpolate(s, [0, 1], [2.2, 1]);
              return (
                <span
                  key={i}
                  style={{
                    position: "relative",
                    display: "inline-block",
                    opacity: local < 0 ? 0 : Math.min(1, s * 2.5),
                    transform: `scale(${cScale}) rotate(${(hashRand(i, 91) - 0.5) * 6}deg)${fxTransform(i)}`,
                  }}
                >
                  <StrokedText
                    text={ch === " " ? " " : ch}
                    fontStyle={megaFont}
                    textStyle={textStyle}
                  />
                </span>
              );
            })}
          </div>
        </AbsoluteFill>
      );
    }

    const inFrames = Math.max(3, Math.round(0.22 * fps));
    const s = spring({
      frame,
      fps,
      durationInFrames: inFrames * 2,
      config: { damping: 14, stiffness: 260, mass: 0.8 },
    });
    // 奥からドーンと叩きつけられる（大→定位置）
    const scaleNow = interpolate(s, [0, 1], [megaScale * 1.6, megaScale]);
    const opacity = Math.min(1, s * 2) * exit;
    return (
      <AbsoluteFill style={{ pointerEvents: "none", overflow: "hidden" }}>
        <div
          style={{
            ...containerStyle,
            transform: `translate(-50%, -50%) rotate(${angle}deg) scale(${scaleNow})`,
            opacity,
          }}
        >
          <StrokedText text={text} fontStyle={megaFont} textStyle={textStyle} />
        </div>
      </AbsoluteFill>
    );
  }

  // ---- 座布団（帯）: 黒/白の帯がシュッと入り、その上に歌詞が乗る ----
  if (effectiveAnim === "lyric-band") {
    const bandColor = String(p.color ?? "black");
    const bandOpacity = Number(p.opacity ?? 0.75);
    const shape = String(p.shape ?? "slant");
    const inFrames = Math.max(3, Math.round(0.35 * fps));
    const bandE = interpolate(frame, [0, inFrames], [0, 1], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
      easing: Easing.bezier(0.2, 0.8, 0.2, 1),
    });
    const textE = interpolate(frame, [Math.round(inFrames * 0.6), inFrames + 4], [0, 1], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    });
    const isWhite = bandColor === "white";
    const bg = isWhite
      ? `rgba(245,245,242,${bandOpacity})`
      : `rgba(0,0,0,${bandOpacity})`;
    const clip =
      shape === "slant" && !vertical
        ? "polygon(2.5% 0, 100% 0, 97.5% 100%, 0 100%)"
        : undefined;
    return (
      <AbsoluteFill style={{ pointerEvents: "none" }}>
        <div style={{ ...positioned, transform: baseTranslate, opacity: exit }}>
          <span
            style={{
              position: "relative",
              display: "inline-block",
              padding: vertical ? "0.7em 0.28em" : "0.28em 0.9em",
            }}
          >
            <span
              aria-hidden
              style={{
                position: "absolute",
                inset: 0,
                background: bg,
                clipPath: clip,
                transform: vertical ? `scaleY(${bandE})` : `scaleX(${bandE})`,
                transformOrigin: vertical ? "top center" : "left center",
                boxShadow: `0 2px 14px rgba(0,0,0,${0.3 * bandOpacity})`,
              }}
            />
            <span style={{ position: "relative", display: "inline-block", opacity: textE }}>
              <StrokedText
                text={text}
                fontStyle={{ ...fontStyle, textShadow: "none" }}
                textStyle={{
                  ...textStyle,
                  color: isWhite ? "#111111" : "#ffffff",
                  strokeWidth: 0,
                  shadow: 0,
                }}
              />
            </span>
          </span>
        </div>
      </AbsoluteFill>
    );
  }

  // ---- MPテロップ流モーション ----
  // 各挙動の"意図"を自前の値で組み立てる。
  // 25部品×パラメータ(in/out・方向・軸)で45プリセット相当をカバー。
  if (MP_MOTION_IDS.has(effectiveAnim)) {
    const sec = frame / fps;
    const mpInDur = Math.max(1, Math.round(Number(p.inDuration ?? 0.55) * fps));
    const isOut = String(p.mode ?? "in") === "out";
    // 遷移系: away度 t(1=変形max/画面外, 0=定位置) と 基準不透明度
    const enterR = interpolate(frame, [0, mpInDur], [0, 1], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
      easing: Easing.out(Easing.cubic),
    });
    const leaveR = interpolate(
      frame,
      [Math.max(0, durationInFrames - mpInDur), durationInFrames],
      [0, 1],
      { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.in(Easing.cubic) },
    );
    const t = isOut ? leaveR : 1 - enterR;
    let op = isOut ? 1 - leaveR : Math.min(enterR, exit);
    // 常駐系の素早い入場フェード（表示の最初だけ）
    const quickIn = interpolate(frame, [0, Math.round(0.2 * fps)], [0, 1], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    });

    const dir = String(p.direction ?? "up");
    const sign = dir === "up" || dir === "left" ? 1 : -1;
    const axisX = dir === "left" || dir === "right";

    const tf: string[] = [];
    let mpFilter = "";
    let clip: string | undefined;
    let idleOsc = true;
    let bodyOverride: React.ReactNode = null; // per-char等の特殊描画
    let behindLayer: React.ReactNode = null; // 残像など背面
    let frontLayer: React.ReactNode = null; // キラキラ/フラッシュ等前面

    const rand = (a: number, b: number) => hashRand(a, b); // 0..1 決定論

    switch (effectiveAnim) {
      case "lyric-mp-slide": {
        const d = t * Number(p.distance ?? 120) * sign;
        tf.push(axisX ? `translateX(${d}px)` : `translateY(${d}px)`);
        mpFilter = `blur(${t * Number(p.blur ?? 24)}px)`;
        break;
      }
      case "lyric-mp-turn": {
        const deg = t * Number(p.angle ?? 90) * sign;
        tf.push(axisX ? `rotateY(${deg}deg)` : `rotateX(${deg}deg)`);
        mpFilter = `blur(${t * Number(p.blur ?? 20)}px)`;
        break;
      }
      case "lyric-mp-mask": {
        const rev = t * 100;
        clip =
          dir === "left"
            ? `inset(0 ${rev}% 0 0)`
            : dir === "right"
              ? `inset(0 0 0 ${rev}%)`
              : dir === "up"
                ? `inset(${rev}% 0 0 0)`
                : `inset(0 0 ${rev}% 0)`;
        break;
      }
      case "lyric-mp-pop": {
        // 登場専用オーバーシュート
        const s = interpolate(
          enterR,
          [0, 0.7, 1],
          [Number(p.from ?? 0.6), Number(p.overshoot ?? 1.08), 1],
          { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
        );
        tf.push(`scale(${s})`);
        mpFilter = `blur(${(1 - enterR) * Number(p.blur ?? 12)}px)`;
        break;
      }
      case "lyric-mp-scale": {
        const grow = String(p.scaleMode ?? "grow") === "grow";
        const s = grow ? 1 - t * 0.8 : 1 + t * 0.8;
        tf.push(`scale(${Math.max(0.02, s)})`);
        break;
      }
      case "lyric-mp-fly": {
        const s = isOut ? 1 + t * 1.4 : 1 - t * 0.7;
        tf.push(`scale(${Math.max(0.02, s)})`);
        mpFilter = `blur(${t * Number(p.blur ?? 28)}px)`;
        break;
      }
      case "lyric-mp-blur": {
        mpFilter = `blur(${t * Number(p.blur ?? 32)}px)`;
        break;
      }
      case "lyric-mp-fade": {
        // op のみ（既に処理済み）
        break;
      }
      case "lyric-mp-crop": {
        const rev = t * 100;
        clip =
          String(p.origin ?? "center") === "left"
            ? `inset(0 ${rev}% 0 0)`
            : `inset(0 ${rev / 2}% 0 ${rev / 2}%)`;
        tf.push(`rotate(${t * 2}deg)`);
        break;
      }
      case "lyric-mp-stripe": {
        const rev = t * 100;
        clip = `inset(${rev}% 0 0 0)`;
        mpFilter = `blur(${t * 4}px)`;
        break;
      }
      case "lyric-mp-scrape": {
        tf.push(`translateX(${t * 40}px)`);
        mpFilter = `blur(${t * 10}px)`;
        break;
      }
      case "lyric-mp-fall": {
        // 上から落ちて着地（bounce）。登場専用。
        const fall = interpolate(frame, [0, mpInDur], [0, 1], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
          easing: Easing.bounce,
        });
        op = Math.min(quickIn, exit);
        tf.push(`translateY(${(1 - fall) * -Number(p.distance ?? 160)}px)`);
        idleOsc = false;
        break;
      }
      // ---- 常駐系 ----
      case "lyric-mp-move": {
        const s2 = String(p.direction ?? "left") === "left" ? -1 : 1;
        tf.push(`translateX(${(sec * Number(p.speed ?? 16) * s2).toFixed(2)}px)`);
        op = Math.min(quickIn, exit);
        idleOsc = false;
        break;
      }
      case "lyric-mp-jitter": {
        const iv = Math.max(1, Math.round(Number(p.interval ?? 3)));
        const q = Math.floor(frame / iv);
        const amt = Number(p.amount ?? 12);
        tf.push(
          `translate(${((rand(q, 1) - 0.5) * 2 * amt).toFixed(1)}px, ${((rand(q, 2) - 0.5) * 2 * amt).toFixed(1)}px)`,
        );
        op = Math.min(quickIn, exit);
        idleOsc = false;
        break;
      }
      case "lyric-mp-bound": {
        const b = Math.abs(Math.sin(sec * Math.PI * Number(p.speed ?? 1.6))) * Number(p.amount ?? 20);
        tf.push(`translateY(${(-b).toFixed(2)}px) skewX(${(b * 0.15).toFixed(2)}deg)`);
        op = Math.min(quickIn, exit);
        idleOsc = false;
        break;
      }
      case "lyric-mp-stretch": {
        const k = 1 + Math.sin(sec * 2 * Math.PI * Number(p.speed ?? 1.5)) * Number(p.amount ?? 0.14);
        tf.push(String(p.axis ?? "x") === "x" ? `scaleX(${k.toFixed(3)})` : `scaleY(${k.toFixed(3)})`);
        op = Math.min(quickIn, exit);
        idleOsc = false;
        break;
      }
      case "lyric-mp-vibrate": {
        const v = Math.sin(sec * 2 * Math.PI * 18) * Number(p.amount ?? 5);
        tf.push(String(p.axis ?? "x") === "x" ? `translateX(${v.toFixed(2)}px)` : `translateY(${v.toFixed(2)}px)`);
        op = Math.min(quickIn, exit);
        idleOsc = false;
        break;
      }
      case "lyric-mp-sway": {
        const sw = Math.sin(sec * 2 * Math.PI * Number(p.speed ?? 0.7)) * Number(p.amount ?? 14);
        tf.push(String(p.axis ?? "x") === "x" ? `translateX(${sw.toFixed(2)}px)` : `translateY(${sw.toFixed(2)}px)`);
        op = Math.min(quickIn, exit);
        idleOsc = false;
        break;
      }
      case "lyric-mp-echo": {
        const cnt = Math.max(1, Math.round(Number(p.count ?? 3)));
        const dist = Number(p.distance ?? 18);
        const drift = Math.sin(sec * 2 * Math.PI * 0.5) * dist;
        behindLayer = (
          <>
            {Array.from({ length: cnt }, (_, k) => (
              <div
                key={k}
                style={{
                  ...positioned,
                  transform: `${baseTranslate} translateX(${(drift * (k + 1) * 0.6).toFixed(2)}px)`,
                  opacity: (0.35 * (cnt - k)) / cnt,
                  filter: "blur(1px)",
                }}
              >
                <StrokedText text={text} fontStyle={fontStyle} textStyle={textStyle} />
              </div>
            ))}
          </>
        );
        op = Math.min(quickIn, exit);
        idleOsc = false;
        break;
      }
      case "lyric-mp-wave": {
        const amp = Number(p.amplitude ?? 10);
        const spd = Number(p.speed ?? 1.2);
        const chars = [...text];
        bodyOverride = chars.map((ch, i) => (
          <span
            key={i}
            style={{
              display: "inline-block",
              transform: `translateY(${(Math.sin(i * 0.6 + sec * 2 * Math.PI * spd) * amp).toFixed(2)}px)`,
            }}
          >
            <StrokedText text={ch === " " ? " " : ch} fontStyle={fontStyle} textStyle={textStyle} />
          </span>
        ));
        op = Math.min(quickIn, exit);
        idleOsc = false;
        break;
      }
      case "lyric-mp-blink": {
        const on = rand(Math.floor(sec * Number(p.speed ?? 6)), 7) > 0.3 ? 1 : 0.15;
        op = Math.min(quickIn, exit) * on;
        idleOsc = false;
        break;
      }
      case "lyric-mp-shockwave": {
        const ph = frame / Math.max(1, Math.round(0.4 * fps));
        const sw = ph < 1 ? Math.sin(ph * Math.PI) * Number(p.strength ?? 0.4) : 0;
        tf.push(`scale(${(1 + sw).toFixed(3)})`);
        mpFilter = `blur(${(sw * 6).toFixed(2)}px)`;
        op = Math.min(quickIn, exit);
        idleOsc = false;
        break;
      }
      case "lyric-mp-sparkle": {
        const n = Math.max(1, Math.round(Number(p.density ?? 16)));
        op = Math.min(quickIn, exit);
        frontLayer = (
          <AbsoluteFill style={{ pointerEvents: "none" }}>
            {Array.from({ length: n }, (_, k) => {
              const tw = 0.5 + 0.5 * Math.sin(sec * 2 * Math.PI * (0.8 + rand(k, 3)) + k);
              const s = 3 + rand(k, 4) * 5;
              return (
                <div
                  key={k}
                  style={{
                    position: "absolute",
                    left: `${(15 + rand(k, 1) * 70).toFixed(2)}%`,
                    bottom: `${(6 + rand(k, 2) * 26).toFixed(2)}%`,
                    width: s,
                    height: s,
                    borderRadius: "50%",
                    background: "radial-gradient(circle, #fff, rgba(255,255,255,0))",
                    opacity: tw,
                  }}
                />
              );
            })}
          </AbsoluteFill>
        );
        break;
      }
      case "lyric-mp-twinkle": {
        const glow = (0.6 + 0.4 * Math.sin(sec * 2 * Math.PI * 1.2)) * Number(p.intensity ?? 1);
        mpFilter = `drop-shadow(0 0 ${(6 * glow).toFixed(1)}px rgba(255,240,180,${(0.9 * glow).toFixed(2)}))`;
        op = Math.min(quickIn, exit);
        idleOsc = false;
        break;
      }
      case "lyric-mp-flash": {
        const ph = frame / Math.max(1, Math.round(0.35 * fps));
        const fl = ph < 1 ? 1 - ph : 0;
        op = Math.min(quickIn, exit);
        frontLayer =
          fl > 0 ? (
            <AbsoluteFill
              style={{
                pointerEvents: "none",
                opacity: fl * 0.85,
                background:
                  String(p.flashMode ?? "1") === "2"
                    ? "linear-gradient(90deg,#f00,#ff0,#0f0,#0ff,#00f,#f0f)"
                    : "#fff",
                mixBlendMode: "screen",
              }}
            />
          ) : null;
        break;
      }
    }

    // 遷移系のみ微アイドル揺れ（常駐オシレータ相当）
    if (idleOsc) {
      tf.push(`translateY(${(Math.sin(sec * Math.PI) * 1.2 * (isOut ? 1 - t : 1 - t)).toFixed(3)}px)`);
    }

    return (
      <AbsoluteFill style={{ pointerEvents: "none" }}>
        {behindLayer}
        <div
          style={{
            ...positioned,
            transform: `${baseTranslate} ${tf.join(" ")}`,
            transformOrigin: "center center",
            opacity: op,
            filter: mpFilter || undefined,
            clipPath: clip,
            WebkitClipPath: clip,
          }}
        >
          {bodyOverride ?? (
            <StrokedText text={text} fontStyle={fontStyle} textStyle={textStyle} />
          )}
        </div>
        {frontLayer}
      </AbsoluteFill>
    );
  }

  // ---- 従来: フェード / スライド / タイプ（簡易） ----
  const inDur = Math.max(1, Math.round(Number(p.inDuration ?? 0.5) * fps));
  const enter = interpolate(frame, [0, inDur], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.bezier(0.16, 1, 0.3, 1),
  });

  let opacity = Math.min(enter, exit);
  let animTranslate = "";
  let displayText = text;
  // fade/slide の磨き: 入場の瞬間だけわずかな発光が乗り、着地で落ち着く。
  // slide は移動中のみ極薄のブラー（勢いの気配）。type には掛けない
  let entryGlow: string | undefined;
  let entryFilter: string | undefined;

  if (effectiveAnim === "lyric-slide") {
    const dist = Number(p.distance ?? 30);
    const d = (1 - enter) * dist;
    animTranslate = vertical ? ` translateX(${d}px)` : ` translateY(${d}px)`;
    if (enter < 1) {
      entryGlow = `0 0 ${(textStyle.size * 0.3 * (1 - enter)).toFixed(1)}px rgba(255,255,255,${(0.35 * (1 - enter)).toFixed(3)})`;
      entryFilter = `blur(${((1 - enter) * 2.2).toFixed(2)}px)`;
    }
  } else if (effectiveAnim === "lyric-type") {
    const speed = Number(p.speed ?? 14);
    const chars = Math.max(0, Math.floor((frame / fps) * speed));
    displayText = text.slice(0, chars);
    opacity = exit;
  } else if (effectiveAnim === "lyric-fade" && enter < 1) {
    entryGlow = `0 0 ${(textStyle.size * 0.32 * (1 - enter)).toFixed(1)}px rgba(255,255,255,${(0.32 * (1 - enter)).toFixed(3)})`;
  }

  // 🔡 文字ごと微調整がある場合は1字ずつ描画（遅れ・変形を個別適用）
  if (fxMap.size > 0 && effectiveAnim !== "lyric-type") {
    const chars = [...displayText];
    return (
      <AbsoluteFill style={{ pointerEvents: "none" }}>
        <div
          style={{
            ...positioned,
            transform: `${baseTranslate}${animTranslate}`,
            opacity: exit,
          }}
        >
          {chars.map((ch, i) => {
            const delayed = interpolate(
              frame,
              [fxDelayFrames(i), fxDelayFrames(i) + inDur],
              [0, 1],
              {
                extrapolateLeft: "clamp",
                extrapolateRight: "clamp",
                easing: Easing.bezier(0.16, 1, 0.3, 1),
              },
            );
            return (
              <span
                key={i}
                style={{
                  position: "relative",
                  display: "inline-block",
                  opacity: delayed,
                  transform: fxTransform(i) || undefined,
                }}
              >
                <StrokedText
                  text={ch === " " ? " " : ch}
                  fontStyle={fontStyle}
                  textStyle={textStyle}
                />
              </span>
            );
          })}
        </div>
      </AbsoluteFill>
    );
  }

  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      <div
        style={{
          ...positioned,
          transform: `${baseTranslate}${animTranslate}`,
          opacity,
          filter: entryFilter,
        }}
      >
        <StrokedText
          text={displayText}
          fontStyle={fontStyle}
          textStyle={textStyle}
          extraShadow={entryGlow}
        />
      </div>
    </AbsoluteFill>
  );
  })();

  return withDecor(motionNode);
};
