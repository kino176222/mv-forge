/**
 * Fish Audio の厳選ボイスプリセット（日本語・朗読向け）。
 * RAdioプロローグ検証（2026-07-02）で聴き比べた声から選定。
 * 検索でも追加できるが、まずはここから選ぶのが早い。
 */
export interface FishVoicePreset {
  id: string; // reference_id
  title: string;
  note: string; // 声の質感メモ
}

export const FISH_VOICE_PRESETS: FishVoicePreset[] = [
  {
    id: "dc4b99470b084b21bed3a7f829aa93d5",
    title: "切ない少女",
    note: "しっとり・詩の朗読の本命",
  },
  {
    id: "a01c35ce897545f6b3555f9fbe929571",
    title: "優しい切ない声",
    note: "柔らかく涙声寄り",
  },
  {
    id: "f382e8c9149a4e07b00d3c94c7b3df81",
    title: "柔らかな女性朗読",
    note: "ナレーション調で安定",
  },
  {
    id: "6bf588f97a9c4a44957d5d4437526fd9",
    title: "落ち着いたトーンの若い女性",
    note: "学生っぽい年齢感",
  },
  {
    id: "0089dce5fefb4c6ba9b9f2f0debe1ddc",
    title: "落ち着いた女性",
    note: "大人の静かな読み",
  },
  {
    id: "5161d41404314212af1254556477c17d",
    title: "元気な女性",
    note: "明るい・昼パートやナレ向き",
  },
  {
    id: "63bc41e652214372b15d9416a30a60b4",
    title: "元気な女性v2",
    note: "明るめ・少し落ち着き",
  },
  {
    id: "fbab1480ef1642c6aed95448fc8c68c7",
    title: "甘い囁き",
    note: "ASMR寄りのウィスパー",
  },
];

/** 試聴サンプル用の短い台本（生成コスト最小・声質が分かる内容） */
export const VOICE_SAMPLE_TEXT =
  "[gentle] こんばんは。眠れない夜に、そっと語りかけます。";
