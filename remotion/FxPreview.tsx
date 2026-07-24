import React from "react";
import { AbsoluteFill, Img, Sequence, staticFile, Video } from "remotion";
import { effectById, resolveParams } from "@/lib/effects-meta";
import { lookPresetById } from "@/lib/look-presets";
import {
  lookSchema,
  textStyleSchema,
  type Look,
  type SlotStyle,
} from "@/lib/schema";
import { CameraEffect } from "./effects/Camera";
import { FxStack } from "./effects/FxStack";
import { LookLayer } from "./effects/Look";
import { TransitionIn } from "./effects/Transitions";
import { XP_TITLE_COMPONENTS } from "./effects/xp/registry-components";
import { resolveXpAliasId } from "@/lib/xp/id-aliases";
import { SubjectOverlay } from "./effects/SubjectOverlay";
import { LyricLine } from "./lyrics/LyricLine";
import type { BeatClock } from "./effects/beat";
import type { LineWord } from "@/lib/schema";

/**
 * エフェクト図鑑のプレビューコンポジション（640×360 / 30fps / 90f = 3秒ループ）。
 * 本編と同じ実装（FxStack / TransitionIn / LyricLine）に同じpropsを渡すので、
 * 図鑑で見た質感がそのまま本編に出る。
 * - transition: 前半1秒は絵A、frame 30 から絵Bが選んだつなぎで入場
 * - lyric/decor: 暗背景＋サンプル歌詞
 * - depth.png が必要な parallax / glitch-subject は素の絵を表示（ページ側で注記）
 */

/** トランジションプレビューでBが入場するフレーム */
export const FX_PREVIEW_TRANSITION_AT = 30;
export const FX_PREVIEW_FRAMES = 90;
export const FX_PREVIEW_FPS = 30;

const NEEDS_DEPTH = new Set(["parallax", "glitch-subject"]);
const SAMPLE_LYRIC = "君の声が夜をほどいていく";

/**
 * プレビュー用の単語タイムスタンプ（歌に合わせた塗り/出現のデモ）。
 * 「声が」と「夜を」の間に0.3秒の意図的なギャップ＝塗りが止まる様子が見える。
 */
const SAMPLE_WORDS: LineWord[] = [
  { text: "君の", start: 0.3, end: 0.62, charFrom: 0, charTo: 1 },
  { text: "声が", start: 0.7, end: 1.02, charFrom: 2, charTo: 3 },
  { text: "夜を", start: 1.32, end: 1.64, charFrom: 4, charTo: 5 },
  { text: "ほどいて", start: 1.7, end: 2.22, charFrom: 6, charTo: 9 },
  { text: "いく", start: 2.3, end: 2.62, charFrom: 10, charTo: 11 },
];
const WORD_SYNC_ANIMS = new Set(["lyric-karaoke-fill", "lyric-word-pop"]);

/** プレビュー用の合成ビート（0.5秒間隔）。beatSync系のつまみが図鑑でも動く */
const PREVIEW_CLOCK: BeatClock = {
  beats: [0, 0.5, 1, 1.5, 2, 2.5],
  offsetFrames: 0,
};

export type FxPreviewProps = {
  effectId: string;
  params?: Record<string, number | string>;
  /** lyric/decor プレビューを縦書きで確認する（検証用） */
  vertical?: boolean;
  /** lyric プレビューの歌詞を差し替える（行単位スタイルの確認用）。無ければサンプル */
  text?: string;
  /** lyric プレビューの行（\n）単位スタイル（line.lyricSlotStyles 相当） */
  slotStyles?: SlotStyle[];
  /** 実素材でプレビューする（エディタから選択中の行の画像URLを渡す）。無ければサンプル */
  imageUrl?: string | null;
  /** 動画行の実素材。指定すると絵Aが動画ループ再生になる（動き系エフェクトの確認用） */
  videoUrl?: string | null;
  /** effectId="__look-live__" 用: 現在編集中の look をそのままプレビュー */
  look?: Look | null;
  /** effectId="__xp-title__" 用: タイトルデザインの素id と表示テキスト */
  xpTitleId?: string;
  titleText?: string;
  /** effectId="__xp-title__" 用: 文字色（titleCard.color 相当。空/未指定=デザイン既定） */
  titleColor?: string;
  /** effectId="__xp-title__" 用: 行（\n）単位スタイル（titleCard.slotStyles 相当） */
  titleSlotStyles?: SlotStyle[];
} & Record<string, unknown>;

export const FxPreview: React.FC<FxPreviewProps> = ({
  effectId,
  params,
  vertical,
  text,
  slotStyles,
  imageUrl,
  videoUrl,
  look,
  xpTitleId,
  titleText,
  titleColor,
  titleSlotStyles,
}) => {
  const imgA = videoUrl ? (
    <Video
      src={videoUrl}
      muted
      loop
      style={{ width: "100%", height: "100%", objectFit: "cover" }}
    />
  ) : (
    <Img
      src={imageUrl || staticFile("showcase/sample.png")}
      style={{ width: "100%", height: "100%", objectFit: "cover" }}
    />
  );
  // トランジションは「この区間に入ってくる絵」＝実素材（あれば）をB側に使う
  const imgB = (
    <Img
      src={imageUrl || staticFile("showcase/sample2.png")}
      style={{ width: "100%", height: "100%", objectFit: "cover" }}
    />
  );

  // 全体ルックのプレビュー: __look:<presetId>__ = プリセット / __look-live__ = 編集中のlook
  if (effectId === "__look-live__" || effectId.startsWith("__look:")) {
    const presetId = effectId.startsWith("__look:")
      ? effectId.slice("__look:".length).replace(/__$/, "")
      : "";
    const previewLook: Look | null =
      effectId === "__look-live__"
        ? (look ?? null)
        : presetId === "none"
          ? null
          : lookSchema.parse({
              effects: lookPresetById(presetId)?.effects ?? [],
              preset: presetId,
            });
    return (
      <AbsoluteFill style={{ background: "#000" }}>
        <LookLayer look={previewLook}>{imgA}</LookLayer>
      </AbsoluteFill>
    );
  }

  // タイトルデザイン（タイトル/クレジットレーンのプレビュー。暗背景+実テキスト）
  if (effectId === "__xp-title__" && xpTitleId) {
    const XpTitle = XP_TITLE_COMPONENTS[resolveXpAliasId(xpTitleId)];
    return (
      <AbsoluteFill style={{ background: "#000" }}>
        {imageUrl && (
          <AbsoluteFill style={{ opacity: 0.35 }}>{imgA}</AbsoluteFill>
        )}
        {XpTitle && (
          <XpTitle
            text={titleText?.trim() || "TITLE PREVIEW"}
            durationInFrames={FX_PREVIEW_FRAMES}
            color={titleColor || undefined}
            lineStyles={
              titleSlotStyles && titleSlotStyles.length > 0
                ? titleSlotStyles
                : undefined
            }
          />
        )}
      </AbsoluteFill>
    );
  }

  if (effectId === "__plain__") {
    return <AbsoluteFill style={{ background: "#000" }}>{imgA}</AbsoluteFill>;
  }
  if (effectId === "__plain-b__") {
    return <AbsoluteFill style={{ background: "#000" }}>{imgB}</AbsoluteFill>;
  }

  // 被写体の後ろに歌詞（text-behind-subject）の検証用デモ。
  // __behind-off__ は同構成でオーバーレイ無し（差分検証の対照）
  if (effectId === "__behind-demo__" || effectId === "__behind-off__") {
    return (
      <AbsoluteFill style={{ background: "#000" }}>
        {imgA}
        <LyricLine
          text={SAMPLE_LYRIC}
          anim={{ id: "lyric-fade", params: {} }}
          textStyle={textStyleSchema.parse({ size: 40 })}
          durationInFrames={FX_PREVIEW_FRAMES}
        />
        {effectId === "__behind-demo__" && (
          <SubjectOverlay
            src={staticFile("showcase/sample.png")}
            depthSrc={staticFile("showcase/sample.depth.png")}
          />
        )}
      </AbsoluteFill>
    );
  }

  const meta = effectById(effectId);
  if (!meta || NEEDS_DEPTH.has(effectId)) {
    return <AbsoluteFill style={{ background: "#000" }}>{imgA}</AbsoluteFill>;
  }
  const inst = { id: effectId, params: resolveParams(effectId, params) };

  if (meta.category === "transition") {
    return (
      <AbsoluteFill style={{ background: "#000" }}>
        {/* 出ていく側は前の区間の絵（不明なのでサンプル固定）。入ってくる側が実素材 */}
        <Img
          src={staticFile("showcase/sample.png")}
          style={{ width: "100%", height: "100%", objectFit: "cover" }}
        />
        <Sequence from={FX_PREVIEW_TRANSITION_AT}>
          <TransitionIn
            transition={inst}
            fallbackFadeFrames={24}
            beatClock={PREVIEW_CLOCK}
            lumaSrc={imageUrl || staticFile("showcase/sample2.png")}
          >
            <AbsoluteFill>{imgB}</AbsoluteFill>
          </TransitionIn>
        </Sequence>
      </AbsoluteFill>
    );
  }

  if (meta.category === "camera") {
    return (
      <AbsoluteFill style={{ background: "#000" }}>
        <CameraEffect
          instance={inst}
          durationInFrames={FX_PREVIEW_FRAMES}
          beatClock={PREVIEW_CLOCK}
        >
          {imgA}
        </CameraEffect>
      </AbsoluteFill>
    );
  }

  if (meta.category === "overlay") {
    // 静止画背景なら水滴が背景を屈折できるよう bgSrc を渡す（動画背景は従来CSS）
    const bgSrc = videoUrl ? undefined : imageUrl || staticFile("showcase/sample.png");
    return (
      <AbsoluteFill style={{ background: "#000" }}>
        <FxStack effects={[inst]} beatClock={PREVIEW_CLOCK} bgSrc={bgSrc}>
          {imgA}
        </FxStack>
      </AbsoluteFill>
    );
  }

  // look 単品（図鑑用）: 本編と同じ LookLayer を通す
  if (meta.category === "look") {
    return (
      <AbsoluteFill style={{ background: "#000" }}>
        <LookLayer look={lookSchema.parse({ effects: [inst] })}>{imgA}</LookLayer>
      </AbsoluteFill>
    );
  }

  // lyric / decor: 暗い背景＋サンプル歌詞（プレビュー解像度に合わせ文字は小さめ）
  const previewTextStyle = textStyleSchema.parse({
    size: 40,
    orientation: vertical ? "vertical" : "horizontal",
  });
  const isDecor = meta.category === "decor";
  return (
    <AbsoluteFill
      style={{
        background: "linear-gradient(180deg, #0c0c14 0%, #16121c 100%)",
      }}
    >
      <LyricLine
        text={text || SAMPLE_LYRIC}
        anim={isDecor ? { id: "lyric-fade", params: {} } : inst}
        decor={isDecor ? inst : null}
        textStyle={previewTextStyle}
        durationInFrames={FX_PREVIEW_FRAMES}
        beatClock={PREVIEW_CLOCK}
        words={WORD_SYNC_ANIMS.has(effectId) ? SAMPLE_WORDS : undefined}
        lineStartSec={0}
        slotStyles={slotStyles}
      />
    </AbsoluteFill>
  );
};
