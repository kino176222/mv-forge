// curated = 本編エディタ/AI参謀に既定で見せる「手札」。全量は明示操作で開く。
// 選定基準: ファミリの代表・MV汎用性・質感の被り回避。図鑑の星で随時入れ替える。

/** トランジション手札（24本 / 全144本） */
export const XP_CURATED_TRANSITIONS: string[] = [
  // 定番・繋ぎ系
  "tx-cross-fade",      // 白閃光クロス。迷ったらこれ
  "tx-fade",            // 異方性ブラー付きフェード
  "tx-dissolve",        // ぼかし溶け
  "tx-blur-cut",        // ブラー頂点カット
  // フラッシュ・光系
  "tx-flash",           // 強ブラー白フラッシュ
  "tx-flash-zoom",      // ズームパンチ+白フラッシュ
  "tx-light-leak",      // 暖色ライトリーク
  "tx-light-speed",     // 超高速ウィップ+白飛び
  // ウィップ・スライド系
  "tx-whip-pan",        // 定番ホイップパン
  "tx-double-whip-pan", // 二段ホイップ
  "tx-swoosh",          // 横流れ+スウッシュ光条
  "tx-flash-slide",     // 白フラッシュ横プッシュ
  // ズーム系
  "tx-zoom-03",       // 急ズームイン
  "tx-zoom-fade",       // ズームブラー+黒フェード
  "tx-vacuum",          // 中心吸い込み
  "tx-spin",            // 全画面スピン
  // インパクト系
  "tx-quake",           // 地震シェイク
  "tx-camera-shake",    // 急ズーム+手ブレ+色収差
  "tx-music-video-transition", // RGB分離+走査線（MV名指し）
  "tx-play-glitch",     // RGBスプリット弾け
  // 質感・フィルム系
  "tx-tape-glitch",     // VHS崩壊
  "tx-noise",           // アナログノイズ崩壊
  "tx-film-burn",       // フィルム焼け
];

/** オーバーレイ手札（38本 / effect 238本）。系統バランスで代表を選抜。
 *  手調整の mlv- 系を優先し、前回検品で崩れなかったものを採用。図鑑の星で随時入れ替える。 */
export const XP_CURATED_OVERLAYS: string[] = [
  // 光・グロー
  "fx-prism", // 色分解プリズム
  "fx-movie-light", // 映画的な差し込み光
  "fx-edge-gleam", // 輪郭の光沢
  "fx-glowing-edges", // 発光エッジ
  "fx-light-leaks", // 暖色ライトリーク
  // 粒子・水滴
  // 質感・フィルム・ヴィンテージ
  "fx-retro-look", // レトロルック
  "fx-dirts-and-scratches", // 埃・傷
  "fx-film-grunge", // フィルムグランジ
  "fx-film-emulation", // フィルムエミュ
  "fx-vintage-01", // ヴィンテージ赤網点
  "fx-film-matte-01", // フィルムマット窓
  // フレーム・枠・分割
  "fx-frame", // フィルムゲート枠
  "fx-split-screen-frame", // 分割フレーム
  "fx-photo-slideshow-03", // 写真フレーム
  "fx-viewfinder", // ビューファインダー
  // 空気・煙・ブラー
  "fx-blur", // ブラー
  "fx-dreamy-look", // ドリーミー
  "fx-dream-blur", // 夢ブラー
  "fx-soft-focus-color-look", // ソフトフォーカス
  // 歪み・色収差・屈折
  "fx-refraction", // 屈折
  // カメラ・揺れ・ズーム
  "fx-distorted-shake", // 手ブレ歪み
  "fx-handheld", // ハンドヘルド
  "fx-punch", // パンチズーム
  "fx-shake-zoom", // シェイクズーム
  // 線・エネルギー・描画（generator）
  // 色・ルック
  "fx-color-filter", // カラーフィルタ
  "fx-gradient-colorize", // グラデ着色
  "fx-mono-color", // モノカラー
];

/** 歌詞演出（lyricAnim）手札（15本 / subtitle 77本）。
 *  カラオケ定番・手描き・エレガント・巨大タイポ・ポップ・シネマ・グリッチで系統を散らす。
 *  ※拡張テロップは「デザインごと使う」（色・レイアウトはポート固定）。図鑑の星で随時入れ替える。 */
export const XP_CURATED_LYRICS: string[] = [
  // カラオケ定番（塗り進み）
  "sub-subtitle-06",  // 白極太を黄で塗る定番。迷ったらこれ
  "sub-subtitle-13",  // 下部で黄が流れる定番塗り
  "sub-subtitle-19",  // 行が連なり上から黄染め
  // 手描き・エモ
  "sub-subtitle-10",  // 手描き文字が揺れて灯る
  "sub-subtitle-39",  // 筆記体が舞い降り流れ去る
  // エレガント・バラード
  // mlv-subtitle-08（階段流しに黄カーブ添え）はアーカイブ入りに伴い手札から除外
  "sub-subtitle-44",  // セリフ体を金で染める
  // 巨大タイポ・輪郭
  "sub-subtitle-14",  // 巨大な輪郭を白で埋める
  "sub-subtitle-30",  // 潰した巨大字を白で照らす
  // ポップ・モダン
  "sub-subtitle-23",  // エコー重なる浮遊タイポ
  "sub-subtitle-36",  // 一字ポップに輪郭エコー
  // 極太ゴシック・インパクト（日本語映えするDela Gothic）
  "sub-subtitle-02", // ストロボ点滅の極太ゴシック
  "sub-subtitle-01", // 読むほど沈む赤カラオケ
  // シネマ・グリッチ
  "sub-subtitle-04", // 左→右にボケが解ける映画風
  "sub-music-video-lower3rd", // 常時割れるRGBグリッチ（MV名指し）
];

/** アウトロ（エンドカード）用タイトル手札（20本 / title+subtitle 248本）
 *  ※暫定。M3で実プレビューを見て人間が確定する（図鑑の星を優先表示に使う） */
export const XP_CURATED_OUTRO_TITLES: string[] = [
  // シネマ系（クレジット向き）
  "title-cinematic-title-01",
  "title-cinematic-title-02",
  "title-cinematic-title-04",
  "title-cinematic-title-09",
  "title-cinematic-title-11",
  "title-cinematic-title-13",
  "title-cinematic-title-18",
  "title-cinematic-title-21",
  // アーティスティック系
  "title-artistic-01",
  "title-artistic-02",
  "title-artistic-04",
  "title-artistic-05",
  // キネティック/動き系
  "title-kinetic-title-02",
  "title-kinetic-title-01",
  "title-dynamic",
  "title-grain",
  // グリッチ系（エッジの効いた曲用）
  "title-signal-glitch-05",
  "title-signal-glitch-16",
  "title-signal-glitch-17",
  "title-signal-glitch-25",
];
