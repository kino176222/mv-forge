import type { Line, Project } from "./schema";

/**
 * 区間（シーン）の導出（仕様書 §3）
 * 区間＝imageを持つ行から、次にimageを持つ行の直前まで（image:nullが続く範囲）。
 * 区間は独立データにせず、常に lines[] から導出する（平屋の原則）。
 */

export interface Section {
  /** 区間の通し番号（色分け用） */
  index: number;
  /** 区間先頭行の lines[] 内インデックス */
  headLineIndex: number;
  /** この区間に属する行のインデックス（先頭行含む） */
  lineIndexes: number[];
  image: string | null;
  /** 曲内時間（秒）: 先頭行の startTime + offset */
  start: number;
  /** 曲内時間（秒）: 次区間の開始（最終区間は曲の終わり） */
  end: number;
}

export function lineTime(line: Line): number {
  return Math.max(0, line.startTime + line.offset);
}

/**
 * lines[] から区間リストを導出する。
 * 先頭に画像なし行が続く場合は image:null の暗黙区間（黒画面）になる。
 */
export function deriveSections(lines: Line[], songDuration: number): Section[] {
  const sections: Section[] = [];
  let current: Section | null = null;

  lines.forEach((line, i) => {
    const isHead = line.image !== null || current === null;
    if (isHead) {
      if (current) {
        current.end = lineTime(line);
        sections.push(current);
      }
      current = {
        index: sections.length,
        headLineIndex: i,
        lineIndexes: [i],
        image: line.image,
        start: i === 0 ? Math.min(lineTime(line), 0) || 0 : lineTime(line),
        end: songDuration,
      };
      // 最初の区間は曲頭から開始する（歌い出し前も絵を出す）
      if (sections.length === 0) current.start = 0;
      else current.start = lineTime(line);
    } else if (current) {
      current.lineIndexes.push(i);
    }
  });
  if (current) sections.push(current);
  return sections;
}

/** 行インデックス → 所属区間 */
export function sectionOfLine(
  sections: Section[],
  lineIndex: number,
): Section | undefined {
  return sections.find((s) => s.lineIndexes.includes(lineIndex));
}

/** 行が区間の先頭（＝エフェクト・トランジションを持てる行）か */
export function isSectionHead(
  sections: Section[],
  lineIndex: number,
): boolean {
  return sections.some((s) => s.headLineIndex === lineIndex);
}

// ---- 時間モデル（プロローグ→本編→アウトロ） ----

export interface Timeline {
  fps: number;
  /** 曲が鳴り始める動画内時刻（秒）＝プロローグ尺 − オーバーラップ */
  songStart: number;
  /** 本編（曲）の長さ（秒） */
  songDuration: number;
  /** アウトロ開始（秒）＝songStart + songDuration */
  outroStart: number;
  /** 動画全体の長さ（秒） */
  total: number;
}

export function deriveTimeline(project: Project): Timeline {
  const { fps, songDuration } = project.meta;
  const p = project.prologue;
  const songStart = p.enabled
    ? Math.max(0, p.duration - p.overlapSec)
    : 0;
  const outroStart = songStart + songDuration;
  const total = outroStart + (project.outro.duration || 0);
  return { fps, songStart, songDuration, outroStart, total: Math.max(total, 1) };
}

export const toFrames = (sec: number, fps: number) => Math.round(sec * fps);

/** 曲内時刻（LRC秒）→ 動画全体のフレーム */
export function songTimeToFrame(
  sec: number,
  timeline: Timeline,
): number {
  return toFrames(timeline.songStart + sec, timeline.fps);
}
