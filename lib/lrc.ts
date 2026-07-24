import type { Line, LineWord } from "./schema";

/**
 * LRCパーサ（仕様書 §3 / v1.3 A-4 エッジケース対応）
 * - [mm:ss.xx] 形式（xxは2〜3桁）をサポート
 * - 1行に複数タイムタグ（[00:10.00][01:20.00]歌詞）は行を複製して展開
 * - [offset:±ms] タグを反映
 * - メタタグ（[ti:][ar:][al:][by:][length:][tool:]等）は無視
 * - word-levelの拡張タグ <mm:ss.xx> は捨てる（カラオケ同期はv2）
 * - 時刻順にソート、同時刻の重複行はそのまま保持（後勝ちにしない）
 * - 歌詞が空のタイムタグ行（間奏マーカーとして使われがち）は空行として保持
 */

const TIME_TAG = /\[(\d{1,2}):(\d{2})(?:[.:](\d{2,3}))?\]/g;
const META_TAG = /^\[(ti|ar|al|by|re|ve|length|tool|au|la):/i;
const OFFSET_TAG = /^\[offset:\s*([+-]?\d+)\s*\]/i;
const WORD_TAG = /<\d{1,2}:\d{2}(?:[.:]\d{2,3})?>/g;

export interface LrcEntry {
  time: number; // 秒
  text: string;
}

export function parseLrc(source: string): LrcEntry[] {
  const entries: LrcEntry[] = [];
  let offsetMs = 0;

  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

    const offsetMatch = line.match(OFFSET_TAG);
    if (offsetMatch) {
      offsetMs = Number(offsetMatch[1]);
      continue;
    }
    if (META_TAG.test(line)) continue;

    const times: number[] = [];
    let match: RegExpExecArray | null;
    TIME_TAG.lastIndex = 0;
    while ((match = TIME_TAG.exec(line)) !== null) {
      const min = Number(match[1]);
      const sec = Number(match[2]);
      const fracRaw = match[3] ?? "0";
      const frac = Number(fracRaw) / (fracRaw.length === 3 ? 1000 : 100);
      times.push(min * 60 + sec + frac);
    }
    if (times.length === 0) continue;

    const text = line
      .replace(TIME_TAG, "")
      .replace(WORD_TAG, "") // 拡張LRCのワードタグは捨てる
      .trim();

    for (const t of times) {
      entries.push({ time: Math.max(0, t + offsetMs / 1000), text });
    }
  }

  entries.sort((a, b) => a.time - b.time);
  return entries;
}

let lineIdCounter = 0;
export function newLineId(): string {
  lineIdCounter += 1;
  return `line-${Date.now().toString(36)}-${lineIdCounter}`;
}

/** LRC → lines[]（新規生成） */
export function lrcToLines(source: string): Line[] {
  return parseLrc(source).map((e) => ({
    id: newLineId(),
    lyricText: e.text,
    startTime: e.time,
    offset: 0,
    words: [],
    behindSubject: false,
    showLyric: true,
    source: "lrc" as const,
    image: null,
    i2vSource: null,
    videoLoop: "pingpong" as const,
    videoTrimStart: 0,
    videoTrimEnd: null,
    videoRate: null,
    videoAnchor: "head" as const,
    frameScale: 1,
    frameX: 0,
    frameY: 0,
    effects: [],
    lookOff: false,
    transition: null,
    lyricAnim: null,
    lyricDecor: null,
    charFx: [],
    cuts: [],
    credit: null,
    aiSuggestion: null,
  }));
}

/**
 * LRC再読込マージ（v1.3 A-3）:
 * LRC由来の行は startTime の一致（±0.75s以内の最近傍）で既存行の装飾
 * （image/effects/lyricAnim/offset/aiSuggestion）を引き継ぐ。
 * source:"manual" のマーカー行は必ず保持する。
 */
export function mergeLrcIntoLines(source: string, existing: Line[]): Line[] {
  const fresh = lrcToLines(source);
  const manualLines = existing.filter((l) => l.source === "manual");
  const lrcLines = existing.filter((l) => l.source === "lrc");
  const used = new Set<number>();

  const merged = fresh.map((f) => {
    let best = -1;
    let bestDist = 0.75;
    lrcLines.forEach((old, i) => {
      if (used.has(i)) return;
      const d = Math.abs(old.startTime - f.startTime);
      if (d <= bestDist) {
        best = i;
        bestDist = d;
      }
    });
    if (best >= 0) {
      used.add(best);
      const old = lrcLines[best];
      return {
        ...f,
        id: old.id,
        offset: old.offset,
        image: old.image,
        effects: old.effects,
        transition: old.transition,
        lyricAnim: old.lyricAnim,
        lyricDecor: old.lyricDecor,
        charFx: old.charFx,
        aiSuggestion: old.aiSuggestion,
      };
    }
    return f;
  });

  const all = [...merged, ...manualLines];
  all.sort((a, b) => a.startTime + a.offset - (b.startTime + b.offset));
  return all;
}

// ---- 前奏/間奏/アウトロ マーカー自動挿入 ----
// 歌詞は「次の行が始まるまで」表示され続けるため、間奏に行が無いと
// 直前の歌詞が間奏中ずっと残る。8秒以上の空白に空マーカー行を入れて防ぐ。
const GAP_MIN = 8; // これ以上の空白（前奏・間奏）にマーカーを入れる（秒）
const OUTRO_MIN = 12; // 最終行→曲末がこれ以上ならアウトロマーカー（秒）
const SING_EST = 5; // wordsが無いときの歌い終わり推定（行開始+n秒）
const WORD_PAD = 0.5; // 最終単語の後に置く余白（秒）

function emptyMarkerLine(startTime: number): Line {
  const [line] = lrcToLines(`[${formatTime(startTime)}] `);
  return { ...line, lyricText: "", source: "manual" };
}

/** 行の歌い終わり推定（マーカーの置き場所）。次の開始時刻は侵食しない */
function singEnd(line: Line, limit: number): number {
  const lastWord = line.words[line.words.length - 1];
  const est = lastWord ? lastWord.end + WORD_PAD : lineTimeOf(line) + SING_EST;
  return Math.round(Math.min(est, limit - 1) * 100) / 100;
}

const lineTimeOf = (l: Line) => Math.max(0, l.startTime + l.offset);

/**
 * 前奏・間奏・アウトロの空白に空マーカー行を挿入する。
 * - 既に行（手打ちマーカー含む）がある空白には入れない＝再取り込みでも冪等
 * - 空歌詞行の後の空白は対象外（歌詞はもう消えている）
 * - songDuration=0（未計測）ならアウトロ判定はスキップ
 */
export function insertGapMarkers(
  lines: Line[],
  songDuration: number,
): { lines: Line[]; inserted: number } {
  const sorted = [...lines].sort((a, b) => lineTimeOf(a) - lineTimeOf(b));
  const added: Line[] = [];

  // 前奏: 最初の行が曲頭から離れている（マーカーがあれば専用の絵を置ける）
  if (sorted.length > 0 && lineTimeOf(sorted[0]) >= GAP_MIN) {
    added.push(emptyMarkerLine(0));
  }
  for (let i = 0; i < sorted.length; i++) {
    const cur = sorted[i];
    if (!cur.lyricText.trim()) continue; // 空行の後は歌詞が残らない
    const next = sorted[i + 1];
    if (next) {
      if (lineTimeOf(next) - lineTimeOf(cur) >= GAP_MIN) {
        added.push(emptyMarkerLine(singEnd(cur, lineTimeOf(next))));
      }
    } else if (songDuration > 0 && songDuration - lineTimeOf(cur) >= OUTRO_MIN) {
      added.push(emptyMarkerLine(singEnd(cur, songDuration)));
    }
  }

  if (added.length === 0) return { lines, inserted: 0 };
  const all = [...lines, ...added];
  all.sort((a, b) => lineTimeOf(a) - lineTimeOf(b));
  return { lines: all, inserted: added.length };
}

export function formatTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec - m * 60;
  return `${String(m).padStart(2, "0")}:${s.toFixed(2).padStart(5, "0")}`;
}

/** lines[] → LRCテキスト（書き戻し用） */
export function linesToLrc(lines: Line[]): string {
  return lines
    .filter((l) => l.source === "lrc")
    .map((l) => `[${formatTime(l.startTime)}] ${l.lyricText}`)
    .join("\n");
}

// ---- 単語タイムスタンプの行への割り付け（重複歌詞行バグ対策） ----
/**
 * Scribeアライメント結果（aligned）の単語タイムスタンプを lines[] に割り付ける。
 *
 * 【つぶす重複行バグ】テキスト一致のMapだけで配ると、「サビ」等の同一歌詞が
 * 曲中に複数回出てくるとき `new Map(aligned.map(a => [a.text, a.words]))` が
 * 最後の出現の単語秒だけを残し、その歌詞を持つ全行へ同じ（＝別の出現位置の）
 * 時刻を配ってしまう。ここではテキスト一致の候補の中から、行の実効時刻
 * （startTime+offset）に最も近い出現を選び、各出現を1行にだけ使う（used）。
 * これで重複行にも各出現位置の正しい単語秒が渡る。
 *
 * 非破壊: 新しい配列を返し、対応が取れた行だけ words を差し替える。
 */
export function attachAlignedWords(
  lines: Line[],
  aligned: { text: string; start: number | null; words: LineWord[] }[],
): Line[] {
  // テキスト（trim）→ その出現たち（開始秒つき）
  const byText = new Map<string, { start: number; words: LineWord[] }[]>();
  for (const a of aligned) {
    if (!a.words || a.words.length === 0) continue;
    const key = a.text.trim();
    const arr = byText.get(key) ?? [];
    arr.push({ start: a.start ?? a.words[0].start, words: a.words });
    byText.set(key, arr);
  }
  const usedByText = new Map<string, Set<number>>(); // 同一テキストの出現を使い回さない
  return lines.map((line) => {
    const key = line.lyricText.trim();
    const cands = byText.get(key);
    if (!cands || cands.length === 0) return line;
    const used = usedByText.get(key) ?? new Set<number>();
    const target = line.startTime + line.offset;
    let best = -1;
    let bestDist = Infinity;
    cands.forEach((c, i) => {
      if (used.has(i)) return;
      const d = Math.abs(c.start - target);
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    });
    if (best === -1) return line; // 出現数より行数が多い稀ケース＝未割り当てで残す
    used.add(best);
    usedByText.set(key, used);
    return { ...line, words: cands[best].words };
  });
}

// ---- 行の分割 / 結合（単語秒スナップ） ----
/**
 * 1行を分割点 atSec（曲内絶対秒）で2行に割る（③LRC分割の純関数コア）。
 * - words があれば「内部の単語境界（1..len-1）」の中から atSec 最近傍にスナップし、
 *   その単語の charFrom で表示テキストも割る。単語秒＝そのまま新2行目の startTime。
 * - words が無ければ表示文字の中央で割り、2行目 startTime は atSec（下限=1行目直後）。
 * words[] は前半＝そのまま／後半＝charFrom-charTo を分割位置ぶんシフトして正しく分配。
 * 2行目は区間の“頭”ではない継続行として返す（image/effects/cuts/credit はリセット、
 * 行レベルの見た目＝lyricAnim/lyricDecor/behindSubject/textStyle は引き継ぐ）。
 * 割れない（1文字以下 等）ときは null。
 */
export function splitLineAt(line: Line, atSec: number): [Line, Line] | null {
  const chars = [...line.lyricText];
  if (chars.length < 2) return null;

  let charSplit: number;
  let bStart: number;
  let aWords: LineWord[];
  let bWords: LineWord[];

  if (line.words.length >= 2) {
    let w = 1;
    let bestDist = Infinity;
    for (let k = 1; k < line.words.length; k++) {
      const d = Math.abs(line.words[k].start - atSec);
      if (d < bestDist) {
        bestDist = d;
        w = k;
      }
    }
    charSplit = Math.min(Math.max(line.words[w].charFrom, 1), chars.length - 1);
    bStart = line.words[w].start;
    aWords = line.words.slice(0, w).map((x) => ({ ...x }));
    bWords = line.words.slice(w).map((x) => ({
      ...x,
      charFrom: x.charFrom - charSplit,
      charTo: x.charTo - charSplit,
    }));
  } else {
    charSplit = Math.max(1, Math.min(Math.round(chars.length / 2), chars.length - 1));
    bStart = Math.max(line.startTime + line.offset + 0.01, atSec);
    aWords = [];
    bWords = [];
  }

  const aText = chars.slice(0, charSplit).join("");
  const bText = chars.slice(charSplit).join("");
  const aFx = line.charFx.filter((f) => f.i < charSplit).map((f) => ({ ...f }));
  const bFx = line.charFx
    .filter((f) => f.i >= charSplit)
    .map((f) => ({ ...f, i: f.i - charSplit }));

  const a: Line = { ...line, lyricText: aText, words: aWords, charFx: aFx };
  const b: Line = {
    ...line,
    id: newLineId(),
    lyricText: bText,
    startTime: bStart,
    offset: 0,
    words: bWords,
    charFx: bFx,
    // 継続行として始まる（区間の頭が持つものはリセット）
    image: null,
    i2vSource: null,
    videoTrimStart: 0,
    videoTrimEnd: null,
    videoRate: null,
    videoAnchor: "head",
    frameScale: 1,
    frameX: 0,
    frameY: 0,
    effects: [],
    lookOff: false,
    transition: null,
    cuts: [],
    credit: null,
    aiSuggestion: null,
    // lyricAnim / lyricDecor / behindSubject / textStyle は行レベルの見た目＝引き継ぐ（...line）
  };
  return [a, b];
}

/**
 * 隣り合う2行 a,b を1行に結合する（③の逆＝mergeLine 2→1）。
 * テキストを連結し、b の words / charFx を a の文字数ぶんだけ後ろへシフトして併合。
 * 区間の頭情報（startTime/image/effects/cuts/transition/credit 等）は a を保つ。
 */
export function mergeLines(a: Line, b: Line): Line {
  const shift = [...a.lyricText].length;
  const bWords = b.words.map((w) => ({
    ...w,
    charFrom: w.charFrom + shift,
    charTo: w.charTo + shift,
  }));
  const bFx = b.charFx.map((f) => ({ ...f, i: f.i + shift }));
  return {
    ...a,
    lyricText: a.lyricText + b.lyricText,
    words: [...a.words, ...bWords],
    charFx: [...a.charFx, ...bFx],
  };
}
