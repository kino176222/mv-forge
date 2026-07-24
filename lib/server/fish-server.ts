import "./server-guard";
import fs from "node:fs";
import path from "node:path";

/**
 * Fish Audio S2-Pro の薄いサーバーサイドクライアント。
 * キーは環境変数 FISH_AUDIO_API_KEY を優先し、無ければ Vault ルートの .env から読む
 * （generate-image と同じ「キーはVaultに一元管理」の思想）。
 */

let VAULT_ENV: string | null = process.env.MVFORGE_VAULT_ENV ?? null;

export function fishApiKey(): string | null {
  if (process.env.FISH_AUDIO_API_KEY) return process.env.FISH_AUDIO_API_KEY;
  if (!VAULT_ENV) return null;
  try {
    const raw = fs.readFileSync(VAULT_ENV, "utf8");
    const m = raw.match(/^FISH_AUDIO_API_KEY=(.+)$/m);
    return m ? m[1].trim() : null;
  } catch {
    return null;
  }
}

export interface FishVoice {
  id: string;
  title: string;
  likeCount: number;
  taskCount: number;
}

/** マーケットプレイスの声モデル検索（日本語対応のものだけ返す） */
export async function searchVoices(query: string): Promise<FishVoice[]> {
  const key = fishApiKey();
  if (!key) throw new Error("FISH_AUDIO_API_KEY が見つかりません");
  const url = `https://api.fish.audio/model?title=${encodeURIComponent(query)}&page_size=10`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${key}` },
  });
  if (!res.ok) throw new Error(`Fish model search failed: ${res.status}`);
  const data = (await res.json()) as {
    items?: {
      _id: string;
      title: string;
      languages?: string[];
      like_count?: number;
      task_count?: number;
    }[];
  };
  return (data.items ?? [])
    .filter((m) => (m.languages ?? []).includes("ja"))
    .map((m) => ({
      id: m._id,
      title: m.title,
      likeCount: m.like_count ?? 0,
      taskCount: m.task_count ?? 0,
    }));
}

export interface TtsParams {
  text: string;
  referenceId: string;
  temperature: number; // 表現力。高いほど変化に富む（公式デフォルト0.7）
  speed: number;
}

/** S2-ProでTTSを1回実行してMP3バイト列を返す */
export async function generateTts(params: TtsParams): Promise<Buffer> {
  const key = fishApiKey();
  if (!key) throw new Error("FISH_AUDIO_API_KEY が見つかりません");
  const res = await fetch("https://api.fish.audio/v1/tts", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      model: "s2-pro", // ⚠️ S1と記法が別物。S2-Proは[角括弧]タグ
    },
    body: JSON.stringify({
      text: params.text,
      reference_id: params.referenceId,
      format: "mp3",
      temperature: params.temperature,
      top_p: 0.7,
      prosody: { speed: params.speed },
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Fish TTS failed: ${res.status} ${detail.slice(0, 200)}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

/** プロジェクト内の朗読テイク置き場 */
export function narrationDir(projectDirAbs: string): string {
  return path.join(projectDirAbs, "narration");
}

// ---- テイクの台帳（narration/takes.json）----
// 間（無音区間）に加えて、出自メタ（種別・使った声・変換元）も記録する。
// UI はファイル名の接頭辞ではなくこの台帳から種別・声名を描画する。

export interface SilenceRegion {
  at: number; // 開始秒
  dur: number; // 長さ秒
}
export interface TakeMeta {
  silences: SilenceRegion[];
  kind?: "tts" | "rec" | "vc"; // tts=Fish生成 / rec=マイク録音 / vc=ボイチェン
  voiceId?: string; // tts/vc で使った声
  voiceName?: string;
  source?: string; // vc の変換元テイク（narration/take_rec_*.mp3）
}
export type TakesMeta = Record<string, TakeMeta>;

function takesMetaPath(projectDirAbs: string): string {
  return path.join(narrationDir(projectDirAbs), "takes.json");
}

export function readTakesMeta(projectDirAbs: string): TakesMeta {
  try {
    return JSON.parse(fs.readFileSync(takesMetaPath(projectDirAbs), "utf8"));
  } catch {
    return {};
  }
}

export function writeTakesMeta(projectDirAbs: string, meta: TakesMeta): void {
  fs.mkdirSync(narrationDir(projectDirAbs), { recursive: true });
  fs.writeFileSync(takesMetaPath(projectDirAbs), JSON.stringify(meta, null, 2));
}
