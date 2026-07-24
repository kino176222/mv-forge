import { deriveSections } from "../sections";
import { dominantEnergy, type SongStructure } from "../server/suggest-server";
import { shotFileRel } from "../batch-plan";
import type { Project } from "../schema";
import type { OneshotMode, PlannedScene } from "./types";

/**
 * Step 6 の i2v 対象選定（純関数）。「AIの提案 ∩ モードの規則」の二段構え。
 * - 梅: 全部無視
 * - 竹: サビ帯（dominantEnergy=chorus）に重なる order 0 シーンのみ。
 *       本数上限は固定値ではなく「サビ帯の合計秒数 ÷ 5秒」から算出（仕様書§10-4）
 * - 松: order 0 の全シーン（=「すべて動かす」。motionPrompt が無ければ汎用にフォールバック）
 * - 適用後の行の絵がシーンの絵と一致しない行（既存絵を尊重してスキップされた行）は対象外
 */

export interface I2vTarget {
  lineId: string;
  image: string;
  motionPrompt: string;
  durationSec: 5 | 10;
  isChorus: boolean;
}

/** アニメ1枚絵の鉄板: カメラと環境を動かし、キャラの変形は控えめに（i2v-suggestの設計ルール） */
export function genericMotionPrompt(intensity: "subtle" | "medium" | "bold" = "medium"): string {
  const base =
    "keep the character design and art style unchanged, no morphing. " +
    "Animate the camera and environment: gentle wind on hair and clothes, drifting light particles, subtle ambient light shift.";
  if (intensity === "subtle") return `Very slow, minimal camera drift. ${base}`;
  if (intensity === "bold")
    return `Dynamic cinematic camera push-in with parallax, lively environment motion. ${base}`;
  return `Slow cinematic camera push-in. ${base}`;
}

export function selectI2vTargets(
  mode: OneshotMode,
  scenes: PlannedScene[],
  project: Project,
  struct: SongStructure | null,
): I2vTarget[] {
  if (mode === "ume") return [];
  const sections = deriveSections(project.lines, project.meta.songDuration);
  const lineById = new Map(project.lines.map((l, i) => [l.id, { line: l, index: i }]));
  const targets: I2vTarget[] = [];

  for (const s of scenes) {
    if (!s.assign || s.assign.order !== 0) continue;
    const hit = lineById.get(s.assign.lineId);
    if (!hit) continue;
    const file = shotFileRel(s);
    if (hit.line.image !== file) continue; // 既存絵の尊重等で適用されなかった行

    const sec = sections.find((x) => x.headLineIndex === hit.index);
    const start = sec?.start ?? hit.line.startTime;
    const end = sec?.end ?? hit.line.startTime + 5;
    const energy = struct?.sections?.length
      ? dominantEnergy(start, end, struct.sections)
      : { level: "mid" as const };
    const isChorus = energy.kind === "chorus";
    if (mode === "take" && !isChorus) continue;

    targets.push({
      lineId: hit.line.id,
      image: file,
      motionPrompt: s.i2v?.motionPrompt?.trim() || genericMotionPrompt(s.i2v?.intensity),
      durationSec: end - start > 6.5 ? 10 : 5,
      isChorus,
    });
  }

  if (mode === "take") {
    const chorusSec = (struct?.sections ?? [])
      .filter((s) => s.kind === "chorus")
      .reduce((sum, s) => sum + (s.end - s.start), 0);
    const cap = Math.max(1, Math.ceil(chorusSec / 5));
    return targets.slice(0, cap);
  }
  return targets;
}
