import { z } from "zod";
import { titleCardSchema } from "./schema";

/**
 * クレジットプリセット＝titleCard設定一式（素材id・文言・フォント・色・位置・尺）の作り置き。
 * card は project.json 内の openingCard / line.credit と同一構造なので、差すときは
 * card を複製して置くだけ（新しい直列化は無い）。
 * 内蔵3種は「クレジットの3用途」の叩き台: 冒頭の名刺 / 曲中のアニメOP風 / エンドロール。
 * 使うときに文言・位置を微調整し、名前を付けて保存＝自作プリセット登録（style-packsと同じ運用）。
 */
export const creditPresetSchema = z.object({
  id: z.string(),
  name: z.string(),
  hint: z.string().optional(), // UIに出す一言（どの用途向けか）
  card: titleCardSchema,
});
export type CreditPreset = z.infer<typeof creditPresetSchema>;

export const BUILTIN_CREDIT_PRESETS: CreditPreset[] = [
  {
    id: "meishi-lower3rd",
    name: "冒頭の名刺（アーティスト名＋曲名）",
    hint: "曲頭に5秒。オープニングタイトル向け。1行目=筆記体の名前、以降=大文字テロップ",
    card: titleCardSchema.parse({
      xpId: "sub-retro-music-video-lower3rd", // 左下寄せロワーサード（スロット定義あり）
      text: "Artist Name\nSONG TITLE\nCREATED BY KINO",
      duration: 5, // 名刺の業界水準=3〜7秒
    }),
  },
  // アニメOP風3点セット: 別々の行に1枚ずつ差すと、曲の進行に乗って順番に出て消える。
  // 位置=左下・歌詞の1段上（radioでrenderStill目視調整済み）。残したい時は表示時間つまみを伸ばす
  ...[
    { id: "op-sakushi", name: "OP: 作詞", text: "作詞 KINO" },
    { id: "op-sakkyoku", name: "OP: 作曲", text: "作曲 SUNO" },
    { id: "op-uta", name: "OP: 歌", text: "歌 OBU-NEE" },
  ].map(({ id, name, text }) => ({
    id,
    name,
    hint: "アニメOP風。別々の行に1枚ずつ差すと順番に出て消える（名前は差してから書き換え）",
    card: titleCardSchema.parse({
      xpId: "sub-subtitle-05", // 左流しフェードの1行字幕
      text,
      font: "project", // 曲の全体フォントで馴染ませる
      scale: 0.62,
      offsetX: -31,
      offsetY: 29,
      // duration 0 = 次の行まで（出て消える）
    }),
  })),
  {
    id: "end-roll",
    name: "エンドロール（映画風名簿）",
    hint: "最終行かアウトロ前に。行を足すと名簿が伸びる",
    card: titleCardSchema.parse({
      xpId: "sub-credits-02", // セリフ体2カラム名簿（リーダー線つき）
      text: "作詞 | Kino\n作曲 | Suno\n映像 | MV FORGE",
    }),
  },
];
