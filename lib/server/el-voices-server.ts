import "./server-guard";
import fs from "node:fs";
import path from "node:path";
import { projectsRoot } from "./projects-server";

/**
 * ボイス手帳: ElevenLabsボイチェンの変換先として登録した声のリスト。
 * 声はプロジェクトではなくユーザーの資産なので、全プロジェクト共通で
 * projects/el-voices.json に保存する（listProjects はディレクトリしか見ないので安全）。
 * 試聴サンプルは projects/el-voice-samples/<voiceId>.mp3 にキャッシュ。
 */

export interface RegisteredVoice {
  id: string;
  name: string;
}

function rosterPath(): string {
  return path.join(projectsRoot(), "el-voices.json");
}

export function readRoster(): RegisteredVoice[] {
  try {
    const v = JSON.parse(fs.readFileSync(rosterPath(), "utf8"));
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

export function writeRoster(voices: RegisteredVoice[]): void {
  fs.mkdirSync(projectsRoot(), { recursive: true });
  fs.writeFileSync(rosterPath(), JSON.stringify(voices, null, 2));
}

export function sampleDir(): string {
  return path.join(projectsRoot(), "el-voice-samples");
}

export function isValidVoiceId(id: string): boolean {
  return /^[A-Za-z0-9]{10,40}$/.test(id);
}
