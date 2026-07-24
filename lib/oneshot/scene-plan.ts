import { loadProject, findParentImage, listAssets } from "../server/projects-server";
import { buildLyricsDigest, coverageOf, MAX_SHOTS_PER_BATCH } from "../batch-plan";
import { quarantineShots } from "../server/batch-gen-server";
import { callLLM, extractJson } from "../server/llm";
import { loadSongStructure, type SongStructure } from "../server/suggest-server";
import type { Project } from "../schema";
import {
  METAPHOR_DIRECTIVES,
  type MetaphorLevel,
  type OneshotMode,
  type PlannedScene,
  type ScenePlanOutput,
} from "./types";

/**
 * Step 3 シーン設計（★頭脳）: 親画像＋歌詞＋曲の実測構造から、MV全体のショットリストを
 * AIが設計する。既存「🎬親画像から一式生成」の設計プロンプトの一発出し版。
 * - 枚数はAIの品質判断（目安: 曲長÷6〜8s、サビは密に）→ コードで上限クランプ
 * - 検疫・命名は既存の quarantineShots（lineId実在チェック・L番号前置・_v2重複回避）
 */

const round1 = (x: number) => Math.round(x * 10) / 10;

/** 曲の実測構造をプロンプト用テキストにする（無ければ空文字） */
export function structureBlock(struct: SongStructure | null): string {
  if (!struct) return "";
  const parts: string[] = [];
  if (struct.bpm) parts.push(`- BPM: ${Math.round(struct.bpm)}`);
  const sections = struct.sections ?? [];
  const chorus = sections.filter((s) => s.kind === "chorus");
  const brk = sections.filter((s) => s.kind === "break");
  if (chorus.length) {
    parts.push(
      `- サビ帯（見せ場。カット密度を高く）: ${chorus.map((s) => `${round1(s.start)}〜${round1(s.end)}s`).join(" / ")}`,
    );
  }
  if (brk.length) {
    parts.push(
      `- ブレイク帯（静かに。情景カット向き）: ${brk.map((s) => `${round1(s.start)}〜${round1(s.end)}s`).join(" / ")}`,
    );
  }
  if (parts.length === 0) return "";
  return `# 曲の実測構造（音声解析の実測。歌詞からの推測より優先すること）
${parts.join("\n")}

`;
}

/** プロンプト組み立て（純関数）。summary を先頭に書かせて設計判断を先に固定する */
export function buildScenePlanPrompt(
  project: Project,
  parent: string,
  existing: string[],
  struct: SongStructure | null,
  mode: OneshotMode,
  metaphor: MetaphorLevel = "balanced",
): string {
  const coverage = coverageOf(project.lines);
  const lyricsDigest = buildLyricsDigest(project.lines);
  const duration = Math.round(project.meta.songDuration);
  const i2vRule =
    mode === "ume"
      ? ""
      : `\n- 動画化したいシーンには "i2v": {"motionPrompt": "英語の動き指示", "intensity": "subtle|medium|bold"} を付ける。アニメ調のコツ: カメラと環境（風・光・粒子）を動かし、キャラクターの変形・モーフィングは禁止と書く${
          mode === "take"
            ? "。付けるのはサビ帯に重なるシーンだけでよい（サビ外は無視される）"
            : "。order 0 の全シーンに付けてよい（すべて動かすモード）"
        }`;

  return `あなたはMVの絵コンテ設計者です。親画像（キャラクターと世界観の基準）を必ずReadツールで見てから、この曲のMV全体のシーン（ショットリスト）を一気に設計してください。

# 親画像（必ずReadで見ること）
${parent}

# 曲: ${project.meta.title}（約${duration}秒）
${
    project.meta.direction.trim()
      ? `# 演出方針（ユーザー指定。最優先で尊重すること）
${project.meta.direction.trim()}

`
      : ""
  }${structureBlock(struct)}# 歌詞の流れ（行ごと: 行番号 | lineId [時刻] [配役マーク] 歌詞。lineId は割付先の指定に使う）
${lyricsDigest}

# 絵の配役状況
${coverage.covered}/${coverage.total}行に絵あり。[絵なし]は${coverage.uncoveredIds.length}行。

# 既にある素材（重複する構図は避ける）
${existing.join(", ") || "なし"}

# 表現のさじ加減（最重要。絵を「歌詞の挿絵」にしない）
- ${METAPHOR_DIRECTIVES[metaphor]}
- 各シーンは必ず「①その行の情緒（何を感じさせたいか）→②使う技法→③絵」の順で考える。purpose に①と②を書くこと（例:「悔しさを飲み込む / 技法: 小物に託す」）
- 間接表現の技法の手札（直喩の代わりにここから選ぶ）:
  - 視線: 見ている先を見せる／あえて見せない。目のクローズアップ
  - 小物に託す: 感情を手元の物で語る（握りしめたメガホン、置かれた帽子、汗の粒）
  - 時間をずらす: 行為そのものではなく直前・直後の瞬間を切り取る（飲む→飲み終えて空を仰ぐ）
  - 光と天気: 夕暮れ・逆光・雲の影・陽炎で情緒を写す
  - 背中とシルエット: 表情を見せずに語る
  - 空舞台: 人のいないグラウンド・ベンチ・空だけのカット
  - 質感の抽象: 溶ける氷・結露・土埃・風に揺れるネット等の超クローズアップ

# ルール
- 枚数は品質判断で決める。目安は「曲の長さ÷6〜8秒で1枚」、サビ帯は3〜5秒刻みで密に。全体で最大${MAX_SHOTS_PER_BATCH}枚
- 曲の頭からアウトロまで、[絵なし]の行が絵で埋まるように order 0 を配って絵をつないでいく（絵は次の order 0 まで表示され続ける）
- 各シーンのpromptは英語。親画像と同じキャラクター・画風を保つ前提で書く（"same girl as reference, same art style" 等を含める）
- キャラが登場しない情景・小物カットも2〜4枚混ぜる（曲の呼吸をつくる）
- 構図は多様に: クローズアップ／引き／後ろ姿／小物／空など
- **MVのクリシェ構図を避ける**: 「ジャンプして仲間が囲む」「全員で拳を突き上げる」のようなありきたりな絵は使わない。少しひねった印象的なショットにする
- filenameは日本語の短い場面名（4〜12文字。例: 蛍光灯の下で見上げる）。空白・記号は入れない。行番号は書かない（システムが付ける）
- 各シーンに assign を付ける: lineId=上の一覧のid、order=0で「その行から絵が切り替わる」。同じ lineId に order 0 は1枚だけ
- **サビや見せ場に限り**、同じ行に order 1,2,… で同一シーンの寄り/引き/背中バリエーションを追加してよい（1行の中のカット割りになる）
- どの行にも属さない自由素材は assign を省略してよい${i2vRule}

# 出力形式（このJSONだけを出力。summaryを最初に書き、その設計意図に沿ってscenesを並べること）
{"summary": "MV全体の設計意図を2-3文で", "scenes": [{"filename": "夜の窓辺にたたずむ", "prompt": "...", "purpose": "Aメロ「〜」の場面", "assign": {"lineId": "line-xxx", "order": 0}}]}`;
}

/** シーン設計の実行: プロンプト→claude CLI→検疫＋命名＋上限クランプ */
export async function runScenePlan(
  projectName: string,
  model: string,
  mode: OneshotMode,
  jobId: string,
  metaphor: MetaphorLevel = "balanced",
): Promise<ScenePlanOutput> {
  const parent = findParentImage(projectName);
  if (!parent) {
    throw new Error("親画像がありません。parent.png を置いてから実行してください。");
  }
  const project = await loadProject(projectName);
  const existing = listAssets(projectName).images.map((i) => i.file);
  const struct = loadSongStructure(projectName);

  const prompt = buildScenePlanPrompt(project, parent, existing, struct, mode, metaphor);
  const raw = await callLLM(prompt, model, { jobId, images: [parent] });
  const parsed = extractJson<{ summary?: string; scenes?: PlannedScene[] }>(raw);

  // 検疫＋命名（既存一式生成と同じ規則）→ 上限クランプ（超過分は切り捨てて記録）
  const quarantined = quarantineShots(
    parsed.scenes ?? [],
    project.lines,
    existing,
  ) as PlannedScene[];
  const scenes = quarantined.slice(0, MAX_SHOTS_PER_BATCH);

  return { scenes, summary: parsed.summary ?? "" };
}
