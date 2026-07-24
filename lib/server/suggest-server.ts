import "./server-guard";
import path from "node:path";
import fs from "node:fs";
import {
  loadProject,
  saveProject,
  projectFile,
  projectDir,
  fileHash,
  listAssets,
} from "./projects-server";
import type { EnergySection } from "./beats-analyze-server";
import { deriveSections, deriveTimeline } from "../sections";
import { effectById, effectCatalogForAI } from "../effects-meta";
import { aiSuggestionSchema, type Project } from "../schema";
import { FONT_METAS } from "../fonts-meta";
import { themePaletteIds, type MvTheme } from "../themes";
import { resolveThemeWithUser } from "./themes-server";
import {
  persistJob,
  isCancelRequested,
  dropHandle,
  JobCancelledError,
} from "./jobs-server";
import { callLLM, extractJson } from "./llm";

/**
 * ⑤AI参謀（演出プランナー）:
 * claude CLI（MAXプラン定額）をヘッドレスで呼び、区間単位のカタマリを渡して
 * [エフェクト][トランジション][歌詞アニメ] を提案させる。
 * 出力は aiSuggestion（人間の決定値とは別枠）に保存。尺には触れさせない。
 */

export interface SuggestJob {
  id: string;
  status: "running" | "done" | "error" | "cancelled" | "interrupted";
  log: string;
  error: string | null;
  startedAt: number;
  projectName: string;
}

type G = typeof globalThis & { __mvforgeSuggestJobs?: Map<string, SuggestJob> };
const g = globalThis as G;
export function suggestJobs(): Map<string, SuggestJob> {
  if (!g.__mvforgeSuggestJobs) g.__mvforgeSuggestJobs = new Map();
  return g.__mvforgeSuggestJobs;
}

export interface SuggestOutput {
  sections: {
    headLineId: string;
    effects: { id: string; params?: Record<string, number | string> }[];
    transition: { id: string; params?: Record<string, number | string> } | null;
    reason: string;
    lines: { lineId: string; lyricAnim: { id: string; params?: Record<string, number | string> } }[];
    imageFile?: string | null;
  }[];
  /** ドラフトモード: 「この行から絵を変える」提案（新しい区間を作れる） */
  imageAssignments?: { lineId: string; imageFile: string; reason?: string }[];
  missingAssets: { what: string; prompt: string }[];
  summary: string;
}

// ============================================================================
// 案3「AIレコメンドへの曲構造供給」: beats.json v2（BPM・サビ・エネルギー）を
// AI参謀プロンプトへ実測データとして注入する。歌詞からの雰囲気推測を実測で置換する。
// ============================================================================

/** beats.json v2 のうち演出提案に効く構造フィールド（全て任意＝旧形式でも読める） */
export interface SongStructure {
  bpm?: number;
  downbeats?: number[];
  sections?: EnergySection[];
}

/** シーン（区間）のエネルギー判定結果 */
export interface DominantEnergy {
  level: "low" | "mid" | "high";
  kind?: "chorus" | "break";
}

const round1 = (x: number) => Math.round(x * 10) / 10;

/**
 * beats.json v2 を読み、構造フィールドだけを取り出す（render-server の loadBeats と同じ流儀）。
 * 無い/壊れている/旧形式なら null または欠落フィールドを返す。依存は増やさない（importなし）。
 */
export function loadSongStructure(projectName: string): SongStructure | null {
  try {
    const file = path.join(projectDir(projectName), "beats.json");
    if (!fs.existsSync(file)) return null;
    const data = JSON.parse(fs.readFileSync(file, "utf8"));
    return {
      bpm: typeof data.bpm === "number" ? data.bpm : undefined,
      downbeats: Array.isArray(data.downbeats) ? data.downbeats : undefined,
      sections: Array.isArray(data.sections) ? data.sections : undefined,
    };
  } catch {
    return null;
  }
}

/**
 * シーン区間[sceneStart,sceneEnd]に重なる sections の支配的エネルギーを返す純関数。
 * 基本は重なり秒数が最大の section の level/kind。ただし chorus は少しでも重なれば
 * 最優先する（サビの見せ場を落とさないため。＝「chorusが1秒でも重なればchorus優先」）。
 * どの section とも重ならなければ mid を返す。
 */
export function dominantEnergy(
  sceneStart: number,
  sceneEnd: number,
  sections: EnergySection[],
): DominantEnergy {
  const overlap = (s: EnergySection) =>
    Math.max(0, Math.min(sceneEnd, s.end) - Math.max(sceneStart, s.start));

  let bestChorus: EnergySection | null = null;
  let bestChorusOv = 0;
  let best: EnergySection | null = null;
  let bestOv = 0;
  for (const s of sections) {
    const ov = overlap(s);
    if (ov <= 0) continue;
    if (ov > bestOv) {
      bestOv = ov;
      best = s;
    }
    if (s.kind === "chorus" && ov > bestChorusOv) {
      bestChorusOv = ov;
      bestChorus = s;
    }
  }
  const pick = bestChorus ?? best;
  if (!pick) return { level: "mid" };
  return pick.kind ? { level: pick.level, kind: pick.kind } : { level: pick.level };
}

/** sectionBlocks の energy フィールド用の短いラベル（例: "high(chorus)" / "mid" / "low(break)"） */
export function energyLabel(e: DominantEnergy): string {
  return e.kind ? `${e.level}(${e.kind})` : e.level;
}

/** プロンプト注記用の日本語ラベル（例: "high(サビ)" / "low(ブレイク)" / "mid"） */
function energyLabelJa(e: DominantEnergy): string {
  const kindJa = e.kind === "chorus" ? "サビ" : e.kind === "break" ? "ブレイク" : "";
  return kindJa ? `${e.level}(${kindJa})` : e.level;
}

/**
 * 曲構造（v2）とシーン区間リストから、プロンプト注入用の文字列ブロックを組む純関数。
 * sections（実測の起伏）が無ければ空文字を返す（BPMだけではAIを迷わせるので出さない）。
 * @param struct beats.json v2 の構造（bpm/downbeats/sections）
 * @param scenes deriveSections 由来のシーン区間リスト（start/end）
 */
export function songStructureBlock(
  struct: SongStructure | null,
  scenes: { start: number; end: number }[],
): string {
  const energy = struct?.sections ?? [];
  if (energy.length === 0) return "";

  const body: string[] = [];

  // テンポ（bpmなしなら省略）
  if (struct?.bpm && struct.bpm > 0) {
    const bar = round1((60 / struct.bpm) * 4); // 4拍＝1小節
    body.push(`- テンポ: BPM ${struct.bpm}（1小節≒${bar}秒）`);
  }

  // 実測の曲構造（サビ帯・ブレイク帯の秒範囲）
  const fmtRanges = (ss: EnergySection[]) =>
    ss.map((s) => `${round1(s.start)}〜${round1(s.end)}s`).join(" / ");
  const chorus = energy.filter((s) => s.kind === "chorus");
  const brk = energy.filter((s) => s.kind === "break");
  if (chorus.length) body.push(`- サビ帯: ${fmtRanges(chorus)}`);
  if (brk.length) body.push(`- ブレイク帯: ${fmtRanges(brk)}`);

  // 各シーンのエネルギー注記
  if (scenes.length) {
    const notes = scenes
      .map((sc, i) => {
        const label = energyLabelJa(dominantEnergy(sc.start, sc.end, energy));
        return `  シーン${i + 1} (${round1(sc.start)}〜${round1(sc.end)}s): ${label}`;
      })
      .join("\n");
    body.push(`- 各シーンのエネルギー（実測）:\n${notes}`);
  }

  const rules = [
    "これは音声の実測データ。歌詞からの推測より優先すること",
    "サビ帯＝カット密度高め・強い演出・hero系はここに集中",
    "break帯＝演出を最小限に静かに支える",
    "切替のタイミング提案は不要（区間は固定）だが、演出の強弱はこの構造に沿わせる",
  ]
    .map((r) => `- ${r}`)
    .join("\n");

  return `# 曲の構造（音声の実測データ。歌詞からの推測より最優先で従うこと）
${body.join("\n")}
${rules}
`;
}

/** モード別の追記（standardは統一ルールのみで追記なし） */
function harnessModeBlock(mode: Project["meta"]["suggestMode"]): string {
  if (mode === "simple") {
    return `- 【シンプルモード】overlay は各区間 0〜1個まで（迷ったら付けない）。サビ以外の lyricAnim は静的で控えめな表示に寄せ、transition はクロスフェード系を基本にする
`;
  }
  if (mode === "rich") {
    return `- 【攻めモード】エフェクトは3〜4系統まで広げてよく、overlay も積極的に使う。ただしセクション内の統一と「サビが一番強い」の序列は崩さない
`;
  }
  return "";
}

export function buildPrompt(
  project: Project,
  projectName: string,
  draftMode: boolean,
  theme: MvTheme | null = null,
  favorites: string[] = [],
  struct: SongStructure | null = null,
): { prompt: string; images: string[] } {
  const timeline = deriveTimeline(project);
  const sections = deriveSections(project.lines, timeline.songDuration);
  const energySections = struct?.sections ?? [];

  const sectionBlocks = sections.map((sec) => {
    const head = project.lines[sec.headLineIndex];
    const lines = sec.lineIndexes.map((i) => {
      const l = project.lines[i];
      return { lineId: l.id, text: l.lyricText, start: l.startTime };
    });
    // 動画区間（i2v済み）はReadで見られないので、元静止画（i2vSource）をAIの目に使う
    const sceneStill =
      sec.image && sec.image.startsWith("videos/")
        ? (head.i2vSource ?? null)
        : sec.image;
    return {
      headLineId: head.id,
      start: Math.round(sec.start * 10) / 10,
      end: Math.round(sec.end * 10) / 10,
      imageFile: sec.image,
      imagePath: sceneStill ? projectFile(projectName, sceneStill) : null,
      // 実測の曲構造があれば各シーンのエネルギーを短い文字列で添える（無ければ省略）
      ...(energySections.length
        ? { energy: energyLabel(dominantEnergy(sec.start, sec.end, energySections)) }
        : {}),
      lines,
    };
  });

  const structBlock = songStructureBlock(struct, sections);

  const fontInfo = FONT_METAS.map((f) => `${f.id}: ${f.vibe}`).join(" / ");

  const assets = listAssets(projectName);
  const assetList = assets.images
    .map(
      (img) =>
        `- ${img.file}${img.hasDepth ? "（深度マップあり→parallax可）" : ""} | path: ${projectFile(projectName, img.file)}`,
    )
    .join("\n");

  // AIに見せる画像（codex等の添付型プロバイダ用）。claudeはプロンプト中のパスをReadで読む
  const images = [
    ...sectionBlocks.map((b) => b.imagePath).filter((p): p is string => Boolean(p)),
    ...(draftMode ? assets.images.map((img) => projectFile(projectName, img.file)) : []),
  ].filter((p, i, arr) => arr.indexOf(p) === i);

  const prompt = `あなたはミュージックビデオの演出プランナー（AI参謀）です。1曲アニメMVの各シーンに最適な演出を提案してください。

# 作品情報
- タイトル: ${project.meta.title}
- テロップ: ${project.meta.textStyle.orientation === "vertical" ? "縦書き" : "横書き"} / フォント ${project.meta.textStyle.font}
- フォントの雰囲気参考: ${fontInfo}

# 演出の統一ルール（全体のトーンを守るハーネス。行ごとの最適化より優先）
- 曲全体で使うエフェクトは2〜3系統に絞り、統一感を最優先する
- 同じセクション（Aメロ/サビ等のまとまり）内では同じ系統・同じテンションで揃える
- lyricAnim は曲全体で1〜2種類までに揃える。行ごとにコロコロ変えない
- 拡張テロップ様式（idが xp- で [lyric] カテゴリ）はデザイン完成品。使うなら曲全体で1〜2種に絞り、上の lyricAnim の種類数に含めて数える。縦書き作品には提案しない（フェードに落ちる）
- 動きの強い演出はサビ・見せ場だけに使い、それ以外は静かに支える
${harnessModeBlock(project.meta.suggestMode)}${structBlock}${
  project.meta.direction.trim()
    ? `# 演出方針（ユーザー指定。最優先で尊重すること）
${project.meta.direction.trim()}
`
    : ""
}${
  theme
    ? `# テーマ「${theme.name}」の方針（この大きな流れに従うこと）
${theme.policy}
`
    : ""
}# 使えるエフェクトのカタログ（このidだけを使うこと${theme ? `。テーマ「${theme.name}」の手札に絞ってある` : ""}）
${effectCatalogForAI(theme ? new Set(themePaletteIds(theme)) : undefined, favorites)}

# 素材（持込画像）の一覧
${assetList || "（画像なし）"}

# シーン一覧（区間単位。imagePathがあれば必ずReadツールで画像を見ること）
${JSON.stringify(sectionBlocks, null, 1)}

# ルール
- シーン（区間）の尺・切替タイミングは固定値。変更を提案してはいけない
- 各区間に camera 1個（不要ならなし）＋ overlay 0〜2個 ＋ transition を提案
- 拡張オーバーレイ（idが xp- で [overlay] カテゴリのもの）は描画が重い。同一区間に2枚まで。曲全体で同一系統に揃え、上の「2〜3系統」に含めて数える
- parallax は images/<名前>.depth.png が無いと動かないので、深度マップ未生成の画像には提案しない（cameraはzoom/panで代替）
- 各行に lyricAnim を1個提案（歌詞のない行は不要）
- lyric-mega-write は posX/posY で置き場所まで演出する: 連続行では同じ位置に置かず対角に振る（例: 左上 posX25,posY28 → 右下 posX75,posY72 と交互）。1行を前半/後半で対角に割るなら layout:"split"
- 歌詞の感情と絵の内容の両方を見て決める。理由は日本語で簡潔に
${
  draftMode
    ? `- 【ドラフトモード＝画像の割り当ても任せる】素材一覧の画像を必ず全てReadで見てから、歌詞の流れに合わせて配役する。
  - 既に絵が入っている行（区間の頭で imageFile を持つ行）の画像は絶対に変えない。imageAssignments は絵が未割り当ての行にだけ出す（手作業の配置を上書きしない）
  - 「この行から絵を変える」提案を imageAssignments に出す（lineIdと素材一覧のimageFile）。これが新しい区間になる
  - 目安は曲全体で8〜16区間。同じ絵を複数箇所で使い回してよい。サビや感情の山で絵を切り替えると効果的
  - imageAssignments で区間が変わる前提で、sections の演出提案は「その行から始まる新区間」に対して付けてよい`
    : ""
}
- 足りない素材（こういう絵があればもっと良くなる）があれば missingAssets に、Midjourney(niji7)用の英語プロンプト付きで挙げる

# 出力形式
説明文は書かず、次のJSONだけを出力すること:
{
 "sections": [{"headLineId": "...", "effects": [{"id": "...", "params": {...}}], "transition": {"id": "crossfade", "params": {"duration": 0.8}}, "reason": "...", "lines": [{"lineId": "...", "lyricAnim": {"id": "...", "params": {}}}], "imageFile": null}],
 "imageAssignments": [{"lineId": "...", "imageFile": "images/xx.png", "reason": "..."}],
 "missingAssets": [{"what": "...", "prompt": "..."}],
 "summary": "全体の演出方針を2-3文で"
}
（imageAssignmentsはドラフトモードのみ。通常モードでは空配列でよい）`;

  return { prompt, images };
}

/**
 * AI出力を project の aiSuggestion/aiAdvice（別枠）だけに書き込む。決定値には一切触れない。
 * 待ち時間中の手編集を巻き戻さないため、呼び出し側は「完了時に再ロードした最新の project」を渡すこと。
 * 行は id で照合するので、待ち時間中に削除された行は自然にスキップされる。
 */
/** AIがカタログ外のidを幻覚した場合に落とす（適用側の安全弁） */
const knownEffect = <T extends { id: string }>(
  inst: T | null | undefined,
): T | null => (inst && effectById(inst.id) ? inst : null);

export function applySuggestionOutput(
  project: Project,
  output: SuggestOutput,
  projectName: string,
  now: string,
  theme: MvTheme | null = null,
): void {
  // テーマの手札が最終安全弁：AIがプロンプトを無視して手札外の出方を出しても、
  // テーマ既定の lyricAnim に落として手札内へ収める（theme=null なら clamp しない）。
  const lyricSet = theme
    ? new Set<string>([...theme.palette.lyric, theme.defaults.lyricAnim.id])
    : null;
  const clampLyric = <T extends { id: string }>(inst: T | null): T | null => {
    if (!inst || !lyricSet || lyricSet.has(inst.id)) return inst;
    return { ...inst, id: theme!.defaults.lyricAnim.id, params: {} } as T;
  };
  for (const secOut of output.sections ?? []) {
    const headIdx = project.lines.findIndex((l) => l.id === secOut.headLineId);
    if (headIdx === -1) continue;
    const head = project.lines[headIdx];
    const imageForHash = head.image ?? secOut.imageFile ?? null;
    head.aiSuggestion = aiSuggestionSchema.parse({
      effects: (secOut.effects ?? []).filter((e) => knownEffect(e) !== null),
      transition: knownEffect(secOut.transition),
      lyricAnim: clampLyric(
        knownEffect(secOut.lines?.find((l) => l.lineId === head.id)?.lyricAnim),
      ),
      imageFile: secOut.imageFile ?? null,
      reason: secOut.reason ?? "",
      forImage: imageForHash
        ? { file: imageForHash, hash: fileHash(projectName, imageForHash) ?? "" }
        : null,
      createdAt: now,
    });
    for (const lineOut of secOut.lines ?? []) {
      if (lineOut.lineId === head.id) continue;
      const idx = project.lines.findIndex((l) => l.id === lineOut.lineId);
      if (idx === -1) continue;
      project.lines[idx].aiSuggestion = aiSuggestionSchema.parse({
        lyricAnim: clampLyric(knownEffect(lineOut.lyricAnim)),
        reason: "",
        createdAt: now,
      });
    }
  }
  // ドラフトモード: 「この行から絵を変える」提案（新しい区間を作る）をマージ
  for (const assign of output.imageAssignments ?? []) {
    const idx = project.lines.findIndex((l) => l.id === assign.lineId);
    if (idx === -1 || !assign.imageFile) continue;
    // 手作業の配置は上書きしない（プロンプト無視への強制ガード）:
    // 既に絵が入っている行への配役提案はコード側で握りつぶす。
    if (project.lines[idx].image) continue;
    const existing = project.lines[idx].aiSuggestion;
    project.lines[idx].aiSuggestion = aiSuggestionSchema.parse({
      ...(existing ?? {}),
      imageFile: assign.imageFile,
      reason:
        [existing?.reason, assign.reason].filter(Boolean).join(" / ") || "",
      forImage: {
        file: assign.imageFile,
        hash: fileHash(projectName, assign.imageFile) ?? "",
      },
      createdAt: now,
    });
  }
  project.aiAdvice = {
    summary: output.summary ?? "",
    missingAssets: output.missingAssets ?? [],
    createdAt: now,
  };
}

export function startSuggest(
  projectName: string,
  draftMode: boolean,
  model = "",
  themeId = "",
  favorites: string[] = [],
): SuggestJob {
  const id = `suggest-${Date.now().toString(36)}`;
  const job: SuggestJob = {
    id,
    status: "running",
    log: "",
    error: null,
    startedAt: Date.now(),
    projectName,
  };
  suggestJobs().set(id, job);
  const persist = () => persistJob(projectName, "suggest", id, job, {
    request: { draftMode, model, themeId },
  });
  persist();

  (async () => {
    try {
      const project = await loadProject(projectName);
      const theme = resolveThemeWithUser(themeId);
      const struct = loadSongStructure(projectName);
      const { prompt, images } = buildPrompt(project, projectName, draftMode, theme, favorites, struct);
      const raw = await callLLM(prompt, model, {
        jobId: job.id,
        images,
        onStderr: (log) => {
          job.log = log;
        },
      });
      const output = extractJson<SuggestOutput>(raw);
      const now = new Date().toISOString();

      // 実行中（最大10分）の手編集を巻き戻さないよう、保存直前に再ロードして
      // aiSuggestion/aiAdvice だけをマージ保存する（開始時スナップショットは捨てる）
      const fresh = await loadProject(projectName);
      applySuggestionOutput(fresh, output, projectName, now, theme);
      saveProject(projectName, fresh);
      job.status = "done";
    } catch (e) {
      if (e instanceof JobCancelledError || isCancelRequested(id)) {
        job.status = "cancelled";
      } else {
        job.status = "error";
        job.error = e instanceof Error ? e.message : String(e);
      }
    } finally {
      persist();
      dropHandle(id);
    }
  })();

  return job;
}
