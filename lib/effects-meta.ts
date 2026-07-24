/**
 * エフェクト規格（仕様書 §4.3）
 * エフェクト1つ＝1つの独立したRemotionコンポーネント＋このメタデータ。
 * lyric（歌詞アニメ）も同じスキーマに乗せる。
 * description は AI参謀に読ませる用（人間UIには出さなくてよい）。
 *
 * params の型: number / enum を実装。boolean は差し込み口のみ（実装保留）、color はv2。
 */

import { xpBridgedEffectById, XP_BRIDGED_EFFECTS, XP_EFFECT_PREFIX } from "@/lib/xp/bridge";
import { isArchived } from "@/lib/xp/archived";
import {
  XP_CURATED_TRANSITIONS,
  XP_CURATED_OVERLAYS,
  XP_CURATED_LYRICS,
} from "@/lib/xp/curated";

export type EffectCategory =
  | "camera"
  | "overlay"
  | "transition"
  | "lyric"
  | "decor" // 歌詞の装飾（座布団など）。出方(lyric)とは独立の軸で、自由に組み合わせる
  | "look"; // 全体ルック（作品全体の色味・質感）。区間ではなく project.look が持つ

export interface ParamDef {
  key: string;
  label: string; // 人間UI用
  // color = カラーピッカー（default は hex 文字列）。Phase2 拡張パラメータ化の色つまみ用。
  type: "number" | "enum" | "boolean" | "color"; // booleanは差し込み口のみ
  min?: number;
  max?: number;
  step?: number;
  default: number | string;
  unit?: string;
  options?: { value: string; label: string }[]; // enum用
}

export interface EffectMeta {
  id: string;
  name: string; // 人間表示名
  category: EffectCategory;
  description: string; // AI参謀に読ませる一言（どんな場面向きか）
  params: ParamDef[];
}

export const EFFECTS: EffectMeta[] = [
  // ---- camera（絵そのものを動かす。区間ごと＝区間先頭行が持つ） ----
  {
    id: "slow-zoom-in",
    name: "スローズームイン",
    category: "camera",
    description:
      "ゆっくり被写体へ寄る。感情が高まる場面・サビ前・core感情のクローズアップ向き。",
    params: [
      { key: "amount", label: "寄り幅", type: "number", min: 1.03, max: 1.6, step: 0.01, default: 1.15, unit: "x" },
      // 注視点＝ズームの不動点。顔の位置に合わせると「顔に寄っていく」画になる
      { key: "originX", label: "注視点 横", type: "number", min: 0, max: 100, step: 1, default: 50, unit: "%" },
      { key: "originY", label: "注視点 縦", type: "number", min: 0, max: 100, step: 1, default: 50, unit: "%" },
    ],
  },
  {
    id: "slow-zoom-out",
    name: "スローズームアウト",
    category: "camera",
    description:
      "ゆっくり引いて全景を見せる。余韻・孤独感・状況説明・曲の終わり向き。",
    params: [
      { key: "amount", label: "引き幅", type: "number", min: 1.03, max: 1.6, step: 0.01, default: 1.15, unit: "x" },
      { key: "originX", label: "注視点 横", type: "number", min: 0, max: 100, step: 1, default: 50, unit: "%" },
      { key: "originY", label: "注視点 縦", type: "number", min: 0, max: 100, step: 1, default: 50, unit: "%" },
    ],
  },
  {
    id: "pan",
    name: "パン",
    category: "camera",
    description:
      "絵を横に流して視線誘導する。風景・移動感・時間経過の表現向き。",
    params: [
      {
        key: "direction",
        label: "方向",
        type: "enum",
        default: "left",
        options: [
          { value: "left", label: "左へ" },
          { value: "right", label: "右へ" },
          { value: "up", label: "上へ" },
          { value: "down", label: "下へ" },
        ],
      },
      { key: "amount", label: "移動量", type: "number", min: 2, max: 20, step: 1, default: 8, unit: "%" },
    ],
  },
  {
    id: "parallax",
    name: "2.5Dパララックス",
    category: "camera",
    description:
      "1枚の絵が立体になったように、手前と奥が別々に動く（2.5D）。⚠️【静止画専用・動画には効かない】主役級の1枚絵・サビ向き。絵から自動生成する深度マップを使う（未生成なら詳細パネルのボタンで1クリック生成）。",
    params: [
      { key: "intensity", label: "立体感", type: "number", min: 0.2, max: 3, step: 0.1, default: 1, unit: "" },
      {
        key: "direction",
        label: "動き",
        type: "enum",
        default: "sway",
        options: [
          { value: "sway", label: "ゆらぎ" },
          { value: "left", label: "左へ" },
          { value: "right", label: "右へ" },
          { value: "push", label: "寄りながら" },
        ],
      },
    ],
  },
  {
    id: "punch-zoom",
    name: "パンチズーム",
    category: "camera",
    description:
      "区間の頭で一気にグッと寄ってから止まる。サビ頭・感情の爆発・キメの瞬間に。多用すると効果が薄れる。",
    params: [
      { key: "amount", label: "寄り幅", type: "number", min: 1.1, max: 1.9, step: 0.05, default: 1.35, unit: "x" },
      { key: "duration", label: "寄る時間", type: "number", min: 0.15, max: 1.2, step: 0.05, default: 0.4, unit: "s" },
      { key: "originX", label: "注視点 横", type: "number", min: 0, max: 100, step: 1, default: 50, unit: "%" },
      { key: "originY", label: "注視点 縦", type: "number", min: 0, max: 100, step: 1, default: 50, unit: "%" },
      {
        key: "beatSync",
        label: "ビートに同期",
        type: "enum",
        default: "off",
        options: [
          { value: "off", label: "頭で1回だけ" },
          { value: "beat", label: "拍ごとに小さくキメる" },
        ],
      },
    ],
  },
  {
    id: "push-in",
    name: "プッシュイン",
    category: "camera",
    description:
      "小節に合わせた決まった長さでグッと寄り、寄った位置で止まる。感情行・サビ前の「ため」向き。静的な画の後に控えめに使うと最も効く。",
    params: [
      {
        key: "timing",
        label: "寄るタイミング",
        type: "enum",
        default: "head",
        options: [
          { value: "head", label: "区間の頭で寄る" },
          { value: "tail", label: "区間の最後で寄る（次へのため）" },
        ],
      },
      { key: "bars", label: "寄る長さ", type: "number", min: 0.5, max: 4, step: 0.5, default: 1, unit: "小節" },
      { key: "amount", label: "寄り幅", type: "number", min: 1.05, max: 1.6, step: 0.01, default: 1.18, unit: "x" },
      // 注視点＝ズームの不動点。顔の位置に合わせると「顔に寄っていく」画になる
      { key: "originX", label: "注視点 横", type: "number", min: 0, max: 100, step: 1, default: 50, unit: "%" },
      { key: "originY", label: "注視点 縦", type: "number", min: 0, max: 100, step: 1, default: 50, unit: "%" },
    ],
  },
  // ---- overlay（絵の上に重ねる。複数同時がけ可） ----
  {
    id: "shake",
    name: "画面揺れ",
    category: "overlay",
    description:
      "手持ちカメラの微振動〜地震級まで。不安・衝動・鼓動・ドラムの激しい場面のエモさ増し。カメラと併用可（プッシュインと重ねると\"揺れながら寄る\"になる）。手ブレはドキュメンタリー的な没入感、かけすぎ注意。",
    params: [
      {
        key: "mode",
        label: "揺れかた",
        type: "enum",
        default: "shake",
        options: [
          { value: "shake", label: "細かく震える" },
          { value: "drift", label: "手ブレ（ゆっくり漂う）" },
        ],
      },
      { key: "intensity", label: "揺れ幅", type: "number", min: 2, max: 30, step: 1, default: 8, unit: "px" },
      { key: "speed", label: "速さ", type: "number", min: 1, max: 15, step: 1, default: 8, unit: "x" },
      {
        key: "beatSync",
        label: "ビートに同期",
        type: "enum",
        default: "off",
        options: [
          { value: "off", label: "常時揺れ" },
          { value: "beat", label: "拍で揺れる（鼓動）" },
        ],
      },
    ],
  },
  {
    id: "glitch-rgb",
    name: "色収差（常時RGBずれ）",
    category: "overlay",
    description:
      "赤と青が常にわずかにズレ続ける色収差。発作型グリッチと違い全編ジワッと不穏。電波・ノイズ・記憶の歪みの通奏低音。",
    params: [
      { key: "shift", label: "ずれ幅", type: "number", min: 1, max: 15, step: 1, default: 4, unit: "px" },
      { key: "wobble", label: "ゆらぎ", type: "number", min: 0, max: 1, step: 0.1, default: 0.4, unit: "" },
    ],
  },
  {
    id: "glitch-vhs",
    name: "VHSノイズ",
    category: "overlay",
    description:
      "古いビデオテープ風。走査線＋トラッキング乱れ＋色にじみ。ノスタルジー・回想・失われた記録の演出。",
    params: [
      { key: "intensity", label: "劣化度", type: "number", min: 0.1, max: 1, step: 0.05, default: 0.5, unit: "" },
      { key: "jitter", label: "乱れ頻度", type: "number", min: 0, max: 1, step: 0.1, default: 0.4, unit: "" },
    ],
  },
  {
    id: "film-grain",
    name: "フィルムグレイン",
    category: "overlay",
    description:
      "全画面のザラつき質感。隠し味として全編うっすらかけるのに向く。強くするとレトロ・劣化感。",
    params: [
      { key: "intensity", label: "強さ", type: "number", min: 0.05, max: 0.8, step: 0.05, default: 0.2, unit: "" },
      { key: "size", label: "粒の大きさ", type: "number", min: 1, max: 4, step: 0.5, default: 2, unit: "px" },
    ],
  },
  {
    id: "light-streaks",
    name: "流れる光影",
    category: "overlay",
    description:
      "光と影の帯が高速で流れる。ネオン・高架下・疾走感・都会の夜の主役級エフェクト。",
    params: [
      { key: "speed", label: "速さ", type: "number", min: 0.2, max: 3, step: 0.1, default: 1, unit: "x" },
      { key: "intensity", label: "強さ", type: "number", min: 0.1, max: 1, step: 0.05, default: 0.5, unit: "" },
      { key: "angle", label: "角度", type: "number", min: -45, max: 45, step: 5, default: -20, unit: "°" },
    ],
  },
  {
    id: "light-leak",
    name: "光漏れ／フレア",
    category: "overlay",
    description:
      "光がボワッと差し込む。エモ・幻想・回想・朝日や逆光の場面向き。",
    params: [
      { key: "intensity", label: "強さ", type: "number", min: 0.1, max: 1, step: 0.05, default: 0.55, unit: "" },
      { key: "hue", label: "色味", type: "number", min: 0, max: 360, step: 10, default: 30, unit: "°" },
      { key: "drift", label: "ゆらぎ速度", type: "number", min: 0.2, max: 2, step: 0.1, default: 0.6, unit: "x" },
    ],
  },
  {
    id: "lens-flare",
    name: "レンズフレア",
    category: "overlay",
    description:
      "シネマ系レンズフレア(WebGL)。鋭いコア+水平アナモルフィック筋+淡いゴースト列を光としてscreen加算。夜景・逆光・ライブ照明・都会的な場面向き。光源位置をキーフレームで動かせる。",
    params: [
      {
        key: "preset",
        label: "プリセット",
        type: "enum",
        default: "dusk-ember",
        options: [
          { value: "dusk-ember", label: "夕陽の残り火｜暖" },
          { value: "neon-rain", label: "ネオンの滲み｜青" },
          { value: "stage-glow", label: "舞台照明｜白" },
          { value: "moon-veil", label: "月あかり｜淡" },
          { value: "window-light", label: "窓辺の光｜柔" },
          { value: "passing-train", label: "過ぎる車窓｜筋" },
          { value: "gold-sparks", label: "金の火花｜散" },
          { value: "frost-flash", label: "冬の閃光｜冷" },
          { value: "amber-halo", label: "琥珀のハロー｜輪" },
          { value: "rainy-glass", label: "雨のガラス｜滲" },
          { value: "crimson-echo", label: "深紅の残光｜赤" },
          { value: "violet-pulse", label: "紫の明滅｜紫" },
        ],
      },
      // originX/Y キーにするとプレビューのクリック/ドラッグ指定UI（EffectPicker）が自動で付く
      { key: "originX", label: "光源 横", type: "number", min: 0, max: 100, step: 1, default: 63, unit: "%" },
      { key: "originY", label: "光源 縦", type: "number", min: 0, max: 100, step: 1, default: 26, unit: "%" },
      { key: "intensity", label: "強さ", type: "number", min: 0.1, max: 1.6, step: 0.05, default: 0.85, unit: "" },
      // 光学系の詳細つまみ（-1=プリセット値のまま。動かすと上書き）
      { key: "anamorphic", label: "水平の筋", type: "number", min: -1, max: 1.6, step: 0.05, default: -1, unit: "" },
      { key: "ghosts", label: "ゴースト数", type: "number", min: -1, max: 12, step: 1, default: -1, unit: "個" },
      { key: "halo", label: "ハロー輪", type: "number", min: -1, max: 1.6, step: 0.05, default: -1, unit: "" },
      { key: "chromatic", label: "色収差", type: "number", min: -1, max: 1, step: 0.05, default: -1, unit: "" },
      { key: "dirt", label: "レンズ汚れ", type: "number", min: -1, max: 1, step: 0.05, default: -1, unit: "" },
      { key: "flicker", label: "明滅", type: "number", min: -1, max: 1, step: 0.05, default: -1, unit: "" },
      {
        key: "motion",
        label: "動き",
        type: "enum",
        default: "drift",
        options: [
          { value: "none", label: "固定" },
          { value: "drift", label: "ゆらぎ（漂う）" },
          { value: "sweep", label: "横流れ（横断）" },
          { value: "path", label: "パス（A→B・曲げ可）" },
        ],
      },
      { key: "motionAmount", label: "振れ幅", type: "number", min: 0, max: 30, step: 1, default: 6, unit: "%" },
      { key: "motionSpeed", label: "動きの速さ", type: "number", min: 0.2, max: 3, step: 0.1, default: 1, unit: "x" },
      // パス移動の終点と曲げハンドル（プレビュー上のドラッグで指定。スライダーは出さない）
      { key: "destX", label: "終点 横", type: "number", min: 0, max: 100, step: 1, default: 30, unit: "%" },
      { key: "destY", label: "終点 縦", type: "number", min: 0, max: 100, step: 1, default: 40, unit: "%" },
      { key: "bendX", label: "曲げ 横", type: "number", min: -60, max: 60, step: 1, default: 0, unit: "%" },
      { key: "bendY", label: "曲げ 縦", type: "number", min: -60, max: 60, step: 1, default: 0, unit: "%" },
    ],
  },
  {
    id: "glitch",
    name: "グリッチ",
    category: "overlay",
    description:
      "画面が一瞬バグる／RGB分離。異界・呪い・不穏・記憶の混濁の演出向き。かけすぎ注意。",
    params: [
      { key: "intensity", label: "強さ", type: "number", min: 0.1, max: 1, step: 0.05, default: 0.5, unit: "" },
      { key: "interval", label: "発作間隔", type: "number", min: 0.5, max: 6, step: 0.5, default: 2.5, unit: "s" },
      { key: "rgbShift", label: "RGBずれ", type: "number", min: 0, max: 20, step: 1, default: 6, unit: "px" },
    ],
  },
  {
    id: "rain-drops",
    name: "水滴（レンズの雨粒）",
    category: "overlay",
    description:
      "画面手前のガラスに付いたボケた水滴。一部がスッと流れ落ちる。雨・涙・車窓・切なさの場面の手前レイヤー。",
    params: [
      { key: "count", label: "数", type: "number", min: 5, max: 50, step: 1, default: 28, unit: "個" },
      { key: "size", label: "大きさ", type: "number", min: 10, max: 60, step: 2, default: 22, unit: "px" },
      { key: "drip", label: "流れ落ちる率", type: "number", min: 0, max: 1, step: 0.1, default: 0.3, unit: "" },
      { key: "blur", label: "ピンボケ", type: "number", min: 0, max: 1, step: 0.1, default: 0.55, unit: "" },
      { key: "refract", label: "屈折", type: "number", min: 0, max: 1, step: 0.05, default: 0.55, unit: "" },
      { key: "bright", label: "明るさ", type: "number", min: 1, max: 1.6, step: 0.05, default: 1.1, unit: "" },
    ],
  },
  {
    id: "glitch-blocks",
    name: "ブロックノイズ",
    category: "overlay",
    description:
      "矩形ブロックが周期的にズレて色化けする（MPEG破損・デジタル崩壊風）。既存glitchより硬質で機械的な壊れ方。",
    params: [
      { key: "intensity", label: "強さ", type: "number", min: 0.1, max: 1, step: 0.05, default: 0.6, unit: "" },
      { key: "interval", label: "発作間隔", type: "number", min: 0.5, max: 6, step: 0.5, default: 2, unit: "s" },
      { key: "blocks", label: "ブロック数", type: "number", min: 3, max: 16, step: 1, default: 8, unit: "個" },
    ],
  },
  {
    id: "glitch-smear",
    name: "ピクセルスミア（縦溶け）",
    category: "overlay",
    description:
      "柱状に像が縦へ溶けて伸びる（ピクセルサート風）。記憶の融解・データが漏れていく感じ。常時ゆっくり生え変わる。",
    params: [
      { key: "amount", label: "柱の本数", type: "number", min: 2, max: 12, step: 1, default: 6, unit: "本" },
      { key: "strength", label: "伸び", type: "number", min: 1.2, max: 4, step: 0.2, default: 2, unit: "x" },
      { key: "refresh", label: "生え変わり", type: "number", min: 0.3, max: 3, step: 0.1, default: 0.8, unit: "s" },
      { key: "opacity", label: "濃さ", type: "number", min: 0.2, max: 1, step: 0.05, default: 0.75, unit: "" },
      { key: "boost", label: "色化け", type: "number", min: 1, max: 3, step: 0.1, default: 1.6, unit: "x" },
    ],
  },
  {
    id: "glitch-wave",
    name: "走査波（うねり）",
    category: "overlay",
    description:
      "横方向のうねりが流れ続ける。電波の乱れ・水中・夢の中。VHSより滑らかで気持ち悪くない歪み。",
    params: [
      { key: "amplitude", label: "うねり幅", type: "number", min: 2, max: 40, step: 1, default: 12, unit: "px" },
      { key: "speed", label: "速さ", type: "number", min: 0.2, max: 4, step: 0.1, default: 1, unit: "x" },
      { key: "wavelength", label: "波の数", type: "number", min: 0.5, max: 4, step: 0.5, default: 1.5, unit: "" },
    ],
  },
  {
    id: "glitch-subject",
    name: "被写体グリッチ（キャラだけ）",
    category: "overlay",
    description:
      "深度マップを使い、手前の被写体（キャラ）の周りだけを周期的にバグらせる。背景は無傷。「この子だけ壊れていく」演出。images/<名前>.depth.png が必要。",
    params: [
      { key: "intensity", label: "強さ", type: "number", min: 0.1, max: 1, step: 0.05, default: 0.6, unit: "" },
      { key: "interval", label: "発作間隔", type: "number", min: 0.5, max: 6, step: 0.5, default: 2.5, unit: "s" },
      { key: "rgbShift", label: "RGBずれ", type: "number", min: 0, max: 24, step: 1, default: 10, unit: "px" },
    ],
  },
  {
    id: "line-sweep",
    name: "線の演出",
    category: "overlay",
    description:
      "細い光の線が画面を横切って引かれる。スタイリッシュ・区切り・スピード感。歌詞の区切りやビートの強い場面に。",
    params: [
      { key: "count", label: "本数", type: "number", min: 1, max: 6, step: 1, default: 3, unit: "本" },
      { key: "angle", label: "角度", type: "number", min: -90, max: 90, step: 15, default: 0, unit: "°" },
      { key: "thickness", label: "太さ", type: "number", min: 1, max: 6, step: 1, default: 2, unit: "px" },
      { key: "speed", label: "速さ", type: "number", min: 0.3, max: 3, step: 0.1, default: 1, unit: "x" },
      {
        key: "beatSync",
        label: "ビートに同期",
        type: "enum",
        default: "off",
        options: [
          { value: "off", label: "区間の頭で1回" },
          { value: "beat", label: "拍のたびに1本走る" },
        ],
      },
    ],
  },
  {
    id: "particles",
    name: "舞い散るパーティクル",
    category: "overlay",
    description:
      "花びら・雪・塵・光の粒が画面をゆっくり舞う。J-MVの定番前景。間奏や静止画区間の寂しさ対策の一軍。桜=春/別れ、雪=冬/静寂、塵=室内の光、光=幻想。",
    params: [
      {
        key: "type",
        label: "種類",
        type: "enum",
        default: "sakura",
        options: [
          { value: "sakura", label: "桜の花びら" },
          { value: "snow", label: "雪" },
          { value: "dust", label: "塵（光の埃）" },
          { value: "light", label: "光の粒" },
        ],
      },
      { key: "count", label: "数", type: "number", min: 8, max: 80, step: 1, default: 30, unit: "個" },
      { key: "size", label: "大きさ", type: "number", min: 8, max: 64, step: 2, default: 24, unit: "px" },
      { key: "speed", label: "速さ", type: "number", min: 0.3, max: 3, step: 0.1, default: 1, unit: "x" },
      {
        key: "beatSync",
        label: "ビートに同期",
        type: "enum",
        default: "off",
        options: [
          { value: "off", label: "常時ふわふわ" },
          { value: "beat", label: "拍で瞬く" },
        ],
      },
    ],
  },
  {
    id: "bokeh-orbs",
    name: "玉ボケ",
    category: "overlay",
    description:
      "前景を漂う大きなソフト円ボケ。バラード・夜景・回想のエモ増し定番。雰囲気はhueで暖色〜寒色に振れる。",
    params: [
      { key: "count", label: "数", type: "number", min: 4, max: 16, step: 1, default: 8, unit: "個" },
      { key: "size", label: "大きさ", type: "number", min: 60, max: 280, step: 10, default: 150, unit: "px" },
      { key: "hue", label: "色味", type: "number", min: 0, max: 360, step: 10, default: 40, unit: "°" },
      { key: "intensity", label: "強さ", type: "number", min: 0.1, max: 1, step: 0.05, default: 0.6, unit: "" },
    ],
  },
  {
    id: "cinescope",
    name: "シネスコープ",
    category: "overlay",
    description:
      "黒帯レターボックス＋ビネット＋フィルムの微妙な縦揺れ（ゲートウィーブ）で一発映画化。film-grainと重ねると質感が完成する。",
    params: [
      {
        key: "ratio",
        label: "画面比",
        type: "enum",
        default: "2.35",
        options: [
          { value: "2.35", label: "2.35:1（シネスコ）" },
          { value: "1.85", label: "1.85:1（ビスタ）" },
        ],
      },
      { key: "vignette", label: "ビネット", type: "number", min: 0, max: 1, step: 0.05, default: 0.5, unit: "" },
      { key: "weave", label: "縦揺れ", type: "number", min: 0, max: 1, step: 0.1, default: 0.3, unit: "" },
    ],
  },
  {
    id: "ornate-frame",
    name: "額装フレーム",
    category: "overlay",
    description:
      "画面全体を角丸の細枠＋ダイヤ飾り＋四隅レースで額装する。アンティーク・文学的・エモ系リリックビデオの「一枚の絵」感。cinescopeとは併用しない方がよい。",
    params: [
      {
        key: "color",
        label: "色",
        type: "enum",
        default: "white",
        options: [
          { value: "white", label: "象牙" },
          { value: "gold", label: "金" },
          { value: "color", label: "カラー" },
        ],
      },
      { key: "hue", label: "カラー時の色相", type: "number", min: 0, max: 360, step: 10, default: 45, unit: "°" },
      { key: "margin", label: "余白", type: "number", min: 16, max: 120, step: 2, default: 48, unit: "px" },
      { key: "radius", label: "角丸", type: "number", min: 0, max: 240, step: 4, default: 140, unit: "px" },
      { key: "thickness", label: "太さ", type: "number", min: 1, max: 6, step: 0.5, default: 2, unit: "px" },
      { key: "opacity", label: "濃さ", type: "number", min: 0.2, max: 1, step: 0.05, default: 0.85, unit: "" },
      {
        key: "corners",
        label: "四隅の飾り",
        type: "enum",
        default: "lace",
        options: [
          { value: "lace", label: "レース" },
          { value: "simple", label: "シンプル" },
          { value: "off", label: "なし" },
        ],
      },
    ],
  },
  // ---- transition（区間の境界） ----
  {
    id: "crossfade",
    name: "クロスディゾルブ",
    category: "transition",
    description: "前の絵と溶け合って切り替わる基本のつなぎ。迷ったらこれ。",
    params: [
      { key: "duration", label: "長さ", type: "number", min: 0.2, max: 2, step: 0.1, default: 0.8, unit: "s" },
    ],
  },
  {
    id: "cut",
    name: "カット",
    category: "transition",
    description: "スパッと切り替える。ビートの強い曲・緊張感のある場面向き。",
    params: [],
  },
  {
    id: "fade-black",
    name: "暗転",
    category: "transition",
    description: "一度黒に落ちてから次の絵が浮かぶ。場面転換・時間経過・章の区切りに。",
    params: [
      { key: "duration", label: "長さ", type: "number", min: 0.4, max: 2.5, step: 0.1, default: 1.2, unit: "s" },
    ],
  },
  {
    id: "wipe",
    name: "ワイプ",
    category: "transition",
    description: "新しい絵が一方向から拭うように現れる。移動・視点の切り替わりに。",
    params: [
      {
        key: "direction",
        label: "方向",
        type: "enum",
        default: "left",
        options: [
          { value: "left", label: "左から" },
          { value: "right", label: "右から" },
          { value: "up", label: "下から" },
          { value: "down", label: "上から" },
        ],
      },
      { key: "duration", label: "長さ", type: "number", min: 0.2, max: 1.5, step: 0.1, default: 0.6, unit: "s" },
    ],
  },
  {
    id: "zoom-transition",
    name: "ズーム切替",
    category: "transition",
    description: "次の絵が引きながら（拡大状態→等倍）フェードインする。勢いと没入感。サビ入りに好相性。",
    params: [
      { key: "amount", label: "初期拡大", type: "number", min: 1.1, max: 1.6, step: 0.05, default: 1.25, unit: "x" },
      { key: "duration", label: "長さ", type: "number", min: 0.2, max: 1.2, step: 0.1, default: 0.5, unit: "s" },
    ],
  },
  {
    id: "glitch-transition",
    name: "グリッチ切替",
    category: "transition",
    description: "画面がバグりながら次の絵に切り替わる。異界へのジャンプ・記憶のフラッシュに。",
    params: [
      { key: "duration", label: "長さ", type: "number", min: 0.15, max: 0.8, step: 0.05, default: 0.35, unit: "s" },
      { key: "intensity", label: "強さ", type: "number", min: 0.2, max: 1, step: 0.1, default: 0.7, unit: "" },
    ],
  },
  {
    id: "whip-pan",
    name: "ホイップパン",
    category: "transition",
    description:
      "画面を高速で振って次の絵へ。モーションブラー＋着地の揺り戻し付き。サビ入り・場面の勢いある切替に。多用すると酔う。",
    params: [
      { key: "duration", label: "長さ", type: "number", min: 0.15, max: 0.6, step: 0.05, default: 0.35, unit: "s" },
      {
        key: "direction",
        label: "方向",
        type: "enum",
        default: "left",
        options: [
          { value: "left", label: "左へ" },
          { value: "right", label: "右へ" },
          { value: "up", label: "上へ" },
          { value: "down", label: "下へ" },
        ],
      },
      { key: "blur", label: "ブラー量", type: "number", min: 0.3, max: 2, step: 0.1, default: 1, unit: "x" },
      {
        key: "exit",
        label: "前の絵",
        type: "enum",
        default: "off",
        options: [
          { value: "off", label: "新しい絵だけ振り込む（従来）" },
          { value: "on", label: "前の絵も同方向に振り出す（両側）" },
        ],
      },
    ],
  },
  {
    id: "push",
    name: "押し出し",
    category: "transition",
    description:
      "前の絵を押し出しながら次の絵が入ってくる（両側が1本のベルトで動く）。場面転換・場所の移動感に。",
    params: [
      {
        key: "direction",
        label: "方向",
        type: "enum",
        default: "left",
        options: [
          { value: "left", label: "左へ" },
          { value: "right", label: "右へ" },
          { value: "up", label: "上へ" },
          { value: "down", label: "下へ" },
        ],
      },
      { key: "duration", label: "長さ", type: "number", min: 0.3, max: 1.5, step: 0.05, default: 0.6, unit: "s" },
    ],
  },
  {
    id: "luma-fade",
    name: "ルマフェード",
    category: "transition",
    description:
      "次の絵が明るい部分（または暗い部分）から先に現れる情緒系の王道。エモバラード・回想・夜明けの場面に。クロスフェードの上位互換的な余韻が出る。",
    params: [
      { key: "duration", label: "長さ", type: "number", min: 0.5, max: 2.5, step: 0.1, default: 1.2, unit: "s" },
      {
        key: "from",
        label: "現れ方",
        type: "enum",
        default: "light",
        options: [
          { value: "light", label: "明部から" },
          { value: "dark", label: "暗部から" },
        ],
      },
    ],
  },
  {
    id: "flash-white",
    name: "フラッシュ",
    category: "transition",
    description:
      "白（または暖色）に一瞬飛ばして次の絵へ。サビ前のキメ・衝撃の瞬間に。beatSyncで遷移中に拍のたび光が再点火する。",
    params: [
      { key: "duration", label: "長さ", type: "number", min: 0.2, max: 1, step: 0.05, default: 0.45, unit: "s" },
      { key: "intensity", label: "強さ", type: "number", min: 0.4, max: 1, step: 0.05, default: 1, unit: "" },
      {
        key: "tone",
        label: "色",
        type: "enum",
        default: "white",
        options: [
          { value: "white", label: "白" },
          { value: "warm", label: "暖色" },
        ],
      },
      {
        key: "beatSync",
        label: "ビートに同期",
        type: "enum",
        default: "off",
        options: [
          { value: "off", label: "1回だけ光る" },
          { value: "beat", label: "拍のたび再点火" },
        ],
      },
    ],
  },
  {
    id: "slice",
    name: "スライス",
    category: "transition",
    description:
      "画面を帯状に割って時間差でスライドイン。ポップ・アップテンポ・リズミカルな場面転換に。縦横が選べる。",
    params: [
      { key: "duration", label: "長さ", type: "number", min: 0.3, max: 1.2, step: 0.05, default: 0.6, unit: "s" },
      { key: "bands", label: "帯の数", type: "number", min: 3, max: 10, step: 1, default: 5, unit: "本" },
      {
        key: "direction",
        label: "帯の向き",
        type: "enum",
        default: "h",
        options: [
          { value: "h", label: "横帯（左右から）" },
          { value: "v", label: "縦帯（上下から）" },
        ],
      },
    ],
  },
  // ---- lyric（歌詞・字幕の出方。行ごと。orientationを読む） ----
  {
    id: "lyric-fade",
    name: "フェード",
    category: "lyric",
    description: "ふわっと現れる基本の出方。バラード・静かな場面向き。",
    params: [
      { key: "inDuration", label: "出る時間", type: "number", min: 0.2, max: 1.5, step: 0.1, default: 0.5, unit: "s" },
    ],
  },
  {
    id: "lyric-slide",
    name: "スライド",
    category: "lyric",
    description:
      "横書きは下から、縦書きは右からスッと入る。動きのある曲・サビ向き。",
    params: [
      { key: "distance", label: "距離", type: "number", min: 10, max: 80, step: 5, default: 30, unit: "px" },
      { key: "inDuration", label: "出る時間", type: "number", min: 0.2, max: 1.2, step: 0.1, default: 0.45, unit: "s" },
    ],
  },
  {
    id: "lyric-type",
    name: "タイプ（簡易）",
    category: "lyric",
    description:
      "行の尺に合わせて一定速度で文字送り。横書き専用（縦書き時は自動でフェードに落ちる）。語りかける歌詞向き。文字ごとの正確な同期はしない。",
    params: [
      { key: "speed", label: "速さ", type: "number", min: 6, max: 30, step: 1, default: 14, unit: "字/s" },
    ],
  },
  {
    id: "lyric-stagger",
    name: "一文字ずつ登場",
    category: "lyric",
    description:
      "文字が1つずつ順に浮かび上がる（リリックビデオの基本形）。語りかける歌詞・静かな感情の高まりに。縦書きも対応。",
    params: [
      { key: "stagger", label: "文字の間隔", type: "number", min: 0.02, max: 0.15, step: 0.01, default: 0.05, unit: "s" },
      { key: "rise", label: "浮き上がり", type: "number", min: 0, max: 40, step: 2, default: 14, unit: "px" },
    ],
  },
  {
    id: "lyric-hero-pop",
    name: "デカ文字ポップ",
    category: "lyric",
    description:
      "画面中央に大きな文字がバンッと弾んで登場（リリックビデオの主役演出）。サビ・タイトルフレーズ・キメの一言に。多用注意。",
    params: [
      { key: "scale", label: "大きさ", type: "number", min: 1.2, max: 2.6, step: 0.1, default: 1.7, unit: "x" },
      { key: "inDuration", label: "出る時間", type: "number", min: 0.15, max: 0.8, step: 0.05, default: 0.35, unit: "s" },
    ],
  },
  {
    id: "lyric-hero-glitch",
    name: "デカ文字グリッチ",
    category: "lyric",
    description:
      "中央の大きな文字がノイズ混じりに明滅して現れる。不穏・電波・叫びの歌詞に。",
    params: [
      { key: "scale", label: "大きさ", type: "number", min: 1.2, max: 2.6, step: 0.1, default: 1.6, unit: "x" },
      { key: "shift", label: "ずれ幅", type: "number", min: 2, max: 20, step: 1, default: 8, unit: "px" },
    ],
  },
  {
    id: "lyric-glow",
    name: "ネオングロウ",
    category: "lyric",
    description:
      "文字がネオンサインのように発光して脈打つ。夜の街・電波・都会の孤独の歌詞に。",
    params: [
      { key: "hue", label: "光の色", type: "number", min: 0, max: 360, step: 10, default: 320, unit: "°" },
      { key: "pulse", label: "脈動", type: "number", min: 0, max: 1, step: 0.1, default: 0.5, unit: "" },
      {
        key: "beatSync",
        label: "ビートに同期",
        type: "enum",
        default: "off",
        options: [
          { value: "off", label: "一定周期で脈打つ" },
          { value: "beat", label: "曲の拍で光が跳ねる" },
        ],
      },
    ],
  },
  {
    id: "lyric-blackout",
    name: "黒場＋歌詞だけ",
    category: "lyric",
    description:
      "画面全体を黒に落として歌詞だけを見せる。ブレイク・無音・決定的な一言に。絵よりも言葉を主役にする瞬間用。",
    params: [
      {
        key: "reveal",
        label: "出方",
        type: "enum",
        default: "fade",
        options: [
          { value: "fade", label: "フェード" },
          { value: "stagger", label: "一文字ずつ" },
        ],
      },
      { key: "textScale", label: "文字の大きさ", type: "number", min: 1, max: 2.2, step: 0.1, default: 1.3, unit: "x" },
    ],
  },
  {
    id: "lyric-whiteout",
    name: "白場＋歌詞だけ",
    category: "lyric",
    description:
      "画面全体を白に飛ばして黒文字の歌詞だけを見せる。転調・回想の反転・眩しさの表現。黒場より鋭い印象。",
    params: [
      {
        key: "reveal",
        label: "出方",
        type: "enum",
        default: "fade",
        options: [
          { value: "fade", label: "フェード" },
          { value: "stagger", label: "一文字ずつ" },
        ],
      },
      { key: "textScale", label: "文字の大きさ", type: "number", min: 1, max: 2.2, step: 0.1, default: 1.3, unit: "x" },
    ],
  },
  {
    id: "lyric-scatter",
    name: "バラバラ→集合",
    category: "lyric",
    description:
      "散らばった文字が集まって歌詞になる。混乱が言葉になる瞬間・サビ前の溜め・印象的なフレーズに。",
    params: [
      { key: "spread", label: "散らばり", type: "number", min: 40, max: 300, step: 10, default: 120, unit: "px" },
      { key: "inDuration", label: "集まる時間", type: "number", min: 0.3, max: 1.5, step: 0.1, default: 0.7, unit: "s" },
    ],
  },
  {
    id: "lyric-gather",
    name: "うにょうにょ集合",
    category: "lyric",
    description:
      "シアンの光の粒として現れた文字が、1文字ずつバラバラのタイミングでうにょうにょ漂いながら定位置へ集まり白く灯る。漢字は大きく・かなは小さく、着地後も浮遊し続ける。幻想・エモの見せ場行に。電撃ライン(decor-neon-script)と好相性。",
    params: [
      { key: "spread", label: "ばらけ幅", type: "number", min: 30, max: 200, step: 5, default: 90, unit: "px" },
      { key: "stagger", label: "時間差", type: "number", min: 0, max: 1.2, step: 0.05, default: 0.5, unit: "s" },
      { key: "inDuration", label: "集まる時間", type: "number", min: 0.4, max: 2.5, step: 0.1, default: 1.2, unit: "s" },
      { key: "wobble", label: "うにょ量", type: "number", min: 0, max: 1, step: 0.05, default: 0.6, unit: "" },
      { key: "chroma", label: "色収差", type: "number", min: 0, max: 1, step: 0.05, default: 0.4, unit: "" },
      {
        key: "pos",
        label: "配置",
        type: "enum",
        default: "bottom",
        options: [
          { value: "bottom", label: "下部（通常）" },
          { value: "center", label: "画面中央" },
        ],
      },
    ],
  },
  {
    id: "lyric-explode",
    name: "バーンとばらける",
    category: "lyric",
    description:
      "文字がポンッと現れ、行の終わりに爆発するように四散して消える。感情の破裂・決別の言葉・サビ終わりに。",
    params: [
      { key: "spread", label: "飛び散り", type: "number", min: 60, max: 400, step: 20, default: 180, unit: "px" },
      { key: "rotate", label: "回転", type: "number", min: 0, max: 360, step: 20, default: 120, unit: "°" },
    ],
  },
  {
    id: "lyric-write",
    name: "書かれていく",
    category: "lyric",
    description:
      "文字が筆で書かれるように1字ずつ現れていく（簡易・線の進行方向で表現）。手紙・独白・つづる系の歌詞に。",
    params: [
      { key: "charTime", label: "1字の時間", type: "number", min: 0.08, max: 0.5, step: 0.02, default: 0.18, unit: "s" },
    ],
  },
  {
    id: "lyric-parts",
    name: "字のパーツが集まる/離れる",
    category: "lyric",
    description:
      "1文字が破片（パーツ）に分かれた状態から組み上がる、または行の終わりに分解する。記憶の再構成・崩壊の表現に。",
    params: [
      {
        key: "mode",
        label: "動き",
        type: "enum",
        default: "gather",
        options: [
          { value: "gather", label: "集まる" },
          { value: "break", label: "離れる（終わりに分解）" },
          { value: "both", label: "集まって、離れる" },
        ],
      },
      {
        key: "split",
        label: "割り方",
        type: "enum",
        default: "quad",
        options: [
          { value: "quad", label: "4分割（破片）" },
          { value: "lr", label: "左右（偏と旁）" },
          { value: "tb", label: "上下（冠と脚）" },
        ],
      },
      { key: "spread", label: "分かれ幅", type: "number", min: 20, max: 160, step: 10, default: 60, unit: "px" },
    ],
  },
  {
    id: "lyric-mega",
    name: "メガ文字（ななめドーン）",
    category: "lyric",
    description:
      "画面からはみ出すほど巨大な文字が斜めにドーンと叩きつけられる。最強のキメ・タイトルコール・絶叫。1曲に1〜2回まで。",
    params: [
      { key: "scale", label: "大きさ", type: "number", min: 1.5, max: 5, step: 0.25, default: 2.8, unit: "x" },
      { key: "angle", label: "傾き", type: "number", min: -30, max: 30, step: 2, default: -8, unit: "°" },
      {
        key: "unit",
        label: "出方",
        type: "enum",
        default: "slam",
        options: [
          { value: "slam", label: "一発ドーン" },
          { value: "chars", label: "一文字ずつドン、ドン" },
        ],
      },
    ],
  },
  {
    id: "lyric-mega-write",
    name: "デカ文字書き文字（自由配置）",
    category: "lyric",
    description:
      "画面のどこにでも置ける巨大な手書き風文字が1字ずつ書かれていく。posX/posYで自由配置。連続する行では位置を対角に散らす（例: 左上25,28 → 右下75,72）と画面が締まる。layout=splitで1行の前半/後半を対角に割る。サビ・キメ・独白の連続行に。",
    params: [
      { key: "posX", label: "横位置", type: "number", min: 0, max: 100, step: 1, default: 50, unit: "%" },
      { key: "posY", label: "縦位置", type: "number", min: 0, max: 100, step: 1, default: 50, unit: "%" },
      { key: "angle", label: "傾き", type: "number", min: -30, max: 30, step: 1, default: -10, unit: "°" },
      { key: "scale", label: "大きさ", type: "number", min: 1.5, max: 6, step: 0.25, default: 3.5, unit: "x" },
      { key: "charTime", label: "1字の時間", type: "number", min: 0.06, max: 0.4, step: 0.02, default: 0.14, unit: "s" },
      {
        key: "layout",
        label: "配置",
        type: "enum",
        default: "single",
        options: [
          { value: "single", label: "ひとかたまり" },
          { value: "split", label: "対角に二分割" },
        ],
      },
    ],
  },
  // ---- decor（歌詞の装飾。出方とは独立に重ねられる） ----
  {
    id: "lyric-word-pop",
    name: "単語ポップ",
    category: "lyric",
    description:
      "歌唱のタイミングに合わせて単語ごとにポンと出る（LRC自動生成した行は単語タイムスタンプで歌に同期）。ボーカルを追う駆動感。サビ・リズムの立った行に。",
    params: [
      { key: "rise", label: "浮き上がり", type: "number", min: 4, max: 30, step: 1, default: 12, unit: "px" },
      { key: "pop", label: "ポップ量", type: "number", min: 0, max: 0.5, step: 0.02, default: 0.22, unit: "" },
    ],
  },
  {
    id: "lyric-karaoke-fill",
    name: "カラオケフィル",
    category: "lyric",
    description:
      "文字色が左→右（縦書きは上→下）へ塗り進む。LRC自動生成した行は単語タイムスタンプで歌に合わせて塗る（発声中は進み、間は止まる）。リリックビデオ感が一番出る主役級。",
    params: [
      { key: "hue", label: "塗り色", type: "number", min: 0, max: 360, step: 10, default: 340, unit: "°" },
      { key: "dim", label: "未達部分の暗さ", type: "number", min: 0.2, max: 0.9, step: 0.05, default: 0.55, unit: "" },
    ],
  },
  {
    id: "lyric-echo",
    name: "ブラーエコー",
    category: "lyric",
    description:
      "文字の残像（ゴースト）が遅れてついてくる。浮遊感・切なさ・夢の中。tint=rgbでサイバー寄りにも振れる。",
    params: [
      { key: "ghosts", label: "残像の数", type: "number", min: 1, max: 4, step: 1, default: 2, unit: "枚" },
      { key: "gap", label: "遅れ", type: "number", min: 0.06, max: 0.3, step: 0.02, default: 0.12, unit: "s" },
      {
        key: "tint",
        label: "色ずれ",
        type: "enum",
        default: "none",
        options: [
          { value: "none", label: "なし" },
          { value: "rgb", label: "RGBずれ" },
        ],
      },
    ],
  },
  {
    id: "lyric-wave",
    name: "波乗りテキスト",
    category: "lyric",
    description:
      "文字が緩いサイン波に乗ってゆらゆら動き続ける。優しい曲・浮遊感・水や風のモチーフに。beatSyncで波が拍に合わせて跳ねる。",
    params: [
      { key: "amp", label: "波の高さ", type: "number", min: 4, max: 30, step: 1, default: 10, unit: "px" },
      { key: "speed", label: "速さ", type: "number", min: 0.2, max: 2, step: 0.1, default: 0.6, unit: "x" },
      { key: "wavelength", label: "波の間隔", type: "number", min: 3, max: 12, step: 1, default: 6, unit: "字" },
      {
        key: "beatSync",
        label: "ビートに同期",
        type: "enum",
        default: "off",
        options: [
          { value: "off", label: "常時ゆらゆら" },
          { value: "beat", label: "拍で跳ねる" },
        ],
      },
    ],
  },
  {
    id: "lyric-title-glitch",
    name: "タイトルグリッチ",
    category: "lyric",
    description:
      "横から流れ込み、RGB分離＋スライス飛び＋グロー明滅の「発作」が周期的に走るタイトル様式。曲名・キメの英語詞に。縦書き指定でも横組みで出る。",
    params: [
      { key: "scale", label: "文字の大きさ", type: "number", min: 1, max: 3, step: 0.1, default: 1.6, unit: "x" },
    ],
  },
  {
    id: "lyric-develop",
    name: "現像ワイプ",
    category: "lyric",
    description:
      "光のスミア帯が先頭から伸び、左→右（縦書きは上→下）に現像されて文字になる。退場は行が走査線に潰れて消える。タイポグラフィMVのタイトル様式。キメの一言・曲名表示に。",
    params: [
      { key: "inDuration", label: "現像の時間", type: "number", min: 0.25, max: 1, step: 0.05, default: 0.45, unit: "s" },
      {
        key: "exit",
        label: "消え方",
        type: "enum",
        default: "line",
        options: [
          { value: "line", label: "走査線に潰れる" },
          { value: "fade", label: "ふつうにフェード" },
        ],
      },
    ],
  },
  {
    id: "decor-band",
    name: "座布団",
    category: "decor",
    description:
      "歌詞の下に敷く帯。可読性とデザインの王道。形（四角/斜め/1文字タイル）とタイミング（先に敷く/あとから重なる）を選べる。",
    params: [
      {
        key: "shape",
        label: "形",
        type: "enum",
        default: "rect",
        options: [
          { value: "rect", label: "四角" },
          { value: "slant", label: "斜めカット" },
          { value: "tile", label: "1文字ずつ正方形" },
        ],
      },
      {
        key: "timing",
        label: "タイミング",
        type: "enum",
        default: "lead",
        options: [
          { value: "lead", label: "帯が先に入る" },
          { value: "follow", label: "あとから帯が重なる" },
        ],
      },
      {
        key: "color",
        label: "色",
        type: "enum",
        default: "black",
        options: [
          { value: "black", label: "黒（白文字）" },
          { value: "white", label: "白（黒文字）" },
        ],
      },
      { key: "opacity", label: "濃さ", type: "number", min: 0.4, max: 1, step: 0.05, default: 0.8, unit: "" },
    ],
  },
  {
    id: "decor-band-grad",
    name: "グラデ座布団",
    category: "decor",
    description:
      "2色グラデーションの帯を歌詞の下に敷く。色の組み合わせで曲の温度感を出せる。サビ・キメの行に。",
    params: [
      { key: "hue", label: "始まりの色", type: "number", min: 0, max: 360, step: 10, default: 280, unit: "°" },
      { key: "hue2", label: "終わりの色", type: "number", min: 0, max: 360, step: 10, default: 340, unit: "°" },
      { key: "opacity", label: "濃さ", type: "number", min: 0.3, max: 1, step: 0.05, default: 0.75, unit: "" },
    ],
  },
  {
    id: "decor-glass",
    name: "すりガラス",
    category: "decor",
    description:
      "背景をぼかす半透明パネル。写真がうるさい場面でも歌詞が上品に読める。バラード・落ち着いた行に。",
    params: [
      { key: "blur", label: "ぼかし", type: "number", min: 4, max: 24, step: 2, default: 12, unit: "px" },
      {
        key: "tone",
        label: "トーン",
        type: "enum",
        default: "dark",
        options: [
          { value: "dark", label: "ダーク" },
          { value: "light", label: "ライト" },
        ],
      },
      { key: "radius", label: "角丸", type: "number", min: 0, max: 32, step: 2, default: 16, unit: "px" },
    ],
  },
  {
    id: "decor-pill",
    name: "角丸ピル",
    category: "decor",
    description:
      "カプセル形の座布団がふわっと膨らんで入る。ポップ・キュート・軽やかな行に。",
    params: [
      {
        key: "color",
        label: "色",
        type: "enum",
        default: "black",
        options: [
          { value: "black", label: "黒" },
          { value: "white", label: "白" },
          { value: "color", label: "カラー" },
        ],
      },
      { key: "hue", label: "カラー時の色相", type: "number", min: 0, max: 360, step: 10, default: 220, unit: "°" },
      { key: "opacity", label: "濃さ", type: "number", min: 0.4, max: 1, step: 0.05, default: 0.85, unit: "" },
    ],
  },
  {
    id: "decor-brush",
    name: "ブラシストローク帯",
    category: "decor",
    description:
      "端がガタついた手塗り風の帯。手書き・エモ・生々しさ。roughnessでかすれ具合を調整。",
    params: [
      {
        key: "color",
        label: "色",
        type: "enum",
        default: "color",
        options: [
          { value: "color", label: "カラー" },
          { value: "black", label: "黒" },
          { value: "white", label: "白" },
        ],
      },
      { key: "hue", label: "カラー時の色相", type: "number", min: 0, max: 360, step: 10, default: 0, unit: "°" },
      { key: "roughness", label: "ガタつき", type: "number", min: 3, max: 16, step: 1, default: 8, unit: "%" },
      { key: "opacity", label: "濃さ", type: "number", min: 0.4, max: 1, step: 0.05, default: 0.85, unit: "" },
    ],
  },
  {
    id: "decor-stripe",
    name: "縞テクスチャ帯",
    category: "decor",
    description:
      "ストライプ模様の帯。リズム感・ストリート・警告テープ風。アップテンポの行に。",
    params: [
      {
        key: "color",
        label: "色",
        type: "enum",
        default: "black",
        options: [
          { value: "black", label: "黒" },
          { value: "white", label: "白" },
          { value: "color", label: "カラー" },
        ],
      },
      { key: "hue", label: "カラー時の色相", type: "number", min: 0, max: 360, step: 10, default: 320, unit: "°" },
      { key: "width", label: "縞の幅", type: "number", min: 6, max: 24, step: 2, default: 12, unit: "px" },
    ],
  },
  {
    id: "decor-underline",
    name: "アンダーライン",
    category: "decor",
    description:
      "文字に沿って線がスッと伸びる強調の基本形。どの出方とも組み合わせられる（出方連動の「波線が走る」とは独立）。",
    params: [
      { key: "thickness", label: "太さ", type: "number", min: 2, max: 8, step: 0.5, default: 4, unit: "px" },
      {
        key: "color",
        label: "色",
        type: "enum",
        default: "white",
        options: [
          { value: "white", label: "白" },
          { value: "color", label: "カラー" },
        ],
      },
      { key: "hue", label: "カラー時の色相", type: "number", min: 0, max: 360, step: 10, default: 340, unit: "°" },
    ],
  },
  {
    id: "decor-marker",
    name: "蛍光マーカー",
    category: "decor",
    description:
      "文字の下半分に半透明の太線。教科書に引くあのマーカー。日常感・青春・ここテストに出ます。",
    params: [
      { key: "hue", label: "色", type: "number", min: 0, max: 360, step: 10, default: 55, unit: "°" },
      { key: "opacity", label: "濃さ", type: "number", min: 0.3, max: 0.8, step: 0.05, default: 0.55, unit: "" },
      { key: "coverage", label: "かかり幅", type: "number", min: 0.3, max: 0.7, step: 0.05, default: 0.5, unit: "" },
    ],
  },
  {
    id: "decor-underline-dash",
    name: "点線下線",
    category: "decor",
    description: "ドット状の下線。メモ書き・かわいい・ゆるさ。手帳の走り書き感。",
    params: [
      { key: "thickness", label: "太さ", type: "number", min: 2, max: 10, step: 0.5, default: 5, unit: "px" },
      { key: "dash", label: "点の間隔", type: "number", min: 4, max: 20, step: 1, default: 10, unit: "px" },
      {
        key: "color",
        label: "色",
        type: "enum",
        default: "white",
        options: [
          { value: "white", label: "白" },
          { value: "color", label: "カラー" },
        ],
      },
      { key: "hue", label: "カラー時の色相", type: "number", min: 0, max: 360, step: 10, default: 340, unit: "°" },
    ],
  },
  {
    id: "decor-sideline",
    name: "サイドライン",
    category: "decor",
    description:
      "行頭にアクセントの縦棒（縦書きは行の上に横棒）。引用・語り・セリフの気配。glowで光らせられる。",
    params: [
      { key: "thickness", label: "太さ", type: "number", min: 3, max: 12, step: 1, default: 6, unit: "px" },
      {
        key: "color",
        label: "色",
        type: "enum",
        default: "color",
        options: [
          { value: "color", label: "カラー" },
          { value: "white", label: "白" },
        ],
      },
      { key: "hue", label: "カラー時の色相", type: "number", min: 0, max: 360, step: 10, default: 200, unit: "°" },
      { key: "glow", label: "光らせ", type: "number", min: 0, max: 1, step: 0.1, default: 0.4, unit: "" },
    ],
  },
  {
    id: "decor-double-line",
    name: "二重線",
    category: "decor",
    description:
      "文字の上下（縦書きは左右）を細線で挟む。見出し・格言・タイトルの風格。",
    params: [
      { key: "thickness", label: "太さ", type: "number", min: 1, max: 5, step: 0.5, default: 2, unit: "px" },
      { key: "gap", label: "文字との距離", type: "number", min: 6, max: 20, step: 1, default: 10, unit: "px" },
      {
        key: "color",
        label: "色",
        type: "enum",
        default: "white",
        options: [
          { value: "white", label: "白" },
          { value: "color", label: "カラー" },
        ],
      },
      { key: "hue", label: "カラー時の色相", type: "number", min: 0, max: 360, step: 10, default: 340, unit: "°" },
    ],
  },
  {
    id: "decor-bracket",
    name: "ブラケット",
    category: "decor",
    description:
      "［ ］が行頭・行末を挟む。字幕・ト書き・システムメッセージの記号感。",
    params: [
      { key: "weight", label: "線の太さ", type: "number", min: 2, max: 8, step: 0.5, default: 5, unit: "px" },
      { key: "size", label: "腕の長さ", type: "number", min: 0.3, max: 1, step: 0.05, default: 0.7, unit: "em" },
      {
        key: "color",
        label: "色",
        type: "enum",
        default: "white",
        options: [
          { value: "white", label: "白" },
          { value: "color", label: "カラー" },
        ],
      },
      { key: "hue", label: "カラー時の色相", type: "number", min: 0, max: 360, step: 10, default: 340, unit: "°" },
    ],
  },
  {
    id: "decor-neon-frame",
    name: "ネオン枠",
    category: "decor",
    description: "発光する角丸ボーダーで歌詞を囲む。サイバー・夜の街・クラブ。",
    params: [
      { key: "hue", label: "色", type: "number", min: 0, max: 360, step: 10, default: 190, unit: "°" },
      { key: "thickness", label: "太さ", type: "number", min: 1, max: 5, step: 0.5, default: 2.5, unit: "px" },
      { key: "glow", label: "光の強さ", type: "number", min: 0.2, max: 1, step: 0.1, default: 0.7, unit: "" },
    ],
  },
  {
    id: "decor-dash-frame",
    name: "破線枠",
    category: "decor",
    description: "点線のボーダーで歌詞を囲む。切り取り線・クーポン・クラフト感。",
    params: [
      { key: "thickness", label: "太さ", type: "number", min: 1, max: 5, step: 0.5, default: 2.5, unit: "px" },
      {
        key: "color",
        label: "色",
        type: "enum",
        default: "white",
        options: [
          { value: "white", label: "白" },
          { value: "color", label: "カラー" },
        ],
      },
      { key: "hue", label: "カラー時の色相", type: "number", min: 0, max: 360, step: 10, default: 340, unit: "°" },
    ],
  },
  {
    id: "decor-corner-frame",
    name: "コーナーフレーム",
    category: "decor",
    description:
      "四隅だけのカギ枠。カメラのファインダー・ドキュメンタリー・監視の視線。",
    params: [
      { key: "thickness", label: "太さ", type: "number", min: 2, max: 6, step: 0.5, default: 4, unit: "px" },
      { key: "size", label: "カギの長さ", type: "number", min: 0.3, max: 0.9, step: 0.05, default: 0.65, unit: "em" },
      {
        key: "color",
        label: "色",
        type: "enum",
        default: "white",
        options: [
          { value: "white", label: "白" },
          { value: "color", label: "カラー" },
        ],
      },
      { key: "hue", label: "カラー時の色相", type: "number", min: 0, max: 360, step: 10, default: 120, unit: "°" },
    ],
  },
  {
    id: "decor-stamp-circle",
    name: "丸スタンプ枠",
    category: "decor",
    description:
      "手押しの判子風だ円がポンッと押される。認印・合格・青春の勢い。",
    params: [
      { key: "hue", label: "色", type: "number", min: 0, max: 360, step: 10, default: 5, unit: "°" },
      { key: "thickness", label: "太さ", type: "number", min: 2, max: 6, step: 0.5, default: 3.5, unit: "px" },
      { key: "rotate", label: "傾き", type: "number", min: -15, max: 15, step: 1, default: -6, unit: "°" },
    ],
  },
  {
    id: "decor-glow-pad",
    name: "背後グロー",
    category: "decor",
    description:
      "文字の後ろにふわっと光だまり。夜景・ネオン・切ない発光。文字を潰さず空気だけ足せる。",
    params: [
      { key: "hue", label: "色", type: "number", min: 0, max: 360, step: 10, default: 320, unit: "°" },
      { key: "size", label: "広がり", type: "number", min: 0.5, max: 2, step: 0.1, default: 1, unit: "" },
      { key: "intensity", label: "強さ", type: "number", min: 0.2, max: 1, step: 0.05, default: 0.6, unit: "" },
    ],
  },
  {
    id: "decor-long-shadow",
    name: "ロングシャドウ",
    category: "decor",
    description:
      "斜めに長く伸びる影。フラットデザイン・タイトルの風格。キメの一言をポスターにする。",
    params: [
      { key: "length", label: "影の長さ", type: "number", min: 6, max: 40, step: 2, default: 18, unit: "px" },
      {
        key: "direction",
        label: "方向",
        type: "enum",
        default: "right",
        options: [
          { value: "right", label: "右下へ" },
          { value: "left", label: "左下へ" },
        ],
      },
      { key: "opacity", label: "濃さ", type: "number", min: 0.3, max: 0.9, step: 0.05, default: 0.55, unit: "" },
    ],
  },
  {
    id: "decor-spotlight",
    name: "背後スポットライト",
    category: "decor",
    description:
      "上から差す光の中に歌詞が立つ。ステージ・独白・神様の視線。バラードのサビ前に。",
    params: [
      { key: "hue", label: "光の色", type: "number", min: 0, max: 360, step: 5, default: 45, unit: "°" },
      { key: "intensity", label: "強さ", type: "number", min: 0.15, max: 0.8, step: 0.05, default: 0.45, unit: "" },
      { key: "spread", label: "広がり", type: "number", min: 1, max: 2, step: 0.1, default: 1.4, unit: "" },
    ],
  },
  {
    id: "decor-halo-ring",
    name: "光彩リング",
    category: "decor",
    description:
      "文字の背後で光の輪がゆっくり脈打つ。神聖・覚醒・クライマックスの一行に。",
    params: [
      { key: "hue", label: "色", type: "number", min: 0, max: 360, step: 10, default: 190, unit: "°" },
      { key: "size", label: "輪の大きさ", type: "number", min: 1, max: 3, step: 0.1, default: 1.8, unit: "em" },
      { key: "pulse", label: "脈動", type: "number", min: 0, max: 1, step: 0.1, default: 0.5, unit: "" },
    ],
  },
  {
    id: "decor-chroma-edge",
    name: "色収差ふち",
    category: "decor",
    description:
      "文字の背後に赤/青の残像を敷く。ローファイ・グリッチ・VHSの気配。動きの激しい出方と好相性。",
    params: [
      { key: "shift", label: "ずれ幅", type: "number", min: 2, max: 14, step: 1, default: 6, unit: "px" },
      { key: "opacity", label: "濃さ", type: "number", min: 0.3, max: 1, step: 0.05, default: 0.7, unit: "" },
    ],
  },
  {
    id: "decor-tape",
    name: "マスキングテープ",
    category: "decor",
    description:
      "半透明テープが歌詞の両端をとめる。日記・スクラップブック・思い出の一枚。",
    params: [
      { key: "hue", label: "テープの色", type: "number", min: 0, max: 360, step: 10, default: 45, unit: "°" },
      { key: "opacity", label: "濃さ", type: "number", min: 0.4, max: 1, step: 0.05, default: 0.7, unit: "" },
      { key: "angle", label: "貼る角度", type: "number", min: 20, max: 70, step: 5, default: 45, unit: "°" },
    ],
  },
  {
    id: "decor-sticky",
    name: "付箋",
    category: "decor",
    description:
      "パステルの付箋紙に歌詞が乗る。メモ・ひとりごと・かわいい小声。めくれ付き。",
    params: [
      { key: "hue", label: "紙の色", type: "number", min: 0, max: 360, step: 10, default: 50, unit: "°" },
      { key: "rotate", label: "傾き", type: "number", min: -8, max: 8, step: 1, default: -2, unit: "°" },
      { key: "opacity", label: "濃さ", type: "number", min: 0.6, max: 1, step: 0.05, default: 0.92, unit: "" },
    ],
  },
  {
    id: "decor-label-tag",
    name: "ラベルタグ",
    category: "decor",
    description:
      "先端が尖った値札タグ＋穴。名づけ・ハッシュタグ・値付けされた気持ち。",
    params: [
      { key: "hue", label: "色", type: "number", min: 0, max: 360, step: 10, default: 20, unit: "°" },
      { key: "opacity", label: "濃さ", type: "number", min: 0.5, max: 1, step: 0.05, default: 0.9, unit: "" },
    ],
  },
  {
    id: "decor-newspaper",
    name: "切り抜き新聞",
    category: "decor",
    description:
      "破いた紙の上に歌詞が乗る。回想・報道・不穏な告白。agingで紙の黄ばみを調整。",
    params: [
      { key: "rotate", label: "傾き", type: "number", min: -6, max: 6, step: 0.5, default: -1.5, unit: "°" },
      { key: "aging", label: "黄ばみ", type: "number", min: 0, max: 1, step: 0.1, default: 0.5, unit: "" },
    ],
  },
  {
    id: "decor-sticker-white",
    name: "シール白ふち",
    category: "decor",
    description:
      "ダイカットステッカーの白ふち＋濃色パッド。ポップ・ストリート・配信サムネの声。",
    params: [
      { key: "border", label: "ふちの太さ", type: "number", min: 4, max: 18, step: 1, default: 10, unit: "px" },
      { key: "radius", label: "角丸", type: "number", min: 6, max: 32, step: 2, default: 18, unit: "px" },
      { key: "opacity", label: "濃さ", type: "number", min: 0.6, max: 1, step: 0.05, default: 0.95, unit: "" },
    ],
  },
  {
    id: "decor-quotes",
    name: "引用符",
    category: "decor",
    description:
      "大きな“ ”が行を挟む。詩・独白・誰かの言葉を借りるとき。",
    params: [
      { key: "size", label: "大きさ", type: "number", min: 0.8, max: 2, step: 0.1, default: 1.3, unit: "em" },
      {
        key: "color",
        label: "色",
        type: "enum",
        default: "white",
        options: [
          { value: "white", label: "白" },
          { value: "color", label: "カラー" },
        ],
      },
      { key: "hue", label: "カラー時の色相", type: "number", min: 0, max: 360, step: 10, default: 340, unit: "°" },
    ],
  },
  {
    id: "decor-sparkles",
    name: "キラキラ散らし",
    category: "decor",
    description:
      "文字の周りで小さな星がまたたく。夢・魔法・ときめき。かわいい曲の味方。",
    params: [
      { key: "count", label: "数", type: "number", min: 6, max: 20, step: 1, default: 12, unit: "個" },
      { key: "size", label: "大きさ", type: "number", min: 0.15, max: 0.5, step: 0.05, default: 0.3, unit: "em" },
      {
        key: "color",
        label: "色",
        type: "enum",
        default: "color",
        options: [
          { value: "color", label: "カラー" },
          { value: "white", label: "白" },
        ],
      },
      { key: "hue", label: "カラー時の色相", type: "number", min: 0, max: 360, step: 10, default: 55, unit: "°" },
    ],
  },
  {
    id: "decor-dots",
    name: "ドット散らし",
    category: "decor",
    description:
      "色つきの丸がポップに弾けて散る。楽しい・跳ねる・コーラスの賑やかし。",
    params: [
      { key: "count", label: "数", type: "number", min: 6, max: 24, step: 1, default: 14, unit: "個" },
      { key: "size", label: "大きさ", type: "number", min: 0.08, max: 0.3, step: 0.02, default: 0.16, unit: "em" },
      {
        key: "palette",
        label: "配色",
        type: "enum",
        default: "mono",
        options: [
          { value: "mono", label: "単色" },
          { value: "rainbow", label: "レインボー" },
        ],
      },
      { key: "hue", label: "単色時の色相", type: "number", min: 0, max: 360, step: 10, default: 320, unit: "°" },
    ],
  },
  {
    id: "decor-angle-emphasis",
    name: "山括弧強調",
    category: "decor",
    description:
      "≫ ≪が両側から迫り続ける。漫画の集中線的なキメ・ツッコミ・畳みかけ。",
    params: [
      { key: "size", label: "大きさ", type: "number", min: 0.5, max: 1.4, step: 0.1, default: 0.8, unit: "em" },
      {
        key: "color",
        label: "色",
        type: "enum",
        default: "white",
        options: [
          { value: "white", label: "白" },
          { value: "color", label: "カラー" },
        ],
      },
      { key: "hue", label: "カラー時の色相", type: "number", min: 0, max: 360, step: 10, default: 0, unit: "°" },
    ],
  },
  {
    id: "decor-flourish",
    name: "花あしらい",
    category: "decor",
    description:
      "❋が両端でゆっくり回りながら咲く。和・レトロ・歌集の飾り罫。",
    params: [
      { key: "size", label: "大きさ", type: "number", min: 0.5, max: 1.5, step: 0.1, default: 0.9, unit: "em" },
      {
        key: "color",
        label: "色",
        type: "enum",
        default: "color",
        options: [
          { value: "color", label: "カラー" },
          { value: "white", label: "白" },
        ],
      },
      { key: "hue", label: "カラー時の色相", type: "number", min: 0, max: 360, step: 10, default: 350, unit: "°" },
      {
        key: "spin",
        label: "回転",
        type: "enum",
        default: "on",
        options: [
          { value: "on", label: "ゆっくり回る" },
          { value: "off", label: "止まる" },
        ],
      },
    ],
  },
  {
    id: "decor-neon-script",
    name: "電撃ライン",
    category: "decor",
    description:
      "画面幅いっぱいの細い光の線が、平坦な波から針金の走り書きへ変形して静かに佇む。うねりつまみを上げると震え・ボイルが加わり雷のように生きて見える。エモ・幻想・夜の見せ場行に。うにょうにょ集合(lyric-gather)と好相性。",
    params: [
      {
        key: "shape",
        label: "走り方",
        type: "enum",
        default: "wire",
        options: [
          { value: "wire", label: "針金の迷走" },
          { value: "storm", label: "左ループ→右下抜け" },
          { value: "loop", label: "右ループ→下抜け" },
          { value: "jagged", label: "ギザギザ多め" },
        ],
      },
      {
        key: "color",
        label: "色",
        type: "enum",
        default: "white",
        options: [
          { value: "white", label: "象牙" },
          { value: "color", label: "カラー" },
        ],
      },
      { key: "hue", label: "カラー時の色相", type: "number", min: 0, max: 360, step: 10, default: 45, unit: "°" },
      { key: "drawTime", label: "変形時間", type: "number", min: 0.4, max: 3, step: 0.1, default: 1.2, unit: "秒" },
      { key: "thickness", label: "太さ", type: "number", min: 1, max: 8, step: 0.5, default: 2.5, unit: "px" },
      { key: "glow", label: "発光", type: "number", min: 0, max: 1, step: 0.05, default: 0.8, unit: "" },
      { key: "wobble", label: "うねり", type: "number", min: 0, max: 1, step: 0.05, default: 0, unit: "" },
      { key: "delay", label: "出だし遅れ", type: "number", min: 0, max: 2, step: 0.05, default: 0.2, unit: "秒" },
      {
        key: "engine",
        label: "描画",
        type: "enum",
        default: "gpu",
        options: [
          { value: "gpu", label: "GPU発光（本物の光）" },
          { value: "svg", label: "旧SVG（帯）" },
        ],
      },
    ],
  },
  {
    id: "lyric-underline",
    name: "波線が走る",
    category: "lyric",
    description:
      "歌詞の下に波線（または直線）がシュッと描かれてから一緒に消える。強調したい一言・エモの余韻に。",
    params: [
      {
        key: "shape",
        label: "線の形",
        type: "enum",
        default: "wave",
        options: [
          { value: "wave", label: "波線" },
          { value: "straight", label: "直線" },
        ],
      },
      { key: "drawTime", label: "描く時間", type: "number", min: 0.2, max: 1.5, step: 0.1, default: 0.6, unit: "s" },
      { key: "thickness", label: "太さ", type: "number", min: 1, max: 8, step: 0.5, default: 3, unit: "px" },
    ],
  },
  {
    id: "lyric-blur-in",
    name: "ブラーイン",
    category: "lyric",
    description: "ピンボケから焦点が合って文字が現れる。回想・夢・意識が戻る瞬間に。",
    params: [
      { key: "blur", label: "ボケ幅", type: "number", min: 4, max: 40, step: 2, default: 16, unit: "px" },
      { key: "inDuration", label: "合う時間", type: "number", min: 0.2, max: 1.5, step: 0.1, default: 0.6, unit: "s" },
    ],
  },
  {
    id: "lyric-wiggle",
    name: "ゆらぎ（震え）",
    category: "lyric",
    description:
      "文字が1字ずつ不規則に震え続ける。不安・寒さ・緊張・電波の乱れ。強くすると恐怖、弱くすると心細さ。",
    params: [
      { key: "amount", label: "震え幅", type: "number", min: 1, max: 15, step: 1, default: 4, unit: "px" },
      { key: "speed", label: "速さ", type: "number", min: 0.5, max: 8, step: 0.5, default: 3, unit: "x" },
    ],
  },
  {
    id: "lyric-tracking",
    name: "字間ひらき",
    category: "lyric",
    description:
      "広がった字間がスッと閉じながら（または開きながら）フェード。映画タイトルの風格。エンドカードにも。",
    params: [
      {
        key: "direction",
        label: "動き",
        type: "enum",
        default: "close",
        options: [
          { value: "close", label: "開→閉じる" },
          { value: "open", label: "閉→開いていく" },
        ],
      },
      { key: "spacing", label: "開き幅", type: "number", min: 0.1, max: 1, step: 0.05, default: 0.4, unit: "em" },
      { key: "inDuration", label: "時間", type: "number", min: 0.3, max: 2, step: 0.1, default: 0.9, unit: "s" },
    ],
  },
  {
    id: "lyric-bounce",
    name: "バウンス",
    category: "lyric",
    description: "文字が1字ずつ弾んで着地する。アップテンポ・楽しい・かわいい曲に。",
    params: [
      { key: "stagger", label: "文字の間隔", type: "number", min: 0.02, max: 0.12, step: 0.01, default: 0.05, unit: "s" },
      { key: "height", label: "弾む高さ", type: "number", min: 10, max: 80, step: 5, default: 30, unit: "px" },
    ],
  },
  {
    id: "lyric-flip3d",
    name: "3Dフリップ",
    category: "lyric",
    description: "文字が1字ずつパタパタと回転しながら起き上がる。ボカロMVの定番様式。スタイリッシュ。",
    params: [
      {
        key: "axis",
        label: "回転軸",
        type: "enum",
        default: "x",
        options: [
          { value: "x", label: "縦にパタパタ" },
          { value: "y", label: "横にクルッ" },
        ],
      },
      { key: "stagger", label: "文字の間隔", type: "number", min: 0.02, max: 0.12, step: 0.01, default: 0.04, unit: "s" },
    ],
  },
  // ==== MPテロップ流モーション（クリーンルーム実装の45プリセット） ====
  // 署名: 方向ブラー＋不透明度フェード＋微アイドル揺れ。in/out・方向・軸をパラメータ化して
  // 25部品で45プリセットに1:1対応（詳細は remotion/lyrics/LyricLine.tsx のMPモーション表）。
  // --- 遷移系（登場/退場をmodeで切替） ---
  {
    id: "lyric-mp-slide",
    name: "スライド（MP流）",
    category: "lyric",
    description: "指定方向からブラーを引きつつ移動。スライドイン/アウト/アップ/ダウン系。",
    params: [
      { key: "mode", label: "動作", type: "enum", default: "in", options: [{ value: "in", label: "登場" }, { value: "out", label: "退場" }] },
      { key: "direction", label: "方向", type: "enum", default: "up", options: [{ value: "up", label: "下から上" }, { value: "down", label: "上から下" }, { value: "left", label: "右から左" }, { value: "right", label: "左から右" }] },
      { key: "distance", label: "移動量", type: "number", min: 20, max: 300, step: 10, default: 120, unit: "px" },
      { key: "blur", label: "方向ブラー", type: "number", min: 0, max: 32, step: 1, default: 24, unit: "" },
      { key: "inDuration", label: "尺", type: "number", min: 0.2, max: 1.2, step: 0.05, default: 0.55, unit: "s" },
    ],
  },
  {
    id: "lyric-mp-turn",
    name: "ターン（MP流）",
    category: "lyric",
    description: "軸回転しながらブラー付きで出入り。ターンイン/アウト系。強調・見出し向き。",
    params: [
      { key: "mode", label: "動作", type: "enum", default: "in", options: [{ value: "in", label: "登場" }, { value: "out", label: "退場" }] },
      { key: "direction", label: "回転軸", type: "enum", default: "up", options: [{ value: "up", label: "縦（X軸）" }, { value: "left", label: "横（Y軸）" }] },
      { key: "angle", label: "回転角", type: "number", min: 30, max: 180, step: 10, default: 90, unit: "deg" },
      { key: "blur", label: "方向ブラー", type: "number", min: 0, max: 32, step: 1, default: 20, unit: "" },
      { key: "inDuration", label: "尺", type: "number", min: 0.2, max: 1.2, step: 0.05, default: 0.6, unit: "s" },
    ],
  },
  {
    id: "lyric-mp-mask",
    name: "マスクワイプ（MP流）",
    category: "lyric",
    description: "帯状に一気に現れ/消えるワイプ。マスクイン/アウト(横縦)系。切替の効いた場面向き。",
    params: [
      { key: "mode", label: "動作", type: "enum", default: "in", options: [{ value: "in", label: "登場" }, { value: "out", label: "退場" }] },
      { key: "direction", label: "ワイプ方向", type: "enum", default: "left", options: [{ value: "left", label: "左→右" }, { value: "right", label: "右→左" }, { value: "up", label: "下→上" }, { value: "down", label: "上→下" }] },
      { key: "inDuration", label: "尺", type: "number", min: 0.2, max: 1.0, step: 0.05, default: 0.5, unit: "s" },
    ],
  },
  {
    id: "lyric-mp-pop",
    name: "ポップ（MP流）",
    category: "lyric",
    description: "少しオーバーシュートして弾む拡大登場。ポップアップ系。サビ・強調ワード向き。",
    params: [
      { key: "from", label: "開始スケール", type: "number", min: 0.2, max: 0.95, step: 0.05, default: 0.6, unit: "" },
      { key: "overshoot", label: "行き過ぎ量", type: "number", min: 1.0, max: 1.3, step: 0.02, default: 1.08, unit: "" },
      { key: "blur", label: "ブラー", type: "number", min: 0, max: 32, step: 1, default: 12, unit: "" },
      { key: "inDuration", label: "尺", type: "number", min: 0.2, max: 1.0, step: 0.05, default: 0.5, unit: "s" },
    ],
  },
  {
    id: "lyric-mp-scale",
    name: "拡大縮小（MP流）",
    category: "lyric",
    description: "スケールで出入り。拡大/縮小系。ゆったり登場・退場向き。",
    params: [
      { key: "mode", label: "動作", type: "enum", default: "in", options: [{ value: "in", label: "登場" }, { value: "out", label: "退場" }] },
      { key: "scaleMode", label: "種類", type: "enum", default: "grow", options: [{ value: "grow", label: "拡大（小→大）" }, { value: "shrink", label: "縮小（大→小）" }] },
      { key: "inDuration", label: "尺", type: "number", min: 0.2, max: 1.4, step: 0.05, default: 0.7, unit: "s" },
    ],
  },
  {
    id: "lyric-mp-fly",
    name: "ズーム飛び（MP流）",
    category: "lyric",
    description: "ズームブラー付きで手前へ飛び込む/飛び出す。飛び込み/飛び出し系。インパクト向き。",
    params: [
      { key: "mode", label: "動作", type: "enum", default: "in", options: [{ value: "in", label: "飛び込み（登場）" }, { value: "out", label: "飛び出し（退場）" }] },
      { key: "blur", label: "ズームブラー", type: "number", min: 0, max: 40, step: 1, default: 28, unit: "" },
      { key: "inDuration", label: "尺", type: "number", min: 0.2, max: 1.0, step: 0.05, default: 0.5, unit: "s" },
    ],
  },
  {
    id: "lyric-mp-blur",
    name: "ブラー（MP流）",
    category: "lyric",
    description: "強いボケから合焦/散焦で出入り。ブラーイン/アウト系。しっとり・余韻向き。",
    params: [
      { key: "mode", label: "動作", type: "enum", default: "in", options: [{ value: "in", label: "登場" }, { value: "out", label: "退場" }] },
      { key: "blur", label: "初期ブラー", type: "number", min: 8, max: 48, step: 1, default: 32, unit: "" },
      { key: "inDuration", label: "尺", type: "number", min: 0.3, max: 1.4, step: 0.05, default: 0.7, unit: "s" },
    ],
  },
  {
    id: "lyric-mp-fade",
    name: "フェード（MP流）",
    category: "lyric",
    description: "不透明度だけで出入り。フェードイン/アウト系。最も素直で万能。",
    params: [
      { key: "mode", label: "動作", type: "enum", default: "in", options: [{ value: "in", label: "登場" }, { value: "out", label: "退場" }] },
      { key: "inDuration", label: "尺", type: "number", min: 0.2, max: 1.4, step: 0.05, default: 0.6, unit: "s" },
    ],
  },
  {
    id: "lyric-mp-crop",
    name: "クロップ（MP流）",
    category: "lyric",
    description: "幅を絞る/開くクロップ＋わずかな回転で出入り。クロップイン/アウト(中央/左)系。",
    params: [
      { key: "mode", label: "動作", type: "enum", default: "in", options: [{ value: "in", label: "登場" }, { value: "out", label: "退場" }] },
      { key: "origin", label: "基準", type: "enum", default: "center", options: [{ value: "center", label: "中央" }, { value: "left", label: "左" }] },
      { key: "inDuration", label: "尺", type: "number", min: 0.2, max: 1.0, step: 0.05, default: 0.5, unit: "s" },
    ],
  },
  {
    id: "lyric-mp-stripe",
    name: "ストライプ（MP流）",
    category: "lyric",
    description: "縞状に走査して出入り。ストライプイン/アウト系。デジタル感のある場面向き。",
    params: [
      { key: "mode", label: "動作", type: "enum", default: "in", options: [{ value: "in", label: "登場" }, { value: "out", label: "退場" }] },
      { key: "stripes", label: "縞の数", type: "number", min: 4, max: 24, step: 1, default: 10, unit: "" },
      { key: "inDuration", label: "尺", type: "number", min: 0.3, max: 1.2, step: 0.05, default: 0.6, unit: "s" },
    ],
  },
  {
    id: "lyric-mp-scrape",
    name: "スクレイプ（MP流）",
    category: "lyric",
    description: "こすり取るように滲みながら出入り。スクレイプイン/アウト系。ラフ・ストリート向き。",
    params: [
      { key: "mode", label: "動作", type: "enum", default: "in", options: [{ value: "in", label: "登場" }, { value: "out", label: "退場" }] },
      { key: "inDuration", label: "尺", type: "number", min: 0.3, max: 1.2, step: 0.05, default: 0.6, unit: "s" },
    ],
  },
  {
    id: "lyric-mp-fall",
    name: "落下（MP流）",
    category: "lyric",
    description: "重力で上から落ちて着地。落下系。コミカル・弾みのある場面向き。",
    params: [
      { key: "distance", label: "落下量", type: "number", min: 40, max: 400, step: 10, default: 160, unit: "px" },
      { key: "inDuration", label: "尺", type: "number", min: 0.3, max: 1.2, step: 0.05, default: 0.6, unit: "s" },
    ],
  },
  // --- 常駐系（表示中ずっと動く） ---
  {
    id: "lyric-mp-move",
    name: "移動（MP流）",
    category: "lyric",
    description: "表示中ずっと横へゆっくり流れる。移動系。テロップ的な連続移動。",
    params: [
      { key: "direction", label: "方向", type: "enum", default: "left", options: [{ value: "left", label: "左へ" }, { value: "right", label: "右へ" }] },
      { key: "speed", label: "速さ", type: "number", min: 2, max: 60, step: 2, default: 16, unit: "px/s" },
    ],
  },
  {
    id: "lyric-mp-jitter",
    name: "ガクガク（MP流）",
    category: "lyric",
    description: "カクカク量子化されたランダム振動。ガクガク系。緊張・グリッチ感。",
    params: [
      { key: "amount", label: "振れ幅", type: "number", min: 2, max: 40, step: 1, default: 12, unit: "px" },
      { key: "interval", label: "更新間隔", type: "number", min: 1, max: 8, step: 1, default: 3, unit: "f" },
    ],
  },
  {
    id: "lyric-mp-bound",
    name: "バウンド（MP流）",
    category: "lyric",
    description: "シアー付きで弾むように上下する。バウンド系。ポップ・元気な場面向き。",
    params: [
      { key: "amount", label: "弾み量", type: "number", min: 4, max: 60, step: 2, default: 20, unit: "px" },
      { key: "speed", label: "速さ", type: "number", min: 0.5, max: 4, step: 0.1, default: 1.6, unit: "Hz" },
    ],
  },
  {
    id: "lyric-mp-stretch",
    name: "伸縮（MP流）",
    category: "lyric",
    description: "軸方向に伸び縮みを繰り返す。伸縮(横/縦)系。ぷにぷに・弾力感。",
    params: [
      { key: "axis", label: "軸", type: "enum", default: "x", options: [{ value: "x", label: "横" }, { value: "y", label: "縦" }] },
      { key: "amount", label: "伸縮量", type: "number", min: 0.02, max: 0.4, step: 0.02, default: 0.14, unit: "" },
      { key: "speed", label: "速さ", type: "number", min: 0.5, max: 4, step: 0.1, default: 1.5, unit: "Hz" },
    ],
  },
  {
    id: "lyric-mp-vibrate",
    name: "振動（MP流）",
    category: "lyric",
    description: "軸方向に小刻みに震える。振動(横/縦)系。細かい緊張感・効果音的。",
    params: [
      { key: "axis", label: "軸", type: "enum", default: "x", options: [{ value: "x", label: "横" }, { value: "y", label: "縦" }] },
      { key: "amount", label: "振幅", type: "number", min: 1, max: 20, step: 1, default: 5, unit: "px" },
    ],
  },
  {
    id: "lyric-mp-sway",
    name: "揺れ（MP流）",
    category: "lyric",
    description: "軸方向にゆったり揺れる。揺れ(横/縦)系。たゆたう・浮遊感。",
    params: [
      { key: "axis", label: "軸", type: "enum", default: "x", options: [{ value: "x", label: "横" }, { value: "y", label: "縦" }] },
      { key: "amount", label: "揺れ幅", type: "number", min: 3, max: 40, step: 1, default: 14, unit: "px" },
      { key: "speed", label: "速さ", type: "number", min: 0.2, max: 2, step: 0.1, default: 0.7, unit: "Hz" },
    ],
  },
  {
    id: "lyric-mp-echo",
    name: "残像（MP流）",
    category: "lyric",
    description: "動きに残像を引く。残像系。スピード感・サイバー演出。",
    params: [
      { key: "distance", label: "残像距離", type: "number", min: 4, max: 60, step: 2, default: 18, unit: "px" },
      { key: "count", label: "残像数", type: "number", min: 1, max: 5, step: 1, default: 3, unit: "" },
    ],
  },
  {
    id: "lyric-mp-wave",
    name: "波形ワープ（MP流）",
    category: "lyric",
    description: "文字列が波打つ。波形ワープ系。やわらか・遊びのある場面向き。",
    params: [
      { key: "amplitude", label: "振幅", type: "number", min: 2, max: 30, step: 1, default: 10, unit: "px" },
      { key: "speed", label: "速さ", type: "number", min: 0.3, max: 3, step: 0.1, default: 1.2, unit: "Hz" },
    ],
  },
  {
    id: "lyric-mp-blink",
    name: "点滅（MP流）",
    category: "lyric",
    description: "不透明度がランダムに明滅。点滅系。警告・故障・ネオン感。",
    params: [
      { key: "speed", label: "速さ", type: "number", min: 1, max: 12, step: 1, default: 6, unit: "Hz" },
    ],
  },
  {
    id: "lyric-mp-shockwave",
    name: "衝撃波（MP流）",
    category: "lyric",
    description: "登場時にドンと衝撃波状に膨らんで戻る。衝撃波系。強打・アクセント向き。",
    params: [
      { key: "strength", label: "強さ", type: "number", min: 0.1, max: 1, step: 0.05, default: 0.4, unit: "" },
    ],
  },
  {
    id: "lyric-mp-sparkle",
    name: "キラキラ（MP流）",
    category: "lyric",
    description: "発光の粒がまとわりつく。キラキラ系。華やか・ゴージャス演出。",
    params: [
      { key: "density", label: "粒の量", type: "number", min: 4, max: 40, step: 2, default: 16, unit: "" },
    ],
  },
  {
    id: "lyric-mp-twinkle",
    name: "スパークル（MP流）",
    category: "lyric",
    description: "回転する光条のきらめき。スパークル系。上品な輝き。",
    params: [
      { key: "intensity", label: "輝き", type: "number", min: 0.2, max: 2, step: 0.1, default: 1, unit: "" },
    ],
  },
  {
    id: "lyric-mp-flash",
    name: "フラッシュ（MP流）",
    category: "lyric",
    description: "登場時に色付き閃光が走る。フラッシュ1/2系。切替・インパクト向き。",
    params: [
      { key: "flashMode", label: "種類", type: "enum", default: "1", options: [{ value: "1", label: "フラッシュ1（白）" }, { value: "2", label: "フラッシュ2（虹）" }] },
    ],
  },
  {
    id: "lyric-none",
    name: "表示しない",
    category: "lyric",
    description: "この行は歌詞を出さない。",
    params: [],
  },

  // ---- look（全体ルック。project.look が持ち、区間エフェクトとは別レイヤー） ----
  {
    id: "color-grade",
    name: "カラーグレード",
    category: "look",
    description:
      "露出・コントラスト・彩度・色温度・ティント・色相の基本色調整。全体ルックの土台。",
    params: [
      { key: "exposure", label: "露出", type: "number", min: 0.5, max: 1.6, step: 0.01, default: 1, unit: "x" },
      { key: "contrast", label: "コントラスト", type: "number", min: 0.5, max: 1.6, step: 0.01, default: 1, unit: "x" },
      { key: "saturation", label: "彩度", type: "number", min: 0, max: 2, step: 0.01, default: 1, unit: "x" },
      { key: "temperature", label: "色温度", type: "number", min: -100, max: 100, step: 1, default: 0, unit: "" },
      { key: "tint", label: "ティント", type: "number", min: -100, max: 100, step: 1, default: 0, unit: "" },
      { key: "hue", label: "色相", type: "number", min: -180, max: 180, step: 1, default: 0, unit: "°" },
    ],
  },
  {
    id: "vignette",
    name: "ビネット",
    category: "look",
    description:
      "四隅を暗く落として視線を中央へ。映画的な締まり。強すぎると古臭くなるので薄めが基本。",
    params: [
      { key: "amount", label: "濃さ", type: "number", min: 0, max: 1, step: 0.05, default: 0.35, unit: "" },
      { key: "size", label: "明るい範囲", type: "number", min: 20, max: 90, step: 1, default: 55, unit: "%" },
    ],
  },
  {
    id: "look-aberration",
    name: "色収差",
    category: "look",
    description:
      "RGBをわずかにずらすレンズの色ズレ。フィルム・アナログ感の隠し味。掛けすぎると滲む。",
    params: [
      { key: "amount", label: "ズレ幅", type: "number", min: 0, max: 10, step: 0.5, default: 2, unit: "px" },
    ],
  },
];

// ---- 歌詞の表示タイミングつまみ（全lyric演出共通。拡張テロップのLYRIC_PARAMSと同じ流儀） ----
// duration=0 は「行末まで」。表示窓の実体は lib/telop-window.ts の lyricWindow（LyricLine外殻で適用）
const LYRIC_TIMING_PARAMS: ParamDef[] = [
  { key: "delay", label: "出だし遅れ", type: "number", min: 0, max: 10, step: 0.1, default: 0, unit: "s" },
  { key: "duration", label: "表示時間", type: "number", min: 0, max: 15, step: 0.1, default: 0, unit: "s" },
];
for (const e of EFFECTS) {
  if (e.category === "lyric" && e.id !== "lyric-none") {
    e.params = [...e.params, ...LYRIC_TIMING_PARAMS];
  }
}

const EFFECTS_BY_ID = new Map(EFFECTS.map((e) => [e.id, e]));

/** native → 見つからなければ 拡張ブリッジ（lib/xp-bridge.ts）へフォールバック */
export const effectById = (id: string): EffectMeta | undefined =>
  isArchived(id) ? undefined : (EFFECTS_BY_ID.get(id) ?? xpBridgedEffectById(id));

export const effectsByCategory = (cat: EffectCategory): EffectMeta[] =>
  EFFECTS.filter((e) => e.category === cat && !isArchived(e.id));

/** params未指定のキーにdefaultを埋めた完全なparamsを返す */
export function resolveParams(
  id: string,
  params: Record<string, number | string> | undefined,
): Record<string, number | string> {
  const meta = effectById(id);
  if (!meta) return params ?? {};
  const out: Record<string, number | string> = {};
  for (const p of meta.params) out[p.key] = params?.[p.key] ?? p.default;
  return out;
}

/**
 * ⭐棚（手札）の単一ソース: curated 拡張（transition＋overlay＋lyric）∪ お気に入り（星）。
 * ピッカー既定表示（EffectPicker）と AI参謀カタログ（effectCatalogForAI）が
 * 同じ⭐集合を使うための共通関数。返す id はすべて "xp-" prefix 付き。
 * favorites は素id / prefix付きのどちらでも受ける（図鑑の星は素idで保存されている）。
 */
export function curatedXpEffectIds(favorites?: string[]): Set<string> {
  const set = new Set(
    [
      ...XP_CURATED_TRANSITIONS,
      ...XP_CURATED_OVERLAYS,
      ...XP_CURATED_LYRICS,
    ].map((id) => XP_EFFECT_PREFIX + id),
  );
  for (const f of favorites ?? []) {
    set.add(f.startsWith(XP_EFFECT_PREFIX) ? f : XP_EFFECT_PREFIX + f);
  }
  return new Set([...set].filter((id) => !isArchived(id)));
}

/**
 * AI参謀プロンプト用のカタログ（id/説明/つまみの範囲）。decorは当面人間の手仕事なので除外。
 * filterIds を渡すと手札をその範囲に絞る（テーマセット用）。
 */
export function effectCatalogForAI(
  filterIds?: Set<string>,
  favorites?: string[],
): string {
  // 拡張手札: curated（transition＋overlay＋lyric）＋お気に入り（星）をAIに見せる。
  // 全量（transition144＋overlay238＋subtitle77）はプロンプト爆発するため curated のみ。テーマ手札とAND。
  // ★ ピッカー既定と同一の⭐集合（curatedXpEffectIds）を単一ソースとして共有する。
  const curatedXp = curatedXpEffectIds(favorites);
  const xpHand = XP_BRIDGED_EFFECTS.filter(
    (e) =>
      curatedXp.has(e.id) &&
      (!filterIds || filterIds.has(e.id)) &&
      !isArchived(e.id),
  );
  return [
    ...EFFECTS.filter(
      (e) =>
        e.category !== "decor" &&
        e.category !== "look" && // 全体ルックは人間が1回決めるもの。行ごとの提案には出さない
        (!filterIds || filterIds.has(e.id)) &&
        !isArchived(e.id),
    ),
    ...xpHand,
  ].map((e) => {
    const params = e.params
      .map((p) =>
        p.type === "enum"
          ? `${p.key}: ${p.options?.map((o) => o.value).join("|")}`
          : `${p.key}: ${p.min}〜${p.max} (default ${p.default}${p.unit ?? ""})`,
      )
      .join(", ");
    return `- id:"${e.id}" [${e.category}] ${e.name} — ${e.description}${params ? ` | params: ${params}` : ""}`;
  }).join("\n");
}
