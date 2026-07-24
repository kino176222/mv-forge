import type { DecorRenderer } from "./types";
import { decorBand } from "./decor-band";
import {
  decorBandGrad,
  decorGlass,
  decorPill,
  decorBrush,
  decorStripe,
} from "./bands";
import {
  decorUnderline,
  decorMarker,
  decorUnderlineDash,
  decorSideline,
  decorDoubleLine,
} from "./lines";
import {
  decorBracket,
  decorNeonFrame,
  decorDashFrame,
  decorCornerFrame,
  decorStampCircle,
} from "./frames";
import {
  decorGlowPad,
  decorLongShadow,
  decorSpotlight,
  decorHaloRing,
  decorChromaEdge,
} from "./glow";
import {
  decorTape,
  decorSticky,
  decorLabelTag,
  decorNewspaper,
  decorStickerWhite,
} from "./stickers";
import {
  decorQuotes,
  decorSparkles,
  decorDots,
  decorAngleEmphasis,
  decorFlourish,
} from "./accents";
import { decorNeonScript } from "./script";

/** id → 装飾レンダラー。部品を足したら effects-meta と ここに登録する */
const DECOR_RENDERERS: Record<string, DecorRenderer> = {
  "decor-band": decorBand,
  "decor-band-grad": decorBandGrad,
  "decor-glass": decorGlass,
  "decor-pill": decorPill,
  "decor-brush": decorBrush,
  "decor-stripe": decorStripe,
  "decor-underline": decorUnderline,
  "decor-marker": decorMarker,
  "decor-underline-dash": decorUnderlineDash,
  "decor-sideline": decorSideline,
  "decor-double-line": decorDoubleLine,
  "decor-bracket": decorBracket,
  "decor-neon-frame": decorNeonFrame,
  "decor-dash-frame": decorDashFrame,
  "decor-corner-frame": decorCornerFrame,
  "decor-stamp-circle": decorStampCircle,
  "decor-glow-pad": decorGlowPad,
  "decor-long-shadow": decorLongShadow,
  "decor-spotlight": decorSpotlight,
  "decor-halo-ring": decorHaloRing,
  "decor-chroma-edge": decorChromaEdge,
  "decor-tape": decorTape,
  "decor-sticky": decorSticky,
  "decor-label-tag": decorLabelTag,
  "decor-newspaper": decorNewspaper,
  "decor-sticker-white": decorStickerWhite,
  "decor-quotes": decorQuotes,
  "decor-sparkles": decorSparkles,
  "decor-dots": decorDots,
  "decor-angle-emphasis": decorAngleEmphasis,
  "decor-flourish": decorFlourish,
  "decor-neon-script": decorNeonScript,
};

export const decorById = (id: string): DecorRenderer | undefined =>
  DECOR_RENDERERS[id];
