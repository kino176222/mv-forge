/**
 * 配布クリーン化アダプタ層: 旧ポート45本の effect id を、白紙作り直しの
 * cleanroom 実装（remotion/effects/cleanroom/）へ張り替える唯一の接続点。
 *
 * - export 名は旧ポートの export 名と同一（SubSubtitle01 等）。
 *   registry-components.ts / registry.tsx は import 先をここに向けるだけで、
 *   id・マップ・プレビューJSXは無修正で済む。
 * - 呼び出し契約も旧ポートと同一（XpTitleProps / XpTransitionProps /
 *   XpOverlayProps / XpGeneratorProps / background={durationInFrames}）。
 *   cleanroom 実装は全プロップ既定値付きなので、基本プロップだけ橋渡しすれば
 *   既定で完成した見た目になる。
 * - 旧ポートファイル（ports/）は削除しない（未参照で残す。後始末は別途）。
 */
import React from "react";
import type {
  XpTitleProps,
  XpTransitionProps,
  XpOverlayProps,
  XpGeneratorProps,
} from "./registry-components";

import { SubtitleSink01 } from "../cleanroom/SubtitleSink01";
import { SubtitleStrobe01 } from "../cleanroom/SubtitleStrobe01";
import { SubtitleKaraoke01 } from "../cleanroom/SubtitleKaraoke01";
import { SubtitleHandwrite05 } from "../cleanroom/SubtitleHandwrite05";
import { SubtitleStair08 } from "../cleanroom/SubtitleStair08";
import { SubtitleKaraoke10 } from "../cleanroom/SubtitleKaraoke10";
import { SubtitleOutline11 } from "../cleanroom/SubtitleOutline11";
import { SubtitleStack16 } from "../cleanroom/SubtitleStack16";
import { SubtitleEcho21 } from "../cleanroom/SubtitleEcho21";
import { SubtitleCrush29 } from "../cleanroom/SubtitleCrush29";
import { SubtitlePopEcho36 } from "../cleanroom/SubtitlePopEcho36";
import { SubtitleFall40 } from "../cleanroom/SubtitleFall40";
import { SubtitleGold45 } from "../cleanroom/SubtitleGold45";
import { SubtitleDefocus01 } from "../cleanroom/SubtitleDefocus01";
import { DynamicWidget01 } from "../cleanroom/DynamicWidget01";
import { KineticTitle01 } from "../cleanroom/KineticTitle01";
import { KineticTitle02 } from "../cleanroom/KineticTitle02";
import { MvLower3rd01 } from "../cleanroom/MvLower3rd01";
import { ArtisticKaleido01 } from "../cleanroom/ArtisticKaleido01";
import { ArtisticDuotone01 } from "../cleanroom/ArtisticDuotone01";
import { ArtisticGlintJGGK } from "../cleanroom/ArtisticGlintJGGK";
import { ArtisticBeamMLLK } from "../cleanroom/ArtisticBeamMLLK";
import { CinematicTitle01 } from "../cleanroom/CinematicTitle01";
import { CinematicTitle02 } from "../cleanroom/CinematicTitle02";
import { CinematicTitle03 } from "../cleanroom/CinematicTitle03";
import { CinematicTitle07 } from "../cleanroom/CinematicTitle07";
import { CinematicTitleJVPJ } from "../cleanroom/CinematicTitleJVPJ";
import { CinematicTitle04 } from "../cleanroom/CinematicTitle04";
import { CinematicTitle05 } from "../cleanroom/CinematicTitle05";
import { CinematicTitle06 } from "../cleanroom/CinematicTitle06";
import { GrainLook01 } from "../cleanroom/GrainLook01";
import { TitleSignalGlitch05 as CrTitleGlitch05 } from "../cleanroom/TitleSignalGlitch05";
import { TitleSignalGlitch16 as CrTitleGlitch16 } from "../cleanroom/TitleSignalGlitch16";
import { TitleSignalGlitch17 as CrTitleGlitch18 } from "../cleanroom/TitleSignalGlitch17";
import { TitleSignalGlitch25 as CrTitleGlitch29 } from "../cleanroom/TitleSignalGlitch25";
import { MvTransitionCollapse } from "../cleanroom/MvTransitionCollapse";
import { PhotoSlideshow } from "../cleanroom/PhotoSlideshow";
import { CentricRaysStrokes } from "../cleanroom/CentricRaysStrokes";
import { ConfettiStrokes } from "../cleanroom/ConfettiStrokes";
import { FireworksStrokes } from "../cleanroom/FireworksStrokes";
import { Swoosh4le6 } from "../cleanroom/Swoosh4le6";
import { WindingStroke1pr3 } from "../cleanroom/WindingStroke1pr3";
import { CurvedStroke37il } from "../cleanroom/CurvedStroke37il";
import { RadiatingStrokes39sy } from "../cleanroom/RadiatingStrokes39sy";
import { BurstingStrokesG6tm } from "../cleanroom/BurstingStrokesG6tm";
import { AscendingStrokes } from "../cleanroom/AscendingStrokes";
import { BouncingStroke } from "../cleanroom/BouncingStroke";
import { ConcentricStrokes } from "../cleanroom/ConcentricStrokes";
import { ConvergingStrokes } from "../cleanroom/ConvergingStrokes";
import { CurvedDropsStroke } from "../cleanroom/CurvedDropsStroke";
import { ExplosiveStroke } from "../cleanroom/ExplosiveStroke";
import { FrayedOutlineStroke } from "../cleanroom/FrayedOutlineStroke";
import { FrayedWindingStroke } from "../cleanroom/FrayedWindingStroke";
import { HeartStroke } from "../cleanroom/HeartStroke";
import { LoopingStroke } from "../cleanroom/LoopingStroke";
import { OutlineStroke } from "../cleanroom/OutlineStroke";
import { PolylineStroke } from "../cleanroom/PolylineStroke";
import { ScribbleStroke } from "../cleanroom/ScribbleStroke";
import { SpiralStroke } from "../cleanroom/SpiralStroke";
import { SplashStroke } from "../cleanroom/SplashStroke";
import { SpreadingStrokes } from "../cleanroom/SpreadingStrokes";
import { BackgroundSlide03 } from "../cleanroom/BackgroundSlide03";
import { BackgroundGeo04 } from "../cleanroom/BackgroundGeo04";
import { BackgroundStage05 } from "../cleanroom/BackgroundStage05";
import { BackgroundTorn09 } from "../cleanroom/BackgroundTorn09";
import { BackgroundTornReveal10 } from "../cleanroom/BackgroundTornReveal10";
import { TitleGlitchFamilyCR } from "../cleanroom/TitleGlitchFamilyCR";
import { SubtitleFamilyCR } from "../cleanroom/SubtitleFamilyCR";
import { LowerThirdFamilyCR } from "../cleanroom/LowerThirdFamilyCR";
import { CinematicTitleFamilyCR } from "../cleanroom/CinematicTitleFamilyCR";
import { KineticTitleFamilyCR } from "../cleanroom/KineticTitleFamilyCR";
import { TechTitleFamilyCR } from "../cleanroom/TechTitleFamilyCR";
import { MvOverlayFrameCR } from "../cleanroom/MvOverlayFrameCR";
import { MusicVideoModuleFamilyCR } from "../cleanroom/MusicVideoModuleFamilyCR";
import { MvTransitionWhipPan } from "../cleanroom/MvTransitionWhipPan";
import { MvTransitionSmear } from "../cleanroom/MvTransitionSmear";
import { MvTransitionZoomPunch } from "../cleanroom/MvTransitionZoomPunch";
import { MvTransitionShakeImpact } from "../cleanroom/MvTransitionShakeImpact";
import { MvTransitionFilmBurn } from "../cleanroom/MvTransitionFilmBurn";
import { MvTransitionFilmBurnSweep } from "../cleanroom/MvTransitionFilmBurnSweep";
import { MvTransitionFilmArtifact } from "../cleanroom/MvTransitionFilmArtifact";
import { MvTransitionFlashCut } from "../cleanroom/MvTransitionFlashCut";
import { MvTransitionFlicker } from "../cleanroom/MvTransitionFlicker";
import { MvTransitionOverexpose } from "../cleanroom/MvTransitionOverexpose";
import { MvTransitionNegativeFlash } from "../cleanroom/MvTransitionNegativeFlash";
import { MvTransitionXRay } from "../cleanroom/MvTransitionXRay";
import { MvTransitionGlitchNoise } from "../cleanroom/MvTransitionGlitchNoise";
import { MvTransitionBlurDissolve } from "../cleanroom/MvTransitionBlurDissolve";
import { MvTransitionShadeSweep } from "../cleanroom/MvTransitionShadeSweep";
import { MvTransitionColorSmear } from "../cleanroom/MvTransitionColorSmear";
import { MvTransitionBulge } from "../cleanroom/MvTransitionBulge";
import { MvTransitionDrift } from "../cleanroom/MvTransitionDrift";
import { MvTransitionFilmScribble } from "../cleanroom/MvTransitionFilmScribble";
import { MvTransitionMeltFlow } from "../cleanroom/MvTransitionMeltFlow";
import { MvTransitionParallax } from "../cleanroom/MvTransitionParallax";
import { MvTransitionMaskReveal } from "../cleanroom/MvTransitionMaskReveal";
import { MvOverlayDreamBlur } from "../cleanroom/MvOverlayDreamBlur";
import { MvOverlayColorGrade } from "../cleanroom/MvOverlayColorGrade";
import { MvOverlayFilmTexture } from "../cleanroom/MvOverlayFilmTexture";
import { MvOverlayPrism } from "../cleanroom/MvOverlayPrism";
import { MvOverlayVintageFilm } from "../cleanroom/MvOverlayVintageFilm";
import { MvOverlayGlitch } from "../cleanroom/MvOverlayGlitch";
import { MvOverlayStrobe } from "../cleanroom/MvOverlayStrobe";
import { MvOverlayLiquidWarp } from "../cleanroom/MvOverlayLiquidWarp";
import { MvOverlayEdgeGlow } from "../cleanroom/MvOverlayEdgeGlow";
import { MvOverlayLensWarp } from "../cleanroom/MvOverlayLensWarp";
import { MvOverlaySplitScreen } from "../cleanroom/MvOverlaySplitScreen";
import { MvOverlayFilmMatte } from "../cleanroom/MvOverlayFilmMatte";
import { MvOverlayFilmStrip } from "../cleanroom/MvOverlayFilmStrip";
import { MvOverlayGhostEcho } from "../cleanroom/MvOverlayGhostEcho";
import { MvOverlayImpactShake } from "../cleanroom/MvOverlayImpactShake";
import { MvOverlayLightStreak } from "../cleanroom/MvOverlayLightStreak";
import { MvOverlayHalftonePrint } from "../cleanroom/MvOverlayHalftonePrint";
import { MvOverlayPaperFrame } from "../cleanroom/MvOverlayPaperFrame";
import { MvOverlayRetroDevice } from "../cleanroom/MvOverlayRetroDevice";
import { MvOverlayDoodleFrame } from "../cleanroom/MvOverlayDoodleFrame";
import { MvTransitionDoubleExposure } from "../cleanroom/MvTransitionDoubleExposure";
import { MvTransitionFlashSweep } from "../cleanroom/MvTransitionFlashSweep";
import { MvOverlayHandheldCam } from "../cleanroom/MvOverlayHandheldCam";
import { MvOverlayLightLeak } from "../cleanroom/MvOverlayLightLeak";
import { MvTransitionPushSlide } from "../cleanroom/MvTransitionPushSlide";
import { MvTransitionRippleGlass } from "../cleanroom/MvTransitionRippleGlass";
import { MvTransitionRoll } from "../cleanroom/MvTransitionRoll";
import { MvTransitionShift } from "../cleanroom/MvTransitionShift";
import { MvTransitionSpin } from "../cleanroom/MvTransitionSpin";
import { MvTransitionStillFrame } from "../cleanroom/MvTransitionStillFrame";

/** background の呼び出し契約（registry.tsx プレビュー/probe と同じ） */
export interface XpBackgroundProps {
  durationInFrames: number;
}

/* ============================ subtitle（lyric 合流） ============================ */

export const SubSubtitle01: React.FC<XpTitleProps> = (p) => (
  <SubtitleSink01 text={p.text} durationInFrames={p.durationInFrames} fontSize={p.fontSize} fontFamily={p.fontFamily} color={p.color} lineStyles={p.lineStyles} />
);
export const SubSubtitle02: React.FC<XpTitleProps> = (p) => (
  <SubtitleStrobe01 text={p.text} durationInFrames={p.durationInFrames} fontSize={p.fontSize} fontFamily={p.fontFamily} color={p.color} background={p.background} />
);
export const SubSubtitle06: React.FC<XpTitleProps> = (p) => (
  <SubtitleKaraoke01 text={p.text} durationInFrames={p.durationInFrames} fontSize={p.fontSize} fontFamily={p.fontFamily} />
);
export const SubSubtitle10: React.FC<XpTitleProps> = (p) => (
  <SubtitleHandwrite05 text={p.text} durationInFrames={p.durationInFrames} fontSize={p.fontSize} fontFamily={p.fontFamily} />
);
export const MlvSubtitle08: React.FC<XpTitleProps> = (p) => (
  <SubtitleStair08 text={p.text} durationInFrames={p.durationInFrames} fontSize={p.fontSize} fontFamily={p.fontFamily} />
);
export const SubSubtitle13: React.FC<XpTitleProps> = (p) => (
  <SubtitleKaraoke10 text={p.text} durationInFrames={p.durationInFrames} fontSize={p.fontSize} fontFamily={p.fontFamily} />
);
export const SubSubtitle14: React.FC<XpTitleProps> = (p) => (
  <SubtitleOutline11 text={p.text} durationInFrames={p.durationInFrames} fontSize={p.fontSize} fontFamily={p.fontFamily} />
);
export const SubSubtitle19: React.FC<XpTitleProps> = (p) => (
  // color はカラオケの「歌唱済み色」（fillColor）に対応させる
  <SubtitleStack16 text={p.text} durationInFrames={p.durationInFrames} fontSize={p.fontSize} fontFamily={p.fontFamily} fillColor={p.color} />
);
export const SubSubtitle23: React.FC<XpTitleProps> = (p) => (
  <SubtitleEcho21 text={p.text} durationInFrames={p.durationInFrames} fontSize={p.fontSize} fontFamily={p.fontFamily} color={p.color} />
);
export const SubSubtitle30: React.FC<XpTitleProps> = (p) => (
  // color は「光が当たった文字色」（litColor）に対応させる
  <SubtitleCrush29 text={p.text} durationInFrames={p.durationInFrames} fontSize={p.fontSize} fontFamily={p.fontFamily} litColor={p.color} />
);
export const SubSubtitle36: React.FC<XpTitleProps> = (p) => (
  <SubtitlePopEcho36 text={p.text} durationInFrames={p.durationInFrames} fontSize={p.fontSize} fontFamily={p.fontFamily} color={p.color} />
);
export const SubSubtitle39: React.FC<XpTitleProps> = (p) => (
  <SubtitleFall40 text={p.text} durationInFrames={p.durationInFrames} fontSize={p.fontSize} fontFamily={p.fontFamily} color={p.color} />
);
export const SubSubtitle44: React.FC<XpTitleProps> = (p) => (
  <SubtitleGold45 text={p.text} durationInFrames={p.durationInFrames} fontSize={p.fontSize} fontFamily={p.fontFamily} />
);
export const SubSubtitle04: React.FC<XpTitleProps> = (p) => (
  // color は「解像後の文字色」（sharpColor）に対応させる
  <SubtitleDefocus01 text={p.text} durationInFrames={p.durationInFrames} fontSize={p.fontSize} fontFamily={p.fontFamily} sharpColor={p.color} />
);

/* ============================ title（タイトル/クレジットレーン） ============================ */

export const TitleDynamic: React.FC<XpTitleProps> = (p) => (
  <DynamicWidget01 text={p.text} durationInFrames={p.durationInFrames} fontSize={p.fontSize} fontFamily={p.fontFamily} />
);
export const TitleKineticTitle01: React.FC<XpTitleProps> = (p) => (
  <KineticTitle01 text={p.text} durationInFrames={p.durationInFrames} fontSize={p.fontSize} fontFamily={p.fontFamily} />
);
export const TitleKineticTitle02: React.FC<XpTitleProps> = (p) => (
  <KineticTitle02 text={p.text} durationInFrames={p.durationInFrames} fontSize={p.fontSize} fontFamily={p.fontFamily} />
);
export const SubMusicVideoLower3rd: React.FC<XpTitleProps> = (p) => (
  <MvLower3rd01 text={p.text} durationInFrames={p.durationInFrames} fontSize={p.fontSize} fontFamily={p.fontFamily} color={p.color} background={p.background} />
);
export const TitleArtistic01: React.FC<XpTitleProps> = (p) => (
  <ArtisticKaleido01 text={p.text} durationInFrames={p.durationInFrames} fontSize={p.fontSize} fontFamily={p.fontFamily} />
);
export const TitleArtistic02: React.FC<XpTitleProps> = (p) => (
  <ArtisticDuotone01 text={p.text} durationInFrames={p.durationInFrames} fontSize={p.fontSize} fontFamily={p.fontFamily} />
);
export const TitleArtistic04: React.FC<XpTitleProps> = (p) => (
  <ArtisticGlintJGGK text={p.text} durationInFrames={p.durationInFrames} fontSize={p.fontSize} fontFamily={p.fontFamily} />
);
export const TitleArtistic05: React.FC<XpTitleProps> = (p) => (
  <ArtisticBeamMLLK text={p.text} durationInFrames={p.durationInFrames} fontSize={p.fontSize} fontFamily={p.fontFamily} />
);
export const TitleCinematicTitle01: React.FC<XpTitleProps> = (p) => (
  <CinematicTitle01 text={p.text} durationInFrames={p.durationInFrames} fontSize={p.fontSize} fontFamily={p.fontFamily} />
);
export const TitleCinematicTitle02: React.FC<XpTitleProps> = (p) => (
  <CinematicTitle02 text={p.text} durationInFrames={p.durationInFrames} fontSize={p.fontSize} fontFamily={p.fontFamily} />
);
export const TitleCinematicTitle04: React.FC<XpTitleProps> = (p) => (
  <CinematicTitle03 text={p.text} durationInFrames={p.durationInFrames} fontSize={p.fontSize} fontFamily={p.fontFamily} />
);
export const TitleCinematicTitle09: React.FC<XpTitleProps> = (p) => (
  <CinematicTitle07 text={p.text} durationInFrames={p.durationInFrames} fontSize={p.fontSize} fontFamily={p.fontFamily} background={p.background} />
);
export const TitleCinematicTitle11: React.FC<XpTitleProps> = (p) => (
  <CinematicTitleJVPJ text={p.text} durationInFrames={p.durationInFrames} fontSize={p.fontSize} fontFamily={p.fontFamily} />
);
export const TitleCinematicTitle13: React.FC<XpTitleProps> = (p) => (
  <CinematicTitle04 text={p.text} durationInFrames={p.durationInFrames} fontSize={p.fontSize} fontFamily={p.fontFamily} />
);
export const TitleCinematicTitle18: React.FC<XpTitleProps> = (p) => (
  <CinematicTitle05 text={p.text} durationInFrames={p.durationInFrames} fontSize={p.fontSize} fontFamily={p.fontFamily} />
);
export const TitleCinematicTitle21: React.FC<XpTitleProps> = (p) => (
  <CinematicTitle06 text={p.text} durationInFrames={p.durationInFrames} fontSize={p.fontSize} fontFamily={p.fontFamily} />
);
export const TitleGrain: React.FC<XpTitleProps> = (p) => (
  <GrainLook01 text={p.text} durationInFrames={p.durationInFrames} fontSize={p.fontSize} fontFamily={p.fontFamily} />
);
export const TitleSignalGlitch05: React.FC<XpTitleProps> = (p) => (
  <CrTitleGlitch05 text={p.text} durationInFrames={p.durationInFrames} fontSize={p.fontSize} fontFamily={p.fontFamily} />
);
export const TitleSignalGlitch16: React.FC<XpTitleProps> = (p) => (
  <CrTitleGlitch16 text={p.text} durationInFrames={p.durationInFrames} fontSize={p.fontSize} fontFamily={p.fontFamily} background={p.background} />
);
export const TitleSignalGlitch17: React.FC<XpTitleProps> = (p) => (
  <CrTitleGlitch18 text={p.text} durationInFrames={p.durationInFrames} fontSize={p.fontSize} fontFamily={p.fontFamily} />
);
export const TitleSignalGlitch25: React.FC<XpTitleProps> = (p) => (
  <CrTitleGlitch29 text={p.text} durationInFrames={p.durationInFrames} fontSize={p.fontSize} fontFamily={p.fontFamily} />
);

/* ============================ transition ============================ */

export const TxMusicVideoTransition: React.FC<XpTransitionProps> = (p) => (
  <MvTransitionCollapse from={p.from} to={p.to} durationInFrames={p.durationInFrames} />
);

/* ============================ effect: overlay（children有） ============================ */

export const FxPhotoSlideshow03: React.FC<XpOverlayProps> = (p) => (
  <PhotoSlideshow durationInFrames={p.durationInFrames} intensity={p.intensity}>
    {p.children}
  </PhotoSlideshow>
);

/* ============================ effect: generator（children無） ============================ */

export const DsCentricRaysStrokes5beg: React.FC<XpGeneratorProps> = (p) => (
  <CentricRaysStrokes durationInFrames={p.durationInFrames} />
);
export const DsConfettiStrokesB2bm: React.FC<XpGeneratorProps> = (p) => (
  <ConfettiStrokes durationInFrames={p.durationInFrames} />
);
export const DsFireworksStrokes5hbq: React.FC<XpGeneratorProps> = (p) => (
  <FireworksStrokes durationInFrames={p.durationInFrames} />
);
// ストローク族パイロット（private&C クリーン化・第1バッチ）
export const DsSwoosh4le6: React.FC<XpGeneratorProps> = (p) => (
  <Swoosh4le6 durationInFrames={p.durationInFrames} />
);
export const DsWindingStroke1pr3: React.FC<XpGeneratorProps> = (p) => (
  <WindingStroke1pr3 durationInFrames={p.durationInFrames} />
);
export const DsCurvedStroke37il: React.FC<XpGeneratorProps> = (p) => (
  <CurvedStroke37il durationInFrames={p.durationInFrames} />
);
export const DsRadiatingStrokes39sy: React.FC<XpGeneratorProps> = (p) => (
  <RadiatingStrokes39sy durationInFrames={p.durationInFrames} />
);
export const DsBurstingStrokesG6tm: React.FC<XpGeneratorProps> = (p) => (
  <BurstingStrokesG6tm durationInFrames={p.durationInFrames} />
);

// ストローク族クリーン化・第2バッチ（自動生成アダプタ）
export const DsAscendingStrokesNy1r: React.FC<XpGeneratorProps> = (p) => (
  <AscendingStrokes durationInFrames={p.durationInFrames} variant={0.012} />
);
export const DsBouncingStrokeDtvk: React.FC<XpGeneratorProps> = (p) => (
  <BouncingStroke durationInFrames={p.durationInFrames} variant={0.453} />
);
export const DsBouncingStrokeEj6r: React.FC<XpGeneratorProps> = (p) => (
  <BouncingStroke durationInFrames={p.durationInFrames} variant={0.080} />
);
export const FxBouncingStroke: React.FC<XpGeneratorProps> = (p) => (
  <BouncingStroke durationInFrames={p.durationInFrames} variant={0.128} />
);
export const DsBouncingStrokeP3jx: React.FC<XpGeneratorProps> = (p) => (
  <BouncingStroke durationInFrames={p.durationInFrames} variant={0.728} />
);
export const DsBouncingStrokeSy1d: React.FC<XpGeneratorProps> = (p) => (
  <BouncingStroke durationInFrames={p.durationInFrames} variant={0.283} />
);
export const DsBurstingShapes89ad: React.FC<XpGeneratorProps> = (p) => (
  <BurstingStrokesG6tm durationInFrames={p.durationInFrames} count={13} spread={0.169} />
);
export const DsBurstingShapes9ms9: React.FC<XpGeneratorProps> = (p) => (
  <BurstingStrokesG6tm durationInFrames={p.durationInFrames} count={14} spread={0.138} />
);
export const DsBurstingShapesJ5q3: React.FC<XpGeneratorProps> = (p) => (
  <BurstingStrokesG6tm durationInFrames={p.durationInFrames} count={15} spread={0.160} />
);
export const DsCentricRaysStrokes1cx6: React.FC<XpGeneratorProps> = (p) => (
  <CentricRaysStrokes durationInFrames={p.durationInFrames} startAngleDeg={152} />
);
export const DsCentricRaysStrokesR9nx: React.FC<XpGeneratorProps> = (p) => (
  <CentricRaysStrokes durationInFrames={p.durationInFrames} startAngleDeg={122} />
);
export const DsConcentricStrokes1ug1: React.FC<XpGeneratorProps> = (p) => (
  <ConcentricStrokes durationInFrames={p.durationInFrames} variant={0.066} />
);
export const DsConvergingStrokesAdp6: React.FC<XpGeneratorProps> = (p) => (
  <ConvergingStrokes durationInFrames={p.durationInFrames} variant={0.818} />
);
export const DsConvergingStrokesQpgf: React.FC<XpGeneratorProps> = (p) => (
  <ConvergingStrokes durationInFrames={p.durationInFrames} variant={0.769} />
);
export const DsConvergingStrokesTga3: React.FC<XpGeneratorProps> = (p) => (
  <ConvergingStrokes durationInFrames={p.durationInFrames} variant={0.422} />
);
export const DsConvergingStrokesZyif: React.FC<XpGeneratorProps> = (p) => (
  <ConvergingStrokes durationInFrames={p.durationInFrames} variant={0.392} />
);
export const DsCurvedDropsStrokeAknx: React.FC<XpGeneratorProps> = (p) => (
  <CurvedDropsStroke durationInFrames={p.durationInFrames} variant={0.490} />
);
export const DsCurvedStrokeBpta: React.FC<XpGeneratorProps> = (p) => (
  <CurvedStroke37il durationInFrames={p.durationInFrames} startDeg={-68} sweepDeg={336} />
);
export const DsCurvedStrokeFwr1: React.FC<XpGeneratorProps> = (p) => (
  <CurvedStroke37il durationInFrames={p.durationInFrames} startDeg={-99} sweepDeg={322} />
);
export const DsCurvedStrokeTib6: React.FC<XpGeneratorProps> = (p) => (
  <CurvedStroke37il durationInFrames={p.durationInFrames} startDeg={-53} sweepDeg={343} />
);
export const DsCurvedStrokesHlrm: React.FC<XpGeneratorProps> = (p) => (
  <CurvedStroke37il durationInFrames={p.durationInFrames} startDeg={-56} sweepDeg={348} />
);
export const DsExplosiveStroke5iiw: React.FC<XpGeneratorProps> = (p) => (
  <ExplosiveStroke durationInFrames={p.durationInFrames} variant={0.488} />
);
export const DsExplosiveStroke728e: React.FC<XpGeneratorProps> = (p) => (
  <ExplosiveStroke durationInFrames={p.durationInFrames} variant={0.831} />
);
export const DsFrayedOutlineStrokeEp6v: React.FC<XpGeneratorProps> = (p) => (
  <FrayedOutlineStroke durationInFrames={p.durationInFrames} variant={0.048} />
);
export const DsFrayedOutlineStrokeXzmu: React.FC<XpGeneratorProps> = (p) => (
  <FrayedOutlineStroke durationInFrames={p.durationInFrames} variant={0.381} />
);
export const DsFrayedWindingStrokeJsyq: React.FC<XpGeneratorProps> = (p) => (
  <FrayedWindingStroke durationInFrames={p.durationInFrames} variant={0.004} />
);
export const DsHeartStrokeSjmn: React.FC<XpGeneratorProps> = (p) => (
  <HeartStroke durationInFrames={p.durationInFrames} variant={0.432} />
);
export const DsLoopingStrokeCbce: React.FC<XpGeneratorProps> = (p) => (
  <LoopingStroke durationInFrames={p.durationInFrames} variant={0.623} />
);
export const DsOutlineStrokeHhci: React.FC<XpGeneratorProps> = (p) => (
  <OutlineStroke durationInFrames={p.durationInFrames} variant={0.153} />
);
export const DsOutlineStrokeUcl5: React.FC<XpGeneratorProps> = (p) => (
  <OutlineStroke durationInFrames={p.durationInFrames} variant={0.416} />
);
export const DsOutlineStrokesUzy6: React.FC<XpGeneratorProps> = (p) => (
  <OutlineStroke durationInFrames={p.durationInFrames} variant={0.708} />
);
export const DsPolylineStrokeAat7: React.FC<XpGeneratorProps> = (p) => (
  <PolylineStroke durationInFrames={p.durationInFrames} variant={0.605} />
);
export const DsPolylineStrokeLrtp: React.FC<XpGeneratorProps> = (p) => (
  <PolylineStroke durationInFrames={p.durationInFrames} variant={0.196} />
);
export const DsRadiatingStrokesIhnr: React.FC<XpGeneratorProps> = (p) => (
  <RadiatingStrokes39sy durationInFrames={p.durationInFrames} rayCount={11} />
);
export const DsRadiatingStrokesJjtm: React.FC<XpGeneratorProps> = (p) => (
  <RadiatingStrokes39sy durationInFrames={p.durationInFrames} rayCount={13} />
);
export const DsScribbleStrokeJz1g: React.FC<XpGeneratorProps> = (p) => (
  <ScribbleStroke durationInFrames={p.durationInFrames} variant={0.621} />
);
export const DsScribbleStrokes652x: React.FC<XpGeneratorProps> = (p) => (
  <ScribbleStroke durationInFrames={p.durationInFrames} variant={0.599} />
);
export const DsSpiralStrokeJ5yb: React.FC<XpGeneratorProps> = (p) => (
  <SpiralStroke durationInFrames={p.durationInFrames} variant={0.745} />
);
export const DsSpiralStrokesMa69: React.FC<XpGeneratorProps> = (p) => (
  <SpiralStroke durationInFrames={p.durationInFrames} variant={0.958} />
);
export const DsSplashStrokeYskf: React.FC<XpGeneratorProps> = (p) => (
  <SplashStroke durationInFrames={p.durationInFrames} variant={0.816} />
);
export const DsSpreadingStrokes7lna: React.FC<XpGeneratorProps> = (p) => (
  <SpreadingStrokes durationInFrames={p.durationInFrames} variant={0.520} />
);
export const DsSwooshCkt2: React.FC<XpGeneratorProps> = (p) => (
  <Swoosh4le6 durationInFrames={p.durationInFrames} count={2} angleDeg={-16} />
);
export const DsSwooshGze2: React.FC<XpGeneratorProps> = (p) => (
  <Swoosh4le6 durationInFrames={p.durationInFrames} count={3} angleDeg={-18} />
);
export const DsSwooshHbb2: React.FC<XpGeneratorProps> = (p) => (
  <Swoosh4le6 durationInFrames={p.durationInFrames} count={3} angleDeg={-27} />
);
export const DsSwooshJtl3: React.FC<XpGeneratorProps> = (p) => (
  <Swoosh4le6 durationInFrames={p.durationInFrames} count={3} angleDeg={-27} />
);
export const DsSwooshM7rc: React.FC<XpGeneratorProps> = (p) => (
  <Swoosh4le6 durationInFrames={p.durationInFrames} count={3} angleDeg={-22} />
);
export const DsSwooshMasx: React.FC<XpGeneratorProps> = (p) => (
  <Swoosh4le6 durationInFrames={p.durationInFrames} count={3} angleDeg={-21} />
);
export const DsSwooshMcsq: React.FC<XpGeneratorProps> = (p) => (
  <Swoosh4le6 durationInFrames={p.durationInFrames} count={3} angleDeg={-12} />
);
export const DsSwooshMw62: React.FC<XpGeneratorProps> = (p) => (
  <Swoosh4le6 durationInFrames={p.durationInFrames} count={2} angleDeg={-15} />
);
export const DsSwooshNtr2: React.FC<XpGeneratorProps> = (p) => (
  <Swoosh4le6 durationInFrames={p.durationInFrames} count={2} angleDeg={-24} />
);
export const DsSwooshRc5r: React.FC<XpGeneratorProps> = (p) => (
  <Swoosh4le6 durationInFrames={p.durationInFrames} count={3} angleDeg={-26} />
);
export const DsSwooshSpbi: React.FC<XpGeneratorProps> = (p) => (
  <Swoosh4le6 durationInFrames={p.durationInFrames} count={2} angleDeg={-26} />
);
export const DsSwooshV771: React.FC<XpGeneratorProps> = (p) => (
  <Swoosh4le6 durationInFrames={p.durationInFrames} count={3} angleDeg={-12} />
);
export const DsSwooshWah5: React.FC<XpGeneratorProps> = (p) => (
  <Swoosh4le6 durationInFrames={p.durationInFrames} count={3} angleDeg={-8} />
);
export const DsSwooshYah5: React.FC<XpGeneratorProps> = (p) => (
  <Swoosh4le6 durationInFrames={p.durationInFrames} count={2} angleDeg={-18} />
);
export const DsWindingStrokeEivs: React.FC<XpGeneratorProps> = (p) => (
  <WindingStroke1pr3 durationInFrames={p.durationInFrames} waves={1.75} amplitude={0.111} />
);
export const DsWindingStrokePylr: React.FC<XpGeneratorProps> = (p) => (
  <WindingStroke1pr3 durationInFrames={p.durationInFrames} waves={1.83} amplitude={0.113} />
);
export const DsWindingStrokeShhk: React.FC<XpGeneratorProps> = (p) => (
  <WindingStroke1pr3 durationInFrames={p.durationInFrames} waves={1.60} amplitude={0.106} />
);
export const DsWindingStrokeVd2t: React.FC<XpGeneratorProps> = (p) => (
  <WindingStroke1pr3 durationInFrames={p.durationInFrames} waves={1.42} amplitude={0.127} />
);
export const DsWindingStrokeVxzr: React.FC<XpGeneratorProps> = (p) => (
  <WindingStroke1pr3 durationInFrames={p.durationInFrames} waves={1.68} amplitude={0.110} />
);
export const DsWindingStrokesBxw8: React.FC<XpGeneratorProps> = (p) => (
  <WindingStroke1pr3 durationInFrames={p.durationInFrames} waves={1.67} amplitude={0.118} />
);

/* ============================ background ============================ */
/* Slide03/Geo04/Stage05 の cleanroom 実装は尺をコンポジションから
   自動追従するため durationInFrames を受けない（受け流す）。 */

export const MlvBackground03: React.FC<XpBackgroundProps> = () => <BackgroundSlide03 />;
export const MlvBackground04: React.FC<XpBackgroundProps> = () => <BackgroundGeo04 />;
export const MlvBackground05: React.FC<XpBackgroundProps> = () => <BackgroundStage05 />;
export const MlvBackground09: React.FC<XpBackgroundProps> = (p) => (
  <BackgroundTorn09 durationInFrames={p.durationInFrames} />
);
export const MlvBackground10: React.FC<XpBackgroundProps> = (p) => (
  <BackgroundTornReveal10 durationInFrames={p.durationInFrames} />
);

// === cleanroom text families (auto: integrate-cleanroom-text.mjs) ===
export const TitleSignalGlitch01: React.FC<XpTitleProps> = (p) => (
  <TitleGlitchFamilyCR {...p} variant={0.030} />
);
export const TitleSignalGlitch02: React.FC<XpTitleProps> = (p) => (
  <TitleGlitchFamilyCR {...p} variant={0.807} />
);
export const TitleSignalGlitch03: React.FC<XpTitleProps> = (p) => (
  <TitleGlitchFamilyCR {...p} variant={0.583} />
);
export const TitleSignalGlitch04: React.FC<XpTitleProps> = (p) => (
  <TitleGlitchFamilyCR {...p} variant={0.149} />
);
export const TitleSignalGlitch06: React.FC<XpTitleProps> = (p) => (
  <TitleGlitchFamilyCR {...p} variant={0.702} />
);
export const TitleSignalGlitch07: React.FC<XpTitleProps> = (p) => (
  <TitleGlitchFamilyCR {...p} variant={0.478} />
);
export const TitleSignalGlitch08: React.FC<XpTitleProps> = (p) => (
  <TitleGlitchFamilyCR {...p} variant={0.464} />
);
export const TitleSignalGlitch09: React.FC<XpTitleProps> = (p) => (
  <TitleGlitchFamilyCR {...p} variant={0.240} />
);
export const TitleSignalGlitch10: React.FC<XpTitleProps> = (p) => (
  <TitleGlitchFamilyCR {...p} variant={0.382} />
);
export const TitleSignalGlitch15: React.FC<XpTitleProps> = (p) => (
  <TitleGlitchFamilyCR {...p} variant={0.501} />
);
export const TitleSignalGlitch14: React.FC<XpTitleProps> = (p) => (
  <TitleGlitchFamilyCR {...p} variant={0.278} />
);
export const TitleSignalGlitch13: React.FC<XpTitleProps> = (p) => (
  <TitleGlitchFamilyCR {...p} variant={0.054} />
);
export const TitleSignalGlitch12: React.FC<XpTitleProps> = (p) => (
  <TitleGlitchFamilyCR {...p} variant={0.830} />
);
export const TitleSignalGlitch11: React.FC<XpTitleProps> = (p) => (
  <TitleGlitchFamilyCR {...p} variant={0.606} />
);
export const TitleSignalGlitch18: React.FC<XpTitleProps> = (p) => (
  <TitleGlitchFamilyCR {...p} variant={0.816} />
);
export const TitleSignalGlitch19: React.FC<XpTitleProps> = (p) => (
  <TitleGlitchFamilyCR {...p} variant={0.510} />
);
export const TitleSignalGlitch20: React.FC<XpTitleProps> = (p) => (
  <TitleGlitchFamilyCR {...p} variant={0.287} />
);
export const TitleSignalGlitch21: React.FC<XpTitleProps> = (p) => (
  <TitleGlitchFamilyCR {...p} variant={0.734} />
);
export const TitleSignalGlitch22: React.FC<XpTitleProps> = (p) => (
  <TitleGlitchFamilyCR {...p} variant={0.391} />
);
export const TitleSignalGlitch23: React.FC<XpTitleProps> = (p) => (
  <TitleGlitchFamilyCR {...p} variant={0.839} />
);
export const TitleSignalGlitch24: React.FC<XpTitleProps> = (p) => (
  <TitleGlitchFamilyCR {...p} variant={0.301} />
);
export const TitleSignalGlitch26: React.FC<XpTitleProps> = (p) => (
  <TitleGlitchFamilyCR {...p} variant={0.318} />
);
export const SubSubtitle07: React.FC<XpTitleProps> = (p) => (
  <SubtitleFamilyCR {...p} variant={0.262} />
);
export const SubSubtitle08: React.FC<XpTitleProps> = (p) => (
  <SubtitleFamilyCR {...p} variant={0.038} />
);
export const SubSubtitle09: React.FC<XpTitleProps> = (p) => (
  <SubtitleFamilyCR {...p} variant={0.814} />
);
export const SubSubtitle11: React.FC<XpTitleProps> = (p) => (
  <SubtitleFamilyCR {...p} variant={0.367} />
);
export const SubSubtitle12: React.FC<XpTitleProps> = (p) => (
  <SubtitleFamilyCR {...p} variant={0.276} />
);
export const SubSubtitle15: React.FC<XpTitleProps> = (p) => (
  <SubtitleFamilyCR {...p} variant={0.285} />
);
export const SubSubtitle16: React.FC<XpTitleProps> = (p) => (
  <SubtitleFamilyCR {...p} variant={0.509} />
);
export const SubSubtitle17: React.FC<XpTitleProps> = (p) => (
  <SubtitleFamilyCR {...p} variant={0.942} />
);
export const SubSubtitle18: React.FC<XpTitleProps> = (p) => (
  <SubtitleFamilyCR {...p} variant={0.166} />
);
export const SubSubtitle20: React.FC<XpTitleProps> = (p) => (
  <SubtitleFamilyCR {...p} variant={0.614} />
);
export const SubSubtitle21: React.FC<XpTitleProps> = (p) => (
  <SubtitleFamilyCR {...p} variant={0.628} />
);
export const SubSubtitle22: React.FC<XpTitleProps> = (p) => (
  <SubtitleFamilyCR {...p} variant={0.852} />
);
export const SubSubtitle24: React.FC<XpTitleProps> = (p) => (
  <SubtitleFamilyCR {...p} variant={0.869} />
);
export const SubSubtitle25: React.FC<XpTitleProps> = (p) => (
  <SubtitleFamilyCR {...p} variant={0.540} />
);
export const SubSubtitle26: React.FC<XpTitleProps> = (p) => (
  <SubtitleFamilyCR {...p} variant={0.316} />
);
export const SubSubtitle27: React.FC<XpTitleProps> = (p) => (
  <SubtitleFamilyCR {...p} variant={0.988} />
);
export const SubSubtitle28: React.FC<XpTitleProps> = (p) => (
  <SubtitleFamilyCR {...p} variant={0.764} />
);
export const SubSubtitle29: React.FC<XpTitleProps> = (p) => (
  <SubtitleFamilyCR {...p} variant={0.436} />
);
export const SubSubtitle31: React.FC<XpTitleProps> = (p) => (
  <SubtitleFamilyCR {...p} variant={0.935} />
);
export const SubSubtitle32: React.FC<XpTitleProps> = (p) => (
  <SubtitleFamilyCR {...p} variant={0.487} />
);
export const SubSubtitle33: React.FC<XpTitleProps> = (p) => (
  <SubtitleFamilyCR {...p} variant={0.711} />
);
export const SubSubtitle34: React.FC<XpTitleProps> = (p) => (
  <SubtitleFamilyCR {...p} variant={0.040} />
);
export const SubSubtitle35: React.FC<XpTitleProps> = (p) => (
  <SubtitleFamilyCR {...p} variant={0.264} />
);
export const SubSubtitle37: React.FC<XpTitleProps> = (p) => (
  <SubtitleFamilyCR {...p} variant={0.816} />
);
export const SubSubtitle38: React.FC<XpTitleProps> = (p) => (
  <SubtitleFamilyCR {...p} variant={0.145} />
);
export const SubSubtitle40: React.FC<XpTitleProps> = (p) => (
  <SubtitleFamilyCR {...p} variant={0.839} />
);
export const SubSubtitle41: React.FC<XpTitleProps> = (p) => (
  <SubtitleFamilyCR {...p} variant={0.616} />
);
export const SubSubtitle42: React.FC<XpTitleProps> = (p) => (
  <SubtitleFamilyCR {...p} variant={0.392} />
);
export const SubSubtitle45: React.FC<XpTitleProps> = (p) => (
  <SubtitleFamilyCR {...p} variant={0.287} />
);
export const SubSubtitle46: React.FC<XpTitleProps> = (p) => (
  <SubtitleFamilyCR {...p} variant={0.273} />
);
export const SubSubtitle47: React.FC<XpTitleProps> = (p) => (
  <SubtitleFamilyCR {...p} variant={0.049} />
);
export const SubSubtitle48: React.FC<XpTitleProps> = (p) => (
  <SubtitleFamilyCR {...p} variant={0.544} />
);
export const SubCleanCallout01: React.FC<XpTitleProps> = (p) => (
  <LowerThirdFamilyCR {...p} variant={0.832} />
);
export const SubCleanCallout02: React.FC<XpTitleProps> = (p) => (
  <LowerThirdFamilyCR {...p} variant={0.785} />
);
export const SubCredits02: React.FC<XpTitleProps> = (p) => (
  <LowerThirdFamilyCR {...p} variant={0.883} />
);
export const SubCredits01: React.FC<XpTitleProps> = (p) => (
  <LowerThirdFamilyCR {...p} variant={0.462} />
);
export const SubDescription04: React.FC<XpTitleProps> = (p) => (
  <LowerThirdFamilyCR {...p} variant={0.190} />
);
export const SubDescription02: React.FC<XpTitleProps> = (p) => (
  <LowerThirdFamilyCR {...p} variant={0.792} />
);
export const SubDescription01: React.FC<XpTitleProps> = (p) => (
  <LowerThirdFamilyCR {...p} variant={0.626} />
);
export const SubDescription03: React.FC<XpTitleProps> = (p) => (
  <LowerThirdFamilyCR {...p} variant={0.153} />
);
export const SubDetails: React.FC<XpTitleProps> = (p) => (
  <LowerThirdFamilyCR {...p} variant={0.706} />
);
export const SubRetroMusicVideoLower3rd: React.FC<XpTitleProps> = (p) => (
  <LowerThirdFamilyCR {...p} variant={0.067} />
);
export const SubSubtitle05: React.FC<XpTitleProps> = (p) => (
  <SubtitleFamilyCR {...p} variant={0.488} />
);
export const TitleArtistic03: React.FC<XpTitleProps> = (p) => (
  <CinematicTitleFamilyCR {...p} variant={0.165} />
);
export const TitleArtistic06: React.FC<XpTitleProps> = (p) => (
  <CinematicTitleFamilyCR {...p} variant={0.204} />
);
export const TitleBasicMovements: React.FC<XpTitleProps> = (p) => (
  <LowerThirdFamilyCR {...p} variant={0.597} />
);
export const TitleArtistic07: React.FC<XpTitleProps> = (p) => (
  <CinematicTitleFamilyCR {...p} variant={0.919} />
);
export const TitleCinematicTitle06: React.FC<XpTitleProps> = (p) => (
  <CinematicTitleFamilyCR {...p} variant={0.212} />
);
export const TitleCinematicTitle05: React.FC<XpTitleProps> = (p) => (
  <CinematicTitleFamilyCR {...p} variant={0.977} />
);
export const TitleCinematicTitle07: React.FC<XpTitleProps> = (p) => (
  <CinematicTitleFamilyCR {...p} variant={0.146} />
);
export const TitleCinematicTitle03: React.FC<XpTitleProps> = (p) => (
  <CinematicTitleFamilyCR {...p} variant={0.078} />
);
export const TitleCinematicTitle08: React.FC<XpTitleProps> = (p) => (
  <CinematicTitleFamilyCR {...p} variant={0.823} />
);
export const TitleCinematicTitle12: React.FC<XpTitleProps> = (p) => (
  <CinematicTitleFamilyCR {...p} variant={0.648} />
);
export const TitleCinematicTitle14: React.FC<XpTitleProps> = (p) => (
  <CinematicTitleFamilyCR {...p} variant={0.622} />
);
export const TitleCinematicTitle15: React.FC<XpTitleProps> = (p) => (
  <CinematicTitleFamilyCR {...p} variant={0.809} />
);
export const TitleCinematicTitle16: React.FC<XpTitleProps> = (p) => (
  <CinematicTitleFamilyCR {...p} variant={0.319} />
);
export const TitleCinematicTitle10: React.FC<XpTitleProps> = (p) => (
  <CinematicTitleFamilyCR {...p} variant={0.016} />
);
export const TitleCinematicTitle17: React.FC<XpTitleProps> = (p) => (
  <CinematicTitleFamilyCR {...p} variant={0.608} />
);
export const TitleCinematicTitle20: React.FC<XpTitleProps> = (p) => (
  <CinematicTitleFamilyCR {...p} variant={0.930} />
);
export const TitleCinematicTitle19: React.FC<XpTitleProps> = (p) => (
  <CinematicTitleFamilyCR {...p} variant={0.465} />
);
export const TitleCinematicTitle22: React.FC<XpTitleProps> = (p) => (
  <CinematicTitleFamilyCR {...p} variant={0.500} />
);
export const TitleKineticTitle05: React.FC<XpTitleProps> = (p) => (
  <KineticTitleFamilyCR {...p} variant={0.959} />
);
export const TitleKineticTitle04: React.FC<XpTitleProps> = (p) => (
  <KineticTitleFamilyCR {...p} variant={0.713} />
);
export const TitleKineticTitle06: React.FC<XpTitleProps> = (p) => (
  <KineticTitleFamilyCR {...p} variant={0.674} />
);
export const TitleKineticTitle03: React.FC<XpTitleProps> = (p) => (
  <KineticTitleFamilyCR {...p} variant={0.210} />
);
export const TitleKineticTitle07: React.FC<XpTitleProps> = (p) => (
  <KineticTitleFamilyCR {...p} variant={0.355} />
);
export const TitleKineticTitle08: React.FC<XpTitleProps> = (p) => (
  <KineticTitleFamilyCR {...p} variant={0.973} />
);
export const TitleKineticTitle09: React.FC<XpTitleProps> = (p) => (
  <KineticTitleFamilyCR {...p} variant={0.541} />
);
export const TitleKineticTitle12: React.FC<XpTitleProps> = (p) => (
  <KineticTitleFamilyCR {...p} variant={0.727} />
);
export const TitleKineticTitle11: React.FC<XpTitleProps> = (p) => (
  <KineticTitleFamilyCR {...p} variant={0.670} />
);
export const TitleKineticTitle13: React.FC<XpTitleProps> = (p) => (
  <KineticTitleFamilyCR {...p} variant={0.571} />
);
export const TitleKineticTitle10: React.FC<XpTitleProps> = (p) => (
  <KineticTitleFamilyCR {...p} variant={0.935} />
);
export const TitleKineticTitle14: React.FC<XpTitleProps> = (p) => (
  <KineticTitleFamilyCR {...p} variant={0.699} />
);
export const TitleKineticTitle15: React.FC<XpTitleProps> = (p) => (
  <KineticTitleFamilyCR {...p} variant={0.128} />
);
export const TitleKineticTitle16: React.FC<XpTitleProps> = (p) => (
  <KineticTitleFamilyCR {...p} variant={0.842} />
);
export const TitleKineticTitle18: React.FC<XpTitleProps> = (p) => (
  <KineticTitleFamilyCR {...p} variant={0.017} />
);
export const TitleKineticTitle17: React.FC<XpTitleProps> = (p) => (
  <KineticTitleFamilyCR {...p} variant={0.101} />
);
export const TitleKineticTitle20: React.FC<XpTitleProps> = (p) => (
  <KineticTitleFamilyCR {...p} variant={0.791} />
);
export const TitleKineticTitle21: React.FC<XpTitleProps> = (p) => (
  <KineticTitleFamilyCR {...p} variant={0.919} />
);
export const TitleKineticTitle22: React.FC<XpTitleProps> = (p) => (
  <KineticTitleFamilyCR {...p} variant={0.781} />
);
export const TitleKineticTitle19: React.FC<XpTitleProps> = (p) => (
  <KineticTitleFamilyCR {...p} variant={0.824} />
);
export const TitleKineticTitle23: React.FC<XpTitleProps> = (p) => (
  <KineticTitleFamilyCR {...p} variant={0.986} />
);
export const TitleKineticTitle24: React.FC<XpTitleProps> = (p) => (
  <KineticTitleFamilyCR {...p} variant={0.830} />
);
export const TitleKineticTitle25: React.FC<XpTitleProps> = (p) => (
  <KineticTitleFamilyCR {...p} variant={0.771} />
);
export const TitleKineticTitle26: React.FC<XpTitleProps> = (p) => (
  <KineticTitleFamilyCR {...p} variant={0.211} />
);
export const TitleKineticTitle28: React.FC<XpTitleProps> = (p) => (
  <KineticTitleFamilyCR {...p} variant={0.383} />
);
export const TitleKineticTitle27: React.FC<XpTitleProps> = (p) => (
  <KineticTitleFamilyCR {...p} variant={0.123} />
);
export const TitleKineticTitle29: React.FC<XpTitleProps> = (p) => (
  <KineticTitleFamilyCR {...p} variant={0.631} />
);
export const TitleKineticTitle30: React.FC<XpTitleProps> = (p) => (
  <KineticTitleFamilyCR {...p} variant={0.989} />
);
export const TitleMusicVideoTitle: React.FC<XpTitleProps> = (p) => (
  <LowerThirdFamilyCR {...p} variant={0.987} />
);
export const TitleRetroMusicVideoTitle: React.FC<XpTitleProps> = (p) => (
  <LowerThirdFamilyCR {...p} variant={0.596} />
);
export const TitleTech02: React.FC<XpTitleProps> = (p) => (
  <TechTitleFamilyCR {...p} variant={0.867} />
);
export const TitleTech04: React.FC<XpTitleProps> = (p) => (
  <TechTitleFamilyCR {...p} variant={0.316} />
);
export const TitleTech01: React.FC<XpTitleProps> = (p) => (
  <TechTitleFamilyCR {...p} variant={0.662} />
);
export const TitleTech03: React.FC<XpTitleProps> = (p) => (
  <TechTitleFamilyCR {...p} variant={0.377} />
);
export const TitleTech05: React.FC<XpTitleProps> = (p) => (
  <TechTitleFamilyCR {...p} variant={0.836} />
);
export const TitleTech06: React.FC<XpTitleProps> = (p) => (
  <TechTitleFamilyCR {...p} variant={0.847} />
);
export const TitleEffect01: React.FC<XpTitleProps> = (p) => (
  <TechTitleFamilyCR {...p} variant={0.583} />
);
export const TitleTech07: React.FC<XpTitleProps> = (p) => (
  <TechTitleFamilyCR {...p} variant={0.101} />
);
export const TitleEffect02: React.FC<XpTitleProps> = (p) => (
  <TechTitleFamilyCR {...p} variant={0.190} />
);
export const TitleEffect03: React.FC<XpTitleProps> = (p) => (
  <TechTitleFamilyCR {...p} variant={0.191} />
);
export const TitleTypography01: React.FC<XpTitleProps> = (p) => (
  <TechTitleFamilyCR {...p} variant={0.296} />
);
export const TitleEffect05: React.FC<XpTitleProps> = (p) => (
  <TechTitleFamilyCR {...p} variant={0.715} />
);
export const TitleEffect04: React.FC<XpTitleProps> = (p) => (
  <TechTitleFamilyCR {...p} variant={0.491} />
);
export const TitleEffect06: React.FC<XpTitleProps> = (p) => (
  <TechTitleFamilyCR {...p} variant={0.280} />
);
export const TitleTypography02: React.FC<XpTitleProps> = (p) => (
  <TechTitleFamilyCR {...p} variant={0.420} />
);
export const TitleTypography03: React.FC<XpTitleProps> = (p) => (
  <TechTitleFamilyCR {...p} variant={0.013} />
);
export const TitleTypography04: React.FC<XpTitleProps> = (p) => (
  <TechTitleFamilyCR {...p} variant={0.372} />
);
export const SubSubtitle43: React.FC<XpTitleProps> = (p) => (
  <SubtitleFamilyCR {...p} variant={0.958} />
);
export const SubSubtitle03: React.FC<XpTitleProps> = (p) => (
  <SubtitleFamilyCR {...p} variant={0.045} />
);

// === cleanroom effect composites (auto: integrate-cleanroom-effects.mjs) ===
export const FxDropZonesEcho: React.FC<XpOverlayProps> = (p) => (
  <MvOverlayFrameCR durationInFrames={p.durationInFrames} intensity={p.intensity} variant={0.904}>{p.children}</MvOverlayFrameCR>
);
export const FxFakeRobotArm: React.FC<XpOverlayProps> = (p) => (
  <MvOverlayFrameCR durationInFrames={p.durationInFrames} intensity={p.intensity} variant={0.668}>{p.children}</MvOverlayFrameCR>
);
export const FxMusicVideo: React.FC<XpGeneratorProps> = (p) => (
  <MusicVideoModuleFamilyCR text="MUSIC VIDEO" durationInFrames={p.durationInFrames} variant={0.047} />
);
export const FxRetroMusicVideo: React.FC<XpGeneratorProps> = (p) => (
  <MusicVideoModuleFamilyCR text="MUSIC VIDEO" durationInFrames={p.durationInFrames} variant={0.782} />
);
export const FxFeelTheBeatModule: React.FC<XpOverlayProps> = (p) => (
  <MvOverlayFrameCR durationInFrames={p.durationInFrames} intensity={p.intensity} variant={0.295}>{p.children}</MvOverlayFrameCR>
);
export const FxMusicVideoModule01: React.FC<XpOverlayProps> = (p) => (
  <MvOverlayFrameCR durationInFrames={p.durationInFrames} intensity={p.intensity} variant={0.523}>{p.children}</MvOverlayFrameCR>
);
export const FxMusicVideoModule02: React.FC<XpOverlayProps> = (p) => (
  <MvOverlayFrameCR durationInFrames={p.durationInFrames} intensity={p.intensity} variant={0.595}>{p.children}</MvOverlayFrameCR>
);
export const FxMusicVideoModule03: React.FC<XpOverlayProps> = (p) => (
  <MvOverlayFrameCR durationInFrames={p.durationInFrames} intensity={p.intensity} variant={0.480}>{p.children}</MvOverlayFrameCR>
);
export const FxPhotoSlideshow01: React.FC<XpOverlayProps> = (p) => (
  <PhotoSlideshow durationInFrames={p.durationInFrames} intensity={p.intensity}>{p.children}</PhotoSlideshow>
);
export const FxPhotoSlideshow02: React.FC<XpOverlayProps> = (p) => (
  <PhotoSlideshow durationInFrames={p.durationInFrames} intensity={p.intensity}>{p.children}</PhotoSlideshow>
);
export const FxPhotoSlideshow04: React.FC<XpOverlayProps> = (p) => (
  <PhotoSlideshow durationInFrames={p.durationInFrames} intensity={p.intensity}>{p.children}</PhotoSlideshow>
);
export const FxRetroMusicVideoModule01: React.FC<XpOverlayProps> = (p) => (
  <MvOverlayFrameCR durationInFrames={p.durationInFrames} intensity={p.intensity} variant={0.126}>{p.children}</MvOverlayFrameCR>
);
export const FxRetroMusicVideoModule03: React.FC<XpOverlayProps> = (p) => (
  <MvOverlayFrameCR durationInFrames={p.durationInFrames} intensity={p.intensity} variant={0.880}>{p.children}</MvOverlayFrameCR>
);
export const FxRetroMusicVideoModule02: React.FC<XpOverlayProps> = (p) => (
  <MvOverlayFrameCR durationInFrames={p.durationInFrames} intensity={p.intensity} variant={0.498}>{p.children}</MvOverlayFrameCR>
);
export const FxRetroMusicVideoModule04: React.FC<XpOverlayProps> = (p) => (
  <MvOverlayFrameCR durationInFrames={p.durationInFrames} intensity={p.intensity} variant={0.644}>{p.children}</MvOverlayFrameCR>
);
export const FxRetroMusicVideoModule05: React.FC<XpOverlayProps> = (p) => (
  <MvOverlayFrameCR durationInFrames={p.durationInFrames} intensity={p.intensity} variant={0.985}>{p.children}</MvOverlayFrameCR>
);
export const FxSlideshow: React.FC<XpOverlayProps> = (p) => (
  <PhotoSlideshow durationInFrames={p.durationInFrames} intensity={p.intensity}>{p.children}</PhotoSlideshow>
);
export const FxRollingSlides: React.FC<XpOverlayProps> = (p) => (
  <PhotoSlideshow durationInFrames={p.durationInFrames} intensity={p.intensity}>{p.children}</PhotoSlideshow>
);
export const TxWhipPan: React.FC<XpTransitionProps> = (p) => (
  <MvTransitionWhipPan from={p.from} to={p.to} durationInFrames={p.durationInFrames} direction="left" variant={0} />
);
export const TxDoubleWhipPan: React.FC<XpTransitionProps> = (p) => (
  <MvTransitionWhipPan from={p.from} to={p.to} durationInFrames={p.durationInFrames} direction="up" variant={0.14} />
);
export const TxSwoosh: React.FC<XpTransitionProps> = (p) => (
  <MvTransitionWhipPan from={p.from} to={p.to} durationInFrames={p.durationInFrames} direction="left" variant={0.29} />
);
export const TxLightSpeed: React.FC<XpTransitionProps> = (p) => (
  <MvTransitionWhipPan from={p.from} to={p.to} durationInFrames={p.durationInFrames} direction="left" variant={0.43} />
);
export const TxShadowWhip: React.FC<XpTransitionProps> = (p) => (
  <MvTransitionWhipPan from={p.from} to={p.to} durationInFrames={p.durationInFrames} direction="right" variant={0.57} />
);
export const TxLightWhip: React.FC<XpTransitionProps> = (p) => (
  <MvTransitionWhipPan from={p.from} to={p.to} durationInFrames={p.durationInFrames} direction="left" variant={0.71} />
);
export const TxSpeedFlash: React.FC<XpTransitionProps> = (p) => (
  <MvTransitionWhipPan from={p.from} to={p.to} durationInFrames={p.durationInFrames} direction="forward" variant={0.86} />
);
export const TxFlashSlide: React.FC<XpTransitionProps> = (p) => (
  <MvTransitionWhipPan from={p.from} to={p.to} durationInFrames={p.durationInFrames} direction="left" variant={0.98} />
);
export const TxSmear: React.FC<XpTransitionProps> = (p) => (
  <MvTransitionSmear from={p.from} to={p.to} durationInFrames={p.durationInFrames} direction="left" variant={0.08} />
);
export const TxEcho: React.FC<XpTransitionProps> = (p) => (
  <MvTransitionSmear from={p.from} to={p.to} durationInFrames={p.durationInFrames} variant={0.25} />
);
export const TxEchoFlash: React.FC<XpTransitionProps> = (p) => (
  <MvTransitionSmear from={p.from} to={p.to} durationInFrames={p.durationInFrames} variant={0.42} />
);
export const TxScrape01: React.FC<XpTransitionProps> = (p) => (
  <MvTransitionSmear from={p.from} to={p.to} durationInFrames={p.durationInFrames} direction="left" variant={0.58} />
);
export const TxScrape02: React.FC<XpTransitionProps> = (p) => (
  <MvTransitionSmear from={p.from} to={p.to} durationInFrames={p.durationInFrames} direction="left" variant={0.75} />
);
export const TxStretch: React.FC<XpTransitionProps> = (p) => (
  <MvTransitionSmear from={p.from} to={p.to} durationInFrames={p.durationInFrames} variant={0.92} />
);
export const TxZoom02: React.FC<XpTransitionProps> = (p) => (
  <MvTransitionZoomPunch from={p.from} to={p.to} durationInFrames={p.durationInFrames} direction="forward" variant={0} />
);
export const TxZoom03: React.FC<XpTransitionProps> = (p) => (
  <MvTransitionZoomPunch from={p.from} to={p.to} durationInFrames={p.durationInFrames} direction="forward" variant={0.15} />
);
export const TxZoomFade: React.FC<XpTransitionProps> = (p) => (
  <MvTransitionZoomPunch from={p.from} to={p.to} durationInFrames={p.durationInFrames} direction="forward" variant={0.3} />
);
export const TxZoom01: React.FC<XpTransitionProps> = (p) => (
  <MvTransitionZoomPunch from={p.from} to={p.to} durationInFrames={p.durationInFrames} direction="forward" variant={0.45} />
);
export const TxFlashZoom: React.FC<XpTransitionProps> = (p) => (
  <MvTransitionZoomPunch from={p.from} to={p.to} durationInFrames={p.durationInFrames} direction="forward" variant={0.6} />
);
export const TxVacuum: React.FC<XpTransitionProps> = (p) => (
  <MvTransitionZoomPunch from={p.from} to={p.to} durationInFrames={p.durationInFrames} direction="forward" variant={0.75} />
);
export const TxCustomSurgeForward: React.FC<XpTransitionProps> = (p) => (
  <MvTransitionZoomPunch from={p.from} to={p.to} durationInFrames={p.durationInFrames} direction="forward" variant={0.9} />
);
export const TxCustomSurgeBackward: React.FC<XpTransitionProps> = (p) => (
  <MvTransitionZoomPunch from={p.from} to={p.to} durationInFrames={p.durationInFrames} direction="backward" variant={1} />
);
export const TxCameraShake: React.FC<XpTransitionProps> = (p) => (
  <MvTransitionShakeImpact from={p.from} to={p.to} durationInFrames={p.durationInFrames} variant={0.1} />
);
export const TxQuake: React.FC<XpTransitionProps> = (p) => (
  <MvTransitionShakeImpact from={p.from} to={p.to} durationInFrames={p.durationInFrames} variant={0.35} />
);
export const TxStrike: React.FC<XpTransitionProps> = (p) => (
  <MvTransitionShakeImpact from={p.from} to={p.to} durationInFrames={p.durationInFrames} variant={0.6} direction="right" />
);
export const TxOverdrive: React.FC<XpTransitionProps> = (p) => (
  <MvTransitionShakeImpact from={p.from} to={p.to} durationInFrames={p.durationInFrames} variant={0.85} />
);
export const TxBurn: React.FC<XpTransitionProps> = (p) => (
  <MvTransitionFilmBurn from={p.from} to={p.to} durationInFrames={p.durationInFrames} variant={0.05} />
);
export const TxFilmBurn: React.FC<XpTransitionProps> = (p) => (
  <MvTransitionFilmBurn from={p.from} to={p.to} durationInFrames={p.durationInFrames} variant={0.2} />
);
export const TxFilmMelt: React.FC<XpTransitionProps> = (p) => (
  <MvTransitionFilmBurn from={p.from} to={p.to} durationInFrames={p.durationInFrames} variant={0.4} />
);
export const TxIgnite: React.FC<XpTransitionProps> = (p) => (
  <MvTransitionFilmBurn from={p.from} to={p.to} durationInFrames={p.durationInFrames} variant={0.55} />
);
export const TxExpire: React.FC<XpTransitionProps> = (p) => (
  <MvTransitionFilmBurn from={p.from} to={p.to} durationInFrames={p.durationInFrames} variant={0.75} />
);
export const TxFilmChange: React.FC<XpTransitionProps> = (p) => (
  <MvTransitionFilmBurn from={p.from} to={p.to} durationInFrames={p.durationInFrames} variant={0.95} />
);
export const TxFilmBurnLeft: React.FC<XpTransitionProps> = (p) => (
  <MvTransitionFilmBurnSweep from={p.from} to={p.to} durationInFrames={p.durationInFrames} direction="left" variant={0.15} />
);
export const TxFilmBurnRight: React.FC<XpTransitionProps> = (p) => (
  <MvTransitionFilmBurnSweep from={p.from} to={p.to} durationInFrames={p.durationInFrames} direction="right" variant={0.65} />
);
export const TxFilmBurnUp: React.FC<XpTransitionProps> = (p) => (
  <MvTransitionFilmBurnSweep from={p.from} to={p.to} durationInFrames={p.durationInFrames} direction="up" variant={0.4} />
);
export const TxFilmBurnDown: React.FC<XpTransitionProps> = (p) => (
  <MvTransitionFilmBurnSweep from={p.from} to={p.to} durationInFrames={p.durationInFrames} direction="down" variant={0.85} />
);
export const TxFilmMarks: React.FC<XpTransitionProps> = (p) => (
  <MvTransitionFilmArtifact from={p.from} to={p.to} durationInFrames={p.durationInFrames} direction="left" variant={0.1} />
);
export const TxFilmStain: React.FC<XpTransitionProps> = (p) => (
  <MvTransitionFilmArtifact from={p.from} to={p.to} durationInFrames={p.durationInFrames} direction="left" variant={0.3} />
);
export const TxJitter: React.FC<XpTransitionProps> = (p) => (
  <MvTransitionFilmArtifact from={p.from} to={p.to} durationInFrames={p.durationInFrames} direction="left" variant={0.5} />
);
export const TxLightLeak: React.FC<XpTransitionProps> = (p) => (
  <MvTransitionFilmArtifact from={p.from} to={p.to} durationInFrames={p.durationInFrames} direction="left" variant={0.7} />
);
export const TxDesaturate: React.FC<XpTransitionProps> = (p) => (
  <MvTransitionFilmArtifact from={p.from} to={p.to} durationInFrames={p.durationInFrames} direction="left" variant={0.9} />
);
export const TxFlash: React.FC<XpTransitionProps> = (p) => (
  <MvTransitionFlashCut from={p.from} to={p.to} durationInFrames={p.durationInFrames} variant={0.5} />
);
export const TxCrossFade: React.FC<XpTransitionProps> = (p) => (
  <MvTransitionFlashCut from={p.from} to={p.to} durationInFrames={p.durationInFrames} variant={0.16} />
);
export const TxIlluminate: React.FC<XpTransitionProps> = (p) => (
  <MvTransitionFlashCut from={p.from} to={p.to} durationInFrames={p.durationInFrames} variant={0.84} />
);
export const TxFlicker: React.FC<XpTransitionProps> = (p) => (
  <MvTransitionFlicker from={p.from} to={p.to} durationInFrames={p.durationInFrames} variant={0.15} />
);
export const TxFlickerFlare: React.FC<XpTransitionProps> = (p) => (
  <MvTransitionFlicker from={p.from} to={p.to} durationInFrames={p.durationInFrames} variant={0.5} />
);
export const TxLumaBlink: React.FC<XpTransitionProps> = (p) => (
  <MvTransitionFlicker from={p.from} to={p.to} durationInFrames={p.durationInFrames} variant={0.85} />
);
export const TxOverexposure01: React.FC<XpTransitionProps> = (p) => (
  <MvTransitionOverexpose from={p.from} to={p.to} durationInFrames={p.durationInFrames} variant={0} />
);
export const TxOverexposure02: React.FC<XpTransitionProps> = (p) => (
  <MvTransitionOverexpose from={p.from} to={p.to} durationInFrames={p.durationInFrames} variant={0.75} />
);
export const TxOverexposeLeft: React.FC<XpTransitionProps> = (p) => (
  <MvTransitionOverexpose from={p.from} to={p.to} durationInFrames={p.durationInFrames} direction="left" variant={0.2} />
);
export const TxOverexposeRight: React.FC<XpTransitionProps> = (p) => (
  <MvTransitionOverexpose from={p.from} to={p.to} durationInFrames={p.durationInFrames} direction="right" variant={0.4} />
);
export const TxOverexposeUp: React.FC<XpTransitionProps> = (p) => (
  <MvTransitionOverexpose from={p.from} to={p.to} durationInFrames={p.durationInFrames} direction="up" variant={0.6} />
);
export const TxOverexposeDown: React.FC<XpTransitionProps> = (p) => (
  <MvTransitionOverexpose from={p.from} to={p.to} durationInFrames={p.durationInFrames} direction="down" variant={0.9} />
);
export const TxNegativeFlash: React.FC<XpTransitionProps> = (p) => (
  <MvTransitionNegativeFlash from={p.from} to={p.to} durationInFrames={p.durationInFrames} variant={0} />
);
export const TxNegativeFlashes: React.FC<XpTransitionProps> = (p) => (
  <MvTransitionNegativeFlash from={p.from} to={p.to} durationInFrames={p.durationInFrames} variant={1} />
);
export const TxXRayLeft: React.FC<XpTransitionProps> = (p) => (
  <MvTransitionXRay from={p.from} to={p.to} durationInFrames={p.durationInFrames} direction="left" variant={0.15} />
);
export const TxXRayRight: React.FC<XpTransitionProps> = (p) => (
  <MvTransitionXRay from={p.from} to={p.to} durationInFrames={p.durationInFrames} direction="right" variant={0.4} />
);
export const TxXRayUp: React.FC<XpTransitionProps> = (p) => (
  <MvTransitionXRay from={p.from} to={p.to} durationInFrames={p.durationInFrames} direction="up" variant={0.65} />
);
export const TxXRayDown: React.FC<XpTransitionProps> = (p) => (
  <MvTransitionXRay from={p.from} to={p.to} durationInFrames={p.durationInFrames} direction="down" variant={0.9} />
);
export const TxPlayGlitch: React.FC<XpTransitionProps> = (p) => (
  <MvTransitionGlitchNoise from={p.from} to={p.to} durationInFrames={p.durationInFrames} variant={0.07} />
);
export const TxTapeGlitch: React.FC<XpTransitionProps> = (p) => (
  <MvTransitionGlitchNoise from={p.from} to={p.to} durationInFrames={p.durationInFrames} variant={0.21} />
);
export const TxStatic: React.FC<XpTransitionProps> = (p) => (
  <MvTransitionGlitchNoise from={p.from} to={p.to} durationInFrames={p.durationInFrames} variant={0.36} />
);
export const TxNoise: React.FC<XpTransitionProps> = (p) => (
  <MvTransitionGlitchNoise from={p.from} to={p.to} durationInFrames={p.durationInFrames} variant={0.5} />
);
export const TxFrameDrop: React.FC<XpTransitionProps> = (p) => (
  <MvTransitionGlitchNoise from={p.from} to={p.to} durationInFrames={p.durationInFrames} variant={0.64} />
);
export const TxPixellate: React.FC<XpTransitionProps> = (p) => (
  <MvTransitionGlitchNoise from={p.from} to={p.to} durationInFrames={p.durationInFrames} variant={0.79} />
);
export const TxFastForward: React.FC<XpTransitionProps> = (p) => (
  <MvTransitionGlitchNoise from={p.from} to={p.to} durationInFrames={p.durationInFrames} variant={0.93} direction="forward" />
);
export const TxBlurCut: React.FC<XpTransitionProps> = (p) => (
  <MvTransitionBlurDissolve from={p.from} to={p.to} durationInFrames={p.durationInFrames} variant={0} />
);
export const TxDissolve: React.FC<XpTransitionProps> = (p) => (
  <MvTransitionBlurDissolve from={p.from} to={p.to} durationInFrames={p.durationInFrames} variant={0.2} />
);
export const TxFade: React.FC<XpTransitionProps> = (p) => (
  <MvTransitionBlurDissolve from={p.from} to={p.to} durationInFrames={p.durationInFrames} variant={0.4} />
);
export const TxBlur: React.FC<XpTransitionProps> = (p) => (
  <MvTransitionBlurDissolve from={p.from} to={p.to} durationInFrames={p.durationInFrames} variant={0.6} />
);
export const TxAura: React.FC<XpTransitionProps> = (p) => (
  <MvTransitionBlurDissolve from={p.from} to={p.to} durationInFrames={p.durationInFrames} variant={0.8} />
);
export const TxNoiseDissolve: React.FC<XpTransitionProps> = (p) => (
  <MvTransitionBlurDissolve from={p.from} to={p.to} durationInFrames={p.durationInFrames} variant={1} />
);
export const TxShade: React.FC<XpTransitionProps> = (p) => (
  <MvTransitionShadeSweep from={p.from} to={p.to} durationInFrames={p.durationInFrames} variant={0.2} />
);
export const TxCustomShade: React.FC<XpTransitionProps> = (p) => (
  <MvTransitionShadeSweep from={p.from} to={p.to} durationInFrames={p.durationInFrames} variant={0.75} />
);
export const TxShadeLeft: React.FC<XpTransitionProps> = (p) => (
  <MvTransitionShadeSweep from={p.from} to={p.to} durationInFrames={p.durationInFrames} direction="left" variant={0.35} />
);
export const TxShadeRight: React.FC<XpTransitionProps> = (p) => (
  <MvTransitionShadeSweep from={p.from} to={p.to} durationInFrames={p.durationInFrames} direction="right" variant={0.6} />
);
export const TxShadeUp: React.FC<XpTransitionProps> = (p) => (
  <MvTransitionShadeSweep from={p.from} to={p.to} durationInFrames={p.durationInFrames} direction="up" variant={0.5} />
);
export const TxShadeDown: React.FC<XpTransitionProps> = (p) => (
  <MvTransitionShadeSweep from={p.from} to={p.to} durationInFrames={p.durationInFrames} direction="down" variant={0.5} />
);
export const TxColorBlurLeft: React.FC<XpTransitionProps> = (p) => (
  <MvTransitionColorSmear from={p.from} to={p.to} durationInFrames={p.durationInFrames} direction="left" variant={0.5} />
);
export const TxColorBlurRight: React.FC<XpTransitionProps> = (p) => (
  <MvTransitionColorSmear from={p.from} to={p.to} durationInFrames={p.durationInFrames} direction="right" variant={0.5} />
);
export const TxColorBlurUp: React.FC<XpTransitionProps> = (p) => (
  <MvTransitionColorSmear from={p.from} to={p.to} durationInFrames={p.durationInFrames} direction="up" variant={0.5} />
);
export const TxColorBlurDown: React.FC<XpTransitionProps> = (p) => (
  <MvTransitionColorSmear from={p.from} to={p.to} durationInFrames={p.durationInFrames} direction="down" variant={0.5} />
);
export const TxDistortHorizontally: React.FC<XpTransitionProps> = (p) => (
  <MvTransitionColorSmear from={p.from} to={p.to} durationInFrames={p.durationInFrames} variant={0.25} />
);
export const TxDistortVertically: React.FC<XpTransitionProps> = (p) => (
  <MvTransitionColorSmear from={p.from} to={p.to} durationInFrames={p.durationInFrames} variant={0.75} />
);
export const TxBulgeLeft: React.FC<XpTransitionProps> = (p) => (
  <MvTransitionBulge from={p.from} to={p.to} durationInFrames={p.durationInFrames} direction="left" variant={0.15} />
);
export const TxBulgeRight: React.FC<XpTransitionProps> = (p) => (
  <MvTransitionBulge from={p.from} to={p.to} durationInFrames={p.durationInFrames} direction="right" variant={0.4} />
);
export const TxBulgeUp: React.FC<XpTransitionProps> = (p) => (
  <MvTransitionBulge from={p.from} to={p.to} durationInFrames={p.durationInFrames} direction="up" variant={0.65} />
);
export const TxBulgeDown: React.FC<XpTransitionProps> = (p) => (
  <MvTransitionBulge from={p.from} to={p.to} durationInFrames={p.durationInFrames} direction="down" variant={0.9} />
);
export const TxDriftLeft: React.FC<XpTransitionProps> = (p) => (
  <MvTransitionDrift from={p.from} to={p.to} durationInFrames={p.durationInFrames} direction="left" variant={0.2} />
);
export const TxDriftRight: React.FC<XpTransitionProps> = (p) => (
  <MvTransitionDrift from={p.from} to={p.to} durationInFrames={p.durationInFrames} direction="right" variant={0.8} />
);
export const TxDriftUp: React.FC<XpTransitionProps> = (p) => (
  <MvTransitionDrift from={p.from} to={p.to} durationInFrames={p.durationInFrames} direction="up" variant={0.3} />
);
export const TxDriftDown: React.FC<XpTransitionProps> = (p) => (
  <MvTransitionDrift from={p.from} to={p.to} durationInFrames={p.durationInFrames} direction="down" variant={0.3} />
);
export const TxFilmScribbleLeft: React.FC<XpTransitionProps> = (p) => (
  <MvTransitionFilmScribble from={p.from} to={p.to} durationInFrames={p.durationInFrames} direction="left" variant={0} />
);
export const TxFilmScribbleRight: React.FC<XpTransitionProps> = (p) => (
  <MvTransitionFilmScribble from={p.from} to={p.to} durationInFrames={p.durationInFrames} direction="right" variant={0.35} />
);
export const TxFilmScribbleUp: React.FC<XpTransitionProps> = (p) => (
  <MvTransitionFilmScribble from={p.from} to={p.to} durationInFrames={p.durationInFrames} direction="up" variant={0.6} />
);
export const TxFilmScribbleDown: React.FC<XpTransitionProps> = (p) => (
  <MvTransitionFilmScribble from={p.from} to={p.to} durationInFrames={p.durationInFrames} direction="down" variant={0.85} />
);
export const TxMeltLeft: React.FC<XpTransitionProps> = (p) => (
  <MvTransitionMeltFlow from={p.from} to={p.to} durationInFrames={p.durationInFrames} direction="left" variant={0.2} />
);
export const TxMeltRight: React.FC<XpTransitionProps> = (p) => (
  <MvTransitionMeltFlow from={p.from} to={p.to} durationInFrames={p.durationInFrames} direction="right" variant={0.45} />
);
export const TxMeltUp: React.FC<XpTransitionProps> = (p) => (
  <MvTransitionMeltFlow from={p.from} to={p.to} durationInFrames={p.durationInFrames} direction="up" variant={0.7} />
);
export const TxMeltDown: React.FC<XpTransitionProps> = (p) => (
  <MvTransitionMeltFlow from={p.from} to={p.to} durationInFrames={p.durationInFrames} direction="down" variant={0.9} />
);
export const TxParallaxLeft: React.FC<XpTransitionProps> = (p) => (
  <MvTransitionParallax from={p.from} to={p.to} durationInFrames={p.durationInFrames} direction="left" variant={0.25} />
);
export const TxParallaxRight: React.FC<XpTransitionProps> = (p) => (
  <MvTransitionParallax from={p.from} to={p.to} durationInFrames={p.durationInFrames} direction="right" variant={0.6} />
);
export const TxParallaxUp: React.FC<XpTransitionProps> = (p) => (
  <MvTransitionParallax from={p.from} to={p.to} durationInFrames={p.durationInFrames} direction="up" variant={0.45} />
);
export const TxParallaxDown: React.FC<XpTransitionProps> = (p) => (
  <MvTransitionParallax from={p.from} to={p.to} durationInFrames={p.durationInFrames} direction="down" variant={0.75} />
);
export const TxCustomMask: React.FC<XpTransitionProps> = (p) => (
  <MvTransitionMaskReveal from={p.from} to={p.to} durationInFrames={p.durationInFrames} direction="down" variant={0.5} />
);
export const FxBlur: React.FC<XpOverlayProps> = (p) => (
  <MvOverlayDreamBlur durationInFrames={p.durationInFrames} tint={p.tint} variant={0}>{p.children}</MvOverlayDreamBlur>
);
export const FxDreamyLook: React.FC<XpOverlayProps> = (p) => (
  <MvOverlayDreamBlur durationInFrames={p.durationInFrames} tint={p.tint} variant={0.25}>{p.children}</MvOverlayDreamBlur>
);
export const FxDreamBlur: React.FC<XpOverlayProps> = (p) => (
  <MvOverlayDreamBlur durationInFrames={p.durationInFrames} tint={p.tint} variant={0.5}>{p.children}</MvOverlayDreamBlur>
);
export const FxSoftFocusColorLook: React.FC<XpOverlayProps> = (p) => (
  <MvOverlayDreamBlur durationInFrames={p.durationInFrames} tint={p.tint} variant={0.75}>{p.children}</MvOverlayDreamBlur>
);
export const FxLumaBlur: React.FC<XpOverlayProps> = (p) => (
  <MvOverlayDreamBlur durationInFrames={p.durationInFrames} tint={p.tint} variant={1}>{p.children}</MvOverlayDreamBlur>
);
export const FxColorFilter: React.FC<XpOverlayProps> = (p) => (
  <MvOverlayColorGrade durationInFrames={p.durationInFrames} tint={p.tint} variant={0}>{p.children}</MvOverlayColorGrade>
);
export const FxMonoColor: React.FC<XpOverlayProps> = (p) => (
  <MvOverlayColorGrade durationInFrames={p.durationInFrames} tint={p.tint} variant={0.5}>{p.children}</MvOverlayColorGrade>
);
export const FxGradientColorize: React.FC<XpOverlayProps> = (p) => (
  <MvOverlayColorGrade durationInFrames={p.durationInFrames} tint={p.tint} variant={1}>{p.children}</MvOverlayColorGrade>
);
export const FxDirtsAndScratches: React.FC<XpOverlayProps> = (p) => (
  <MvOverlayFilmTexture durationInFrames={p.durationInFrames} tint={p.tint} variant={0}>{p.children}</MvOverlayFilmTexture>
);
export const FxFilmEmulation: React.FC<XpOverlayProps> = (p) => (
  <MvOverlayFilmTexture durationInFrames={p.durationInFrames} tint={p.tint} variant={1}>{p.children}</MvOverlayFilmTexture>
);
export const FxPrism: React.FC<XpOverlayProps> = (p) => (
  <MvOverlayPrism durationInFrames={p.durationInFrames} tint={p.tint} variant={0} intensity={70}>{p.children}</MvOverlayPrism>
);
export const FxPrismBlur: React.FC<XpOverlayProps> = (p) => (
  <MvOverlayPrism durationInFrames={p.durationInFrames} tint={p.tint} variant={0.5} intensity={60}>{p.children}</MvOverlayPrism>
);
export const FxRefraction: React.FC<XpOverlayProps> = (p) => (
  <MvOverlayPrism durationInFrames={p.durationInFrames} tint={p.tint} variant={1} intensity={65}>{p.children}</MvOverlayPrism>
);
export const FxRetroLook: React.FC<XpOverlayProps> = (p) => (
  <MvOverlayVintageFilm durationInFrames={p.durationInFrames} tint={p.tint} variant={0}>{p.children}</MvOverlayVintageFilm>
);
export const FxVintage02: React.FC<XpOverlayProps> = (p) => (
  <MvOverlayVintageFilm durationInFrames={p.durationInFrames} tint={p.tint} variant={0.25}>{p.children}</MvOverlayVintageFilm>
);
export const FxVintage04: React.FC<XpOverlayProps> = (p) => (
  <MvOverlayVintageFilm durationInFrames={p.durationInFrames} tint={p.tint} variant={0.5}>{p.children}</MvOverlayVintageFilm>
);
export const FxVintage03: React.FC<XpOverlayProps> = (p) => (
  <MvOverlayVintageFilm durationInFrames={p.durationInFrames} tint={p.tint} variant={0.75}>{p.children}</MvOverlayVintageFilm>
);
export const FxVintage08: React.FC<XpOverlayProps> = (p) => (
  <MvOverlayVintageFilm durationInFrames={p.durationInFrames} tint={p.tint} variant={1}>{p.children}</MvOverlayVintageFilm>
);
export const FxDistortedShake: React.FC<XpOverlayProps> = (p) => (
  <MvOverlayGlitch durationInFrames={p.durationInFrames} tint={p.tint} variant={0}>{p.children}</MvOverlayGlitch>
);
export const FxDistortion05: React.FC<XpOverlayProps> = (p) => (
  <MvOverlayGlitch durationInFrames={p.durationInFrames} tint={p.tint} variant={0.33}>{p.children}</MvOverlayGlitch>
);
export const FxDistortion04: React.FC<XpOverlayProps> = (p) => (
  <MvOverlayGlitch durationInFrames={p.durationInFrames} tint={p.tint} variant={0.67}>{p.children}</MvOverlayGlitch>
);
export const FxDistortion08: React.FC<XpOverlayProps> = (p) => (
  <MvOverlayGlitch durationInFrames={p.durationInFrames} tint={p.tint} variant={1}>{p.children}</MvOverlayGlitch>
);
export const FxStutterEffect: React.FC<XpOverlayProps> = (p) => (
  <MvOverlayStrobe durationInFrames={p.durationInFrames} tint={p.tint} variant={0}>{p.children}</MvOverlayStrobe>
);
export const FxLightStroboscope: React.FC<XpOverlayProps> = (p) => (
  <MvOverlayStrobe durationInFrames={p.durationInFrames} tint={p.tint} variant={1}>{p.children}</MvOverlayStrobe>
);
export const FxDistortion02: React.FC<XpOverlayProps> = (p) => (
  <MvOverlayLiquidWarp durationInFrames={p.durationInFrames} tint={p.tint} variant={0}>{p.children}</MvOverlayLiquidWarp>
);
export const FxDistortion03: React.FC<XpOverlayProps> = (p) => (
  <MvOverlayLiquidWarp durationInFrames={p.durationInFrames} tint={p.tint} variant={0.34}>{p.children}</MvOverlayLiquidWarp>
);
export const FxDistortion01: React.FC<XpOverlayProps> = (p) => (
  <MvOverlayLiquidWarp durationInFrames={p.durationInFrames} tint={p.tint} variant={0.67}>{p.children}</MvOverlayLiquidWarp>
);
export const FxDistortion07: React.FC<XpOverlayProps> = (p) => (
  <MvOverlayLiquidWarp durationInFrames={p.durationInFrames} tint={p.tint} variant={1}>{p.children}</MvOverlayLiquidWarp>
);
export const FxDistortion09: React.FC<XpOverlayProps> = (p) => (
  <MvOverlayEdgeGlow durationInFrames={p.durationInFrames} tint={p.tint} variant={0}>{p.children}</MvOverlayEdgeGlow>
);
export const FxDistortion06: React.FC<XpOverlayProps> = (p) => (
  <MvOverlayEdgeGlow durationInFrames={p.durationInFrames} tint={p.tint} variant={0.33}>{p.children}</MvOverlayEdgeGlow>
);
export const FxEdgeGleam: React.FC<XpOverlayProps> = (p) => (
  <MvOverlayEdgeGlow durationInFrames={p.durationInFrames} tint={p.tint} variant={0.66}>{p.children}</MvOverlayEdgeGlow>
);
export const FxGlowingEdges: React.FC<XpOverlayProps> = (p) => (
  <MvOverlayEdgeGlow durationInFrames={p.durationInFrames} tint={p.tint} variant={1}>{p.children}</MvOverlayEdgeGlow>
);
export const FxFisheyeLens: React.FC<XpOverlayProps> = (p) => (
  <MvOverlayLensWarp durationInFrames={p.durationInFrames} tint={p.tint} variant={0}>{p.children}</MvOverlayLensWarp>
);
export const FxFisheye: React.FC<XpOverlayProps> = (p) => (
  <MvOverlayLensWarp durationInFrames={p.durationInFrames} tint={p.tint} variant={0.5}>{p.children}</MvOverlayLensWarp>
);
export const FxDizzy: React.FC<XpOverlayProps> = (p) => (
  <MvOverlayLensWarp durationInFrames={p.durationInFrames} tint={p.tint} variant={1}>{p.children}</MvOverlayLensWarp>
);
export const FxSplitScreenLetterbox: React.FC<XpOverlayProps> = (p) => (
  <MvOverlaySplitScreen durationInFrames={p.durationInFrames} tint={p.tint} variant={0}>{p.children}</MvOverlaySplitScreen>
);
export const FxSplitScreen: React.FC<XpOverlayProps> = (p) => (
  <MvOverlaySplitScreen durationInFrames={p.durationInFrames} tint={p.tint} variant={0.33}>{p.children}</MvOverlaySplitScreen>
);
export const FxMultiSplitScreen: React.FC<XpOverlayProps> = (p) => (
  <MvOverlaySplitScreen durationInFrames={p.durationInFrames} tint={p.tint} variant={0.66}>{p.children}</MvOverlaySplitScreen>
);
export const FxSplitScreenFrame: React.FC<XpOverlayProps> = (p) => (
  <MvOverlaySplitScreen durationInFrames={p.durationInFrames} tint={p.tint} variant={1}>{p.children}</MvOverlaySplitScreen>
);
export const FxFilmMatte03: React.FC<XpOverlayProps> = (p) => (
  <MvOverlayFilmMatte durationInFrames={p.durationInFrames} tint={p.tint} variant={0}>{p.children}</MvOverlayFilmMatte>
);
export const FxFilmMatte05: React.FC<XpOverlayProps> = (p) => (
  <MvOverlayFilmMatte durationInFrames={p.durationInFrames} tint={p.tint} variant={0.143}>{p.children}</MvOverlayFilmMatte>
);
export const FxFilmMatte08: React.FC<XpOverlayProps> = (p) => (
  <MvOverlayFilmMatte durationInFrames={p.durationInFrames} tint={p.tint} variant={0.286}>{p.children}</MvOverlayFilmMatte>
);
export const FxFilmMatte04: React.FC<XpOverlayProps> = (p) => (
  <MvOverlayFilmMatte durationInFrames={p.durationInFrames} tint={p.tint} variant={0.429}>{p.children}</MvOverlayFilmMatte>
);
export const FxFilmMatte07: React.FC<XpOverlayProps> = (p) => (
  <MvOverlayFilmMatte durationInFrames={p.durationInFrames} tint={p.tint} variant={0.571}>{p.children}</MvOverlayFilmMatte>
);
export const FxFilmMatte06: React.FC<XpOverlayProps> = (p) => (
  <MvOverlayFilmMatte durationInFrames={p.durationInFrames} tint={p.tint} variant={0.714}>{p.children}</MvOverlayFilmMatte>
);
export const FxFilmMatte01: React.FC<XpOverlayProps> = (p) => (
  <MvOverlayFilmMatte durationInFrames={p.durationInFrames} tint={p.tint} variant={0.857}>{p.children}</MvOverlayFilmMatte>
);
export const FxFrame: React.FC<XpOverlayProps> = (p) => (
  <MvOverlayFilmMatte durationInFrames={p.durationInFrames} tint={p.tint} variant={1}>{p.children}</MvOverlayFilmMatte>
);
export const FxFilmMatte02: React.FC<XpOverlayProps> = (p) => (
  <MvOverlayFilmStrip durationInFrames={p.durationInFrames} tint={p.tint} variant={0}>{p.children}</MvOverlayFilmStrip>
);
export const FxGrayscaleFilmRoll: React.FC<XpOverlayProps> = (p) => (
  <MvOverlayFilmStrip durationInFrames={p.durationInFrames} tint={p.tint} variant={0.5}>{p.children}</MvOverlayFilmStrip>
);
export const FxGlitchFilmReel: React.FC<XpOverlayProps> = (p) => (
  <MvOverlayFilmStrip durationInFrames={p.durationInFrames} tint={p.tint} variant={1}>{p.children}</MvOverlayFilmStrip>
);
export const FxFootageClones01: React.FC<XpOverlayProps> = (p) => (
  <MvOverlayGhostEcho durationInFrames={p.durationInFrames} tint={p.tint} variant={0}>{p.children}</MvOverlayGhostEcho>
);
export const FxFootageClones02: React.FC<XpOverlayProps> = (p) => (
  <MvOverlayGhostEcho durationInFrames={p.durationInFrames} tint={p.tint} variant={0.25}>{p.children}</MvOverlayGhostEcho>
);
export const FxGhosting: React.FC<XpOverlayProps> = (p) => (
  <MvOverlayGhostEcho durationInFrames={p.durationInFrames} tint={p.tint} variant={0.5}>{p.children}</MvOverlayGhostEcho>
);
export const FxGhostingEffect: React.FC<XpOverlayProps> = (p) => (
  <MvOverlayGhostEcho durationInFrames={p.durationInFrames} tint={p.tint} variant={0.75}>{p.children}</MvOverlayGhostEcho>
);
export const FxPermeation: React.FC<XpOverlayProps> = (p) => (
  <MvOverlayGhostEcho durationInFrames={p.durationInFrames} tint={p.tint} variant={1}>{p.children}</MvOverlayGhostEcho>
);
export const FxPunch: React.FC<XpOverlayProps> = (p) => (
  <MvOverlayImpactShake durationInFrames={p.durationInFrames} tint={p.tint} variant={0} intensity={75}>{p.children}</MvOverlayImpactShake>
);
export const FxQuakeZoom: React.FC<XpOverlayProps> = (p) => (
  <MvOverlayImpactShake durationInFrames={p.durationInFrames} tint={p.tint} variant={0.33} intensity={70}>{p.children}</MvOverlayImpactShake>
);
export const FxShakeZoom: React.FC<XpOverlayProps> = (p) => (
  <MvOverlayImpactShake durationInFrames={p.durationInFrames} tint={p.tint} variant={0.67} intensity={65}>{p.children}</MvOverlayImpactShake>
);
export const FxFastRotation: React.FC<XpOverlayProps> = (p) => (
  <MvOverlayImpactShake durationInFrames={p.durationInFrames} tint={p.tint} variant={1} intensity={70}>{p.children}</MvOverlayImpactShake>
);
export const FxVerticalStreak: React.FC<XpOverlayProps> = (p) => (
  <MvOverlayLightStreak durationInFrames={p.durationInFrames} tint={p.tint} variant={0}>{p.children}</MvOverlayLightStreak>
);
export const FxPixelSorting: React.FC<XpOverlayProps> = (p) => (
  <MvOverlayLightStreak durationInFrames={p.durationInFrames} tint={p.tint} variant={1}>{p.children}</MvOverlayLightStreak>
);
export const FxVintage01: React.FC<XpOverlayProps> = (p) => (
  <MvOverlayHalftonePrint durationInFrames={p.durationInFrames} tint={p.tint} variant={0}>{p.children}</MvOverlayHalftonePrint>
);
export const FxVintage07: React.FC<XpOverlayProps> = (p) => (
  <MvOverlayHalftonePrint durationInFrames={p.durationInFrames} tint={p.tint} variant={0.33}>{p.children}</MvOverlayHalftonePrint>
);
export const FxHalftone: React.FC<XpOverlayProps> = (p) => (
  <MvOverlayHalftonePrint durationInFrames={p.durationInFrames} tint={p.tint} variant={0.67}>{p.children}</MvOverlayHalftonePrint>
);
export const FxVintage09: React.FC<XpOverlayProps> = (p) => (
  <MvOverlayHalftonePrint durationInFrames={p.durationInFrames} tint={p.tint} variant={1}>{p.children}</MvOverlayHalftonePrint>
);
export const FxVintage06: React.FC<XpOverlayProps> = (p) => (
  <MvOverlayPaperFrame durationInFrames={p.durationInFrames} tint={p.tint} variant={0.2}>{p.children}</MvOverlayPaperFrame>
);
export const FxVintage11: React.FC<XpOverlayProps> = (p) => (
  <MvOverlayPaperFrame durationInFrames={p.durationInFrames} tint={p.tint} variant={0.8}>{p.children}</MvOverlayPaperFrame>
);
export const FxVintage05: React.FC<XpOverlayProps> = (p) => (
  <MvOverlayRetroDevice durationInFrames={p.durationInFrames} tint={p.tint} variant={0}>{p.children}</MvOverlayRetroDevice>
);
export const FxVintage10: React.FC<XpOverlayProps> = (p) => (
  <MvOverlayRetroDevice durationInFrames={p.durationInFrames} tint={p.tint} variant={0.33}>{p.children}</MvOverlayRetroDevice>
);
export const FxViewfinder: React.FC<XpOverlayProps> = (p) => (
  <MvOverlayRetroDevice durationInFrames={p.durationInFrames} tint={p.tint} variant={0.67}>{p.children}</MvOverlayRetroDevice>
);
export const FxVisionEmulations: React.FC<XpOverlayProps> = (p) => (
  <MvOverlayRetroDevice durationInFrames={p.durationInFrames} tint={p.tint} variant={1}>{p.children}</MvOverlayRetroDevice>
);
export const FxHandhelds: React.FC<XpOverlayProps> = (p) => (
  <MvOverlayDoodleFrame durationInFrames={p.durationInFrames} tint={p.tint} variant={0}>{p.children}</MvOverlayDoodleFrame>
);
export const TxDoubleExposure: React.FC<XpTransitionProps> = (p) => (
  <MvTransitionDoubleExposure from={p.from} to={p.to} durationInFrames={p.durationInFrames} direction="left" variant={0.25} />
);
export const TxFlashLeft: React.FC<XpTransitionProps> = (p) => (
  <MvTransitionFlashSweep from={p.from} to={p.to} durationInFrames={p.durationInFrames} direction="left" variant={0.12} />
);
export const TxFlashRight: React.FC<XpTransitionProps> = (p) => (
  <MvTransitionFlashSweep from={p.from} to={p.to} durationInFrames={p.durationInFrames} direction="right" variant={0.37} />
);
export const TxFlashUp: React.FC<XpTransitionProps> = (p) => (
  <MvTransitionFlashSweep from={p.from} to={p.to} durationInFrames={p.durationInFrames} direction="up" variant={0.62} />
);
export const TxFlashDown: React.FC<XpTransitionProps> = (p) => (
  <MvTransitionFlashSweep from={p.from} to={p.to} durationInFrames={p.durationInFrames} direction="down" variant={0.87} />
);
export const FxCamera: React.FC<XpOverlayProps> = (p) => (
  <MvOverlayHandheldCam durationInFrames={p.durationInFrames} tint={p.tint} variant={0} intensity={60}>{p.children}</MvOverlayHandheldCam>
);
export const FxHandheld: React.FC<XpOverlayProps> = (p) => (
  <MvOverlayHandheldCam durationInFrames={p.durationInFrames} tint={p.tint} variant={0.5} intensity={65}>{p.children}</MvOverlayHandheldCam>
);
export const FxWalkingZoomIn: React.FC<XpOverlayProps> = (p) => (
  <MvOverlayHandheldCam durationInFrames={p.durationInFrames} tint={p.tint} variant={1} intensity={60}>{p.children}</MvOverlayHandheldCam>
);
export const FxBurnEffect: React.FC<XpOverlayProps> = (p) => (
  <MvOverlayLightLeak durationInFrames={p.durationInFrames} tint={p.tint} variant={0}>{p.children}</MvOverlayLightLeak>
);
export const FxLightLeaks: React.FC<XpOverlayProps> = (p) => (
  <MvOverlayLightLeak durationInFrames={p.durationInFrames} tint={p.tint} variant={0.33}>{p.children}</MvOverlayLightLeak>
);
export const FxMovieLight: React.FC<XpOverlayProps> = (p) => (
  <MvOverlayLightLeak durationInFrames={p.durationInFrames} tint={p.tint} variant={0.66}>{p.children}</MvOverlayLightLeak>
);
export const FxFilmGrunge: React.FC<XpOverlayProps> = (p) => (
  <MvOverlayLightLeak durationInFrames={p.durationInFrames} tint={p.tint} variant={1}>{p.children}</MvOverlayLightLeak>
);
export const TxFilmSlide: React.FC<XpTransitionProps> = (p) => (
  <MvTransitionPushSlide from={p.from} to={p.to} durationInFrames={p.durationInFrames} direction="up" variant={0.15} />
);
export const TxTug: React.FC<XpTransitionProps> = (p) => (
  <MvTransitionPushSlide from={p.from} to={p.to} durationInFrames={p.durationInFrames} direction="down" variant={0.5} />
);
export const TxFootageRoll: React.FC<XpTransitionProps> = (p) => (
  <MvTransitionPushSlide from={p.from} to={p.to} durationInFrames={p.durationInFrames} direction="left" variant={0.85} />
);
export const TxGlassDistortion: React.FC<XpTransitionProps> = (p) => (
  <MvTransitionRippleGlass from={p.from} to={p.to} durationInFrames={p.durationInFrames} direction="left" variant={0.15} />
);
export const TxRipple: React.FC<XpTransitionProps> = (p) => (
  <MvTransitionRippleGlass from={p.from} to={p.to} durationInFrames={p.durationInFrames} direction="down" variant={0.85} />
);
export const TxRollLeft: React.FC<XpTransitionProps> = (p) => (
  <MvTransitionRoll from={p.from} to={p.to} durationInFrames={p.durationInFrames} direction="left" variant={0.15} />
);
export const TxRollRight: React.FC<XpTransitionProps> = (p) => (
  <MvTransitionRoll from={p.from} to={p.to} durationInFrames={p.durationInFrames} direction="right" variant={0.4} />
);
export const TxRollUp: React.FC<XpTransitionProps> = (p) => (
  <MvTransitionRoll from={p.from} to={p.to} durationInFrames={p.durationInFrames} direction="up" variant={0.65} />
);
export const TxRollDown: React.FC<XpTransitionProps> = (p) => (
  <MvTransitionRoll from={p.from} to={p.to} durationInFrames={p.durationInFrames} direction="down" variant={0.9} />
);
export const TxShiftLeft: React.FC<XpTransitionProps> = (p) => (
  <MvTransitionShift from={p.from} to={p.to} durationInFrames={p.durationInFrames} direction="left" variant={0.12} />
);
export const TxShiftRight: React.FC<XpTransitionProps> = (p) => (
  <MvTransitionShift from={p.from} to={p.to} durationInFrames={p.durationInFrames} direction="right" variant={0.37} />
);
export const TxShiftUp: React.FC<XpTransitionProps> = (p) => (
  <MvTransitionShift from={p.from} to={p.to} durationInFrames={p.durationInFrames} direction="up" variant={0.62} />
);
export const TxShiftDown: React.FC<XpTransitionProps> = (p) => (
  <MvTransitionShift from={p.from} to={p.to} durationInFrames={p.durationInFrames} direction="down" variant={0.87} />
);
export const TxSpin: React.FC<XpTransitionProps> = (p) => (
  <MvTransitionSpin from={p.from} to={p.to} durationInFrames={p.durationInFrames} direction="right" variant={0.1} />
);
export const TxGyre: React.FC<XpTransitionProps> = (p) => (
  <MvTransitionSpin from={p.from} to={p.to} durationInFrames={p.durationInFrames} direction="right" variant={0.3} />
);
export const TxRevolveLeft: React.FC<XpTransitionProps> = (p) => (
  <MvTransitionSpin from={p.from} to={p.to} durationInFrames={p.durationInFrames} direction="left" variant={0.55} />
);
export const TxRevolveRight: React.FC<XpTransitionProps> = (p) => (
  <MvTransitionSpin from={p.from} to={p.to} durationInFrames={p.durationInFrames} direction="right" variant={0.8} />
);
export const TxStillFrame: React.FC<XpTransitionProps> = (p) => (
  <MvTransitionStillFrame from={p.from} to={p.to} durationInFrames={p.durationInFrames} direction="left" variant={0.5} />
);
