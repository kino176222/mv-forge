import fs from "node:fs";
import path from "node:path";
import { projectDir, loadProject, findParentImage } from "../server/projects-server";
import { loadFalKey } from "../server/i2v-server";
import { detectAiProviders } from "../server/llm";
import { AI_PROVIDER_LABELS, resolveAiModel } from "../ai-models";

/**
 * Step 0 前提チェック: 走り出してから止まると悲しいもの（素材・キー・CLI）を先に全部見る。
 * 返り値は問題の配列（空=出発OK）。
 */
export async function preflightOneshot(input: {
  projectName: string;
  lyricsText?: string;
  /** AI参謀のモデルID（プロバイダCLIの存在チェックに使う。省略=claude） */
  model?: string;
}): Promise<string[]> {
  const problems: string[] = [];

  let dir: string;
  try {
    dir = projectDir(input.projectName);
  } catch (e) {
    return [String(e)];
  }
  if (!fs.existsSync(dir)) {
    return [`プロジェクトが見つかりません: ${input.projectName}`];
  }

  let project;
  try {
    project = await loadProject(input.projectName);
  } catch (e) {
    return [`project.json が読めません: ${String(e)}`];
  }

  // 曲
  const song = project.meta.songFile;
  if (!song || !fs.existsSync(path.join(dir, song))) {
    problems.push("曲ファイルがありません（セットアップから音源を投入してください）");
  }

  // 親画像（シーン画像はI2I参照で量産する）
  if (!findParentImage(input.projectName)) {
    problems.push("親画像がありません（parent.png をアップロードしてください）");
  }

  // 歌詞: テキスト入力があればLRC自動生成、無ければ既存 lines[] を使う
  const willGenerateLrc = Boolean(input.lyricsText?.trim());
  if (!willGenerateLrc && project.lines.length === 0) {
    problems.push("歌詞がありません（歌詞テキストを入力するか、先にLRCを取り込んでください）");
  }
  if (willGenerateLrc && !process.env.ELEVENLABS_API_KEY) {
    problems.push("ELEVENLABS_API_KEY が未設定です（LRC自動生成に必要）");
  }

  // 画像生成のキー（Vault .env か環境変数）
  if (!loadFalKey()) {
    problems.push("FAL_KEY が見つかりません（画像生成に必要。Vaultの .env か環境変数で設定）");
  }

  // AI CLI（シーン設計・演出提案の頭脳。定額サブスクのCLIログイン方式）
  const { provider, vision } = resolveAiModel(input.model ?? "");
  const available = await detectAiProviders();
  if (!available[provider]) {
    problems.push(
      `${AI_PROVIDER_LABELS[provider]} のCLIが見つかりません（シーン設計・演出提案に必要）`,
    );
  }
  // 一発出しは親画像を見るシーン設計・検品を含むため、画像入力できるモデルが必須
  if (!vision) {
    problems.push(
      `選択中のAIモデル（${AI_PROVIDER_LABELS[provider]}）は画像入力に未対応です。ClaudeまたはCodexのモデルを選んでください`,
    );
  }

  return problems;
}
