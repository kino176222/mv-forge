/**
 * フォント棚（仕様書 §3.5.1「作風の心臓」）。
 * - Google Fonts 13種: @remotion/google-fonts がレンダリング前に読込を自動で待つ
 * - "system:書体名": Macにインストール済みのフォント（Morisawa Fonts等）をそのまま使う
 * メタ情報は lib/fonts-meta.ts（サーバー側からも読めるようRemotion非依存で分離）。
 */
import { loadFont as shippori } from "@remotion/google-fonts/ShipporiMincho";
import { loadFont as zenOld } from "@remotion/google-fonts/ZenOldMincho";
import { loadFont as notoSerif } from "@remotion/google-fonts/NotoSerifJP";
import { loadFont as hinaMincho } from "@remotion/google-fonts/HinaMincho";
import { loadFont as notoSans } from "@remotion/google-fonts/NotoSansJP";
import { loadFont as zenMaru } from "@remotion/google-fonts/ZenMaruGothic";
import { loadFont as yuseiMagic } from "@remotion/google-fonts/YuseiMagic";
import { loadFont as kaiseiDecol } from "@remotion/google-fonts/KaiseiDecol";
import { loadFont as rocknRoll } from "@remotion/google-fonts/RocknRollOne";
import { loadFont as reggae } from "@remotion/google-fonts/ReggaeOne";
import { loadFont as trainOne } from "@remotion/google-fonts/TrainOne";
import { loadFont as dotGothic } from "@remotion/google-fonts/DotGothic16";
import { loadFont as yujiSyuku } from "@remotion/google-fonts/YujiSyuku";
import { FONT_METAS, type FontMeta } from "@/lib/fonts-meta";

export interface FontChoice extends FontMeta {
  family: string;
}

const families: Record<string, string> = {
  "shippori-mincho": shippori().fontFamily,
  "zen-old-mincho": zenOld().fontFamily,
  "noto-serif-jp": notoSerif().fontFamily,
  "hina-mincho": hinaMincho().fontFamily,
  "noto-sans-jp-thin": notoSans().fontFamily,
  "zen-maru-gothic": zenMaru().fontFamily,
  "yusei-magic": yuseiMagic().fontFamily,
  "kaisei-decol": kaiseiDecol().fontFamily,
  "rocknroll-one": rocknRoll().fontFamily,
  "reggae-one": reggae().fontFamily,
  "train-one": trainOne().fontFamily,
  "dot-gothic": dotGothic().fontFamily,
  "yuji-syuku": yujiSyuku().fontFamily,
};

export const FONTS: FontChoice[] = FONT_METAS.map((m) => ({
  ...m,
  family: families[m.id] ?? "sans-serif",
}));

export function fontById(id: string): FontChoice {
  // "system:書体名" = Macにインストール済みのフォント（Morisawa Fonts等）。
  // ローカルレンダリングなのでheadless Chromeからもシステムフォントが見える。
  if (id.startsWith("system:")) {
    const name = id.slice("system:".length);
    return {
      id,
      label: name,
      family: `'${name}'`,
      weight: 500,
      vibe: "システムフォント（Morisawa等）",
    };
  }
  return FONTS.find((f) => f.id === id) ?? FONTS[0];
}
