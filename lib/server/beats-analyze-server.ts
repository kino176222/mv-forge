import "./server-guard";
import { spawn } from "node:child_process";
import { projectFile } from "./projects-server";

/**
 * ④ビート吸着用のビート検出。
 * ffmpegでモノラルPCMに落とし、エネルギーの立ち上がり（スペクトラルフラックスの簡易版）
 * のピークをビートとして拾う。音ハメ磁石に使えれば十分の精度でよい。
 */

const SR = 22050;
const HOP = 512;

export function decodePcm(absPath: string): Promise<Float32Array> {
  return new Promise((resolve, reject) => {
    const ff = spawn("ffmpeg", [
      "-v", "quiet",
      "-i", absPath,
      "-ac", "1",
      "-ar", String(SR),
      "-f", "f32le",
      "pipe:1",
    ]);
    const chunks: Buffer[] = [];
    ff.stdout.on("data", (c) => chunks.push(c));
    ff.on("error", reject);
    ff.on("close", (code) => {
      if (code !== 0) return reject(new Error(`ffmpeg exit ${code}`));
      const buf = Buffer.concat(chunks);
      resolve(
        new Float32Array(buf.buffer, buf.byteOffset, Math.floor(buf.length / 4)),
      );
    });
  });
}

/**
 * PCM からオンセット（立ち上がり）を時刻＋強度で拾う純関数。
 * スペクトラルフラックス簡易版→適応しきい値→局所最大ピーク。fs/ffmpeg非依存。
 * detectBeats（時刻のみ）と analyzeSongStructure（構造解析）の共通の土台。
 */
export function detectOnsets(
  pcm: Float32Array,
  sampleRate: number,
  hop = HOP,
): { times: number[]; strengths: number[] } {
  const frames = Math.floor(pcm.length / hop);
  if (frames < 8) return { times: [], strengths: [] };

  // 1) フレームごとのエネルギー
  const energy = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    let sum = 0;
    for (let j = 0; j < hop; j++) {
      const v = pcm[i * hop + j];
      sum += v * v;
    }
    energy[i] = sum;
  }

  // 2) 立ち上がり（前フレームより増えた量だけ）
  const flux = new Float32Array(frames);
  for (let i = 1; i < frames; i++) {
    flux[i] = Math.max(0, energy[i] - energy[i - 1]);
  }

  // 3) 適応しきい値（近傍の平均+偏差）を超えた局所最大をピークに
  const W = 20;
  const times: number[] = [];
  const strengths: number[] = [];
  const minGap = 0.22; // 秒
  let lastBeat = -1;
  for (let i = 2; i < frames - 2; i++) {
    const lo = Math.max(0, i - W);
    const hi = Math.min(frames, i + W);
    let mean = 0;
    for (let k = lo; k < hi; k++) mean += flux[k];
    mean /= hi - lo;
    let sd = 0;
    for (let k = lo; k < hi; k++) sd += (flux[k] - mean) ** 2;
    sd = Math.sqrt(sd / (hi - lo));
    const threshold = mean + 1.4 * sd;
    const isPeak =
      flux[i] > threshold &&
      flux[i] >= flux[i - 1] &&
      flux[i] >= flux[i + 1] &&
      flux[i] > 1e-6;
    if (isPeak) {
      const t = (i * hop) / sampleRate;
      if (t - lastBeat >= minGap) {
        times.push(Math.round(t * 1000) / 1000);
        strengths.push(flux[i]); // 音ハメ磁石の吸着強度＝フラックス値
        lastBeat = t;
      }
    }
  }
  return { times, strengths };
}

/** ④ビート検出（時刻＋強度）。ダウンビート判定に強度を使うための詳細版。 */
export async function detectBeatsDetailed(
  projectName: string,
  file: string,
): Promise<{ beats: number[]; strengths: number[]; duration: number }> {
  const pcm = await decodePcm(projectFile(projectName, file));
  const { times, strengths } = detectOnsets(pcm, SR);
  return { beats: times, strengths, duration: pcm.length / SR };
}

/** ④ビート吸着用のビート検出（時刻のみ）。detectBeatsDetailed の薄いラッパー。 */
export async function detectBeats(
  projectName: string,
  file: string,
): Promise<number[]> {
  return (await detectBeatsDetailed(projectName, file)).beats;
}

/** 波形ストリップ用のピーク列（曲の見取り図） */
export async function computeWaveform(
  projectName: string,
  file: string,
  buckets = 1200,
): Promise<{ duration: number; peaks: number[] }> {
  const pcm = await decodePcm(projectFile(projectName, file));
  const duration = pcm.length / SR;
  const per = Math.max(1, Math.floor(pcm.length / buckets));
  const peaks: number[] = [];
  for (let b = 0; b < buckets; b++) {
    let max = 0;
    const start = b * per;
    for (let i = start; i < Math.min(start + per, pcm.length); i++) {
      const v = Math.abs(pcm[i]);
      if (v > max) max = v;
    }
    peaks.push(Math.round(max * 1000) / 1000);
  }
  return { duration, peaks };
}

// ============================================================================
// 案3「拍節グリッド＋サビ検出」: 曲の構造を数学で測る純関数群。
// すべて Float32Array / number[] を受け、fs/ffmpeg非依存で機械検証できる。
// ============================================================================

const round3 = (x: number) => Math.round(x * 1000) / 1000;

/**
 * オンセット時刻列からテンポ（BPM）を推定する。
 * 近距離のonset間隔を集め、候補周期の整数倍にどれだけ一致するかで採点。
 * 探索60〜200BPM、優先レンジ70〜180で半倍/倍テンポの曖昧さを解決する
 * （例: 0.25s連打＝240相当は、候補上限200外なので自然に120へ落ちる）。
 * confidenceは最良スコアと次点の比（0〜1の相対値）。
 */
export function estimateBpm(onsets: number[]): { bpm: number; confidence: number } {
  const ons = onsets
    .filter((t) => Number.isFinite(t))
    .slice()
    .sort((a, b) => a - b);
  if (ons.length < 2) return { bpm: 0, confidence: 0 };

  const MIN_BPM = 60;
  const MAX_BPM = 200;
  const maxLag = 60 / MIN_BPM; // 1.0s

  // 近距離のonset間隔（周期の最大4倍まで）を集める。実曲でもO(N×近傍数)で軽い。
  const maxInterval = maxLag * 4 * 1.05;
  const intervals: number[] = [];
  for (let i = 0; i < ons.length; i++) {
    for (let j = i + 1; j < ons.length; j++) {
      const d = ons[j] - ons[i];
      if (d > maxInterval) break;
      if (d > 1e-4) intervals.push(d);
    }
  }
  if (intervals.length === 0) return { bpm: 0, confidence: 0 };

  const sigma = 0.03; // 一致とみなす揺らぎ（±30ms程度、ジッタ耐性）
  const twoSig2 = 2 * sigma * sigma;
  const prefWeight = (bpm: number) => {
    // 70〜180を優先。外側はなだらかに減衰させ半倍/倍の綱引きを解く。
    if (bpm >= 70 && bpm <= 180) return 1;
    const d = bpm < 70 ? 70 - bpm : bpm - 180;
    return Math.max(0.4, 1 - d / 120);
  };

  const score = (bpm: number) => {
    const T = 60 / bpm;
    let s = 0;
    for (const d of intervals) {
      const k = Math.round(d / T);
      if (k < 1 || k > 4) continue;
      const err = d - k * T;
      s += Math.exp(-(err * err) / twoSig2);
    }
    return s * prefWeight(bpm);
  };

  let bestBpm = 0;
  let best = -1;
  let second = 0;
  for (let bpm = MIN_BPM; bpm <= MAX_BPM; bpm += 0.5) {
    const sc = score(bpm);
    if (sc > best) {
      // 5%以上離れた次点だけを second として保持（同一テンポ周辺の肩は無視）
      if (bestBpm > 0 && Math.abs(bpm - bestBpm) / bestBpm > 0.05) second = best;
      best = sc;
      bestBpm = bpm;
    } else if (sc > second && bestBpm > 0 && Math.abs(bpm - bestBpm) / bestBpm > 0.05) {
      second = sc;
    }
  }

  const confidence = best > 0 ? best / (best + second) : 0;
  return { bpm: Math.round(bestBpm * 10) / 10, confidence: round3(confidence) };
}

/**
 * 等間隔グリッドの位相（offset）を推定して 0〜duration のグリッド列を返す。
 * 各onsetの周期内位相を単位円に載せた円周平均で、グリッド点→最寄りonsetの
 * ずれが最小になる位相を求める（位相の巻き込みに強い）。
 */
export function fitBeatGrid(
  onsets: number[],
  bpm: number,
  duration: number,
): { offset: number; grid: number[] } {
  if (!(bpm > 0) || !(duration > 0)) return { offset: 0, grid: [] };
  const T = 60 / bpm;

  let offset = 0;
  const ons = onsets.filter((t) => Number.isFinite(t));
  if (ons.length > 0) {
    let sx = 0;
    let sy = 0;
    for (const t of ons) {
      const ang = (2 * Math.PI * (((t % T) + T) % T)) / T;
      sx += Math.cos(ang);
      sy += Math.sin(ang);
    }
    const meanAng = Math.atan2(sy, sx);
    offset = (((meanAng / (2 * Math.PI)) * T) % T + T) % T;
  }

  const grid: number[] = [];
  for (let t = offset; t <= duration + 1e-9; t += T) grid.push(round3(t));
  return { offset: round3(offset), grid };
}

/**
 * 4拍子前提の小節頭（ダウンビート）検出。
 * グリッドを4本に1本ずつ抜く4通りの位相のうち、近傍onsetの強度和が最大の
 * 位相を小節頭列として返す。
 */
export function detectDownbeats(
  grid: number[],
  onsets: number[],
  strengths: number[],
  meter = 4,
): number[] {
  if (grid.length === 0 || onsets.length === 0) return [];
  const T = grid.length > 1 ? grid[1] - grid[0] : 0.5;
  const tol = T / 2;

  // グリッド点→最寄りonsetの強度（許容内のみ）。onsetは昇順前提。
  const strengthAt = (gt: number): number => {
    let best = 0;
    let bestErr = tol;
    // 線形探索（グリッド点は疎なので十分軽い）
    for (let i = 0; i < onsets.length; i++) {
      const err = Math.abs(onsets[i] - gt);
      if (err <= bestErr) {
        bestErr = err;
        best = strengths[i] ?? 1;
      } else if (onsets[i] - gt > tol) {
        break;
      }
    }
    return best;
  };

  let bestPhase = 0;
  let bestSum = -1;
  for (let p = 0; p < meter; p++) {
    let sum = 0;
    for (let i = p; i < grid.length; i += meter) sum += strengthAt(grid[i]);
    if (sum > bestSum) {
      bestSum = sum;
      bestPhase = p;
    }
  }

  const downbeats: number[] = [];
  for (let i = bestPhase; i < grid.length; i += meter) downbeats.push(grid[i]);
  return downbeats;
}

/**
 * RMSエネルギー包絡。hopごとにRMSを取る（窓＝hopの2倍、末端は短窓）。
 */
export function computeRmsEnvelope(
  pcm: Float32Array,
  sampleRate: number,
  hopSec = 0.25,
): number[] {
  const hop = Math.max(1, Math.round(hopSec * sampleRate));
  const win = hop * 2;
  const frames = Math.max(0, Math.floor(pcm.length / hop));
  const out: number[] = [];
  for (let f = 0; f < frames; f++) {
    const start = f * hop;
    const end = Math.min(start + win, pcm.length);
    let sum = 0;
    for (let i = start; i < end; i++) sum += pcm[i] * pcm[i];
    out.push(Math.sqrt(sum / Math.max(1, end - start)));
  }
  return out;
}

export type EnergySection = {
  start: number;
  end: number;
  level: "low" | "mid" | "high";
  kind?: "chorus" | "break";
};

/**
 * RMS包絡から曲の起伏区間を推定する。
 * 正規化→移動平均(約1.5s)→パーセンタイルしきい値(高70%tile/低25%tile)で
 * low/mid/high に分類し、隣接同レベルをマージ。highが8秒以上続く帯をchorus、
 * lowが2秒以上続く帯をbreakとして kind に付ける。全域を隙間なく被覆する。
 */
export function detectEnergySections(
  rms: number[],
  hopSec: number,
  duration: number,
): EnergySection[] {
  const n = rms.length;
  if (n === 0) return [];

  // 1) 正規化（min-max）
  let min = Infinity;
  let max = -Infinity;
  for (const v of rms) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  const span = max - min;
  const norm = rms.map((v) => (span > 1e-9 ? (v - min) / span : 0));

  // 2) 移動平均（約1.5s、中央寄せ）で平滑
  const half = Math.max(1, Math.round(1.5 / hopSec / 2));
  const smooth = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    const lo = Math.max(0, i - half);
    const hi = Math.min(n - 1, i + half);
    let s = 0;
    for (let k = lo; k <= hi; k++) s += norm[k];
    smooth[i] = s / (hi - lo + 1);
  }

  // 3) パーセンタイルしきい値
  const sorted = smooth.slice().sort((a, b) => a - b);
  const pct = (p: number) => sorted[Math.min(n - 1, Math.floor(p * n))];
  const hiTh = pct(0.7);
  const loTh = pct(0.25);

  const levelOf = (v: number): "low" | "mid" | "high" =>
    v >= hiTh ? "high" : v <= loTh ? "low" : "mid";

  // 4) 連続する同レベルをランにまとめる（フレーム区間）
  type Run = { s: number; e: number; level: "low" | "mid" | "high" };
  const runs: Run[] = [];
  for (let i = 0; i < n; i++) {
    const lv = levelOf(smooth[i]);
    const last = runs[runs.length - 1];
    if (last && last.level === lv) last.e = i;
    else runs.push({ s: i, e: i, level: lv });
  }

  // 5) フレーム→秒。隙間なく被覆するため境界を前区間の終端に揃える。
  const sections: EnergySection[] = [];
  for (let r = 0; r < runs.length; r++) {
    const run = runs[r];
    const start = r === 0 ? 0 : sections[sections.length - 1].end;
    const end = r === runs.length - 1 ? duration : round3((run.e + 1) * hopSec);
    const durSec = end - start;
    const sec: EnergySection = { start: round3(start), end: round3(end), level: run.level };
    if (run.level === "high" && durSec >= 8) sec.kind = "chorus";
    else if (run.level === "low" && durSec >= 2) sec.kind = "break";
    sections.push(sec);
  }
  return sections;
}

/**
 * 上記の解析を束ねるオーケストレータ（純関数）。
 * onset検出→BPM→拍グリッド→小節頭→RMS包絡→起伏区間 をまとめて返す。
 */
export function analyzeSongStructure(
  pcm: Float32Array,
  sampleRate: number,
  duration: number,
): {
  bpm: number;
  confidence: number;
  offset: number;
  beats: number[];
  beatGrid: number[];
  downbeats: number[];
  rms: number[];
  sections: EnergySection[];
} {
  const { times, strengths } = detectOnsets(pcm, sampleRate);
  const { bpm, confidence } = estimateBpm(times);
  const { offset, grid } = fitBeatGrid(times, bpm, duration);
  const downbeats = detectDownbeats(grid, times, strengths, 4);
  const rms = computeRmsEnvelope(pcm, sampleRate);
  const sections = detectEnergySections(rms, 0.25, duration);
  return {
    bpm,
    confidence,
    offset,
    beats: times,
    beatGrid: grid,
    downbeats,
    rms,
    sections,
  };
}

/**
 * 実ファイルを decode して beats.json v2 相当のペイロードを返す（API POST用）。
 * PCMのデコードは1回だけ。beats.json v2 = {file, beats, duration, bpm, beatGrid,
 * downbeats, sections}（旧キー file/beats/duration を保持したまま拡張）。
 */
export async function analyzeSong(
  projectName: string,
  file: string,
): Promise<{
  file: string;
  beats: number[];
  duration: number;
  bpm: number;
  beatGrid: number[];
  downbeats: number[];
  sections: EnergySection[];
}> {
  const pcm = await decodePcm(projectFile(projectName, file));
  const duration = pcm.length / SR;
  const st = analyzeSongStructure(pcm, SR, duration);
  return {
    file,
    beats: st.beats,
    duration,
    bpm: st.bpm,
    beatGrid: st.beatGrid,
    downbeats: st.downbeats,
    sections: st.sections,
  };
}
