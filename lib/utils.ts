import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** 区間の絵として動画素材（i2v生成物など）かどうか。UI/Remotion共用 */
export function isVideoFile(file: string): boolean {
  return /\.(mp4|webm|mov)$/i.test(file);
}

/** 秒 → 「1分23秒」表記（ジョブの経過・残り時間表示用） */
export function formatDurationJa(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  const m = Math.floor(s / 60);
  return m > 0 ? `${m}分${String(s % 60).padStart(2, "0")}秒` : `${s}秒`;
}
