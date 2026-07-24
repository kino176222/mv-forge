/**
 * プロダクトブランド定数（単一の変更点）。
 * 「MV Forge」は仮ブランド。リネームする時はここだけ変えれば
 * UI表記（図鑑ヘッダ・タイトル等）が一括で切り替わる。
 * ※effect id やルートパス（/xp 等）には使わない（保存プロジェクト互換のため）。
 */
export const BRAND_NAME = "MV Forge";

/**
 * 配布ビルド判定。私用リポジトリでは false。
 * build-dist-package.mjs が配布ツリー生成時に true へ書き換える（この行を直接置換）。
 * 私用専用UI（レビュー台帳・採点バッジ・配布仕分けバッジ・出所フィルタ）を配布で隠す。
 */
export const MVFORGE_DIST = true;

/** 拡張エフェクトパック（旧 拡張群）の表示名 */
export const EXT_PACK_LABEL = `${BRAND_NAME} 拡張`;

/** 自作エフェクト群の表示名（図鑑チップ・カードのパック表記・ピッカーの出所フィルタ共通） */
export const BASE_PACK_LABEL = "基本パック";
