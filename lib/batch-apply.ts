import type { Cut, Line } from "./schema";
import { deriveSections } from "./sections";
import { snapToMusic } from "./beat-snap";

/**
 * 一括生成で採用した画像を、ショットの割付メタ（assign）に従って
 * 行の image と cuts[] へ自動で入れる（設計: docs/2026-07-06-generation-loop-handoff.md ①-B）。
 *
 * 安全側デフォルト（手作業を壊さない）:
 * - 既に image を持つ行への order 0 は上書きせずスキップ報告
 * - 既に cuts を持つ行への order 1+ も同様
 * - cuts の不変条件（cuts[0].at===0 ∧ cuts[0].image===line.image ∧ at昇順）を厳守
 */

export interface AssignedShot {
  /** プロジェクト相対パス（images/xxx.png） */
  file: string;
  assign: { lineId: string; order: number };
}

export interface ApplyResult {
  lines: Line[];
  applied: number; // image に入った枚数
  cutsCreated: number; // 追加されたカット数（cut0は数えない）
  skipped: { file: string; reason: string }[];
}

/** CutsBlock の磁石と同じ効き幅（秒） */
const SNAP_RANGE = 0.35;

// beats は曲内時刻、at は区間頭からの相対秒。音ハメ量子化は beat-snap に一本化。
// downbeats は未指定＝従来の拍のみ吸着（この経路は回帰ゼロ）。
const snapToBeat = (sec: number, sectionStart: number, beats: number[]): number => {
  const snapped = snapToMusic(sectionStart + sec, { beats }, SNAP_RANGE);
  return Math.round((snapped - sectionStart) * 1000) / 1000;
};

const makeCut = (id: string, image: string, at: number): Cut => ({
  id,
  image,
  i2vSource: null,
  at,
  trimStart: 0,
  trimEnd: null,
  videoLoop: "pingpong",
  videoRate: null,
  videoAnchor: "head",
  frameScale: 1,
  frameX: 0,
  frameY: 0,
  credit: null,
});

export function applyShotsToLines(
  lines: Line[],
  shots: AssignedShot[],
  beats: number[],
  songDuration: number,
): ApplyResult {
  const next: Line[] = lines.map((l) => ({ ...l, cuts: [...l.cuts] }));
  const byId = new Map(next.map((l) => [l.id, l]));
  const skipped: ApplyResult["skipped"] = [];
  let applied = 0;
  let cutsCreated = 0;

  // 行ごとに order 昇順へ整理（order最小がメイン画像候補）
  const byLine = new Map<string, AssignedShot[]>();
  for (const s of shots) {
    if (!s.assign || !byId.has(s.assign.lineId)) {
      skipped.push({ file: s.file, reason: `行が見つかりません: ${s.assign?.lineId}` });
      continue;
    }
    const list = byLine.get(s.assign.lineId) ?? [];
    list.push(s);
    byLine.set(s.assign.lineId, list);
  }
  for (const list of byLine.values()) list.sort((a, b) => a.assign.order - b.assign.order);

  // 1周目: メイン画像（order最小）を先に全行へ → 区間の形を確定させる
  const cutShots = new Map<string, AssignedShot[]>();
  for (const [lineId, list] of byLine) {
    const line = byId.get(lineId)!;
    const [main, ...rest] = list;
    if (line.image) {
      // 手作業の絵は壊さない。order 0 相当はスキップ、order 1+ はカット候補として残す
      const isMainShot = main.assign.order === 0;
      if (isMainShot) {
        skipped.push({ file: main.file, reason: "行に既に画像があるためスキップ（上書きしません）" });
        if (rest.length > 0) cutShots.set(lineId, rest);
      } else {
        cutShots.set(lineId, list);
      }
    } else {
      line.image = main.file;
      applied++;
      if (rest.length > 0) cutShots.set(lineId, rest);
    }
  }

  // 2周目: 区間尺を画像割付後の lines から導出し、カットを等分配置＋拍スナップ
  const sections = deriveSections(next, songDuration);
  for (const [lineId, list] of cutShots) {
    const line = byId.get(lineId)!;
    if (!line.image) {
      for (const s of list) skipped.push({ file: s.file, reason: "行に画像が無いためカットにできません" });
      continue;
    }
    if (line.cuts.length > 0) {
      for (const s of list) skipped.push({ file: s.file, reason: "行に既にカット割りがあるためスキップ（上書きしません）" });
      continue;
    }
    const sec = sections.find((s) => next[s.headLineIndex].id === lineId);
    if (!sec) {
      for (const s of list) skipped.push({ file: s.file, reason: "区間の頭ではない行にはカットを置けません" });
      continue;
    }
    const sectionSec = sec.end - sec.start;
    // cut0（行の絵）＋提案カットで区間を等分
    const total = list.length + 1;
    const cuts: Cut[] = [makeCut(`${line.id}-cut0`, line.image, 0)];
    list.forEach((s, i) => {
      const raw = (sectionSec * (i + 1)) / total;
      const at = snapToBeat(raw, sec.start, beats);
      cuts.push(makeCut(`${line.id}-cut${i + 1}`, s.file, at));
    });
    // at昇順・重複防御（スナップで潰れたら1/30秒ずらす）
    for (let i = 1; i < cuts.length; i++) {
      if (cuts[i].at <= cuts[i - 1].at) cuts[i].at = Math.round((cuts[i - 1].at + 1 / 30) * 1000) / 1000;
    }
    line.cuts = cuts;
    cutsCreated += list.length;
  }

  return { lines: next, applied, cutsCreated, skipped };
}
