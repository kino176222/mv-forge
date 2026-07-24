import { z } from "zod";

/**
 * 一発出しモード（一気通貫MV生成）の型定義。
 * 仕様の正本: Vault `01_プロジェクト/music/mv-maker/2026-07-16_一気通貫MV生成_仕様書_v1.0.md`
 * - ゲートは2つだけ（方針・完成品）。途中では止めない
 * - 正本は常に project.json の lines[]（平屋の原則）。oneshot.json は作業メモ
 */

export type OneshotMode = "matsu" | "take" | "ume";

export type OneshotPhase =
  | "preflight"
  | "lrc"
  | "scene-plan"
  | "cost-gate"
  | "images"
  | "apply"
  | "depth"
  | "i2v"
  | "suggest"
  | "adopt"
  | "done"
  | "error"
  | "cancelled"
  | "interrupted";

/** 進捗ステッパー表示用（phase→ラベル。順序も兼ねる） */
export const ONESHOT_STEPS: { phase: OneshotPhase; label: string }[] = [
  { phase: "preflight", label: "前提チェック" },
  { phase: "lrc", label: "歌詞タイミング（LRC）" },
  { phase: "scene-plan", label: "シーン設計" },
  { phase: "cost-gate", label: "コスト確認" },
  { phase: "images", label: "画像生成＋AI判定" },
  { phase: "apply", label: "行へ適用" },
  { phase: "depth", label: "深度マップ（パララックス下地）" },
  { phase: "i2v", label: "動画化＋AI判定" },
  { phase: "suggest", label: "演出提案" },
  { phase: "adopt", label: "演出の採用" },
];

/** 演出トーン（既定=大人しめ。テロップ・切替の派手さを抑える。カメラモーションは抑えない） */
export type OneshotTone = "calm" | "standard" | "bold";

/**
 * 表現のさじ加減（絵が歌詞の直喩になりすぎる問題への3段ダイヤル）。
 * 2026-07-17 ナツヂカラ実運転のKinoフィードバック「直喩的すぎる。エモく・抽象的に表現する
 * いいさじ加減が出ないのか」から追加。既定=balanced。
 */
export type MetaphorLevel = "literal" | "balanced" | "poetic";

export const METAPHOR_DIRECTIVES: Record<MetaphorLevel, string> = {
  literal:
    "シーンの配分目安: 直喩（歌詞の情景をそのまま）7割・間接表現3割。分かりやすさ優先",
  balanced:
    "シーンの配分目安: 直喩3割・間接表現5割・抽象2割。歌詞をなぞりつつ、要所は情緒で見せる",
  poetic:
    "シーンの配分目安: 直喩1割・間接表現5割・抽象4割。歌詞の言葉はほぼ直接描かず、情緒と質感で語る",
};

export const TONE_DIRECTIVES: Record<OneshotTone, string> = {
  calm: "演出トーン: 大人しめ。テロップアニメは静的〜最小限（フェード・スライド・バウンド等の派手な出方は使わない）。切替はカット/ディゾルブ中心。カメラモーション（ズーム・パン・パララックス）は使ってよい",
  standard: "演出トーン: 標準。サビだけ演出を強め、他は控えめに",
  bold: "演出トーン: 派手。テロップアニメ・切替・オーバーレイを積極的に使ってよい（ただしセクション内の統一は守る）",
};

/** AIが設計する1シーン。既存 batch の Shot 互換＋i2v拡張（竹/松で使う） */
export interface PlannedScene {
  filename: string;
  prompt: string;
  purpose: string;
  assign?: { lineId: string; order: number };
  i2v?: { motionPrompt: string; intensity: "subtle" | "medium" | "bold" };
}

export interface ScenePlanOutput {
  scenes: PlannedScene[];
  summary: string;
}

/** ジョブ本体（in-memory Map＋jobs.json 永続化。payload.phase を deriveState が読む） */
export interface OneshotJob {
  id: string;
  projectName: string;
  mode: OneshotMode;
  model: string;
  /** i2vモデル（竹/松のみ使用。lib/ai-models.ts の I2V_MODELS） */
  i2vModel: string;
  phase: OneshotPhase;
  stepIndex: number;
  stepLabel: string;
  /** 現在ステップの子ジョブ進捗（画像生成の done/total 等） */
  done: number;
  total: number;
  childJobId: string | null;
  planSummary: string;
  planCount: number;
  /** Step 3.5 コストゲート: 確定見積（円）と上限。超過時は phase="cost-gate" で承認待ち */
  planYen: number | null;
  capYen: number | null;
  costConfirmed: boolean;
  /** 実測ではなく単価表ベースの概算累計（USD） */
  spentUsd: number;
  /** AI判定で最終的に不採用→再生成でも救えなかった画像（rejected/へ退避） */
  rejectedImages: string[];
  /** 生成に失敗したショット名（作品は静止画のままでも成立するので続行し、報告に使う） */
  failedImages: string[];
  /** i2vで最終不採用（静止画のまま残した）行 */
  i2vRejected: string[];
  error: string | null;
  startedAt: number;
}

/** <projectDir>/oneshot.json（チェックポイント。冪等な途中再開=Phase 3 の土台） */
export const oneshotCheckpointSchema = z.object({
  version: z.literal(1),
  mode: z.enum(["matsu", "take", "ume"]),
  createdAt: z.number(),
  summary: z.string().default(""),
  scenes: z.array(
    z.object({
      filename: z.string(),
      prompt: z.string(),
      purpose: z.string().default(""),
      assign: z.object({ lineId: z.string(), order: z.number() }).optional(),
      i2v: z
        .object({
          motionPrompt: z.string(),
          intensity: z.enum(["subtle", "medium", "bold"]),
        })
        .optional(),
    }),
  ),
  steps: z.record(z.string(), z.boolean()).default({}),
});
export type OneshotCheckpoint = z.infer<typeof oneshotCheckpointSchema>;
