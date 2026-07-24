// ⚙️ 自動生成: scripts/gen-xp-components.py（手編集しない）
// registry-meta.ts の transition / title / subtitle / effect(overlay) を生コンポーネントとして機械マップする。
// registry.tsx（プレビュー用・@remotion/media依存）とは独立させ、本編バンドルへの全ポート流入を防ぐ。
// 新ポートを統合したら再実行すること。
// 配布クリーン化済みの id（CLEANROOM_IDS）は ./cleanroom-adapters（cleanroom新実装）を指す。
import type React from "react";

import { TxCrossFade } from "./cleanroom-adapters";
import { TxBlurCut } from "./cleanroom-adapters";
import { TxBurn } from "./cleanroom-adapters";
import { TxCameraShake } from "./cleanroom-adapters";
import { TxCustomMask } from "./cleanroom-adapters";
import { TxDissolve } from "./cleanroom-adapters";
import { TxDoubleExposure } from "./cleanroom-adapters";
import { TxDoubleWhipPan } from "./cleanroom-adapters";
import { TxEcho } from "./cleanroom-adapters";
import { TxEchoFlash } from "./cleanroom-adapters";
import { TxExpire } from "./cleanroom-adapters";
import { TxFade } from "./cleanroom-adapters";
import { TxFilmBurn } from "./cleanroom-adapters";
import { TxFilmChange } from "./cleanroom-adapters";
import { TxFilmMarks } from "./cleanroom-adapters";
import { TxFilmMelt } from "./cleanroom-adapters";
import { TxFilmSlide } from "./cleanroom-adapters";
import { TxFilmStain } from "./cleanroom-adapters";
import { TxFlash } from "./cleanroom-adapters";
import { TxFlashSlide } from "./cleanroom-adapters";
import { TxFlashZoom } from "./cleanroom-adapters";
import { TxFlicker } from "./cleanroom-adapters";
import { TxFlickerFlare } from "./cleanroom-adapters";
import { TxFootageRoll } from "./cleanroom-adapters";
import { TxFrameDrop } from "./cleanroom-adapters";
import { TxGlassDistortion } from "./cleanroom-adapters";
import { TxGyre } from "./cleanroom-adapters";
import { TxIgnite } from "./cleanroom-adapters";
import { TxJitter } from "./cleanroom-adapters";
import { TxLightLeak } from "./cleanroom-adapters";
import { TxLightSpeed } from "./cleanroom-adapters";
import { TxLightWhip } from "./cleanroom-adapters";
import { TxLumaBlink } from "./cleanroom-adapters";
import { TxMusicVideoTransition } from "./cleanroom-adapters";
import { TxNegativeFlash } from "./cleanroom-adapters";
import { TxNegativeFlashes } from "./cleanroom-adapters";
import { TxNoise } from "./cleanroom-adapters";
import { TxOverdrive } from "./cleanroom-adapters";
import { TxOverexposure01 } from "./cleanroom-adapters";
import { TxOverexposure02 } from "./cleanroom-adapters";
import { TxPlayGlitch } from "./cleanroom-adapters";
import { TxQuake } from "./cleanroom-adapters";
import { TxScrape01 } from "./cleanroom-adapters";
import { TxShade } from "./cleanroom-adapters";
import { TxShadowWhip } from "./cleanroom-adapters";
import { TxSmear } from "./cleanroom-adapters";
import { TxSpeedFlash } from "./cleanroom-adapters";
import { TxSpin } from "./cleanroom-adapters";
import { TxStatic } from "./cleanroom-adapters";
import { TxStillFrame } from "./cleanroom-adapters";
import { TxStretch } from "./cleanroom-adapters";
import { TxStrike } from "./cleanroom-adapters";
import { TxSwoosh } from "./cleanroom-adapters";
import { TxTapeGlitch } from "./cleanroom-adapters";
import { TxTug } from "./cleanroom-adapters";
import { TxVacuum } from "./cleanroom-adapters";
import { TxWhipPan } from "./cleanroom-adapters";
import { TxZoom02 } from "./cleanroom-adapters";
import { TxZoomFade } from "./cleanroom-adapters";
import { TxZoom03 } from "./cleanroom-adapters";
import { TxColorBlurLeft } from "./cleanroom-adapters";
import { TxColorBlurDown } from "./cleanroom-adapters";
import { TxBlur } from "./cleanroom-adapters";
import { TxBulgeUp } from "./cleanroom-adapters";
import { TxAura } from "./cleanroom-adapters";
import { TxBulgeLeft } from "./cleanroom-adapters";
import { TxBulgeRight } from "./cleanroom-adapters";
import { TxBulgeDown } from "./cleanroom-adapters";
import { TxColorBlurUp } from "./cleanroom-adapters";
import { TxColorBlurRight } from "./cleanroom-adapters";
import { TxCustomShade } from "./cleanroom-adapters";
import { TxDistortHorizontally } from "./cleanroom-adapters";
import { TxDistortVertically } from "./cleanroom-adapters";
import { TxDesaturate } from "./cleanroom-adapters";
import { TxCustomSurgeBackward } from "./cleanroom-adapters";
import { TxCustomSurgeForward } from "./cleanroom-adapters";
import { TxDriftDown } from "./cleanroom-adapters";
import { TxFastForward } from "./cleanroom-adapters";
import { TxFilmBurnRight } from "./cleanroom-adapters";
import { TxDriftRight } from "./cleanroom-adapters";
import { TxFilmBurnLeft } from "./cleanroom-adapters";
import { TxDriftUp } from "./cleanroom-adapters";
import { TxDriftLeft } from "./cleanroom-adapters";
import { TxFilmBurnDown } from "./cleanroom-adapters";
import { TxFilmBurnUp } from "./cleanroom-adapters";
import { TxFilmScribbleLeft } from "./cleanroom-adapters";
import { TxFilmScribbleDown } from "./cleanroom-adapters";
import { TxFilmScribbleRight } from "./cleanroom-adapters";
import { TxFilmScribbleUp } from "./cleanroom-adapters";
import { TxFlashLeft } from "./cleanroom-adapters";
import { TxFlashDown } from "./cleanroom-adapters";
import { TxFlashUp } from "./cleanroom-adapters";
import { TxFlashRight } from "./cleanroom-adapters";
import { TxIlluminate } from "./cleanroom-adapters";
import { TxMeltDown } from "./cleanroom-adapters";
import { TxMeltRight } from "./cleanroom-adapters";
import { TxMeltLeft } from "./cleanroom-adapters";
import { TxNoiseDissolve } from "./cleanroom-adapters";
import { TxMeltUp } from "./cleanroom-adapters";
import { TxOverexposeDown } from "./cleanroom-adapters";
import { TxOverexposeRight } from "./cleanroom-adapters";
import { TxOverexposeLeft } from "./cleanroom-adapters";
import { TxOverexposeUp } from "./cleanroom-adapters";
import { TxParallaxLeft } from "./cleanroom-adapters";
import { TxParallaxUp } from "./cleanroom-adapters";
import { TxParallaxDown } from "./cleanroom-adapters";
import { TxPixellate } from "./cleanroom-adapters";
import { TxRevolveLeft } from "./cleanroom-adapters";
import { TxRevolveRight } from "./cleanroom-adapters";
import { TxParallaxRight } from "./cleanroom-adapters";
import { TxRipple } from "./cleanroom-adapters";
import { TxRollDown } from "./cleanroom-adapters";
import { TxShadeDown } from "./cleanroom-adapters";
import { TxScrape02 } from "./cleanroom-adapters";
import { TxRollRight } from "./cleanroom-adapters";
import { TxRollUp } from "./cleanroom-adapters";
import { TxShadeLeft } from "./cleanroom-adapters";
import { TxRollLeft } from "./cleanroom-adapters";
import { TxShadeRight } from "./cleanroom-adapters";
import { TxShiftDown } from "./cleanroom-adapters";
import { TxShadeUp } from "./cleanroom-adapters";
import { TxShiftLeft } from "./cleanroom-adapters";
import { TxShiftRight } from "./cleanroom-adapters";
import { TxShiftUp } from "./cleanroom-adapters";
import { TxXRayDown } from "./cleanroom-adapters";
import { TxZoom01 } from "./cleanroom-adapters";
import { TxXRayUp } from "./cleanroom-adapters";
import { TxXRayLeft } from "./cleanroom-adapters";
import { TxXRayRight } from "./cleanroom-adapters";
import { TitleSignalGlitch01 } from "./cleanroom-adapters";
import { TitleSignalGlitch02 } from "./cleanroom-adapters";
import { TitleSignalGlitch03 } from "./cleanroom-adapters";
import { TitleSignalGlitch04 } from "./cleanroom-adapters";
import { TitleSignalGlitch05 } from "./cleanroom-adapters";
import { TitleSignalGlitch06 } from "./cleanroom-adapters";
import { TitleSignalGlitch07 } from "./cleanroom-adapters";
import { TitleSignalGlitch08 } from "./cleanroom-adapters";
import { TitleSignalGlitch09 } from "./cleanroom-adapters";
import { TitleSignalGlitch10 } from "./cleanroom-adapters";
import { TitleSignalGlitch11 } from "./cleanroom-adapters";
import { TitleSignalGlitch12 } from "./cleanroom-adapters";
import { TitleSignalGlitch13 } from "./cleanroom-adapters";
import { TitleSignalGlitch14 } from "./cleanroom-adapters";
import { TitleSignalGlitch15 } from "./cleanroom-adapters";
import { TitleSignalGlitch16 } from "./cleanroom-adapters";
import { TitleSignalGlitch17 } from "./cleanroom-adapters";
import { TitleSignalGlitch18 } from "./cleanroom-adapters";
import { TitleSignalGlitch19 } from "./cleanroom-adapters";
import { TitleSignalGlitch20 } from "./cleanroom-adapters";
import { TitleSignalGlitch21 } from "./cleanroom-adapters";
import { TitleSignalGlitch22 } from "./cleanroom-adapters";
import { TitleSignalGlitch23 } from "./cleanroom-adapters";
import { TitleSignalGlitch24 } from "./cleanroom-adapters";
import { TitleSignalGlitch25 } from "./cleanroom-adapters";
import { TitleSignalGlitch26 } from "./cleanroom-adapters";
import { SubSubtitle06 } from "./cleanroom-adapters";
import { SubSubtitle07 } from "./cleanroom-adapters";
import { SubSubtitle08 } from "./cleanroom-adapters";
import { SubSubtitle09 } from "./cleanroom-adapters";
import { SubSubtitle10 } from "./cleanroom-adapters";
import { SubSubtitle11 } from "./cleanroom-adapters";
import { SubSubtitle12 } from "./cleanroom-adapters";
import { SubSubtitle13 } from "./cleanroom-adapters";
import { SubSubtitle14 } from "./cleanroom-adapters";
import { SubSubtitle15 } from "./cleanroom-adapters";
import { SubSubtitle16 } from "./cleanroom-adapters";
import { SubSubtitle17 } from "./cleanroom-adapters";
import { SubSubtitle18 } from "./cleanroom-adapters";
import { SubSubtitle19 } from "./cleanroom-adapters";
import { SubSubtitle20 } from "./cleanroom-adapters";
import { SubSubtitle21 } from "./cleanroom-adapters";
import { SubSubtitle22 } from "./cleanroom-adapters";
import { SubSubtitle23 } from "./cleanroom-adapters";
import { SubSubtitle24 } from "./cleanroom-adapters";
import { SubSubtitle25 } from "./cleanroom-adapters";
import { SubSubtitle26 } from "./cleanroom-adapters";
import { SubSubtitle27 } from "./cleanroom-adapters";
import { SubSubtitle28 } from "./cleanroom-adapters";
import { SubSubtitle29 } from "./cleanroom-adapters";
import { SubSubtitle30 } from "./cleanroom-adapters";
import { SubSubtitle31 } from "./cleanroom-adapters";
import { SubSubtitle32 } from "./cleanroom-adapters";
import { SubSubtitle33 } from "./cleanroom-adapters";
import { SubSubtitle34 } from "./cleanroom-adapters";
import { SubSubtitle35 } from "./cleanroom-adapters";
import { SubSubtitle36 } from "./cleanroom-adapters";
import { SubSubtitle37 } from "./cleanroom-adapters";
import { SubSubtitle38 } from "./cleanroom-adapters";
import { SubSubtitle39 } from "./cleanroom-adapters";
import { SubSubtitle40 } from "./cleanroom-adapters";
import { SubSubtitle41 } from "./cleanroom-adapters";
import { SubSubtitle42 } from "./cleanroom-adapters";
import { SubSubtitle43 } from "./cleanroom-adapters";
import { SubSubtitle44 } from "./cleanroom-adapters";
import { SubSubtitle45 } from "./cleanroom-adapters";
import { SubSubtitle46 } from "./cleanroom-adapters";
import { SubSubtitle47 } from "./cleanroom-adapters";
import { SubSubtitle48 } from "./cleanroom-adapters";
import { TitleArtistic01 } from "./cleanroom-adapters";
import { TitleArtistic03 } from "./cleanroom-adapters";
import { TitleArtistic02 } from "./cleanroom-adapters";
import { TitleArtistic04 } from "./cleanroom-adapters";
import { TitleArtistic06 } from "./cleanroom-adapters";
import { TitleArtistic05 } from "./cleanroom-adapters";
import { TitleBasicMovements } from "./cleanroom-adapters";
import { TitleArtistic07 } from "./cleanroom-adapters";
import { TitleCinematicTitle01 } from "./cleanroom-adapters";
import { TitleCinematicTitle02 } from "./cleanroom-adapters";
import { TitleCinematicTitle04 } from "./cleanroom-adapters";
import { TitleCinematicTitle06 } from "./cleanroom-adapters";
import { TitleCinematicTitle05 } from "./cleanroom-adapters";
import { TitleCinematicTitle07 } from "./cleanroom-adapters";
import { TitleCinematicTitle09 } from "./cleanroom-adapters";
import { TitleCinematicTitle03 } from "./cleanroom-adapters";
import { TitleCinematicTitle08 } from "./cleanroom-adapters";
import { TitleCinematicTitle11 } from "./cleanroom-adapters";
import { TitleCinematicTitle13 } from "./cleanroom-adapters";
import { TitleCinematicTitle12 } from "./cleanroom-adapters";
import { TitleCinematicTitle14 } from "./cleanroom-adapters";
import { TitleCinematicTitle15 } from "./cleanroom-adapters";
import { TitleCinematicTitle16 } from "./cleanroom-adapters";
import { TitleCinematicTitle10 } from "./cleanroom-adapters";
import { TitleCinematicTitle18 } from "./cleanroom-adapters";
import { TitleCinematicTitle17 } from "./cleanroom-adapters";
import { TitleCinematicTitle21 } from "./cleanroom-adapters";
import { TitleCinematicTitle20 } from "./cleanroom-adapters";
import { TitleCinematicTitle19 } from "./cleanroom-adapters";
import { SubCleanCallout01 } from "./cleanroom-adapters";
import { TitleCinematicTitle22 } from "./cleanroom-adapters";
import { SubCleanCallout02 } from "./cleanroom-adapters";
import { SubCredits02 } from "./cleanroom-adapters";
import { SubCredits01 } from "./cleanroom-adapters";
import { SubDescription04 } from "./cleanroom-adapters";
import { SubDescription02 } from "./cleanroom-adapters";
import { SubDescription01 } from "./cleanroom-adapters";
import { SubDescription03 } from "./cleanroom-adapters";
import { SubDetails } from "./cleanroom-adapters";
import { TitleDynamic } from "./cleanroom-adapters";
import { TitleKineticTitle02 } from "./cleanroom-adapters";
import { TitleKineticTitle01 } from "./cleanroom-adapters";
import { TitleGrain } from "./cleanroom-adapters";
import { TitleKineticTitle05 } from "./cleanroom-adapters";
import { TitleKineticTitle04 } from "./cleanroom-adapters";
import { TitleKineticTitle06 } from "./cleanroom-adapters";
import { TitleKineticTitle03 } from "./cleanroom-adapters";
import { TitleKineticTitle07 } from "./cleanroom-adapters";
import { TitleKineticTitle08 } from "./cleanroom-adapters";
import { TitleKineticTitle09 } from "./cleanroom-adapters";
import { TitleKineticTitle12 } from "./cleanroom-adapters";
import { TitleKineticTitle11 } from "./cleanroom-adapters";
import { TitleKineticTitle13 } from "./cleanroom-adapters";
import { TitleKineticTitle10 } from "./cleanroom-adapters";
import { TitleKineticTitle14 } from "./cleanroom-adapters";
import { TitleKineticTitle15 } from "./cleanroom-adapters";
import { TitleKineticTitle16 } from "./cleanroom-adapters";
import { TitleKineticTitle18 } from "./cleanroom-adapters";
import { TitleKineticTitle17 } from "./cleanroom-adapters";
import { TitleKineticTitle20 } from "./cleanroom-adapters";
import { TitleKineticTitle21 } from "./cleanroom-adapters";
import { TitleKineticTitle22 } from "./cleanroom-adapters";
import { TitleKineticTitle19 } from "./cleanroom-adapters";
import { TitleKineticTitle23 } from "./cleanroom-adapters";
import { TitleKineticTitle24 } from "./cleanroom-adapters";
import { TitleKineticTitle25 } from "./cleanroom-adapters";
import { TitleKineticTitle26 } from "./cleanroom-adapters";
import { TitleKineticTitle28 } from "./cleanroom-adapters";
import { TitleKineticTitle27 } from "./cleanroom-adapters";
import { TitleKineticTitle29 } from "./cleanroom-adapters";
import { TitleKineticTitle30 } from "./cleanroom-adapters";
import { SubMusicVideoLower3rd } from "./cleanroom-adapters";
import { TitleMusicVideoTitle } from "./cleanroom-adapters";
import { SubRetroMusicVideoLower3rd } from "./cleanroom-adapters";
import { SubSubtitle02 } from "./cleanroom-adapters";
import { TitleRetroMusicVideoTitle } from "./cleanroom-adapters";
import { SubSubtitle01 } from "./cleanroom-adapters";
import { SubSubtitle05 } from "./cleanroom-adapters";
import { SubSubtitle04 } from "./cleanroom-adapters";
import { SubSubtitle03 } from "./cleanroom-adapters";
import { TitleTech01 } from "./cleanroom-adapters";
import { TitleTech02 } from "./cleanroom-adapters";
import { TitleTech04 } from "./cleanroom-adapters";
import { TitleTech03 } from "./cleanroom-adapters";
import { TitleTech05 } from "./cleanroom-adapters";
import { TitleTech06 } from "./cleanroom-adapters";
import { TitleEffect01 } from "./cleanroom-adapters";
import { TitleTech07 } from "./cleanroom-adapters";
import { TitleEffect02 } from "./cleanroom-adapters";
import { TitleEffect03 } from "./cleanroom-adapters";
import { TitleTypography01 } from "./cleanroom-adapters";
import { TitleEffect05 } from "./cleanroom-adapters";
import { TitleEffect04 } from "./cleanroom-adapters";
import { TitleEffect06 } from "./cleanroom-adapters";
import { TitleTypography02 } from "./cleanroom-adapters";
import { TitleTypography03 } from "./cleanroom-adapters";
import { TitleTypography04 } from "./cleanroom-adapters";
import { FxBlur } from "./cleanroom-adapters";
import { FxBurnEffect } from "./cleanroom-adapters";
import { FxCamera } from "./cleanroom-adapters";
import { FxColorFilter } from "./cleanroom-adapters";
import { FxDirtsAndScratches } from "./cleanroom-adapters";
import { FxDreamyLook } from "./cleanroom-adapters";
import { FxHandheld } from "./cleanroom-adapters";
import { FxPrism } from "./cleanroom-adapters";
import { FxRetroLook } from "./cleanroom-adapters";
import { FxDistortedShake } from "./cleanroom-adapters";
import { FxStutterEffect } from "./cleanroom-adapters";
import { FxDistortion02 } from "./cleanroom-adapters";
import { FxDistortion03 } from "./cleanroom-adapters";
import { FxDistortion01 } from "./cleanroom-adapters";
import { FxDistortion05 } from "./cleanroom-adapters";
import { FxDistortion07 } from "./cleanroom-adapters";
import { FxDistortion09 } from "./cleanroom-adapters";
import { FxDistortion04 } from "./cleanroom-adapters";
import { FxDistortion06 } from "./cleanroom-adapters";
import { FxDizzy } from "./cleanroom-adapters";
import { FxDistortion08 } from "./cleanroom-adapters";
import { FxDreamBlur } from "./cleanroom-adapters";
import { FxDropZonesEcho } from "./cleanroom-adapters";
import { FxFakeRobotArm } from "./cleanroom-adapters";
import { FxSplitScreenLetterbox } from "./cleanroom-adapters";
import { FxMovieLight } from "./cleanroom-adapters";
import { FxSplitScreen } from "./cleanroom-adapters";
import { FxMultiSplitScreen } from "./cleanroom-adapters";
import { FxSplitScreenFrame } from "./cleanroom-adapters";
import { FxFilmGrunge } from "./cleanroom-adapters";
import { FxFeelTheBeatModule } from "./cleanroom-adapters";
import { FxEdgeGleam } from "./cleanroom-adapters";
import { FxFilmMatte03 } from "./cleanroom-adapters";
import { FxFilmMatte02 } from "./cleanroom-adapters";
import { FxFastRotation } from "./cleanroom-adapters";
import { FxFilmMatte05 } from "./cleanroom-adapters";
import { FxFisheyeLens } from "./cleanroom-adapters";
import { FxFilmEmulation } from "./cleanroom-adapters";
import { FxFilmMatte08 } from "./cleanroom-adapters";
import { FxFilmMatte04 } from "./cleanroom-adapters";
import { FxFilmMatte07 } from "./cleanroom-adapters";
import { FxFisheye } from "./cleanroom-adapters";
import { FxFilmMatte06 } from "./cleanroom-adapters";
import { FxFootageClones01 } from "./cleanroom-adapters";
import { FxGlitchFilmReel } from "./cleanroom-adapters";
import { FxGlowingEdges } from "./cleanroom-adapters";
import { FxGhosting } from "./cleanroom-adapters";
import { FxFrame } from "./cleanroom-adapters";
import { FxFootageClones02 } from "./cleanroom-adapters";
import { FxGhostingEffect } from "./cleanroom-adapters";
import { FxGradientColorize } from "./cleanroom-adapters";
import { FxFilmMatte01 } from "./cleanroom-adapters";
import { FxHandhelds } from "./cleanroom-adapters";
import { FxLightStroboscope } from "./cleanroom-adapters";
import { FxLightLeaks } from "./cleanroom-adapters";
import { FxGrayscaleFilmRoll } from "./cleanroom-adapters";
import { FxLumaBlur } from "./cleanroom-adapters";
import { FxMonoColor } from "./cleanroom-adapters";
import { FxHalftone } from "./cleanroom-adapters";
import { FxMusicVideoModule01 } from "./cleanroom-adapters";
import { FxMusicVideoModule02 } from "./cleanroom-adapters";
import { FxMusicVideoModule03 } from "./cleanroom-adapters";
import { FxPhotoSlideshow01 } from "./cleanroom-adapters";
import { FxPermeation } from "./cleanroom-adapters";
import { FxPhotoSlideshow03 } from "./cleanroom-adapters";
import { FxPhotoSlideshow02 } from "./cleanroom-adapters";
import { FxPhotoSlideshow04 } from "./cleanroom-adapters";
import { FxPixelSorting } from "./cleanroom-adapters";
import { FxPunch } from "./cleanroom-adapters";
import { FxPrismBlur } from "./cleanroom-adapters";
import { FxRefraction } from "./cleanroom-adapters";
import { FxQuakeZoom } from "./cleanroom-adapters";
import { FxRetroMusicVideoModule01 } from "./cleanroom-adapters";
import { FxRetroMusicVideoModule03 } from "./cleanroom-adapters";
import { FxRetroMusicVideoModule02 } from "./cleanroom-adapters";
import { FxRetroMusicVideoModule04 } from "./cleanroom-adapters";
import { FxRetroMusicVideoModule05 } from "./cleanroom-adapters";
import { FxShakeZoom } from "./cleanroom-adapters";
import { FxSlideshow } from "./cleanroom-adapters";
import { FxVerticalStreak } from "./cleanroom-adapters";
import { FxRollingSlides } from "./cleanroom-adapters";
import { FxSoftFocusColorLook } from "./cleanroom-adapters";
import { FxVintage01 } from "./cleanroom-adapters";
import { FxViewfinder } from "./cleanroom-adapters";
import { FxVintage02 } from "./cleanroom-adapters";
import { FxVintage04 } from "./cleanroom-adapters";
import { FxVintage03 } from "./cleanroom-adapters";
import { FxVintage05 } from "./cleanroom-adapters";
import { FxVintage06 } from "./cleanroom-adapters";
import { FxVintage07 } from "./cleanroom-adapters";
import { FxVintage09 } from "./cleanroom-adapters";
import { FxWalkingZoomIn } from "./cleanroom-adapters";
import { FxVintage08 } from "./cleanroom-adapters";
import { FxVintage10 } from "./cleanroom-adapters";
import { FxVisionEmulations } from "./cleanroom-adapters";
import { FxVintage11 } from "./cleanroom-adapters";
import { FxBouncingStroke } from "./cleanroom-adapters";
import { FxMusicVideo } from "./cleanroom-adapters";
import { FxRetroMusicVideo } from "./cleanroom-adapters";

export interface XpTransitionProps {
  from: React.ReactNode;
  to: React.ReactNode;
  durationInFrames: number;
}

/** 素id（プレフィックス無し）→ 生トランジションコンポーネント */
export const XP_TRANSITION_COMPONENTS: Record<string, React.FC<XpTransitionProps>> = {
  "tx-cross-fade": TxCrossFade,
  "tx-blur-cut": TxBlurCut,
  "tx-burn": TxBurn,
  "tx-camera-shake": TxCameraShake,
  "tx-custom-mask": TxCustomMask,
  "tx-dissolve": TxDissolve,
  "tx-double-exposure": TxDoubleExposure,
  "tx-double-whip-pan": TxDoubleWhipPan,
  "tx-echo": TxEcho,
  "tx-echo-flash": TxEchoFlash,
  "tx-expire": TxExpire,
  "tx-fade": TxFade,
  "tx-film-burn": TxFilmBurn,
  "tx-film-change": TxFilmChange,
  "tx-film-marks": TxFilmMarks,
  "tx-film-melt": TxFilmMelt,
  "tx-film-slide": TxFilmSlide,
  "tx-film-stain": TxFilmStain,
  "tx-flash": TxFlash,
  "tx-flash-slide": TxFlashSlide,
  "tx-flash-zoom": TxFlashZoom,
  "tx-flicker": TxFlicker,
  "tx-flicker-flare": TxFlickerFlare,
  "tx-footage-roll": TxFootageRoll,
  "tx-frame-drop": TxFrameDrop,
  "tx-glass-distortion": TxGlassDistortion,
  "tx-gyre": TxGyre,
  "tx-ignite": TxIgnite,
  "tx-jitter": TxJitter,
  "tx-light-leak": TxLightLeak,
  "tx-light-speed": TxLightSpeed,
  "tx-light-whip": TxLightWhip,
  "tx-luma-blink": TxLumaBlink,
  "tx-music-video-transition": TxMusicVideoTransition,
  "tx-negative-flash": TxNegativeFlash,
  "tx-negative-flashes": TxNegativeFlashes,
  "tx-noise": TxNoise,
  "tx-overdrive": TxOverdrive,
  "tx-overexposure-01": TxOverexposure01,
  "tx-overexposure-02": TxOverexposure02,
  "tx-play-glitch": TxPlayGlitch,
  "tx-quake": TxQuake,
  "tx-scrape-01": TxScrape01,
  "tx-shade": TxShade,
  "tx-shadow-whip": TxShadowWhip,
  "tx-smear": TxSmear,
  "tx-speed-flash": TxSpeedFlash,
  "tx-spin": TxSpin,
  "tx-static": TxStatic,
  "tx-still-frame": TxStillFrame,
  "tx-stretch": TxStretch,
  "tx-strike": TxStrike,
  "tx-swoosh": TxSwoosh,
  "tx-tape-glitch": TxTapeGlitch,
  "tx-tug": TxTug,
  "tx-vacuum": TxVacuum,
  "tx-whip-pan": TxWhipPan,
  "tx-zoom-02": TxZoom02,
  "tx-zoom-fade": TxZoomFade,
  "tx-zoom-03": TxZoom03,
  "tx-color-blur-left": TxColorBlurLeft,
  "tx-color-blur-down": TxColorBlurDown,
  "tx-blur": TxBlur,
  "tx-bulge-up": TxBulgeUp,
  "tx-aura": TxAura,
  "tx-bulge-left": TxBulgeLeft,
  "tx-bulge-right": TxBulgeRight,
  "tx-bulge-down": TxBulgeDown,
  "tx-color-blur-up": TxColorBlurUp,
  "tx-color-blur-right": TxColorBlurRight,
  "tx-custom-shade": TxCustomShade,
  "tx-distort-horizontally": TxDistortHorizontally,
  "tx-distort-vertically": TxDistortVertically,
  "tx-desaturate": TxDesaturate,
  "tx-custom-surge-backward": TxCustomSurgeBackward,
  "tx-custom-surge-forward": TxCustomSurgeForward,
  "tx-drift-down": TxDriftDown,
  "tx-fast-forward": TxFastForward,
  "tx-film-burn-right": TxFilmBurnRight,
  "tx-drift-right": TxDriftRight,
  "tx-film-burn-left": TxFilmBurnLeft,
  "tx-drift-up": TxDriftUp,
  "tx-drift-left": TxDriftLeft,
  "tx-film-burn-down": TxFilmBurnDown,
  "tx-film-burn-up": TxFilmBurnUp,
  "tx-film-scribble-left": TxFilmScribbleLeft,
  "tx-film-scribble-down": TxFilmScribbleDown,
  "tx-film-scribble-right": TxFilmScribbleRight,
  "tx-film-scribble-up": TxFilmScribbleUp,
  "tx-flash-left": TxFlashLeft,
  "tx-flash-down": TxFlashDown,
  "tx-flash-up": TxFlashUp,
  "tx-flash-right": TxFlashRight,
  "tx-illuminate": TxIlluminate,
  "tx-melt-down": TxMeltDown,
  "tx-melt-right": TxMeltRight,
  "tx-melt-left": TxMeltLeft,
  "tx-noise-dissolve": TxNoiseDissolve,
  "tx-melt-up": TxMeltUp,
  "tx-overexpose-down": TxOverexposeDown,
  "tx-overexpose-right": TxOverexposeRight,
  "tx-overexpose-left": TxOverexposeLeft,
  "tx-overexpose-up": TxOverexposeUp,
  "tx-parallax-left": TxParallaxLeft,
  "tx-parallax-up": TxParallaxUp,
  "tx-parallax-down": TxParallaxDown,
  "tx-pixellate": TxPixellate,
  "tx-revolve-left": TxRevolveLeft,
  "tx-revolve-right": TxRevolveRight,
  "tx-parallax-right": TxParallaxRight,
  "tx-ripple": TxRipple,
  "tx-roll-down": TxRollDown,
  "tx-shade-down": TxShadeDown,
  "tx-scrape-02": TxScrape02,
  "tx-roll-right": TxRollRight,
  "tx-roll-up": TxRollUp,
  "tx-shade-left": TxShadeLeft,
  "tx-roll-left": TxRollLeft,
  "tx-shade-right": TxShadeRight,
  "tx-shift-down": TxShiftDown,
  "tx-shade-up": TxShadeUp,
  "tx-shift-left": TxShiftLeft,
  "tx-shift-right": TxShiftRight,
  "tx-shift-up": TxShiftUp,
  "tx-x-ray-down": TxXRayDown,
  "tx-zoom-01": TxZoom01,
  "tx-x-ray-up": TxXRayUp,
  "tx-x-ray-left": TxXRayLeft,
  "tx-x-ray-right": TxXRayRight,
};

export interface XpTitleProps {
  text: string;
  durationInFrames: number;
  fontSize?: number;
  fontFamily?: string;
  /** 文字色。未指定=デザイン既定（cleanroom家族部品が color prop として解釈） */
  color?: string;
  /** 行（\n）単位のスタイル上書き。index=描画行。未指定行は color→デザイン既定の順でフォールバック */
  lineStyles?: { color?: string }[];
  /** 背景。クレジット等のオーバーレイ用途では "transparent" を渡す。未指定=デザイン既定 */
  background?: string;
}

/** 素id → 生タイトルコンポーネント（title/subtitle。タイトル/クレジットレーンで共用） */
export const XP_TITLE_COMPONENTS: Record<string, React.FC<XpTitleProps>> = {
  "title-signal-glitch-01": TitleSignalGlitch01,
  "title-signal-glitch-02": TitleSignalGlitch02,
  "title-signal-glitch-03": TitleSignalGlitch03,
  "title-signal-glitch-04": TitleSignalGlitch04,
  "title-signal-glitch-05": TitleSignalGlitch05,
  "title-signal-glitch-06": TitleSignalGlitch06,
  "title-signal-glitch-07": TitleSignalGlitch07,
  "title-signal-glitch-08": TitleSignalGlitch08,
  "title-signal-glitch-09": TitleSignalGlitch09,
  "title-signal-glitch-10": TitleSignalGlitch10,
  "title-signal-glitch-11": TitleSignalGlitch11,
  "title-signal-glitch-12": TitleSignalGlitch12,
  "title-signal-glitch-13": TitleSignalGlitch13,
  "title-signal-glitch-14": TitleSignalGlitch14,
  "title-signal-glitch-15": TitleSignalGlitch15,
  "title-signal-glitch-16": TitleSignalGlitch16,
  "title-signal-glitch-17": TitleSignalGlitch17,
  "title-signal-glitch-18": TitleSignalGlitch18,
  "title-signal-glitch-19": TitleSignalGlitch19,
  "title-signal-glitch-20": TitleSignalGlitch20,
  "title-signal-glitch-21": TitleSignalGlitch21,
  "title-signal-glitch-22": TitleSignalGlitch22,
  "title-signal-glitch-23": TitleSignalGlitch23,
  "title-signal-glitch-24": TitleSignalGlitch24,
  "title-signal-glitch-25": TitleSignalGlitch25,
  "title-signal-glitch-26": TitleSignalGlitch26,
  "sub-subtitle-06": SubSubtitle06,
  "sub-subtitle-07": SubSubtitle07,
  "sub-subtitle-08": SubSubtitle08,
  "sub-subtitle-09": SubSubtitle09,
  "sub-subtitle-10": SubSubtitle10,
  "sub-subtitle-11": SubSubtitle11,
  "sub-subtitle-12": SubSubtitle12,
  "sub-subtitle-13": SubSubtitle13,
  "sub-subtitle-14": SubSubtitle14,
  "sub-subtitle-15": SubSubtitle15,
  "sub-subtitle-16": SubSubtitle16,
  "sub-subtitle-17": SubSubtitle17,
  "sub-subtitle-18": SubSubtitle18,
  "sub-subtitle-19": SubSubtitle19,
  "sub-subtitle-20": SubSubtitle20,
  "sub-subtitle-21": SubSubtitle21,
  "sub-subtitle-22": SubSubtitle22,
  "sub-subtitle-23": SubSubtitle23,
  "sub-subtitle-24": SubSubtitle24,
  "sub-subtitle-25": SubSubtitle25,
  "sub-subtitle-26": SubSubtitle26,
  "sub-subtitle-27": SubSubtitle27,
  "sub-subtitle-28": SubSubtitle28,
  "sub-subtitle-29": SubSubtitle29,
  "sub-subtitle-30": SubSubtitle30,
  "sub-subtitle-31": SubSubtitle31,
  "sub-subtitle-32": SubSubtitle32,
  "sub-subtitle-33": SubSubtitle33,
  "sub-subtitle-34": SubSubtitle34,
  "sub-subtitle-35": SubSubtitle35,
  "sub-subtitle-36": SubSubtitle36,
  "sub-subtitle-37": SubSubtitle37,
  "sub-subtitle-38": SubSubtitle38,
  "sub-subtitle-39": SubSubtitle39,
  "sub-subtitle-40": SubSubtitle40,
  "sub-subtitle-41": SubSubtitle41,
  "sub-subtitle-42": SubSubtitle42,
  "sub-subtitle-43": SubSubtitle43,
  "sub-subtitle-44": SubSubtitle44,
  "sub-subtitle-45": SubSubtitle45,
  "sub-subtitle-46": SubSubtitle46,
  "sub-subtitle-47": SubSubtitle47,
  "sub-subtitle-48": SubSubtitle48,
  "title-artistic-01": TitleArtistic01,
  "title-artistic-03": TitleArtistic03,
  "title-artistic-02": TitleArtistic02,
  "title-artistic-04": TitleArtistic04,
  "title-artistic-06": TitleArtistic06,
  "title-artistic-05": TitleArtistic05,
  "title-basic-movements": TitleBasicMovements,
  "title-artistic-07": TitleArtistic07,
  "title-cinematic-title-01": TitleCinematicTitle01,
  "title-cinematic-title-02": TitleCinematicTitle02,
  "title-cinematic-title-04": TitleCinematicTitle04,
  "title-cinematic-title-06": TitleCinematicTitle06,
  "title-cinematic-title-05": TitleCinematicTitle05,
  "title-cinematic-title-07": TitleCinematicTitle07,
  "title-cinematic-title-09": TitleCinematicTitle09,
  "title-cinematic-title-03": TitleCinematicTitle03,
  "title-cinematic-title-08": TitleCinematicTitle08,
  "title-cinematic-title-11": TitleCinematicTitle11,
  "title-cinematic-title-13": TitleCinematicTitle13,
  "title-cinematic-title-12": TitleCinematicTitle12,
  "title-cinematic-title-14": TitleCinematicTitle14,
  "title-cinematic-title-15": TitleCinematicTitle15,
  "title-cinematic-title-16": TitleCinematicTitle16,
  "title-cinematic-title-10": TitleCinematicTitle10,
  "title-cinematic-title-18": TitleCinematicTitle18,
  "title-cinematic-title-17": TitleCinematicTitle17,
  "title-cinematic-title-21": TitleCinematicTitle21,
  "title-cinematic-title-20": TitleCinematicTitle20,
  "title-cinematic-title-19": TitleCinematicTitle19,
  "sub-clean-callout-01": SubCleanCallout01,
  "title-cinematic-title-22": TitleCinematicTitle22,
  "sub-clean-callout-02": SubCleanCallout02,
  "sub-credits-02": SubCredits02,
  "sub-credits-01": SubCredits01,
  "sub-description-04": SubDescription04,
  "sub-description-02": SubDescription02,
  "sub-description-01": SubDescription01,
  "sub-description-03": SubDescription03,
  "sub-details": SubDetails,
  "title-dynamic": TitleDynamic,
  "title-kinetic-title-02": TitleKineticTitle02,
  "title-kinetic-title-01": TitleKineticTitle01,
  "title-grain": TitleGrain,
  "title-kinetic-title-05": TitleKineticTitle05,
  "title-kinetic-title-04": TitleKineticTitle04,
  "title-kinetic-title-06": TitleKineticTitle06,
  "title-kinetic-title-03": TitleKineticTitle03,
  "title-kinetic-title-07": TitleKineticTitle07,
  "title-kinetic-title-08": TitleKineticTitle08,
  "title-kinetic-title-09": TitleKineticTitle09,
  "title-kinetic-title-12": TitleKineticTitle12,
  "title-kinetic-title-11": TitleKineticTitle11,
  "title-kinetic-title-13": TitleKineticTitle13,
  "title-kinetic-title-10": TitleKineticTitle10,
  "title-kinetic-title-14": TitleKineticTitle14,
  "title-kinetic-title-15": TitleKineticTitle15,
  "title-kinetic-title-16": TitleKineticTitle16,
  "title-kinetic-title-18": TitleKineticTitle18,
  "title-kinetic-title-17": TitleKineticTitle17,
  "title-kinetic-title-20": TitleKineticTitle20,
  "title-kinetic-title-21": TitleKineticTitle21,
  "title-kinetic-title-22": TitleKineticTitle22,
  "title-kinetic-title-19": TitleKineticTitle19,
  "title-kinetic-title-23": TitleKineticTitle23,
  "title-kinetic-title-24": TitleKineticTitle24,
  "title-kinetic-title-25": TitleKineticTitle25,
  "title-kinetic-title-26": TitleKineticTitle26,
  "title-kinetic-title-28": TitleKineticTitle28,
  "title-kinetic-title-27": TitleKineticTitle27,
  "title-kinetic-title-29": TitleKineticTitle29,
  "title-kinetic-title-30": TitleKineticTitle30,
  "sub-music-video-lower3rd": SubMusicVideoLower3rd,
  "title-music-video-title": TitleMusicVideoTitle,
  "sub-retro-music-video-lower3rd": SubRetroMusicVideoLower3rd,
  "sub-subtitle-02": SubSubtitle02,
  "title-retro-music-video-title": TitleRetroMusicVideoTitle,
  "sub-subtitle-01": SubSubtitle01,
  "sub-subtitle-05": SubSubtitle05,
  "sub-subtitle-04": SubSubtitle04,
  "sub-subtitle-03": SubSubtitle03,
  "title-tech-01": TitleTech01,
  "title-tech-02": TitleTech02,
  "title-tech-04": TitleTech04,
  "title-tech-03": TitleTech03,
  "title-tech-05": TitleTech05,
  "title-tech-06": TitleTech06,
  "title-effect-01": TitleEffect01,
  "title-tech-07": TitleTech07,
  "title-effect-02": TitleEffect02,
  "title-effect-03": TitleEffect03,
  "title-typography-01": TitleTypography01,
  "title-effect-05": TitleEffect05,
  "title-effect-04": TitleEffect04,
  "title-effect-06": TitleEffect06,
  "title-typography-02": TitleTypography02,
  "title-typography-03": TitleTypography03,
  "title-typography-04": TitleTypography04,
};

export interface XpOverlayProps {
  children: React.ReactNode;
  durationInFrames: number;
  intensity?: number;
  /** 基調色の差し替え（対応ポートのみ。未指定=デザイン既定） */
  tint?: string;
}

/** 素id → 生オーバーレイコンポーネント（category=effect・children有。FxStack が絵を包んで上に重ねる） */
export const XP_OVERLAY_COMPONENTS: Record<string, React.FC<XpOverlayProps>> = {
  "fx-blur": FxBlur,
  "fx-burn-effect": FxBurnEffect,
  "fx-camera": FxCamera,
  "fx-color-filter": FxColorFilter,
  "fx-dirts-and-scratches": FxDirtsAndScratches,
  "fx-dreamy-look": FxDreamyLook,
  "fx-handheld": FxHandheld,
  "fx-prism": FxPrism,
  "fx-retro-look": FxRetroLook,
  "fx-distorted-shake": FxDistortedShake,
  "fx-stutter-effect": FxStutterEffect,
  "fx-distortion-02": FxDistortion02,
  "fx-distortion-03": FxDistortion03,
  "fx-distortion-01": FxDistortion01,
  "fx-distortion-05": FxDistortion05,
  "fx-distortion-07": FxDistortion07,
  "fx-distortion-09": FxDistortion09,
  "fx-distortion-04": FxDistortion04,
  "fx-distortion-06": FxDistortion06,
  "fx-dizzy": FxDizzy,
  "fx-distortion-08": FxDistortion08,
  "fx-dream-blur": FxDreamBlur,
  "fx-drop-zones-echo": FxDropZonesEcho,
  "fx-fake-robot-arm": FxFakeRobotArm,
  "fx-split-screen-letterbox": FxSplitScreenLetterbox,
  "fx-movie-light": FxMovieLight,
  "fx-split-screen": FxSplitScreen,
  "fx-multi-split-screen": FxMultiSplitScreen,
  "fx-split-screen-frame": FxSplitScreenFrame,
  "fx-film-grunge": FxFilmGrunge,
  "fx-feel-the-beat-module": FxFeelTheBeatModule,
  "fx-edge-gleam": FxEdgeGleam,
  "fx-film-matte-03": FxFilmMatte03,
  "fx-film-matte-02": FxFilmMatte02,
  "fx-fast-rotation": FxFastRotation,
  "fx-film-matte-05": FxFilmMatte05,
  "fx-fisheye-lens": FxFisheyeLens,
  "fx-film-emulation": FxFilmEmulation,
  "fx-film-matte-08": FxFilmMatte08,
  "fx-film-matte-04": FxFilmMatte04,
  "fx-film-matte-07": FxFilmMatte07,
  "fx-fisheye": FxFisheye,
  "fx-film-matte-06": FxFilmMatte06,
  "fx-footage-clones-01": FxFootageClones01,
  "fx-glitch-film-reel": FxGlitchFilmReel,
  "fx-glowing-edges": FxGlowingEdges,
  "fx-ghosting": FxGhosting,
  "fx-frame": FxFrame,
  "fx-footage-clones-02": FxFootageClones02,
  "fx-ghosting-effect": FxGhostingEffect,
  "fx-gradient-colorize": FxGradientColorize,
  "fx-film-matte-01": FxFilmMatte01,
  "fx-handhelds": FxHandhelds,
  "fx-light-stroboscope": FxLightStroboscope,
  "fx-light-leaks": FxLightLeaks,
  "fx-grayscale-film-roll": FxGrayscaleFilmRoll,
  "fx-luma-blur": FxLumaBlur,
  "fx-mono-color": FxMonoColor,
  "fx-halftone": FxHalftone,
  "fx-music-video-module-01": FxMusicVideoModule01,
  "fx-music-video-module-02": FxMusicVideoModule02,
  "fx-music-video-module-03": FxMusicVideoModule03,
  "fx-photo-slideshow-01": FxPhotoSlideshow01,
  "fx-permeation": FxPermeation,
  "fx-photo-slideshow-03": FxPhotoSlideshow03,
  "fx-photo-slideshow-02": FxPhotoSlideshow02,
  "fx-photo-slideshow-04": FxPhotoSlideshow04,
  "fx-pixel-sorting": FxPixelSorting,
  "fx-punch": FxPunch,
  "fx-prism-blur": FxPrismBlur,
  "fx-refraction": FxRefraction,
  "fx-quake-zoom": FxQuakeZoom,
  "fx-retro-music-video-module-01": FxRetroMusicVideoModule01,
  "fx-retro-music-video-module-03": FxRetroMusicVideoModule03,
  "fx-retro-music-video-module-02": FxRetroMusicVideoModule02,
  "fx-retro-music-video-module-04": FxRetroMusicVideoModule04,
  "fx-retro-music-video-module-05": FxRetroMusicVideoModule05,
  "fx-shake-zoom": FxShakeZoom,
  "fx-slideshow": FxSlideshow,
  "fx-vertical-streak": FxVerticalStreak,
  "fx-rolling-slides": FxRollingSlides,
  "fx-soft-focus-color-look": FxSoftFocusColorLook,
  "fx-vintage-01": FxVintage01,
  "fx-viewfinder": FxViewfinder,
  "fx-vintage-02": FxVintage02,
  "fx-vintage-04": FxVintage04,
  "fx-vintage-03": FxVintage03,
  "fx-vintage-05": FxVintage05,
  "fx-vintage-06": FxVintage06,
  "fx-vintage-07": FxVintage07,
  "fx-vintage-09": FxVintage09,
  "fx-walking-zoom-in": FxWalkingZoomIn,
  "fx-vintage-08": FxVintage08,
  "fx-vintage-10": FxVintage10,
  "fx-vision-emulations": FxVisionEmulations,
  "fx-vintage-11": FxVintage11,
};

export interface XpGeneratorProps {
  durationInFrames: number;
}

/** 素id → 生ジェネレータコンポーネント（category=effect・children無。透明背景の粒子/線/光を絵の上に置く） */
export const XP_GENERATOR_COMPONENTS: Record<string, React.FC<XpGeneratorProps>> = {
  "fx-bouncing-stroke": FxBouncingStroke,
  "fx-music-video": FxMusicVideo,
  "fx-retro-music-video": FxRetroMusicVideo,
};
