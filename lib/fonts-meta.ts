/** フォントのメタ情報（Remotion非依存。サーバー/AI参謀からも読める） */
export interface FontMeta {
  id: string;
  label: string;
  weight: number;
  vibe: string; // UI表示・AI参謀用の一言
}

export const FONT_METAS: FontMeta[] = [
  { id: "shippori-mincho", label: "しっぽり明朝", weight: 500, vibe: "細明朝。ダーク・文学的・切ない系の本命" },
  { id: "zen-old-mincho", label: "Zen オールド明朝", weight: 400, vibe: "オールドスタイル明朝。レトロで上品" },
  { id: "noto-serif-jp", label: "Noto Serif 明朝", weight: 500, vibe: "王道明朝。バラード・重厚・映画的" },
  { id: "hina-mincho", label: "雛明朝", weight: 400, vibe: "繊細で儚いアンティーク明朝。和・郷愁・ガラス細工" },
  { id: "noto-sans-jp-thin", label: "Noto Sans 極細", weight: 200, vibe: "極細ゴシック。都会的・無機質・現代的" },
  { id: "zen-maru-gothic", label: "Zen丸ゴシック", weight: 500, vibe: "丸ゴシック。優しい・あたたかい・日常系" },
  { id: "yusei-magic", label: "油性マジック", weight: 400, vibe: "マジックペン手書き。青春・部活・等身大の言葉" },
  { id: "kaisei-decol", label: "解星デコール", weight: 400, vibe: "装飾明朝。レトロポップ・大正浪漫・喫茶店" },
  { id: "rocknroll-one", label: "ロックンロール", weight: 400, vibe: "元気な太ゴシック。バンド・疾走・ポップロック" },
  { id: "reggae-one", label: "レゲエ", weight: 400, vibe: "極太で叫ぶ。サビの絶叫・熱量・インパクト" },
  { id: "train-one", label: "トレイン", weight: 400, vibe: "縁取り中抜き文字。ポップ・タイトル向き" },
  { id: "dot-gothic", label: "ドットゴシック", weight: 400, vibe: "レトロゲーム風ドット文字。異界・電脳感" },
  { id: "yuji-syuku", label: "佑字 肅", weight: 400, vibe: "筆文字。和風・呪い・墨の世界観" },
];
