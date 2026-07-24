import React, { useEffect, useState } from "react";
import {
  AbsoluteFill,
  Freeze,
  Img,
  Loop,
  OffthreadVideo,
  Sequence,
  cancelRender,
  continueRender,
  delayRender,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { Audio } from "@remotion/media";
import { getVideoMetadata } from "@remotion/media-utils";
import type { EffectInstance, Look, Project } from "@/lib/schema";
import { deriveSectionCuts, type PlacedCut } from "@/lib/cuts";
import { framingShort, framingTransform } from "@/lib/framing";
import { isVideoFile } from "@/lib/utils";
import {
  deriveSections,
  deriveTimeline,
  lineTime,
  toFrames,
  type Timeline,
} from "@/lib/sections";
import { resolveParams } from "@/lib/effects-meta";
import { telopWindowAbs, creditEnterExit } from "@/lib/telop-window";
import type { TitleCard } from "@/lib/schema";
import { ShortTextsOverlay } from "./ShortTextsOverlay";
import { fontById } from "./fonts";
import { assetUrl } from "./asset-url";
import { CameraEffect } from "./effects/Camera";
import { GlitchSubject } from "./effects/GlitchSubject";
import { SubjectOverlay } from "./effects/SubjectOverlay";
import { ParallaxLayer } from "./effects/ParallaxLayer";
import { FxStack } from "./effects/FxStack";
import { LookLayer } from "./effects/Look";
import {
  TransitionIn,
  TransitionOut,
  transitionFrames,
} from "./effects/Transitions";
import { LyricLine } from "./lyrics/LyricLine";
import { EndCard } from "./EndCard";
import { XP_TITLE_COMPONENTS } from "./effects/xp/registry-components";
import { resolveXpAliasId } from "@/lib/xp/id-aliases";
import type { BeatClock } from "./effects/beat";

const CAMERA_IDS = ["slow-zoom-in", "slow-zoom-out", "pan", "punch-zoom", "push-in", "parallax"];

/** 🎬 クレジット/タイトルの入退場上掛け（Sequence内で使う）。入り/抜き0秒なら従来と完全一致。
    スタイル（fade/rise/fall/blur/pop）とイージングは lib/telop-window の純関数が持つ */
const CreditFade: React.FC<{
  durF: number;
  card: Pick<TitleCard, "fadeIn" | "fadeOut" | "enterStyle" | "exitStyle">;
  children: React.ReactNode;
}> = ({ durF, card, children }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const m = creditEnterExit(
    frame,
    durF,
    Math.round(card.fadeIn * fps),
    Math.round(card.fadeOut * fps),
    card.enterStyle,
    card.exitStyle,
  );
  if (m.opacity >= 1 && m.translateY === 0 && m.blur === 0 && m.scale === 1) {
    return <>{children}</>;
  }
  return (
    <AbsoluteFill
      style={{
        pointerEvents: "none",
        opacity: m.opacity,
        transform: `translateY(${m.translateY}px) scale(${m.scale})`,
        ...(m.blur > 0 ? { filter: `blur(${m.blur.toFixed(1)}px)` } : {}),
      }}
    >
      {children}
    </AbsoluteFill>
  );
};

/** 区間Sequenceの先読み（境界での素材ロードによるカクつき・黒ちらつき対策） */
const PREMOUNT_SEC = 2;

export type MVProps = {
  project: Project;
  projectName: string;
  assetBase: string;
  /** 検出済みビート（曲内秒）。ビート同期エフェクトに使う。無ければ同期は無効 */
  beats?: number[];
  /** 検出済み小節頭（曲内秒）。プッシュイン等の小節同期カメラに使う。無ければ拍から推定 */
  downbeats?: number[];
} & Record<string, unknown>;

/** 画像ファイル名 → 深度マップのファイル名（images/01.png → images/01.depth.png） */
function depthFileOf(image: string): string {
  const dot = image.lastIndexOf(".");
  return dot === -1 ? `${image}.depth.png` : `${image.slice(0, dot)}.depth.png`;
}

/** 画像ファイル名 → 人物切り抜きのファイル名（images/01.png → images/01.subject.png） */
function subjectFileOf(image: string): string {
  const dot = image.lastIndexOf(".");
  return dot === -1 ? `${image}.subject.png` : `${image.slice(0, dot)}.subject.png`;
}

// 動画メタデータのモジュールキャッシュ。Sequence再入場・シークのたびの
// 再取得（黒ちらつき＋delayRender再発）を防ぐ
const videoDurationCache = new Map<string, Promise<number>>();
function cachedVideoDuration(src: string): Promise<number> {
  let p = videoDurationCache.get(src);
  if (!p) {
    p = getVideoMetadata(src).then((m) => m.durationInSeconds);
    videoDurationCache.set(src, p);
    p.catch(() => videoDurationCache.delete(src)); // 失敗はキャッシュしない
  }
  return p;
}

// ピンポン版のような「無いかもしれない」動画用: 失敗を null で返し、結果もキャッシュする
// （毎フレーム404を叩き直さないため）
const optionalDurationCache = new Map<string, Promise<number | null>>();
function cachedVideoDurationOrNull(src: string): Promise<number | null> {
  let p = optionalDurationCache.get(src);
  if (!p) {
    p = getVideoMetadata(src)
      .then((m) => m.durationInSeconds)
      .catch(() => null);
    optionalDurationCache.set(src, p);
  }
  return p;
}

import { computeHoldPlan } from "@/lib/video-plan";

/** クリップ末尾で凍結する（尺を使い切った後に範囲外フレームを要求しないための蓋） */
const HoldEnd: React.FC<{ clipFrames: number; children: React.ReactNode }> = ({
  clipFrames,
  children,
}) => {
  const frame = useCurrentFrame();
  return (
    <Freeze frame={clipFrames - 1} active={frame >= clipFrames - 1}>
      {children}
    </Freeze>
  );
};

/**
 * 🎬 区間の動画素材（i2v生成物など）を、区間尺に「1本の連続した動き」として敷く。
 *
 * 動画は元絵に i2v の動きが焼き込まれた自己完結クリップ。ハードカットのループは
 * 継ぎ目でフレーム0に飛んで段差になるので採らない。代わりに:
 *   - 区間 ≤ クリップ         : 等速で流し、区間側で切る（速度いじらない）
 *   - クリップ < 区間 ≤ 2×    : playbackRate を落として区間にピタリ伸ばす（継ぎ目なし）
 *   - 区間 > 2×クリップ       : mode で分岐。
 *     hold(既定)  : 1回流しきって最後のコマで静止。外側のカメラズームは掛かり続ける
 *                   ので「寄って、寄り切って、なお寄る」の一方向な体験になる。
 *     pingpong    : ピンポン版（xxx.pp.mp4 = 順→逆の回文）を等速Loop。雨・揺れなど
 *                   方向性のない環境の動き向け。pp が無ければクロスフェードループ。
 * 実尺はメタデータから取る（その間 delayRender で待つ）。
 */
const SectionVideo: React.FC<{
  src: string;
  ppSrc: string;
  durationInFrames: number;
  mode: "hold" | "pingpong";
  /** hold時の動き出し。head=区間の頭から動画スタート（既定）/ end=終わりから逆算 */
  anchor?: "head" | "end";
  /** 再生速度の手動指定（null=自動リタイム） */
  manualRate?: number | null;
  /** end待機中に見せる静止画（i2vSource）。無ければ待機せず区間頭から再生 */
  posterSrc?: string | null;
  /** ✂️ 素材内の使いたい区間（秒）。start=0 & end=null なら従来どおり全尺 */
  trimStartSec?: number;
  trimEndSec?: number | null;
  /** ショート縦合成時のパン（cover の切り抜き窓）。undefined=従来の中央（本編は常にこれ） */
  objectPosition?: string;
}> = ({
  src,
  ppSrc,
  durationInFrames,
  mode,
  anchor = "head",
  manualRate = null,
  posterSrc,
  trimStartSec = 0,
  trimEndSec = null,
  objectPosition,
}) => {
  const { fps } = useVideoConfig();
  const [durs, setDurs] = useState<{ main: number; pp: number | null } | null>(
    null,
  );
  const [handle] = useState(() => delayRender(`video metadata: ${src}`));

  useEffect(() => {
    let alive = true;
    Promise.all([cachedVideoDuration(src), cachedVideoDurationOrNull(ppSrc)])
      .then(([main, pp]) => {
        if (alive) setDurs({ main, pp });
        continueRender(handle);
      })
      .catch((e) => cancelRender(e));
    return () => {
      alive = false;
    };
  }, [src, ppSrc, handle]);

  if (durs === null) return null;

  // 動き出しの決定:
  //   head(既定) = 区間の頭から動画スタート。元が動画なら動画で始まる。
  //                尺が尽きたら最後のコマで静止（ズームは続く）。足りなければ延長生成。
  //   end        = 終わりから逆算（歌詞の瞬間に動きを残す）。手前はポスター待機。
  const sectionSec = durationInFrames / fps;
  // ✂️ トリム: 素材内の [in, out] だけを使う。リタイム計算の基準は「切り出し尺」。
  // 丸め事故対策: in は末尾-1f まで、out は in+1f〜素材末尾にクランプ
  const minClip = 1 / fps;
  const trimStart = Math.min(
    Math.max(0, trimStartSec),
    Math.max(0, durs.main - minClip),
  );
  const trimEnd = Math.min(
    Math.max(trimEndSec ?? durs.main, trimStart + minClip),
    durs.main,
  );
  const clipSec = trimEnd - trimStart;
  const trimmed = trimStart > 1e-4 || trimEnd < durs.main - 1e-4;
  const trimProps = trimmed
    ? {
        trimBefore: Math.round(trimStart * fps),
        trimAfter: Math.round(trimEnd * fps),
      }
    : {};
  const plan = computeHoldPlan(clipSec, sectionSec);
  // 倍速の手動指定があれば自動リタイムより優先する
  const rate = manualRate ?? plan.rate;
  const effectiveSec = clipSec / rate; // リタイム後にクリップが持つ長さ
  // end はポスター必須（無い旧素材は待機できないので頭から再生）
  const leadIn =
    mode === "hold" && anchor === "end" && posterSrc
      ? Math.max(0, Math.round((sectionSec - effectiveSec) * fps))
      : 0;

  const videoEl = (
    <OffthreadVideo
      src={src}
      muted
      playbackRate={rate}
      style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition }}
      {...trimProps}
    />
  );

  // ⏸ hold: 待機 → 1回流しきる → 最後のコマで静止。方向が反転する瞬間ゼロ。
  // 外側の CameraEffect が区間全体で寄り続けるので、静止後も画は前進し続ける。
  // 凍結は Freeze の active 切替＝同じ video 要素のまま（差し替えると黒フラッシュ）。
  if (mode === "hold") {
    const clipFrames = Math.max(1, Math.floor(effectiveSec * fps) - 1);
    const inner = <HoldEnd clipFrames={clipFrames}>{videoEl}</HoldEnd>;
    if (leadIn > 0 && posterSrc) {
      return (
        <AbsoluteFill>
          {/* 待機中はポスター＝動画の初手と同じ絵。切り替わりは目に見えない */}
          <Img
            src={posterSrc}
            style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition }}
          />
          {/* premountで先に読み込ませ、行の瞬間に頭から再生開始（layout=noneとは併用不可） */}
          <Sequence from={leadIn} premountFor={leadIn}>
            {inner}
          </Sequence>
        </AbsoluteFill>
      );
    }
    return inner;
  }

  // リタイムだけで区間を覆えるなら1本流して終わり（区間側のSequenceが末尾を切る）
  if (effectiveSec >= sectionSec - 1 / fps) return videoEl;

  // 🔁 往復で繋ぐ（既定）: ピンポン版の前半＝順再生なので「1回流しきってから往復」と同じ。
  // rate も掛かるので、自動リタイムなら順再生パスがちょうど区間を満たし、
  // 手動倍速で余った分だけ折り返しが見える（静止画で終わることはない）
  // ✂️ トリム時は pp（全尺前提の事前生成物）が使えないためクロスフェードへフォールバック
  if (durs.pp && !trimmed) {
    const unit = Math.max(1, Math.floor((durs.pp / rate) * fps) - 1);
    return (
      <Loop durationInFrames={unit}>
        <OffthreadVideo
          src={ppSrc}
          muted
          playbackRate={rate}
          style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition }}
        />
      </Loop>
    );
  }

  // フォールバック: 2×スローで伸ばしつつ、継ぎ目を長め(1.2s)のクロスフェードで馴染ませる
  const unitFrames = Math.max(1, Math.floor(effectiveSec * fps));
  const fadeFrames = Math.min(
    Math.round(1.2 * fps),
    Math.floor(unitFrames / 3),
  );
  return (
    <CrossfadeLoop
      unitFrames={unitFrames}
      fadeFrames={fadeFrames}
      totalFrames={durationInFrames}
    >
      <OffthreadVideo
        src={src}
        muted
        playbackRate={rate}
        style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition }}
        {...trimProps}
      />
    </CrossfadeLoop>
  );
};

/**
 * 中身を unitFrames ごとに敷き直しつつ、継ぎ目を fadeFrames ぶん重ねて
 * クロスフェードする（ハードカットのループの段差を消す）。各コピーは Sequence
 * ローカルの frame0 から始まるので、中の動画は毎回頭から再生される。
 */
const CrossfadeLoop: React.FC<{
  unitFrames: number;
  fadeFrames: number;
  totalFrames: number;
  children: React.ReactNode;
}> = ({ unitFrames, fadeFrames, totalFrames, children }) => {
  const step = Math.max(1, unitFrames - fadeFrames);
  const count = Math.ceil(totalFrames / step) + 1;
  return (
    <AbsoluteFill>
      {Array.from({ length: count }, (_, i) => (
        <Sequence key={i} from={i * step} durationInFrames={unitFrames}>
          <CrossfadeUnit
            unitFrames={unitFrames}
            fadeFrames={fadeFrames}
            fadeInStart={i > 0}
          >
            {children}
          </CrossfadeUnit>
        </Sequence>
      ))}
    </AbsoluteFill>
  );
};

const CrossfadeUnit: React.FC<{
  unitFrames: number;
  fadeFrames: number;
  fadeInStart: boolean;
  children: React.ReactNode;
}> = ({ unitFrames, fadeFrames, fadeInStart, children }) => {
  const frame = useCurrentFrame();
  const fadeIn = fadeInStart
    ? interpolate(frame, [0, fadeFrames], [0, 1], {
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
      })
    : 1;
  const fadeOut = interpolate(
    frame,
    [unitFrames - fadeFrames, unitFrames],
    [1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );
  return (
    <AbsoluteFill style={{ opacity: Math.min(fadeIn, fadeOut) }}>
      {children}
    </AbsoluteFill>
  );
};

/** 区間の中身（画像＋camera＋overlay）を組み立てる */
const SectionContent: React.FC<{
  image: string | null;
  effects: EffectInstance[];
  durationInFrames: number;
  projectName: string;
  assetBase: string;
  beatClock?: BeatClock | null;
  videoLoop?: "hold" | "pingpong";
  videoAnchor?: "head" | "end";
  videoRate?: number | null;
  videoPoster?: string | null;
  videoTrimStart?: number;
  videoTrimEnd?: number | null;
  /** フレーミング（拡大して一部を使う）。既定値は従来経路そのまま */
  frameScale?: number;
  frameX?: number;
  frameY?: number;
  /** ✂️✂️ カット割り（2カット以上のときのみ渡す。null/1件は従来パス＝ピクセル回帰ゼロ） */
  cuts?: PlacedCut[] | null;
  /** 全体ルック（lookOff の区間は素の画のまま） */
  look?: Look | null;
  lookOff?: boolean;
  /** 全体見せモード（ショート縦合成時のみ。aspect=本編のw/h）。null=従来のcover */
  fullFrame?: { aspect: number } | null;
  /**
   * ショート縦合成中か（project.shortOverlay != null と同義）。
   * true のときだけパンを object-position で行い、wrapper は scale のみ。
   * false（本編）は従来の translate+scale＝ピクセル回帰ゼロ。
   */
  shortFraming?: boolean;
}> = ({
  image,
  effects,
  durationInFrames,
  projectName,
  assetBase,
  beatClock,
  videoLoop = "pingpong",
  videoAnchor = "head",
  videoRate = null,
  videoPoster = null,
  videoTrimStart = 0,
  videoTrimEnd = null,
  frameScale = 1,
  frameX = 0,
  frameY = 0,
  cuts = null,
  look = null,
  lookOff = false,
  fullFrame = null,
  shortFraming = false,
}) => {
  const { fps } = useVideoConfig();
  const camera = effects.find((e) => CAMERA_IDS.includes(e.id));
  const glitchSubject = effects.find((e) => e.id === "glitch-subject");

  // フレーミング（拡大して一部を使う）: 画像そのものを包む＝CameraEffect/FxStackより内側。
  // 本編(shortFraming=false): translate+scale の従来経路。既定値(1x/0/0)は framingTransform が
  //   null を返しラップしない（回帰ゼロ）。
  // ショート(shortFraming=true): パンは media の object-position（mediaStyle）で行うので、
  //   ここでは wrapper に scale（ズーム）だけを掛ける。黒縁ガードは不要（cover は常に枠を満たす）。
  const framed = (
    node: React.ReactNode,
    f: { frameScale?: number; frameX?: number; frameY?: number },
  ): React.ReactNode => {
    if (shortFraming) {
      const { wrapper } = framingShort(f.frameScale, f.frameX, f.frameY);
      return wrapper ? <AbsoluteFill style={wrapper}>{node}</AbsoluteFill> : node;
    }
    const style = framingTransform(f.frameScale, f.frameX, f.frameY);
    return style ? <AbsoluteFill style={style}>{node}</AbsoluteFill> : node;
  };

  // media(Img/Video)の style。ショート時だけ object-position でパン（横長→縦枠を端まで滑らせる）。
  // 本編は objectPosition を付けない＝従来の cover 中央（回帰ゼロ）。
  const mediaStyle = (f: {
    frameScale?: number;
    frameX?: number;
    frameY?: number;
  }): React.CSSProperties => ({
    width: "100%",
    height: "100%",
    objectFit: "cover",
    ...(shortFraming
      ? { objectPosition: framingShort(f.frameScale, f.frameX, f.frameY).objectPosition }
      : {}),
  });
  // SectionVideo へ渡す objectPosition（本編は undefined＝従来中央）
  const videoObjectPosition = (f: {
    frameScale?: number;
    frameX?: number;
    frameY?: number;
  }): string | undefined =>
    shortFraming ? framingShort(f.frameScale, f.frameX, f.frameY).objectPosition : undefined;

  // ✂️✂️ カット積層: 各カットを自分の区間内Sequenceで重ねる（後のカットが上）。
  // CameraEffect / FxStack は従来どおりこの外側＝区間全体を貫く
  const cutList = cuts && cuts.length > 1 ? cuts : null;
  const imageEl = cutList ? (
    <AbsoluteFill>
      {cutList.map((pc) => {
        const from = Math.round(pc.startSec * fps);
        const dur = Math.max(1, Math.round(pc.durationSec * fps));
        const media = isVideoFile(pc.cut.image) ? (
          <SectionVideo
            src={assetUrl(assetBase, projectName, pc.cut.image)}
            ppSrc={assetUrl(
              assetBase,
              projectName,
              pc.cut.image.replace(/\.(mp4|webm|mov)$/i, ".pp.$1"),
            )}
            durationInFrames={dur}
            mode={pc.cut.videoLoop}
            anchor={pc.cut.videoAnchor}
            manualRate={pc.cut.videoRate}
            posterSrc={
              pc.cut.i2vSource
                ? assetUrl(assetBase, projectName, pc.cut.i2vSource)
                : null
            }
            trimStartSec={pc.cut.trimStart}
            trimEndSec={pc.cut.trimEnd}
            objectPosition={videoObjectPosition(pc.cut)}
          />
        ) : (
          <Img
            src={assetUrl(assetBase, projectName, pc.cut.image)}
            style={mediaStyle(pc.cut)}
          />
        );
        return (
          // premountで先読みして境界の黒ちらつきを防ぐ（layout="none"とは併用不可の制約に従い既定レイアウト）
          <Sequence
            key={pc.cut.id}
            from={from}
            durationInFrames={dur}
            premountFor={from > 0 ? Math.round(fps) : 0}
          >
            {framed(media, pc.cut)}
          </Sequence>
        );
      })}
    </AbsoluteFill>
  ) : image ? (
    framed(
    isVideoFile(image) ? (
      // 🎬 i2v生成などの動画素材: 区間より短ければループ。音はBGMの邪魔なのでミュート
      <SectionVideo
        src={assetUrl(assetBase, projectName, image)}
        ppSrc={assetUrl(
          assetBase,
          projectName,
          image.replace(/\.(mp4|webm|mov)$/i, ".pp.$1"),
        )}
        durationInFrames={durationInFrames}
        mode={videoLoop}
        anchor={videoAnchor}
        manualRate={videoRate}
        posterSrc={videoPoster}
        trimStartSec={videoTrimStart}
        trimEndSec={videoTrimEnd}
        objectPosition={videoObjectPosition({ frameScale, frameX, frameY })}
      />
    ) : camera?.id === "parallax" ? (
      <ParallaxLayer
        src={assetUrl(assetBase, projectName, image)}
        depthSrc={assetUrl(assetBase, projectName, depthFileOf(image))}
        instance={camera}
        durationInFrames={durationInFrames}
      />
    ) : (
      <Img
        src={assetUrl(assetBase, projectName, image)}
        style={mediaStyle({ frameScale, frameX, frameY })}
      />
    ),
    { frameScale, frameX, frameY },
    )
  ) : (
    <AbsoluteFill style={{ background: "#000" }} />
  );

  // 全体見せモード（ショート縦合成時のみ）: 本編アスペクトの箱を中央に置く＝coverのまま
  // 本編で見えていた全体が写る。余白は同じ絵のぼかし拡大で埋める（黒帯にしない）。
  // null（既定）はこの分岐を通らない＝従来経路そのまま（本編回帰ゼロ）
  const framedEl: React.ReactNode = fullFrame ? (
    <AbsoluteFill>
      <AbsoluteFill
        style={{ filter: "blur(48px) brightness(0.72)", transform: "scale(1.15)" }}
      >
        {imageEl}
      </AbsoluteFill>
      <AbsoluteFill style={{ justifyContent: "center", alignItems: "center" }}>
        <div
          style={{
            position: "relative",
            width: "100%",
            aspectRatio: String(fullFrame.aspect),
            overflow: "hidden",
          }}
        >
          {imageEl}
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  ) : (
    imageEl
  );

  // カメラ（スローズーム等）は区間全体を貫く1本の連続した動きとして掛かる。
  // 動画素材でも同様: ループは内側(SectionVideo)、ズームは外側なので、
  // クリップが5秒ごとに繰り返してもズームは継ぎ目でリセットしない。
  const base: React.ReactNode = (
    <CameraEffect
      instance={camera ?? null}
      durationInFrames={durationInFrames}
      beatClock={beatClock}
    >
      {framedEl}
    </CameraEffect>
  );

  // 静止画背景なら水滴が背景を屈折できるよう bgSrc を渡す（動画背景は従来CSS）
  const rainBgSrc =
    image && !isVideoFile(image)
      ? assetUrl(assetBase, projectName, image)
      : undefined;

  return (
    <LookLayer look={look} off={lookOff}>
      <AbsoluteFill>
        <FxStack effects={effects} beatClock={beatClock} bgSrc={rainBgSrc}>
          {base}
        </FxStack>
        {/* 被写体グリッチ: 深度マップの明部（手前=キャラ）だけをバグらせる。静止画専用 */}
        {glitchSubject && image && !isVideoFile(image) && (
          (() => {
            const p = resolveParams("glitch-subject", glitchSubject.params);
            return (
              <GlitchSubject
                src={assetUrl(assetBase, projectName, image)}
                depthSrc={assetUrl(assetBase, projectName, depthFileOf(image))}
                intensity={Number(p.intensity)}
                interval={Number(p.interval)}
                rgbShift={Number(p.rgbShift)}
              />
            );
          })()
        )}
      </AbsoluteFill>
    </LookLayer>
  );
};


const PrologueBlock: React.FC<{
  project: Project;
  timeline: Timeline;
  projectName: string;
  assetBase: string;
}> = ({ project, timeline, projectName, assetBase }) => {
  const p = project.prologue;
  const { fps } = timeline;
  const durFrames = toFrames(p.duration, fps);
  if (!p.enabled || durFrames <= 0) return null;

  const stanzas = p.subtitle.enabled ? p.subtitle.stanzas : [];
  const slot = stanzas.length > 0 ? p.duration / stanzas.length : 0;

  return (
    <Sequence durationInFrames={durFrames} layout="none">
      <AbsoluteFill style={{ background: "#000" }}>
        <SectionContent
          image={p.image}
          effects={p.effects}
          durationInFrames={durFrames}
          projectName={projectName}
          assetBase={assetBase}
          look={project.look}
        />
        {/* 詩の字幕: 均等割り＋オフセット、入替型（常に1連だけ） */}
        {stanzas.map((st, i) => {
          const start = Math.max(0, i * slot + st.offset);
          const next =
            i + 1 < stanzas.length
              ? Math.max(start + 0.5, (i + 1) * slot + stanzas[i + 1].offset)
              : p.duration;
          const dur = toFrames(next - start, fps);
          if (dur <= 0) return null;
          return (
            <Sequence key={i} from={toFrames(start, fps)} durationInFrames={dur} layout="none">
              <LyricLine
                text={st.text}
                anim={p.subtitle.anim ?? { id: "lyric-fade", params: {} }}
                textStyle={project.meta.textStyle}
                durationInFrames={dur}
                placement="prologue"
              />
            </Sequence>
          );
        })}
      </AbsoluteFill>
    </Sequence>
  );
};

export const MVComposition: React.FC<MVProps> = ({
  project,
  projectName,
  assetBase,
  beats,
  downbeats,
}) => {
  const { fps } = useVideoConfig();
  const timeline = deriveTimeline(project);
  const sections = deriveSections(project.lines, timeline.songDuration);
  const songStartFrame = toFrames(timeline.songStart, fps);
  const outroStartFrame = toFrames(timeline.outroStart, fps);
  const totalFrames = toFrames(timeline.total, fps);
  const overlapFrames = project.prologue.enabled
    ? toFrames(project.prologue.overlapSec, fps)
    : 0;
  const premount = Math.round(PREMOUNT_SEC * fps);
  const beatList = beats ?? [];
  const downbeatList = downbeats ?? [];
  // 全体見せモード（ショート縦合成時だけ applyShortToProject が焼き込む。本編では常にnull）
  const fullFrame = project.shortOverlay?.fullFrame ?? null;
  // ショート縦合成中か。true のときだけフレーミングを object-position 方式にする（本編は不変）
  const shortFraming = project.shortOverlay != null;

  // 区間の中身（SectionContent）を組み立てる単一ソース。本体（区間i）と、
  // 拡張切替へ供給する fromContent（前区間の中身）の両方が同じ props で描くための
  // ドリフト防止関数。dur・beatClock はその区間自身の値で毎回組み直す。
  const sectionContentFor = (idx: number): React.ReactNode => {
    const s = sections[idx];
    const h = project.lines[s.headLineIndex];
    const sStart = songStartFrame + toFrames(s.start, fps);
    const sNextTrans = transitionFrames(sections[idx + 1], project, fps);
    const sEnd =
      songStartFrame +
      toFrames(s.end, fps) +
      (idx + 1 < sections.length ? sNextTrans : 0);
    const sDur = Math.max(1, sEnd - sStart);
    const sBeatClock: BeatClock | null =
      beatList.length > 0
        ? {
            beats: beatList,
            downbeats: downbeatList.length > 0 ? downbeatList : undefined,
            offsetFrames: sStart - songStartFrame,
          }
        : null;
    return (
      <SectionContent
        image={s.image}
        effects={h.effects}
        durationInFrames={sDur}
        projectName={projectName}
        assetBase={assetBase}
        beatClock={sBeatClock}
        videoLoop={h.videoLoop}
        videoAnchor={h.videoAnchor}
        videoRate={h.videoRate}
        videoTrimStart={h.videoTrimStart}
        videoTrimEnd={h.videoTrimEnd}
        frameScale={h.frameScale}
        frameX={h.frameX}
        frameY={h.frameY}
        cuts={h.cuts.length > 1 ? deriveSectionCuts(h, sDur / fps) : null}
        videoPoster={
          h.i2vSource ? assetUrl(assetBase, projectName, h.i2vSource) : null
        }
        look={project.look}
        lookOff={h.lookOff}
        fullFrame={fullFrame}
        shortFraming={shortFraming}
      />
    );
  };

  return (
    <AbsoluteFill style={{ background: "#000" }}>
      {/* ---- 本編: 区間（後の区間ほど上に重なり、頭でフェードイン） ---- */}
      {sections.map((sec, i) => {
        const head = project.lines[sec.headLineIndex];
        const nextHead =
          i + 1 < sections.length
            ? project.lines[sections[i + 1].headLineIndex]
            : null;
        const startFrame = songStartFrame + toFrames(sec.start, fps);
        const nextTrans = transitionFrames(sections[i + 1], project, fps);
        const endFrame =
          songStartFrame + toFrames(sec.end, fps) + (i + 1 < sections.length ? nextTrans : 0);
        const dur = Math.max(1, endFrame - startFrame);
        // プロローグ明けの最初の区間はオーバーラップぶんかけてフェードイン
        const fallbackFade = i === 0 ? overlapFrames : Math.round(0.8 * fps);
        // 拡張切替の from（前区間の中身）: 区間iローカルフレーム g に対し、前区間の
        // ローカルフレーム = g + (startFrame_i − prevStartFrame)。Sequence の from を
        // 負に振ると child が見る時間が先へ進む（childLocal = g − from）。i=0 は前が無い。
        const prevStartFrame =
          i > 0 ? songStartFrame + toFrames(sections[i - 1].start, fps) : 0;
        const fromContent =
          i > 0 ? (
            <Sequence from={-(startFrame - prevStartFrame)} layout="none">
              {sectionContentFor(i - 1)}
            </Sequence>
          ) : null;
        // Sequenceローカルフレーム→曲内フレームの換算（ビート同期用）
        const beatClock: BeatClock | null =
          beatList.length > 0
            ? {
                beats: beatList,
                downbeats: downbeatList.length > 0 ? downbeatList : undefined,
                offsetFrames: startFrame - songStartFrame,
              }
            : null;
        return (
          // premountFor は layout="none" と併用不可のため既定レイアウト
          // （中身がAbsoluteFillなので見た目は等価）
          <Sequence
            key={head.id}
            from={startFrame}
            durationInFrames={dur}
            premountFor={premount}
          >
            <TransitionIn
              transition={head.transition}
              fallbackFadeFrames={fallbackFade}
              beatClock={beatClock}
              lumaSrc={
                sec.image && !isVideoFile(sec.image)
                  ? assetUrl(assetBase, projectName, sec.image)
                  : null
              }
              fromContent={fromContent}
            >
              <TransitionOut
                exitTransition={nextHead?.transition ?? null}
                exitStartFrame={dur - nextTrans}
                exitFrames={nextTrans}
              >
                {sectionContentFor(i)}
              </TransitionOut>
            </TransitionIn>
          </Sequence>
        );
      })}

      {/* ---- アウトロ: 1枚絵＋エフェクトで余韻 → 黒へ ---- */}
      {project.outro.duration > 0 && (
        <Sequence
          from={outroStartFrame}
          durationInFrames={totalFrames - outroStartFrame}
          premountFor={premount}
        >
          <TransitionIn transition={null} fallbackFadeFrames={Math.round(1 * fps)}>
            <SectionContent
              image={project.outro.image}
              effects={project.outro.effects}
              durationInFrames={totalFrames - outroStartFrame}
              projectName={projectName}
              assetBase={assetBase}
              look={project.look}
              lookOff={project.outro.lookOff}
              fullFrame={fullFrame}
              shortFraming={shortFraming}
            />
          </TransitionIn>
          {/* エンドカード: プリセット（曲名・Created by等）または自由テキスト */}
          {/* endCard は schemaVersion 1 以前の project.json に無いため ?. で守る */}
          {project.outro.endCard?.preset && project.outro.endCard.preset !== "none" ? (
            <EndCard endCard={project.outro.endCard} project={project} />
          ) : (
            (project.outro.text ?? "").trim() !== "" && (
              <LyricLine
                text={project.outro.text}
                anim={
                  project.outro.textAnim ?? {
                    id: "lyric-fade",
                    params: { inDuration: 1.2 },
                  }
                }
                textStyle={project.meta.textStyle}
                durationInFrames={totalFrames - outroStartFrame}
                placement="prologue"
              />
            )
          )}
          <FadeToBlack
            lastFrames={Math.round(1.2 * fps)}
            durationInFrames={totalFrames - outroStartFrame}
          />
        </Sequence>
      )}

      {/* ---- 歌詞（本編の行。入替型） ---- */}
      {/* 全体ルックは色調整のみ歌詞にも掛ける（applyToLyrics。粒子・ビネットは絵専用） */}
      <LookLayer
        look={project.look.applyToLyrics ? project.look : null}
        colorOnly
      >
      {project.lines.map((line, i) => {
        // showLyrics=false は本編歌詞のみ消す（行credit/openingCard/エンドカードは別ブロックで描画継続）
        if (!project.meta.showLyrics) return null;
        // 行単位OFF（アウトロのクレジット中など。テキストは残るので後で戻せる）
        if (!line.showLyric) return null;
        if (!line.lyricText.trim()) return null;
        const start = songStartFrame + toFrames(lineTime(line), fps);
        const nextLine = project.lines[i + 1];
        const endSec = nextLine
          ? lineTime(nextLine)
          : Math.min(lineTime(line) + 8, timeline.songDuration);
        const dur = Math.max(
          1,
          songStartFrame + toFrames(Math.min(endSec, timeline.songDuration), fps) - start,
        );
        // 被写体の後ろに置く行: この行が属する区間の画像（静止画のみ）
        const behindSec = line.behindSubject
          ? (sections.find((s) => s.lineIndexes.includes(i)) ?? null)
          : null;
        const sectionImage = behindSec?.image ?? null;
        const behindImage =
          sectionImage && !isVideoFile(sectionImage) ? sectionImage : null;
        // 区間の頭の行が持つエフェクト/ルックで「エフェクト適用後の区間」を再構築し、
        // 被写体シルエットでマスクする（グレイン/色調整/フレアがキャラにも乗る）
        const behindHead =
          behindSec != null ? project.lines[behindSec.headLineIndex] : null;
        const behindContent =
          behindImage && behindHead ? (
            <SectionContent
              image={behindImage}
              effects={behindHead.effects}
              frameScale={behindHead.frameScale}
              frameX={behindHead.frameX}
              frameY={behindHead.frameY}
              durationInFrames={dur}
              projectName={projectName}
              assetBase={assetBase}
              beatClock={
                beatList.length > 0
                  ? {
                      beats: beatList,
                      downbeats: downbeatList.length > 0 ? downbeatList : undefined,
                      offsetFrames: start - songStartFrame,
                    }
                  : null
              }
              look={project.look}
              lookOff={behindHead.lookOff}
              fullFrame={fullFrame}
              shortFraming={shortFraming}
            />
          ) : null;
        return (
          <Sequence key={line.id} from={start} durationInFrames={dur} layout="none">
            <LyricLine
              text={line.lyricText}
              anim={line.lyricAnim}
              textStyle={project.meta.textStyle}
              textStyleOverride={line.textStyle}
              durationInFrames={dur}
              charFx={line.charFx}
              decor={line.lyricDecor}
              beatClock={
                beatList.length > 0
                  ? {
                      beats: beatList,
                      downbeats: downbeatList.length > 0 ? downbeatList : undefined,
                      offsetFrames: start - songStartFrame,
                    }
                  : null
              }
              words={line.words}
              lineStartSec={lineTime(line)}
              autoHide={project.meta.lyricAutoHide}
              slotStyles={line.lyricSlotStyles}
            />
            {/* 被写体切り抜きコピーを文字の上へ→歌詞が被写体の後ろに回り込む */}
            {behindImage && (
              <SubjectOverlay
                src={assetUrl(assetBase, projectName, behindImage)}
                subjectSrc={assetUrl(
                  assetBase,
                  projectName,
                  subjectFileOf(behindImage),
                )}
                depthSrc={assetUrl(
                  assetBase,
                  projectName,
                  depthFileOf(behindImage),
                )}
                effectedContent={behindContent}
              />
            )}
          </Sequence>
        );
      })}
      </LookLayer>

      {/* ---- タイトル/クレジットレーン（タイトルデザイン。歌詞より上・プロローグより下） ---- */}
      {/* オープニングタイトル: 曲頭に重ねる。つまみ（font/scale/offset/delay/duration）は
          行クレジットと同経路。duration 0=従来どおり6秒（既定値=従来挙動） */}
      {/* 🅣 テキスト（クレジット/名刺）はデザインのルート背景を敷かない＝映像に文字だけ重ねる。
          背景を焼き込んだ全画面タイトルでも、オーバーレイ用途ではルートの敷き背景を強制的に抜く
          （stylesheetの!importantはインラインstyleに勝つ。部品内部の帯・箱は子孫要素なので残る） */}
      <style>{`.mvf-text-knockout > * { background: transparent !important; background-color: transparent !important; }`}</style>
      {project.openingCard &&
        (() => {
          const card = project.openingCard;
          const Xp = XP_TITLE_COMPONENTS[resolveXpAliasId(card.xpId)];
          if (!Xp) return null;
          const baseDur = Math.round(6 * fps);
          const win = telopWindowAbs(
            card.delay,
            card.duration,
            songStartFrame,
            baseDur,
            toFrames(timeline.total, fps),
            fps,
          );
          const openingFontFamily =
            card.font === "design"
              ? undefined
              : card.font === "project"
                ? fontById(project.meta.textStyle.font).family
                : fontById(card.font).family;
          return (
            <Sequence from={win.fromF} durationInFrames={win.durF}>
              <CreditFade durF={win.durF} card={card}>
                <AbsoluteFill
                  className="mvf-text-knockout"
                  style={{
                    pointerEvents: "none",
                    transform: `translate(${card.offsetX}%, ${card.offsetY}%) scale(${card.scale})`,
                  }}
                >
                  <Xp
                    background="transparent"
                    text={card.text.trim() || project.meta.title}
                    durationInFrames={win.durF}
                    fontFamily={openingFontFamily}
                    color={card.color || undefined}
                    lineStyles={card.slotStyles.length > 0 ? card.slotStyles : undefined}
                  />
                </AbsoluteFill>
              </CreditFade>
            </Sequence>
          );
        })()}
      {/* 行クレジット: その行からタイトルデザインを最前面に重ねる（テキスト必須）。
          表示時間0=行の間だけ（次の行/最終行+8sで推定）。表示時間>0=指定どおり出す
          （行末を越えてアウトロにもまたがれる。上限=動画終端の0.5s前＝退場の余白） */}
      {project.lines.map((line, i) => {
        if (!line.credit || !line.credit.text.trim()) return null;
        const Xp = XP_TITLE_COMPONENTS[resolveXpAliasId(line.credit.xpId)];
        if (!Xp) return null;
        const start = songStartFrame + toFrames(lineTime(line), fps);
        const nextLine = project.lines[i + 1];
        const endSec = nextLine
          ? lineTime(nextLine)
          : Math.min(lineTime(line) + 8, timeline.songDuration);
        const dur = Math.max(
          1,
          songStartFrame + toFrames(Math.min(endSec, timeline.songDuration), fps) - start,
        );
        const win = telopWindowAbs(
          line.credit.delay,
          line.credit.duration,
          start,
          dur,
          toFrames(timeline.total, fps),
          fps,
        );
        const creditFontFamily =
          line.credit.font === "design"
            ? undefined
            : line.credit.font === "project"
              ? fontById(project.meta.textStyle.font).family
              : fontById(line.credit.font).family;
        return (
          <Sequence
            key={`credit-${line.id}`}
            from={win.fromF}
            durationInFrames={win.durF}
          >
            <CreditFade durF={win.durF} card={line.credit}>
              <AbsoluteFill
                className="mvf-text-knockout"
                style={{
                  pointerEvents: "none",
                  transform: `translate(${line.credit.offsetX}%, ${line.credit.offsetY}%) scale(${line.credit.scale})`,
                }}
              >
                <Xp
                  background="transparent"
                  text={line.credit.text}
                  durationInFrames={win.durF}
                  fontFamily={creditFontFamily}
                  color={line.credit.color || undefined}
                  lineStyles={
                    line.credit.slotStyles.length > 0 ? line.credit.slotStyles : undefined
                  }
                />
              </AbsoluteFill>
            </CreditFade>
          </Sequence>
        );
      })}

      {/* ✂️ ショット（カット）単位のクレジット: そのカットの開始→次のカット/区間末の窓で出す。
          行クレジットが「行の頭」なのに対し、こちらはショットの切り替わりに同期する */}
      {sections.map((sec) => {
        const head = project.lines[sec.headLineIndex];
        if (!head || head.cuts.length === 0) return null;
        const sectionSec = sec.end - sec.start;
        const placedCuts = deriveSectionCuts(head, sectionSec);
        return placedCuts.map((pc) => {
          const credit = pc.cut.credit;
          if (!credit || !credit.text.trim()) return null;
          const Xp = XP_TITLE_COMPONENTS[resolveXpAliasId(credit.xpId)];
          if (!Xp) return null;
          const start = songStartFrame + toFrames(sec.start + pc.startSec, fps);
          const dur = Math.max(1, toFrames(pc.durationSec, fps));
          const win = telopWindowAbs(
            credit.delay,
            credit.duration,
            start,
            dur,
            toFrames(timeline.total, fps),
            fps,
          );
          const fontFamily =
            credit.font === "design"
              ? undefined
              : credit.font === "project"
                ? fontById(project.meta.textStyle.font).family
                : fontById(credit.font).family;
          return (
            <Sequence
              key={`cut-credit-${head.id}-${pc.cut.id}`}
              from={win.fromF}
              durationInFrames={win.durF}
            >
              <CreditFade durF={win.durF} card={credit}>
                <AbsoluteFill
                  className="mvf-text-knockout"
                  style={{
                    pointerEvents: "none",
                    transform: `translate(${credit.offsetX}%, ${credit.offsetY}%) scale(${credit.scale})`,
                  }}
                >
                  <Xp
                    background="transparent"
                    text={credit.text}
                    durationInFrames={win.durF}
                    fontFamily={fontFamily}
                    color={credit.color || undefined}
                    lineStyles={credit.slotStyles.length > 0 ? credit.slotStyles : undefined}
                  />
                </AbsoluteFill>
              </CreditFade>
            </Sequence>
          );
        });
      })}

      {/* ---- ショート専用テロップ（掴み/曲名/CTA）: applyShortToProject 合成時のみ ---- */}
      {project.shortOverlay && (
        <ShortTextsOverlay
          overlay={project.shortOverlay}
          textStyle={project.meta.textStyle}
        />
      )}

      {/* ---- プロローグ（最上層: 本編の頭とクロスフェードで重なるため） ---- */}
      <PrologueOverlay
        project={project}
        timeline={timeline}
        projectName={projectName}
        assetBase={assetBase}
      />

      {/* ---- 音声 ---- */}
      {/* 朗読は曲が重なっても音量を落とさない（フェードアウトなし） */}
      {project.prologue.enabled && project.prologue.audioFile && (
        <Audio
          src={assetUrl(assetBase, projectName, project.prologue.audioFile)}
        />
      )}
      <Sequence from={songStartFrame} layout="none">
        <Audio
          src={assetUrl(assetBase, projectName, project.meta.songFile)}
          volume={(f) =>
            overlapFrames > 0
              ? interpolate(f, [0, overlapFrames], [0.25, 1], {
                  extrapolateLeft: "clamp",
                  extrapolateRight: "clamp",
                })
              : 1
          }
        />
      </Sequence>
    </AbsoluteFill>
  );
};

/** プロローグは本編の上に重ね、終わり際にフェードアウトして本編を見せる */
const PrologueOverlay: React.FC<{
  project: Project;
  timeline: Timeline;
  projectName: string;
  assetBase: string;
}> = ({ project, timeline, projectName, assetBase }) => {
  const frame = useCurrentFrame();
  const { fps } = timeline;
  const p = project.prologue;
  if (!p.enabled || p.duration <= 0) return null;
  const durFrames = toFrames(p.duration, fps);
  const overlapFrames = toFrames(p.overlapSec, fps);
  const opacity = interpolate(
    frame,
    [Math.max(0, durFrames - overlapFrames), durFrames],
    [1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );
  if (frame > durFrames) return null;
  return (
    <AbsoluteFill style={{ opacity }}>
      <PrologueBlock
        project={project}
        timeline={timeline}
        projectName={projectName}
        assetBase={assetBase}
      />
    </AbsoluteFill>
  );
};

const FadeToBlack: React.FC<{ lastFrames: number; durationInFrames: number }> = ({
  lastFrames,
  durationInFrames,
}) => {
  const frame = useCurrentFrame(); // アウトロSequence内のローカルフレーム
  const opacity = interpolate(
    frame,
    [Math.max(0, durationInFrames - lastFrames), durationInFrames],
    [0, 1],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );
  return <AbsoluteFill style={{ background: "#000", opacity }} />;
};
