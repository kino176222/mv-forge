import "./server-guard";
/**
 * ElevenLabs の薄いサーバーサイドクライアント（生fetch、SDK不使用）。
 * キーは .env.local の ELEVENLABS_API_KEY（lrc/route.ts と同じ流儀）。
 * 用途: 録音した演技を Speech-to-Speech で声色だけ変換する（いとエモし検証の結論:
 * 泣きの演技はTTSに天井がある → 人間演技+STSが正解）。
 */

export function elevenApiKey(): string | null {
  return process.env.ELEVENLABS_API_KEY ?? null;
}

export interface ElevenVoice {
  id: string;
  name: string;
  category: string;
}

/** My Voices の一覧（ユーザーがElevenLabs側でキュレーション済みのリスト） */
export async function listVoices(): Promise<ElevenVoice[]> {
  const key = elevenApiKey();
  if (!key) throw new Error("ELEVENLABS_API_KEY が見つかりません（.env.local）");
  const res = await fetch("https://api.elevenlabs.io/v1/voices", {
    headers: { "xi-api-key": key },
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`ElevenLabs voices failed: ${res.status} ${detail.slice(0, 200)}`);
  }
  const data = (await res.json()) as {
    voices?: { voice_id: string; name: string; category?: string }[];
  };
  return (data.voices ?? []).map((v) => ({
    id: v.voice_id,
    name: v.name,
    category: v.category ?? "",
  }));
}

/** TTSでMP3バイト列を返す（ボイス手帳の試聴サンプル生成用） */
export async function textToSpeech(params: {
  text: string;
  voiceId: string;
}): Promise<Buffer> {
  const key = elevenApiKey();
  if (!key) throw new Error("ELEVENLABS_API_KEY が見つかりません（.env.local）");
  const res = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${params.voiceId}`,
    {
      method: "POST",
      headers: { "xi-api-key": key, "Content-Type": "application/json" },
      body: JSON.stringify({
        text: params.text,
        model_id: "eleven_multilingual_v2",
      }),
    },
  );
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`ElevenLabs TTS failed: ${res.status} ${detail.slice(0, 200)}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

/**
 * Speech-to-Speech: 演技のニュアンスを保ったまま声色だけ変換してMP3バイト列を返す。
 * パラメータは 2026-07-05 のマトリクス実験で言葉の保持率が最良だった組み合わせ:
 * - stability=1.0 が決定打（未指定だと「あいうえお」が別言語級に化ける）
 * - similarity_boost は 0.75（1.0 に上げると逆に崩壊する）
 * - remove_background_noise は【オフ】（オンだと語頭・語尾を食って化ける。
 *   音量はアップロード時の loudnorm で確保済みなので不要）
 */
export async function speechToSpeech(params: {
  audio: Buffer;
  filename: string;
  voiceId: string;
}): Promise<Buffer> {
  const key = elevenApiKey();
  if (!key) throw new Error("ELEVENLABS_API_KEY が見つかりません（.env.local）");
  const form = new FormData();
  form.append(
    "audio",
    new Blob([new Uint8Array(params.audio)], { type: "audio/mpeg" }),
    params.filename,
  );
  form.append("model_id", "eleven_multilingual_sts_v2");
  form.append(
    "voice_settings",
    JSON.stringify({ stability: 1.0, similarity_boost: 0.75 }),
  );
  const res = await fetch(
    `https://api.elevenlabs.io/v1/speech-to-speech/${params.voiceId}`,
    {
      method: "POST",
      headers: { "xi-api-key": key },
      body: form,
    },
  );
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`ElevenLabs STS failed: ${res.status} ${detail.slice(0, 200)}`);
  }
  return Buffer.from(await res.arrayBuffer()); // 既定出力 mp3_44100_128
}
