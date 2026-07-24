import "./server-guard";
import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { projectDir, projectFile } from "./projects-server";
import {
  narrationDir,
  readTakesMeta,
  writeTakesMeta,
  type SilenceRegion,
} from "./fish-server";

const execFileAsync = promisify(execFile);

/**
 * 「間」の非破壊編集エンジン。
 * - 元音声は narration/src/ に保全し、間はメタデータ（takes.json）として持つ
 * - テイクのmp3は「src + 間リスト」から毎回レンダリングして同名上書き
 * → 聴いているテイクがその場で変わる／何度編集しても劣化・複製しない
 *
 * 座標系: takes.json の silences は【元音声の時間軸】で保存。
 * UI・APIの境界では【レンダリング後の時間軸】でやり取りし、ここで変換する。
 */

function srcAbsPath(projectName: string, file: string): string {
  return path.join(narrationDir(projectDir(projectName)), "src", path.basename(file));
}

const FMT = "aformat=sample_rates=44100:channel_layouts=stereo";

async function transcode(input: string, output: string): Promise<void> {
  await execFileAsync("ffmpeg", [
    "-y", "-i", input, "-af", FMT, "-c:a", "libmp3lame", "-q:a", "2", output,
  ]);
}

async function probeSec(abs: string): Promise<number> {
  const { stdout } = await execFileAsync("ffprobe", [
    "-v", "quiet", "-show_entries", "format=duration", "-of", "csv=p=0", abs,
  ]);
  return Number(stdout.trim()) || 0;
}

/** 元座標の間リスト → レンダリング後座標（UI表示用） */
export function renderedSilences(gaps: SilenceRegion[]): SilenceRegion[] {
  let shift = 0;
  return [...gaps]
    .sort((a, b) => a.at - b.at)
    .map((g) => {
      const r = { at: g.at + shift, dur: g.dur };
      shift += g.dur;
      return r;
    });
}

/** レンダリング後座標 → 元座標（挿入位置の変換）。既存の間の中なら、その間の位置に吸着 */
export function toOriginalAt(gaps: SilenceRegion[], renderedAt: number): number {
  let shift = 0;
  for (const g of [...gaps].sort((a, b) => a.at - b.at)) {
    const rStart = g.at + shift;
    if (renderedAt < rStart) break;
    if (renderedAt <= rStart + g.dur) return g.at;
    shift += g.dur;
  }
  return Math.max(0, renderedAt - shift);
}

/**
 * 初回編集時の移行: src/ に元音声を確保して間リスト（元座標）を返す。
 * 旧方式で音声に焼き込まれた間は、切り出して元音声を復元しメタへ変換する。
 */
export async function ensureSrc(
  projectName: string,
  file: string,
): Promise<SilenceRegion[]> {
  const pdir = projectDir(projectName);
  const abs = projectFile(projectName, file);
  const srcAbs = srcAbsPath(projectName, file);
  const meta = readTakesMeta(pdir);

  if (fs.existsSync(srcAbs)) {
    return meta[file]?.silences ?? [];
  }
  fs.mkdirSync(path.dirname(srcAbs), { recursive: true });

  const baked = [...(meta[file]?.silences ?? [])].sort((a, b) => a.at - b.at);
  if (baked.length === 0) {
    // 焼き込みなし: クリーンなCBRに揃えて保全（ブラウザのシーク精度も安定する）
    await transcode(abs, srcAbs);
    return [];
  }

  // 焼き込まれた無音を全て切り出して元音声を復元
  const parts: string[] = [];
  const labels: string[] = [];
  let cursor = 0;
  let idx = 0;
  for (const s of baked) {
    if (s.at > cursor) {
      parts.push(`[0:a]atrim=${cursor}:${s.at},asetpts=N/SR/TB,${FMT}[p${idx}]`);
      labels.push(`[p${idx}]`);
      idx++;
    }
    cursor = s.at + s.dur;
  }
  parts.push(`[0:a]atrim=${cursor},asetpts=N/SR/TB,${FMT}[p${idx}]`);
  labels.push(`[p${idx}]`);
  const filter =
    parts.join(";") + `;${labels.join("")}concat=n=${labels.length}:v=0:a=1[out]`;
  await execFileAsync("ffmpeg", [
    "-y", "-i", abs, "-filter_complex", filter, "-map", "[out]",
    "-c:a", "libmp3lame", "-q:a", "2", srcAbs,
  ]);

  // 焼き込み座標（レンダリング後）→ 元座標へ変換して保存し直す
  let shift = 0;
  const gaps = baked.map((s) => {
    const g = { at: s.at - shift, dur: s.dur };
    shift += s.dur;
    return g;
  });
  meta[file] = { ...meta[file], silences: gaps }; // 出自メタ（kind/voice）は保持
  writeTakesMeta(pdir, meta);
  return gaps;
}

/** src + 間リスト（元座標）からテイクmp3を再レンダリングして上書き */
export async function renderTake(
  projectName: string,
  file: string,
  gaps: SilenceRegion[],
): Promise<void> {
  const pdir = projectDir(projectName);
  const abs = projectFile(projectName, file);
  const srcAbs = srcAbsPath(projectName, file);
  const srcLen = await probeSec(srcAbs);
  const sorted = [...gaps]
    .map((g) => ({ at: Math.min(Math.max(0, g.at), srcLen), dur: g.dur }))
    .sort((a, b) => a.at - b.at);

  if (sorted.length === 0) {
    fs.copyFileSync(srcAbs, abs);
  } else {
    const parts: string[] = [];
    const labels: string[] = [];
    let cursor = 0;
    let idx = 0;
    for (const g of sorted) {
      if (g.at > cursor) {
        parts.push(`[0:a]atrim=${cursor}:${g.at},asetpts=N/SR/TB,${FMT}[p${idx}]`);
        labels.push(`[p${idx}]`);
        idx++;
      }
      parts.push(`aevalsrc=0:d=${g.dur}:s=44100,${FMT}[s${idx}]`);
      labels.push(`[s${idx}]`);
      idx++;
      cursor = g.at;
    }
    if (cursor < srcLen) {
      parts.push(`[0:a]atrim=${cursor},asetpts=N/SR/TB,${FMT}[p${idx}]`);
      labels.push(`[p${idx}]`);
    }
    const filter =
      parts.join(";") + `;${labels.join("")}concat=n=${labels.length}:v=0:a=1[out]`;
    const tmp = abs.replace(/\.mp3$/, ".tmp.mp3");
    await execFileAsync("ffmpeg", [
      "-y", "-i", srcAbs, "-filter_complex", filter, "-map", "[out]",
      "-c:a", "libmp3lame", "-q:a", "2", tmp,
    ]);
    fs.renameSync(tmp, abs);
  }

  const meta = readTakesMeta(pdir);
  meta[file] = { ...meta[file], silences: sorted }; // 出自メタ（kind/voice）は保持
  writeTakesMeta(pdir, meta);
}
