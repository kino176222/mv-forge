import {
  mergeTextStyle,
  type Project,
  type Short,
  type ShortText,
} from "./schema";
import { renderPreset } from "./render-presets";
import { deriveTimeline, lineTime, toFrames } from "./sections";

/**
 * ショート（縦型9:16切り抜き）の純関数層。
 * applyShortToProject をプレビュー（PlayerPanel）と書き出し（render-server）の
 * 両方が通ることで「縦プレビュー＝完成品」を保証する（なんちゃってプレビューは作らない）。
 * Node API に依存しないこと（クライアント/サーバー両方から import される）。
 */

/** ショート推奨の最大尺（秒）。超過は警告表示のみ（ブロックしない） */
export const SHORT_MAX_SEC = 60;

/**
 * 縦型UIセーフゾーン（画面比%）。プレビューのガイド表示とテロップ既定位置の基準。
 * 固定pxの「公式値」は存在しない（TikTok公式も可変と明言。勝ち筋調査 2026-07-11 で
 * サードパーティの固定px説は全て棄却）ため、保守的な近似値を1か所で持つ。
 * bottom=キャプション・投稿UI帯 / right=いいね・コメント列 / top=検索等
 */
export const SHORT_SAFE_ZONES = {
  topPct: 5,
  bottomPct: 20,
  rightPct: 16,
} as const;

/** bottomテロップ（CTA等）の下端位置（画面下から%）。UI帯（bottomPct）の外に置く */
export const SHORT_TEXT_BOTTOM_PCT = 22;

/** texts[] のプリセット（［＋掴み］［＋曲名常設］［＋CTA］ボタンの既定値） */
export const SHORT_TEXT_PRESETS = {
  hook: { position: "top", anchor: "start", delay: 0, duration: 3, role: "hook" },
  title: { position: "topSmall", anchor: "start", delay: 0, duration: null, role: "title" },
  cta: { position: "bottom", anchor: "end", delay: 3, duration: null, role: "cta" },
} as const satisfies Record<string, Omit<ShortText, "id" | "text">>;

/** 行id範囲 → lines[] のインデックス範囲（逆順は正規化。id消失は null＝範囲切れ） */
export function shortRangeIndexes(
  project: Project,
  short: Short,
): { startIndex: number; endIndex: number } | null {
  const si = project.lines.findIndex((l) => l.id === short.range.startLineId);
  const ei = project.lines.findIndex((l) => l.id === short.range.endLineId);
  if (si === -1 || ei === -1) return null;
  return si <= ei
    ? { startIndex: si, endIndex: ei }
    : { startIndex: ei, endIndex: si };
}

/** 範囲の曲内秒。開始行の頭〜終了行の次の行頭（最終行なら曲末）＝区間書き出しと同じ考え方 */
export function shortRangeSec(
  project: Project,
  short: Short,
): { startSec: number; endSec: number } | null {
  const r = shortRangeIndexes(project, short);
  if (!r) return null;
  const lines = project.lines;
  const startSec = Math.max(0, lineTime(lines[r.startIndex]));
  const next = lines[r.endIndex + 1];
  const endSec = next ? lineTime(next) : project.meta.songDuration;
  return { startSec, endSec: Math.max(endSec, startSec + 0.1) };
}

/** 範囲 → 動画全体のフレーム範囲（RenderDialog の区間書き出しと同式。songStart 加算込み） */
export function shortFrameRange(
  project: Project,
  short: Short,
): [number, number] | null {
  const sec = shortRangeSec(project, short);
  if (!sec) return null;
  const timeline = deriveTimeline(project);
  const from = toFrames(timeline.songStart + sec.startSec, timeline.fps);
  const to = Math.max(
    from + 1,
    toFrames(timeline.songStart + sec.endSec, timeline.fps) - 1,
  );
  return [from, to];
}

/** ショートの尺（秒）。範囲切れは null */
export function shortDurationSec(project: Project, short: Short): number | null {
  const sec = shortRangeSec(project, short);
  return sec ? Math.round((sec.endSec - sec.startSec) * 10) / 10 : null;
}

/**
 * フレーミング対象ショットの頭のフレーム（プレビュー頭出し用）。
 * lineIndex の行頭＋カットの at 秒（行単位は atSec=0）。songStart（プロローグ）込み。
 * 範囲外・負値でも 0 以上のフレームを返す（プレビューの seekTo に安全に渡せる）。
 */
export function shotSeekFrame(
  project: Project,
  lineIndex: number,
  atSec: number,
): number {
  const line = project.lines[lineIndex];
  if (!line) return 0;
  const timeline = deriveTimeline(project);
  const sec = timeline.songStart + Math.max(0, lineTime(line)) + Math.max(0, atSec);
  return Math.max(0, toFrames(sec, timeline.fps));
}

/**
 * フレーミングキー（行id または カットid）→ 現在の基準フレーミング値。無ければ null。
 * プレビュー直接ドラッグ時に、上書きが未設定なら本編値を初期値として使うのに用いる。
 */
export function resolveFramingBase(
  project: Project,
  key: string,
): { frameScale: number; frameX: number; frameY: number } | null {
  const line = project.lines.find((l) => l.id === key);
  if (line) return { frameScale: line.frameScale, frameX: line.frameX, frameY: line.frameY };
  const cut = project.lines.flatMap((l) => l.cuts).find((c) => c.id === key);
  if (cut) return { frameScale: cut.frameScale, frameX: cut.frameX, frameY: cut.frameY };
  return null;
}

const clampFramePct = (v: number): number => Math.min(50, Math.max(-50, Math.round(v)));
const clampFrameScale = (v: number): number =>
  Math.min(3, Math.max(1, Math.round(v * 100) / 100));

/**
 * プレビュー直接ドラッグ: ピクセル移動量 → frameX/frameY（%）。
 * 画面幅/高さ基準で%換算し、-50〜50 にクランプ。box が0でも壊れない。
 */
export function applyFramingDrag(
  cur: { frameX: number; frameY: number },
  dxPx: number,
  dyPx: number,
  wPx: number,
  hPx: number,
): { frameX: number; frameY: number } {
  const nx = wPx > 0 ? cur.frameX + (dxPx / wPx) * 100 : cur.frameX;
  const ny = hPx > 0 ? cur.frameY + (dyPx / hPx) * 100 : cur.frameY;
  return { frameX: clampFramePct(nx), frameY: clampFramePct(ny) };
}

/** ホイールで拡大縮小（deltaY<0＝拡大）。0.05刻み・1〜3にクランプ */
export function applyFramingWheel(curScale: number, deltaY: number): number {
  return clampFrameScale(curScale + (deltaY < 0 ? 0.05 : -0.05));
}

/**
 * ショート専用テロップの表示窓（範囲頭からの相対秒）。
 * anchor=start: delay 秒後から / anchor=end: 末尾の delay 秒前から。
 * duration=null は末尾まで。暴れ値（過大delay・負値）でも必ず範囲内の正の窓を返す。
 */
export function resolveShortTextWindow(
  t: { anchor: "start" | "end"; delay: number; duration: number | null },
  rangeDurSec: number,
): { fromSec: number; toSec: number } {
  const dur = Math.max(0.2, rangeDurSec);
  const delay = Math.max(0, t.delay);
  let from = t.anchor === "end" ? dur - delay : delay;
  let to = t.duration != null ? from + Math.max(0, t.duration) : dur;
  from = Math.min(Math.max(0, from), dur - 0.1);
  to = Math.min(Math.max(to, from + 0.1), dur);
  return { fromSec: from, toSec: to };
}

/**
 * ショート合成の核: 本編 project ＋ short 定義 → 縦用に上書きした project（非破壊）と frameRange。
 * 上書き順: 本編 textStyle → プリセット textScale 底上げ → short.textStyleOverride。
 * 本編の lines[] 実体・演出は複製せず、崩れる要素（解像度/文字/フレーミング/歌詞演出）だけ差し替える。
 */
export function applyShortToProject(
  project: Project,
  short: Short,
  presetId: string = "vertical",
): { project: Project; frameRange: [number, number] } | null {
  const r = shortRangeIndexes(project, short);
  const sec = shortRangeSec(project, short);
  const frameRange = shortFrameRange(project, short);
  if (!r || !sec || !frameRange) return null;

  const preset = renderPreset(presetId);
  const p = structuredClone(project);

  // 解像度（remotion/Root.tsx の calculateMetadata が inputProps の meta に追従する）
  if (preset.width && preset.height) {
    p.meta.width = preset.width;
    p.meta.height = preset.height;
  }
  // 文字サイズの底上げ（render-server のプリセット適用と同挙動。行別上書きにも掛ける）
  if (preset.textScale !== 1) {
    p.meta.textStyle.size = Math.round(p.meta.textStyle.size * preset.textScale);
    for (const line of p.lines) {
      if (line.textStyle?.size != null) {
        line.textStyle.size = Math.round(line.textStyle.size * preset.textScale);
      }
    }
  }
  // ショート専用のテロップ様式上書き（指定キーは底上げ後の値より優先）
  p.meta.textStyle = mergeTextStyle(p.meta.textStyle, short.textStyleOverride);

  // 縦で崩れるコマだけフレーミング差し替え（行id または カットid 指定。実在しないidは無視）
  for (const [key, f] of Object.entries(short.framingOverrides)) {
    const line = p.lines.find((l) => l.id === key);
    if (line) {
      line.frameScale = f.frameScale;
      line.frameX = f.frameX;
      line.frameY = f.frameY;
      continue;
    }
    // カットid: cuts>1 の行は描画がカット単位（行のframe値は使われない）なのでカット側を差し替える
    const cut = p.lines.flatMap((l) => l.cuts).find((c) => c.id === key);
    if (cut) {
      cut.frameScale = f.frameScale;
      cut.frameX = f.frameX;
      cut.frameY = f.frameY;
    }
  }

  // 歌詞演出の差し替え（範囲内全行に1種。null=本編のまま）
  if (short.lyricAnim) {
    for (let i = r.startIndex; i <= r.endIndex; i++) {
      p.lines[i].lyricAnim = structuredClone(short.lyricAnim);
    }
  }

  // ショート専用テロップを焼き込む（本編 project には存在しない描画用フィールド）
  const timeline = deriveTimeline(project);
  p.shortOverlay = {
    texts: structuredClone(short.texts),
    startSec: timeline.songStart + sec.startSec,
    endSec: timeline.songStart + sec.endSec,
    // 全体見せモード: 本編アスペクト（上書き前のmeta）を持たせ、描画側でcontain+ぼかし背景にする
    ...(short.fullFrame
      ? { fullFrame: { aspect: project.meta.width / project.meta.height } }
      : {}),
  };

  return { project: p, frameRange };
}

/**
 * 冒頭フックの健全性チェック（勝ち筋調査 2026-07-11: フックの成否は
 * YouTubeの「Viewed vs swiped away」指標で直接計測される）。
 * 警告文の配列を返す（空=問題なし。範囲切れは空＝範囲切れ警告はUIの責務）。
 */
export function shortHookIssues(project: Project, short: Short): string[] {
  const r = shortRangeIndexes(project, short);
  if (!r) return [];
  const issues: string[] = [];
  if (!project.lines[r.startIndex].lyricText.trim()) {
    issues.push(
      "冒頭が間奏です。サビ・歌い出しの行から始めると冒頭3秒フックが効きます（開始行の見直しを推奨）",
    );
  }
  if (!short.texts.some((t) => t.role === "hook" && t.text.trim() !== "")) {
    issues.push("掴みテロップが未設定です（冒頭3秒に一言あるとスワイプ離脱を減らせます）");
  }
  return issues;
}

/**
 * 投稿メモ（書き出し後の運用チェックリスト＋キャプション雛形）。
 * フルMV誘導はYouTube公式のRelated Video機能が正規ルート（映像内CTAより確実）。
 */
export function buildShortPostMemo(project: Project, short: Short): string {
  const hook = short.texts.find((t) => t.role === "hook" && t.text.trim() !== "")?.text.trim();
  const title = project.meta.title;
  const tag = title.replace(/\s+/g, "");
  return [
    `【${title} / ${short.name}】投稿メモ`,
    "",
    "■ キャプション案",
    `${hook ?? `「${title}」サビ切り抜き`} ♪ ${title}`,
    "",
    "■ ハッシュタグ案",
    `#Shorts #${tag} #リリックビデオ #新曲`,
    "",
    "■ 投稿後にやること",
    "1. YouTube: Related Video でフルMVを紐付け（Studio > Content > Shorts > Edit > Related Video）",
    "   → ショートのハンドル名の下にフル版リンクが出る（公式のフル誘導ルート）",
    "2. TikTok: 楽曲のサウンドページが正しく紐付いているか確認（楽曲タップは公式の推薦シグナル）",
    "3. 48時間後に「Viewed vs swiped away」を確認 → 低ければ次のショートは開始行・掴みを変える",
  ].join("\n");
}
