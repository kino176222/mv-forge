/**
 * 書き出しプリセット（§8）。
 * 解像度は inputProps の project.meta.width/height を差し替えるだけで効く
 * （remotion/Root.tsx の calculateMetadata が props に追従するため）。
 * 縦型はテロップの fontSize が絶対px（textStyle.size 基準）のため、
 * 幅が狭くなるぶん textScale で文字サイズを底上げする。
 * クライアント（RenderDialog）とサーバー（render-server）の両方から import するので
 * Node API に依存しないこと。
 */

export type RenderPresetId = "youtube" | "x" | "vertical";

export interface RenderPreset {
  id: RenderPresetId;
  label: string;
  description: string;
  /** null = project.meta の解像度をそのまま使う */
  width: number | null;
  height: number | null;
  /** h264 の CRF（小さいほど高品質・大容量） */
  crf: number;
  /** textStyle.size に掛ける倍率（縦型の文字が小さく見える問題の補正） */
  textScale: number;
  /** 出力ファイル名に付ける識別子（youtube は従来どおり無印） */
  suffix: string;
}

export const RENDER_PRESETS: Record<RenderPresetId, RenderPreset> = {
  youtube: {
    id: "youtube",
    label: "YouTube 1080p（高品質）",
    description: "1920×1080 / CRF17。本命アップロード用",
    width: null,
    height: null,
    crf: 17,
    textScale: 1,
    suffix: "",
  },
  x: {
    id: "x",
    label: "X 軽量 720p",
    description: "1280×720 / CRF23。ポスト添付用の軽いmp4",
    width: 1280,
    height: 720,
    crf: 23,
    textScale: 1,
    suffix: "x720p",
  },
  vertical: {
    id: "vertical",
    label: "縦型 9:16（サビ切り抜き）",
    description: "1080×1920 / CRF18。ショート・リール用（文字サイズ自動補正）",
    width: 1080,
    height: 1920,
    crf: 18,
    textScale: 1.4,
    suffix: "vertical",
  },
};

export function renderPreset(id: string | undefined | null): RenderPreset {
  return RENDER_PRESETS[(id ?? "youtube") as RenderPresetId] ?? RENDER_PRESETS.youtube;
}
