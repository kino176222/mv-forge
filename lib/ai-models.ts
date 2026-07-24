/**
 * AI参謀に使えるモデルの一覧。GUI/サーバー共用（node依存を置かないこと）。
 * idはUI・API・localStorageを素通しで流れる1本の文字列:
 * - claude: 後方互換のため素のモデルID（"" = 既定）
 * - codex / gemini: "provider:model"（"provider:default" = そのCLIの既定）
 */
export type AiProvider = "claude" | "codex" | "gemini";

export interface AiModelOption {
  id: string;
  provider: AiProvider;
  label: string;
  /** ローカル画像ファイルをAIに見せられるか（i2v提案・検品・シーン設計に必要） */
  vision: boolean;
  /** codexのみ: 思考の深さ（model_reasoning_effort）。idの"@効き目"サフィックスと対応 */
  effort?: "minimal" | "low" | "medium" | "high" | "xhigh";
}

export const AI_PROVIDER_LABELS: Record<AiProvider, string> = {
  claude: "Claude",
  codex: "Codex",
  gemini: "Gemini",
};

export const AI_MODELS: AiModelOption[] = [
  { id: "", provider: "claude", label: "既定（Claude Codeの設定に従う）", vision: true },
  { id: "claude-sonnet-5", provider: "claude", label: "Sonnet 5 — 速い・枠にやさしい（量産向け）", vision: true },
  { id: "claude-fable-5", provider: "claude", label: "Fable 5 — 最高性能（勝負曲向け）", vision: true },
  { id: "claude-opus-4-8", provider: "claude", label: "Opus 4.8 — 高性能", vision: true },
  { id: "claude-haiku-4-5-20251001", provider: "claude", label: "Haiku 4.5 — 最速・最軽量", vision: true },
  { id: "codex:default@xhigh", provider: "codex", label: "最深思考（xhigh） — 最高品質・遅い", vision: true, effort: "xhigh" },
  { id: "codex:default@high", provider: "codex", label: "じっくり（high） — 勝負どころ向け", vision: true, effort: "high" },
  { id: "codex:default@medium", provider: "codex", label: "標準思考（medium） — バランス", vision: true, effort: "medium" },
  { id: "codex:default@low", provider: "codex", label: "高速（low） — 下書き・量産向け", vision: true, effort: "low" },
  { id: "gemini:gemini-3.1-pro-high", provider: "gemini", label: "3.1 Pro (High) — 最高性能・じっくり ※画像入力なし", vision: false },
  { id: "gemini:gemini-3.6-flash-high", provider: "gemini", label: "3.6 Flash (High) — 最新・賢い ※画像入力なし", vision: false },
  { id: "gemini:gemini-3.6-flash-low", provider: "gemini", label: "3.6 Flash (Low) — 最新・最速 ※画像入力なし", vision: false },
];

/** モデルID→プロバイダとCLIに渡すモデル名の解決。未知のIDはclaude扱い（後方互換） */
export function resolveAiModel(id: string): {
  provider: AiProvider;
  cliModel: string;
  vision: boolean;
  effort?: AiModelOption["effort"];
} {
  const known = AI_MODELS.find((m) => m.id === id);
  for (const provider of ["codex", "gemini"] as const) {
    const prefix = `${provider}:`;
    if (id.startsWith(prefix)) {
      // "codex:default@low" → モデル部と思考の深さ（@サフィックス）に分解
      const [rest, effortRaw] = id.slice(prefix.length).split("@");
      const effort = (known?.effort ?? effortRaw) as AiModelOption["effort"] | undefined;
      return {
        provider,
        cliModel: rest === "default" ? "" : rest,
        vision: known?.vision ?? provider === "codex",
        effort,
      };
    }
  }
  return { provider: "claude", cliModel: id, vision: true };
}

/** 💡 i2vの動きレコメンド1案。GUI/サーバー共用 */
export interface MotionIdea {
  label: string; // 日本語の短い見出し
  intensity: "subtle" | "medium" | "bold";
  prompt: string; // 英語の動き指示
  reason: string;
}

/** 🎬 i2v（画像→動画）に使えるfal.aiモデル。GUI/サーバー共用 */
export const I2V_MODELS = [
  {
    id: "fal-ai/kling-video/v2.5-turbo/pro/image-to-video",
    label: "Kling 2.5 Turbo Pro — 高品質（約$0.35/5秒）",
  },
  {
    id: "fal-ai/bytedance/seedance/v1/lite/image-to-video",
    label: "Seedance 1.0 Lite — 速い・安い（1080p 約$0.2/5秒）",
  },
];
