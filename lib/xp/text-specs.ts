/**
 * 拡張テロップ（subtitle→lyric合流分）の「テキスト書式」定義。
 * 複数スロット持ちのポートは text 1本を独自規約（改行=行 / | =列）でパースするため、
 * どの行に何を入れるかを DetailPanel の分割フォーム（XpTextSlotsForm）に教える。
 *
 * - kind:"slots" … 固定スロット。sep（既定 \n）で joinして text にする。最後のスロットは残り全部を受ける
 * - kind:"rows"  … 可変行×固定列（credits名簿など）。行= \n、列= " | " で組み立てる
 * - kind:"note"  … フォームは出さず注意書きだけ表示（例: テキストは大タイトルのみ置換）
 *
 * ここに無い id は「改行＝行の追加（全行等価）」なので通常の歌詞欄だけで足りる。
 * 定義は素id（xp- 接頭辞なし）。実在検査は scripts/fx-verify-logic.ts。
 */

export interface XpSlotDef {
  label: string;
  placeholder?: string;
  /** 複数行OKのスロット（textarea で出す）。sep が \n の場合は最終スロットのみ可 */
  multiline?: boolean;
}

export type XpTextSpec =
  | { kind: "slots"; sep?: string; slots: XpSlotDef[]; hint?: string }
  | { kind: "rows"; columns: XpSlotDef[]; hint?: string }
  | { kind: "note"; hint: string };

export const XP_TEXT_SPECS: Record<string, XpTextSpec> = {
  // ---- credits系（可変行の名簿） ----
  "sub-credits-02": {
    kind: "rows",
    columns: [
      { label: "役職", placeholder: "作詞" },
      { label: "人名", placeholder: "Kino" },
    ],
    hint: "映画エンドロール風の2カラム名簿。行を足すと名簿が伸びる",
  },
  "sub-credits-01": {
    kind: "rows",
    columns: [
      { label: "役職", placeholder: "DIRECTED BY" },
      { label: "人名", placeholder: "KINO" },
    ],
    hint: "中央のメディア枠を挟む左右クレジット。行ごとに立ち上がる",
  },
  "sub-description-01": {
    kind: "rows",
    columns: [
      { label: "ラベル", placeholder: "Directed by" },
      { label: "氏名", placeholder: "Kino" },
      { label: "ハンドル", placeholder: "@kino" },
    ],
    hint: "3列のクレジット表。列は空欄OK",
  },

  // ---- 見出し＋副題/ラベル系（固定スロット） ----
  "sub-description-02": {
    kind: "slots",
    slots: [
      { label: "見出し（手書き）", placeholder: "Midnight Solaris" },
      { label: "副題", placeholder: "25時のソラリス" },
    ],
  },
  "sub-description-03": {
    kind: "slots",
    slots: [
      { label: "左ラベル", placeholder: "MUSIC" },
      { label: "中央見出し", placeholder: "SOLARIS" },
      { label: "右ラベル", placeholder: "2026" },
    ],
    hint: "下寄せロワーサード。中央→両脇の順に決まる",
  },
  "sub-details": {
    kind: "slots",
    slots: [
      { label: "主タイトル", placeholder: "SOLARIS" },
      { label: "副題", placeholder: "midnight session" },
    ],
  },
  "sub-retro-music-video-lower3rd": {
    kind: "slots",
    slots: [
      { label: "筆記体見出し", placeholder: "Solaris" },
      { label: "テロップ（改行OK）", placeholder: "MIDNIGHT SESSION", multiline: true },
    ],
  },
  "sub-subtitle-17": {
    kind: "slots",
    slots: [
      { label: "極太大文字の行", placeholder: "MIDNIGHT" },
      { label: "黄の筆記体の行", placeholder: "solaris" },
    ],
    hint: "3行以上入れると中央の行が筆記体になる",
  },
  "sub-subtitle-34": {
    kind: "slots",
    sep: "|",
    slots: [
      { label: "輪郭のワイド文字", placeholder: "SOLARIS" },
      { label: "右肩の小ラベル", placeholder: "25:00" },
    ],
  },
  "sub-subtitle-35": {
    kind: "slots",
    sep: "|",
    slots: [
      { label: "白ベタの太字", placeholder: "25時の" },
      { label: "輪郭のワイド文字", placeholder: "ソラリス" },
    ],
  },
};

/** 素id / xp- 接頭辞付きのどちらでも引ける */
export function xpTextSpecById(id: string): XpTextSpec | undefined {
  const bare = id.startsWith("xp-") ? id.slice(3) : id;
  return XP_TEXT_SPECS[bare];
}
