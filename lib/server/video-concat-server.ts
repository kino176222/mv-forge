import "./server-guard";
import { execFile } from "node:child_process";

function ff(bin: "ffmpeg" | "ffprobe", args: string[], timeout: number): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(bin, args, { timeout }, (err, stdout) =>
      err ? reject(err) : resolve(String(stdout)),
    );
  });
}

/**
 * 🎬 動画の連結（i2v延長生成用）。
 * 入力同士はコーデック・タイムベース・解像度が微妙に違い得る（falは同じモデルでも
 * 1912x1084等を返すことがあり、実際に連結失敗の事故が起きた）。なので:
 * - 全入力を「先頭入力の寸法」へ scale + crop で正規化し、SARも1に揃える
 * - concat demuxer ではなく filter の concat でデコード→再エンコード（確実性優先）
 * 音声は使わない方針（曲が主役）なので映像のみ。
 */
export async function concatVideos(inputs: string[], out: string): Promise<void> {
  if (inputs.length < 2) throw new Error("concatVideos: 2本以上必要です");
  // 基準寸法 = 先頭入力（親動画）
  const probe = await ff(
    "ffprobe",
    ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0", inputs[0]],
    30_000,
  );
  const [w, h] = probe.trim().split(",").map(Number);
  if (!w || !h) throw new Error(`基準動画の寸法が取れません: ${inputs[0]}`);

  const args: string[] = ["-y", "-v", "error"];
  for (const f of inputs) args.push("-i", f);
  // 各入力を基準寸法へ: 足りなければ拡大して切る（縁の黒帯を出さない）
  const norm = inputs
    .map(
      (_, i) =>
        `[${i}:v]scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},setsar=1[v${i}]`,
    )
    .join(";");
  const refs = inputs.map((_, i) => `[v${i}]`).join("");
  args.push(
    "-filter_complex",
    `${norm};${refs}concat=n=${inputs.length}:v=1:a=0[v]`,
    "-map",
    "[v]",
    "-an",
    "-c:v",
    "libx264",
    "-crf",
    "18",
    "-pix_fmt",
    "yuv420p",
    out,
  );
  await ff("ffmpeg", args, 300_000);
}

/** 動画の最終コマをPNGで抜き出す（延長生成の元絵にする） */
export function extractLastFrame(videoPath: string, outPng: string): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(
      "ffmpeg",
      // -sseof で末尾0.1秒から読み、-update 1 で「最後に読めたフレーム」を1枚だけ残す
      ["-y", "-v", "error", "-sseof", "-0.1", "-i", videoPath, "-frames:v", "1", "-update", "1", outPng],
      { timeout: 60_000 },
      (err) => (err ? reject(err) : resolve()),
    );
  });
}
