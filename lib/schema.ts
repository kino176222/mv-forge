import { z } from "zod";

/**
 * project.json のスキーマ（仕様書 §7）
 * - schemaVersion: 将来のマイグレーション用（量産で古いファイルが大量に残るため必須）
 * - lines[]: データの原子単位＝歌詞行。image:null は「直前の絵を継続」＝区間の途中行
 * - aiSuggestion: 人間の決定値とは別枠。forImage のハッシュで⚠️スタンプを判定
 */

export const SCHEMA_VERSION = 1;

// ---- エフェクトのインスタンス（プリセットID＋つまみの値） ----
export const effectInstanceSchema = z.object({
  id: z.string(),
  params: z.record(z.string(), z.union([z.number(), z.string()])).default({}),
});
export type EffectInstance = z.infer<typeof effectInstanceSchema>;

// ---- テロップの全体固定スタイル（貼り紙1枚方式） ----
export const textStyleSchema = z.object({
  orientation: z.enum(["horizontal", "vertical"]).default("horizontal"),
  font: z.string().default("shippori-mincho"), // フォントIDは remotion/fonts.ts の数種から
  size: z.number().min(24).max(160).default(54),
  color: z.string().default("#ffffff"),
  strokeColor: z.string().default("#000000"),
  strokeWidth: z.number().min(0).max(12).default(4),
  shadow: z.number().min(0).max(1).default(0.6), // 影の濃さ
  // テロップ位置(%): 横書き=画面下からの高さ / 縦書き=画面右からの距離。
  // 既定7は従来の下部7%/右6%とほぼ同じ見た目（既存プロジェクト維持）。
  // 範囲外(AI提案の暴れ等)は既定へフォールバックし読込を落とさない。描画時はhelperで再クランプ。
  posY: z.number().min(0).max(100).default(7).catch(7),
});
export type TextStyle = z.infer<typeof textStyleSchema>;

// ---- 行ごとのテロップ上書き（キネティックタイポ用） ----
// 全項目optional。未設定(undefined)の項目は meta.textStyle にフォールバックする。
// キーが無ければJSONにも現れない＝旧プロジェクトは無変更で読める（migrate不要）。
// 注意: textStyleSchema.partial() は使わない（zodはoptionalでも .default() を発火させるため、
// 部分上書きが読込時に全項目デフォルト入りへ化けてフォールバックが壊れる）
export const lineTextStyleSchema = z.object({
  orientation: z.enum(["horizontal", "vertical"]).optional(),
  font: z.string().optional(),
  size: z.number().min(24).max(160).optional(),
  color: z.string().optional(),
  strokeColor: z.string().optional(),
  strokeWidth: z.number().min(0).max(12).optional(),
  shadow: z.number().min(0).max(1).optional(),
  // 範囲外（AI提案の暴れ等）は上書き無し扱い＝全体値へフォールバックし読込を落とさない
  posY: z.number().min(0).max(100).optional().catch(undefined),
});
export type LineTextStyle = z.infer<typeof lineTextStyleSchema>; // = Partial<TextStyle>

/** 全体様式に行ごとの上書きをマージ（undefinedの項目は全体値のまま。上書き無しなら同一参照を返す） */
export function mergeTextStyle(
  base: TextStyle,
  override?: LineTextStyle | null,
): TextStyle {
  if (!override) return base;
  const keys = (Object.keys(override) as (keyof TextStyle)[]).filter(
    (k) => override[k] !== undefined,
  );
  if (keys.length === 0) return base;
  const merged: Record<string, unknown> = { ...base };
  for (const k of keys) merged[k] = override[k];
  return merged as TextStyle;
}

// ---- 全体ルック（作品全体の色味・質感。映像編集ソフトの調整レイヤー相当） ----
// effects には look カテゴリ（color-grade / vignette / look-aberration）と
// 流用可の overlay（film-grain / cinescope / glitch-vhs）だけが入る。
// intensity はプリセット全体の効きを一括スケールするマスターつまみ。
export const lookSchema = z.object({
  effects: z.array(effectInstanceSchema).default([]),
  intensity: z.number().min(0).max(1).default(1),
  applyToLyrics: z.boolean().default(true), // 歌詞にも色調整を掛ける（粒子等は常に絵だけ）
  preset: z.string().default(""), // 選択中プリセットID（UI表示用。実体は effects）
});
export type Look = z.infer<typeof lookSchema>;

// ---- スタイルパック（1曲を貫く「見た目の型」） ----
// フォント・色・ルックを1セットに束ね、プロジェクトへ被せる（＝見た目の型）。
// 適用は meta.textStyle / project.look へ流し込む＝適用後も既存つまみで微調整でき、
// 行ごとの上書きは残る（非破壊。元に戻すのは Undo）。
// 動き（テーマ）と濃さ（suggestMode）はパックが檻で縛らず、推奨初期値として持つだけ。
export const stylePackSchema = z.object({
  id: z.string(),
  name: z.string(),
  // 見た目（適用時に meta.textStyle へ部分マージ。未指定キーは現状維持）
  textStyle: lineTextStyleSchema.default({}),
  // パレット（2〜3色。MVPは記録＋UI表示。将来decor/縁色の自動割当に使う）
  palette: z.array(z.string()).default([]),
  lookPreset: z.string().default(""), // look-presets の id（適用で project.look に反映）
  // 推奨初期値（檻ではない。適用時に流し込む出発点で、後から自由に変えられる）
  recommendedTheme: z.string().optional(), // テーマid（lib/themes.ts の手札。適用時の初期値）
  recommendedMode: z.enum(["simple", "standard", "rich"]).optional(), // 演出の濃さの初期値
});
export type StylePack = z.infer<typeof stylePackSchema>;

// ---- AI提案（決定値とは別枠で保管） ----
export const aiSuggestionSchema = z.object({
  effects: z.array(effectInstanceSchema).default([]), // camera+overlay（区間先頭行のみ意味を持つ）
  transition: effectInstanceSchema.nullable().default(null),
  lyricAnim: effectInstanceSchema.nullable().default(null),
  imageFile: z.string().nullable().default(null), // ドラフトモードでの画像割り当て提案
  reason: z.string().default(""),
  // ⚠️スタンプ判定用：提案時に見ていた画像とそのハッシュ（中身差し替えも検知）
  forImage: z
    .object({ file: z.string(), hash: z.string() })
    .nullable()
    .default(null),
  createdAt: z.string().default(""),
});
export type AiSuggestion = z.infer<typeof aiSuggestionSchema>;

// ---- 拡張テロップの行（スロット）単位スタイル ----
// 配列indexは「描画される \n 行」に対応。未設定(undefined)はデザイン既定へフォールバック。
// 全項目optionalなので旧プロジェクトは無変更で読める（migrate不要）
export const slotStyleSchema = z.object({
  color: z.string().optional(), // この行だけの文字色（hex）
});
export type SlotStyle = z.infer<typeof slotStyleSchema>;

// ---- タイトルカード（オープニング/行クレジット/ショットクレジット共用。タイトルデザイン+任意テキスト） ----
export const titleCardSchema = z.object({
  xpId: z.string(), // registry-components XP_TITLE_COMPONENTS の素id
  text: z.string().default(""), // 空ならオープニング=曲名を自動使用
  // ---- つまみ（歌詞テロップの LYRIC_PARAMS と同構成。既定値=従来挙動） ----
  font: z.string().default("design"), // design=ポート原設計 / project=全体フォント / フォントid
  scale: z.number().default(1),
  offsetX: z.number().default(0), // %（画面幅比）
  offsetY: z.number().default(0), // %（画面高比）
  delay: z.number().default(0), // 行頭からの出だし遅れ（秒）
  duration: z.number().default(0), // 表示時間（秒）。0=行末まで
  // 出方・消え方: デザイン自身のアニメとは独立の入退場（0秒=なし＝従来挙動）
  fadeIn: z.number().min(0).default(0), // 入りの長さ（秒）
  fadeOut: z.number().min(0).default(0), // 抜きの長さ（秒）
  enterStyle: z.enum(["fade", "rise", "fall", "blur", "pop"]).default("fade"), // 入り方
  exitStyle: z.enum(["fade", "rise", "fall", "blur", "pop"]).default("fade"), // 抜き方
  color: z.string().default(""), // 文字色。空=デザイン既定（ポートへ渡さない）
  slotStyles: z.array(slotStyleSchema).default([]), // 行（\n）単位の上書き
});
export type TitleCard = z.infer<typeof titleCardSchema>;

// ---- カット（1行の中を複数の絵に割るサブショット） ----
// 不変条件（store側で強制）: cuts.length>0 ⇒ cuts[0].at===0 ∧ cuts[0].image===line.image ∧ at昇順。
// これにより deriveSections の「imageを持つ行=区間の頭」判定は無改修のまま生きる。
export const cutSchema = z.object({
  id: z.string(),
  image: z.string(), // カットは絵を必ず持つ（null継続の概念は持ち込まない）
  i2vSource: z.string().nullable().default(null), // 動画カットのポスター・可逆用
  at: z.number().min(0).default(0), // 区間頭からの開始秒（ビートスナップ可）
  trimStart: z.number().min(0).default(0), // 素材内in点（秒）
  trimEnd: z.number().nullable().default(null), // 素材内out点。null=末尾
  videoLoop: z.enum(["hold", "pingpong"]).default("pingpong"),
  videoRate: z.number().min(0.25).max(2).nullable().default(null),
  videoAnchor: z.enum(["head", "end"]).default("head"),
  // フレーミング（拡大して一部を使う）。エフェクトとは独立の静的な切り取り。
  // 描画時の黒縁ガードは lib/framing.ts（オフセットに必要な分は自動で拡大）
  frameScale: z.number().min(1).max(3).default(1),
  frameX: z.number().min(-50).max(50).default(0), // %
  frameY: z.number().min(-50).max(50).default(0), // %
  // ショットクレジット: このカットの開始タイミングで出すテロップ（作詞/作曲/歌など）。
  // 行クレジット（line.credit）が「行の頭」なのに対し、こちらはカットの頭に同期する
  credit: titleCardSchema.nullable().default(null),
});
export type Cut = z.infer<typeof cutSchema>;

// ---- 単語タイムスタンプ（LRC自動生成時にScribeの認識結果から保存） ----
// start/end は曲内の絶対秒。charFrom/charTo は lyricText 内の表示文字index（両端含む）。
// カラオケ塗りの単語精度化・単語ごと出現・将来の強調語タイミングの土台。
export const lineWordSchema = z.object({
  text: z.string().default(""),
  start: z.number(),
  end: z.number(),
  charFrom: z.number(),
  charTo: z.number(),
});
export type LineWord = z.infer<typeof lineWordSchema>;

// ---- 歌詞行（データの原子単位） ----
export const lineSchema = z.object({
  id: z.string(),
  lyricText: z.string().default(""),
  startTime: z.number(), // LRC由来の秒（尺の背骨。AIも人間も固定値として扱う）
  offset: z.number().default(0), // スナップからのズレ（秒）
  // 単語タイムスタンプ（無ければ空＝行単位フォールバック）
  words: z.array(lineWordSchema).default([]),
  // 歌詞を被写体の後ろに置く（depth.png の輝度マスクで被写体コピーを文字の上に重ねる）
  behindSubject: z.boolean().default(false),
  source: z.enum(["lrc", "manual"]).default("lrc"), // manual＝間奏などに手で打ったマーカー行
  image: z.string().nullable().default(null), // null＝直前の絵を継続（区間の途中行）
  // i2vで動画化したとき、生成元の静止画を覚えておく。動画は「元絵＋動き」なので
  // これがあれば「作り直す」「元の静止画に戻す」が可逆にできる（image が動画のときだけ意味を持つ）
  i2vSource: z.string().nullable().default(null),
  // 動画が区間より短いときの延ばし方。
  // pingpong=往復で繋ぐ（既定。1回流しきったあと末尾から往復＝静止画で終わらない）
  // hold=1回流して最後のコマで静止（カメラが動く素材で折り返しが目立つとき用）
  videoLoop: z.enum(["hold", "pingpong"]).default("pingpong"),
  // ✂️ 動画の使いたい区間（素材内の秒）。start=0 & end=null なら全尺＝従来動作。
  // 「5秒のi2vの良い2秒だけ使う」用。リタイム計算は切り出し尺が基準になる
  videoTrimStart: z.number().min(0).default(0),
  videoTrimEnd: z.number().nullable().default(null),
  // 再生速度の手動指定（null=自動。区間に合わせてリタイム）。0.5未満はコマ送り感に注意
  videoRate: z.number().min(0.25).max(2).nullable().default(null),
  // hold時の動き出し。head=区間の頭から動画スタート（既定。元が動画なら動画で始まる）
  // end=終わりから逆算（歌詞の瞬間に動きが残るよう末尾に寄せる。手前はポスター待機）
  videoAnchor: z.enum(["head", "end"]).default("head"),
  // フレーミング（拡大して一部を使う）。cutSchemaと同型＝Lv.1→Lv.2の単一カット合成で写す
  frameScale: z.number().min(1).max(3).default(1),
  frameX: z.number().min(-50).max(50).default(0), // %
  frameY: z.number().min(-50).max(50).default(0), // %
  effects: z.array(effectInstanceSchema).default([]), // camera 1個＋overlay 複数（区間先頭行が持つ）
  lookOff: z.boolean().default(false), // この区間だけ全体ルックを外す（区間先頭行が持つ）
  transition: effectInstanceSchema.nullable().default(null), // この区間に入るときのつなぎ
  lyricAnim: effectInstanceSchema.nullable().default(null), // 行ごと（出方）
  lyricDecor: effectInstanceSchema.nullable().default(null), // 行ごと（装飾＝座布団等。出方と独立に組み合わせる）
  // この行だけ歌詞テロップを出さない（アウトロのクレジット中など。全体OFFは meta.showLyrics）
  showLyric: z.boolean().default(true),
  // 🅰️ この行だけテロップ様式を上書き（向き/フォント/サイズ/色/縁/影/位置）。
  // 未設定の項目は meta.textStyle にフォールバック（mergeTextStyle）。行単位のキネティックタイポ用
  textStyle: lineTextStyleSchema.optional(),
  // 🎨 拡張テロップ（lyricAnim=xp-*）の行（\n）単位スタイル。index=描画行。
  // キー無し=旧プロジェクト無変更。拡張以外の出方では未使用
  lyricSlotStyles: z.array(slotStyleSchema).optional(),
  // 🔡 文字ごとの個別制御（上級）: i番目の文字への遅れ・変形の上書き
  charFx: z
    .array(
      z.object({
        i: z.number(),
        delay: z.number().default(0), // 秒。登場をこの文字だけ遅らせる
        dx: z.number().default(0),
        dy: z.number().default(0),
        rotate: z.number().default(0),
        scale: z.number().default(1),
      }),
    )
    .default([]),
  // ✂️✂️ カット割り: 1行（の属する区間）の中を複数の絵に割る。空=従来の1区間1絵。
  // 区間頭の行だけが持つ（effects等と同じ扱い）
  cuts: z.array(cutSchema).default([]),
  // 🎬 クレジット差し込み: この行の間、タイトルデザインを重ねて表示（アーティスト名等）
  credit: titleCardSchema.nullable().default(null),
  aiSuggestion: aiSuggestionSchema.nullable().default(null),
});
export type Line = z.infer<typeof lineSchema>;
export type CharFx = Line["charFx"][number];

// ---- プロローグ（詩の朗読） ----
export const prologueSchema = z.object({
  enabled: z.boolean().default(false),
  audioFile: z.string().nullable().default(null), // 例: prologue.wav（外部で完成させて持ち込む）
  duration: z.number().default(0), // 朗読の尺（秒）
  overlapSec: z.number().default(2), // 曲を何秒前から重ねるか（クロスフェード）
  image: z.string().nullable().default(null),
  effects: z.array(effectInstanceSchema).default([]),
  subtitle: z
    .object({
      enabled: z.boolean().default(false),
      // 連(スタンザ)ごと。均等割りが基準で、offset で個別に微調整（入替型表示）
      stanzas: z
        .array(z.object({ text: z.string(), offset: z.number().default(0) }))
        .default([]),
      anim: effectInstanceSchema.nullable().default(null), // v1は本編のlyricAnimを流用
    })
    .default({ enabled: false, stanzas: [], anim: null }),
  // 朗読のTTS生成レシピ（Fish Audio S2-Pro）。採用テイクの再生成・微調整用に保存する
  gen: z
    .object({
      script: z.string().default(""), // タグ入りテキスト
      voiceId: z.string().default(""), // Fish reference_id
      voiceLabel: z.string().default(""),
      temperature: z.number().default(0.75),
      speed: z.number().default(0.9),
      adoptedTake: z.string().default(""), // 採用中テイク（narration/xxx.mp3）
      stsVoiceId: z.string().default(""), // ElevenLabsボイチェン（録音→STS）の声
      stsVoiceLabel: z.string().default(""),
    })
    .default(() => ({
      script: "",
      voiceId: "",
      voiceLabel: "",
      temperature: 0.75,
      speed: 0.9,
      adoptedTake: "",
      stsVoiceId: "",
      stsVoiceLabel: "",
    })),
});
export type Prologue = z.infer<typeof prologueSchema>;

// ---- エンドカード（アウトロのクレジット表示プリセット） ----
export const endCardSchema = z.object({
  // none=自由テキスト（従来のtext/textAnim） / simple=曲名+アーティスト / credits=クレジット / cinema=映画エンド風
  // xp=拡張タイトル（registry-componentsのXP_TITLE_COMPONENTSから選ぶ）
  preset: z.enum(["none", "simple", "credits", "cinema", "xp"]).default("none"),
  songTitle: z.string().default(""), // 空なら meta.title を使う
  artistName: z.string().default(""),
  createdBy: z.string().default(""), // 「Created by ◯◯」の◯◯
  xpId: z.string().nullable().default(null), // preset="xp" のとき使うタイトルの素id
  xpText: z.string().default(""), // 空なら「曲名\nアーティスト」を自動合成
  // ---- つまみ（preset="xp" のとき。titleCardSchema と同構成。既定値=従来挙動） ----
  font: z.string().default("design"), // design=ポート原設計 / project=全体フォント / フォントid
  scale: z.number().default(1),
  offsetX: z.number().default(0), // %（画面幅比）
  offsetY: z.number().default(0), // %（画面高比）
  delay: z.number().default(0), // アウトロ頭からの出だし遅れ（秒）
  duration: z.number().default(0), // 表示時間（秒）。0=従来（アウトロの間ずっと・退場は6秒目）
});
export type EndCard = z.infer<typeof endCardSchema>;

// ---- アウトロ（1枚絵＋エフェクトで余韻。エンドカードのテキストも出せる） ----
export const outroSchema = z.object({
  duration: z.number().default(0),
  image: z.string().nullable().default(null),
  effects: z.array(effectInstanceSchema).default([]),
  lookOff: z.boolean().default(false), // アウトロだけ全体ルックを外す
  text: z.string().default(""), // 例: 「ご視聴ありがとうございました」
  textAnim: effectInstanceSchema.nullable().default(null),
  endCard: endCardSchema.default(() => endCardSchema.parse({})),
});
export type Outro = z.infer<typeof outroSchema>;

// ---- AI参謀の全体アドバイス（不足素材の指摘など） ----
export const aiAdviceSchema = z.object({
  summary: z.string().default(""),
  missingAssets: z
    .array(
      z.object({
        what: z.string(), // 何が足りないか
        prompt: z.string(), // Midjourney等に渡す具体プロンプト
      }),
    )
    .default([]),
  createdAt: z.string().default(""),
});
export type AiAdvice = z.infer<typeof aiAdviceSchema>;

// ---- ショート（縦型9:16切り抜きの「しおり」） ----
// lines[] を行id範囲で参照するだけで曲・絵・歌詞は複製しない（平屋の原則）＝
// 本編を直せばショートにも自動で伝播する。縦で崩れる要素だけを上書きで持つ。
export const shortTextSchema = z.object({
  id: z.string(),
  text: z.string().default(""),
  // 表示位置: top=上部大（掴みコピー）/ topSmall=上部小（曲名常設向け）/ bottom=下部（CTA）
  position: z.enum(["top", "topSmall", "bottom"]).default("top"),
  // anchor=start: ショート頭から delay 秒後に出す / end: ショート末尾の delay 秒前から出す
  // （endアンカーは範囲を編集しても「末尾N秒」が追従する＝CTA向け）
  anchor: z.enum(["start", "end"]).default("start"),
  delay: z.number().default(0),
  duration: z.number().nullable().default(null), // null=末尾まで表示
  role: z.enum(["hook", "title", "cta", "free"]).default("free"), // プリセット出自（バッジ表示用）
});
export type ShortText = z.infer<typeof shortTextSchema>;

export const shortFramingSchema = z.object({
  frameScale: z.number().min(1).max(3).default(1),
  frameX: z.number().min(-50).max(50).default(0), // %
  frameY: z.number().min(-50).max(50).default(0), // %
});
export type ShortFraming = z.infer<typeof shortFramingSchema>;

export const shortSchema = z.object({
  id: z.string(),
  name: z.string().default("ショート"),
  // 歌詞行の範囲（行id基準＝行の増減・時刻編集に強い。id消失時はUIで「範囲切れ」警告）
  range: z.object({ startLineId: z.string(), endLineId: z.string() }),
  // 縦(9:16)で崩れるコマだけ、行id または カットid ごとにフレーミングを上書き
  // （cuts>1の行はカット単位で指定。未指定は本編値のまま。実在しないidは無視）
  framingOverrides: z.record(z.string(), shortFramingSchema).default({}),
  // 全体見せモード: 絵を本編アスペクト(16:9)のまま中央に見せ、余白は同じ絵のぼかしで埋める。
  // centerクロップとの優劣に公的データは無い＝両方持ってA/Bできるようにする（勝ち筋調査 2026-07-11）
  fullFrame: z.boolean().default(false),
  // テロップ様式の部分上書き（未設定キーは 本編textStyle×プリセットのtextScale にフォールバック）
  textStyleOverride: lineTextStyleSchema.optional(),
  // 歌詞演出の差し替え（null=本編のまま。ショート単位で1種＝行別指定はしない）
  lyricAnim: effectInstanceSchema.nullable().default(null),
  // ショート専用テロップ（掴み/曲名常設/CTA等。本編には一切出ない独立レーン）
  texts: z.array(shortTextSchema).default([]),
});
export type Short = z.infer<typeof shortSchema>;

// ---- プロジェクト全体 ----
export const projectSchema = z.object({
  schemaVersion: z.number().default(SCHEMA_VERSION),
  meta: z.object({
    title: z.string().default("Untitled MV"),
    fps: z.number().default(30),
    width: z.number().default(1920),
    height: z.number().default(1080),
    songFile: z.string().default("song.mp3"),
    songDuration: z.number().default(0), // 秒。読込時に自動計測して埋める
    // 演出方針（自由記述）。ショット設計・AI参謀・i2v動き提案の全プロンプトに注入される
    direction: z.string().default(""),
    // AI参謀の演出モード（ハーネスの強弱）。simple=静か寄り / standard=統一ルールのみ / rich=攻め
    suggestMode: z.enum(["simple", "standard", "rich"]).default("standard"),
    textStyle: textStyleSchema.default(() => textStyleSchema.parse({})),
    // 歌い終わりで歌詞を自動で消す（words必須。手動の表示時間つまみが常に優先）
    lyricAutoHide: z.boolean().default(false),
    // 本編歌詞（lines[].lyricText）を描画するか。false=歌詞なしMV。
    // クレジット（行credit/openingCard/エンドカード）とプロローグ詩・アウトロ文は対象外＝出続ける。
    // 既定true＝キー無しの旧JSONは挙動不変（stylePackと同じ非migrate方式）
    showLyrics: z.boolean().default(true),
    // 適用中のスタイルパック（見た目の型）。null=未適用。旧JSONはキー無し＝nullで読める（migrate不要）
    stylePack: stylePackSchema.nullable().default(null),
  }),
  prologue: prologueSchema.default(() => prologueSchema.parse({})),
  look: lookSchema.default(() => lookSchema.parse({})),
  // オープニングタイトル（曲頭にタイトルデザインを重ねる。null=なし）
  openingCard: titleCardSchema.nullable().default(null),
  lines: z.array(lineSchema).default([]),
  outro: outroSchema.default(() => outroSchema.parse({})),
  // ショート（縦型切り抜き）の定義。素材は持たず lines[] を範囲参照するだけ
  shorts: z.array(shortSchema).default([]),
  // ショート合成時だけ載る描画用データ（lib/shorts.ts applyShortToProject が焼き込む。
  // プレビュー/レンダの inputProps 専用＝保存されるproject.jsonには現れない）
  shortOverlay: z
    .object({
      texts: z.array(shortTextSchema),
      startSec: z.number(), // 動画内絶対秒（プロローグ込み）
      endSec: z.number(),
      // 全体見せモード（aspect=本編のw/h）。undefined=従来のcoverクロップ
      fullFrame: z.object({ aspect: z.number() }).optional(),
    })
    .optional(),
  aiAdvice: aiAdviceSchema.nullable().default(null),
});
export type Project = z.infer<typeof projectSchema>;

/** 新規プロジェクトの雛形 */
export function emptyProject(title: string): Project {
  return projectSchema.parse({ meta: { title } });
}

/**
 * 旧バージョンの project.json を現行スキーマへ移行して読み込む。
 * schemaVersion が増えたらここに case を足していく。
 */
/**
 * 旧名前空間の保存 JSON（project / テーマ / プリセット）を現行の "xp" 系へ読み替える。
 * 配布版に旧データは存在しないため恒等（私用ブロックが実体を持つ）。
 */
export function migrateLegacyXpNames<T>(raw: T): T {
  let migrated = raw;
  return migrated;
}

export function migrateProject(raw: unknown): Project {
  const obj = migrateLegacyXpNames((raw ?? {}) as Record<string, unknown>);
  const version = typeof obj.schemaVersion === "number" ? obj.schemaVersion : 0;
  // v0（バージョン欄なし）→ v1: zodのdefaultで補完できる範囲なのでそのままparse
  const parsed = projectSchema.parse({ ...obj, schemaVersion: SCHEMA_VERSION });
  void version;
  return parsed;
}

// ---- テーマ（AI一括提案の「手札」＋方針＋ワンクリック即席適用の代表構成） ----
// lib/themes.ts の MvTheme インターフェイスの zod 版（自作テーマの永続化・検証用）。
// 内蔵テーマ（emo/pop/fantasy/cinema）と同じ形。EffectInstance は effectInstanceSchema を再利用。
// クライアントからも import される lib/themes.ts に fs 読みを入れないため、検証はここに置く。
export const mvThemeSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().default(""),
  palette: z.object({
    camera: z.array(z.string()).default([]),
    overlay: z.array(z.string()).default([]),
    transition: z.array(z.string()).default([]),
    lyric: z.array(z.string()).default([]),
    // AI手札に加える装飾（decorカテゴリ）。省略可
    decor: z.array(z.string()).optional(),
  }),
  policy: z.string().default(""),
  defaults: z.object({
    // 区間の入り（先頭区間には付けない）
    transition: effectInstanceSchema,
    // 区間頭に順繰りで配るカメラ（単調さ回避のため複数）
    cameras: z.array(effectInstanceSchema).default([]),
    // 全区間に敷く空気感オーバーレイ
    overlays: z.array(effectInstanceSchema).default([]),
    // 全行の出方
    lyricAnim: effectInstanceSchema,
    // 区間頭の行だけに配る装飾。省略可
    lyricDecor: effectInstanceSchema.optional(),
  }),
});
export type MvThemeSchema = z.infer<typeof mvThemeSchema>;
