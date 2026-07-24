/**
 * 口頭修正コンソール（赤入れ）の純関数層。
 * 自由文の修正指示 → AIが patches JSON を返す → sanitize（幻覚除去）→ 人間が選ぶ →
 * applyPatchesToLines（クライアントの store.mutate 内で適用＝1回の⌘Zで戻せる）。
 * fs / spawn 禁止（テスト対象。LLM呼び出しは lib/repair-server.ts）。
 */
import type { Line, Project } from "./schema";

export interface EffectRef {
  id: string;
  params?: Record<string, number | string>;
}

export type RepairPatch =
  | { kind: "image"; lineNo: number; image: string; summary: string; reason?: string }
  | { kind: "lyricAnim"; lineNo: number; effect: EffectRef; summary: string; reason?: string }
  | {
      kind: "effects";
      lineNo: number;
      mode: "replace" | "add";
      effects: EffectRef[];
      summary: string;
      reason?: string;
    }
  | { kind: "transition"; lineNo: number; transition: EffectRef | null; summary: string; reason?: string }
  /** 既存素材では叶わない指示。表示だけして適用はしない（課金の関所） */
  | { kind: "needs-generation"; lineNo?: number; summary: string; prompt?: string; reason?: string }
  /** 動画化(i2v)の指示。表示だけして適用はしない（課金の関所）。sourceImage は検疫時に解決済み */
  | {
      kind: "needs-i2v";
      lineNo: number;
      motionPrompt: string;
      model: "kling" | "seedance";
      duration: 5 | 10;
      sourceImage: string;
      summary: string;
      reason?: string;
    };

export interface RepairContext {
  lineCount: number;
  images: Set<string>;
  effectIds: Set<string>;
  lyricAnimIds: Set<string>;
  transitionIds: Set<string>;
  /** 各行の「動画化の元になる静止画」（1始まり行番号-1で引く）。無い呼び出し元では needs-i2v が全落ちする */
  lineImages?: (string | null)[];
}

/**
 * 各行の「動画化の元になる静止画」を解決する。
 * 自行に絵があればそれ。動画行は生成元の i2vSource（無ければその区間は元絵不明=null）。
 * image=null の行は直前の区間から継承。
 */
export function effectiveLineImages(lines: Line[]): (string | null)[] {
  const isVideo = (f: string) => /\.(mp4|mov|webm)$/i.test(f);
  let current: string | null = null;
  return lines.map((l) => {
    if (l.image) current = isVideo(l.image) ? (l.i2vSource ?? null) : l.image;
    return current;
  });
}

/** i2vの鉄板既定: キャラ控えめ・カメラと環境が動きを担う（顔・作画の崩れ防止） */
const DEFAULT_MOTION_PROMPT =
  "subtle character motion, gentle camera drift, ambient environment movement (light, clouds, hair, fabric), keep the character's face stable";

const isRef = (v: unknown): v is EffectRef =>
  !!v && typeof v === "object" && typeof (v as EffectRef).id === "string";

/**
 * AI出力の検疫。存在しない行番号・素材・エフェクトidは適用前に落とし、理由を残す。
 * needs-generation は表示用なので素通し（lineNo不正だけ丸める）。
 */
export function sanitizePatches(
  raw: unknown,
  ctx: RepairContext,
): { patches: RepairPatch[]; dropped: { summary: string; reason: string }[] } {
  const patches: RepairPatch[] = [];
  const dropped: { summary: string; reason: string }[] = [];
  const list = (raw as { patches?: unknown[] })?.patches;
  if (!Array.isArray(list)) return { patches, dropped };

  for (const item of list) {
    const p = item as Record<string, unknown>;
    const summary = typeof p.summary === "string" ? p.summary : "(要約なし)";
    const reason = typeof p.reason === "string" ? p.reason : undefined;
    const lineNo = typeof p.lineNo === "number" ? Math.floor(p.lineNo) : NaN;
    const drop = (why: string) => dropped.push({ summary, reason: why });
    const lineOk = lineNo >= 1 && lineNo <= ctx.lineCount;

    switch (p.kind) {
      case "needs-generation":
        patches.push({
          kind: "needs-generation",
          lineNo: lineOk ? lineNo : undefined,
          summary,
          prompt: typeof p.prompt === "string" ? p.prompt : undefined,
          reason,
        });
        break;
      case "needs-i2v": {
        if (!lineOk) { drop(`行番号${p.lineNo}が範囲外（1〜${ctx.lineCount}）`); break; }
        const src = ctx.lineImages?.[lineNo - 1] ?? null;
        if (!src) { drop(`${lineNo}行目に動画化の元になる絵がない`); break; }
        const motion =
          typeof p.motionPrompt === "string" && p.motionPrompt.trim()
            ? p.motionPrompt.trim()
            : DEFAULT_MOTION_PROMPT;
        patches.push({
          kind: "needs-i2v",
          lineNo,
          motionPrompt: motion,
          model: p.model === "seedance" ? "seedance" : "kling",
          duration: p.duration === 10 ? 10 : 5,
          sourceImage: src,
          summary,
          reason,
        });
        break;
      }
      case "image": {
        if (!lineOk) { drop(`行番号${p.lineNo}が範囲外（1〜${ctx.lineCount}）`); break; }
        if (typeof p.image !== "string" || !ctx.images.has(p.image)) {
          drop(`素材 ${String(p.image)} が存在しない`); break;
        }
        patches.push({ kind: "image", lineNo, image: p.image, summary, reason });
        break;
      }
      case "lyricAnim": {
        if (!lineOk) { drop(`行番号${p.lineNo}が範囲外`); break; }
        if (!isRef(p.effect) || !ctx.lyricAnimIds.has(p.effect.id)) {
          drop(`歌詞アニメ ${isRef(p.effect) ? p.effect.id : "?"} が存在しない`); break;
        }
        patches.push({ kind: "lyricAnim", lineNo, effect: p.effect, summary, reason });
        break;
      }
      case "effects": {
        if (!lineOk) { drop(`行番号${p.lineNo}が範囲外`); break; }
        const list = Array.isArray(p.effects) ? p.effects.filter(isRef) : [];
        const bad = list.find((e) => !ctx.effectIds.has(e.id));
        if (list.length === 0 || bad) {
          drop(`エフェクト ${bad ? bad.id : "(空)"} が存在しない`); break;
        }
        patches.push({
          kind: "effects",
          lineNo,
          mode: p.mode === "add" ? "add" : "replace",
          effects: list,
          summary,
          reason,
        });
        break;
      }
      case "transition": {
        if (!lineOk) { drop(`行番号${p.lineNo}が範囲外`); break; }
        const t = p.transition === null ? null : isRef(p.transition) ? p.transition : undefined;
        if (t !== null && (!t || !ctx.transitionIds.has(t.id))) {
          drop(`つなぎ ${t ? t.id : "?"} が存在しない`); break;
        }
        patches.push({ kind: "transition", lineNo, transition: t, summary, reason });
        break;
      }
      default:
        drop(`未知の修正タイプ ${String(p.kind)}`);
    }
  }
  return { patches, dropped };
}

/**
 * 選ばれたパッチを lines に適用（非破壊）。
 * 不変条件: 行の image を差し替えたら cuts[0].image も同期（cuts[0].at=0=行の絵）。
 */
export function applyPatchesToLines(
  lines: Line[],
  patches: RepairPatch[],
): { lines: Line[]; applied: number; skipped: { summary: string; reason: string }[] } {
  const next = lines.map((l) => ({
    ...l,
    effects: [...l.effects],
    cuts: l.cuts.map((c) => ({ ...c })),
  }));
  let applied = 0;
  const skipped: { summary: string; reason: string }[] = [];

  for (const p of patches) {
    if (p.kind === "needs-generation" || p.kind === "needs-i2v") {
      skipped.push({
        summary: p.summary,
        reason:
          p.kind === "needs-i2v"
            ? "動画生成が必要（コンソールの動画化ボタンで実行）"
            : "新規生成が必要（このコンソールでは生成しない）",
      });
      continue;
    }
    const line = next[p.lineNo - 1];
    if (!line) {
      skipped.push({ summary: p.summary, reason: `行番号${p.lineNo}が見つからない` });
      continue;
    }
    // effectInstanceSchema は params 必須（default {}）なので補完してから入れる
    const inst = (e: EffectRef) => ({ id: e.id, params: e.params ?? {} });
    if (p.kind === "image") {
      line.image = p.image;
      if (line.cuts.length > 0) line.cuts[0] = { ...line.cuts[0], image: p.image };
    } else if (p.kind === "lyricAnim") {
      line.lyricAnim = inst(p.effect);
    } else if (p.kind === "effects") {
      const added = p.effects.map(inst);
      line.effects = p.mode === "replace" ? added : [...line.effects, ...added];
    } else if (p.kind === "transition") {
      line.transition = p.transition ? inst(p.transition) : null;
    }
    applied += 1;
  }
  return { lines: next, applied, skipped };
}

/** AIへ渡す修正依頼プロンプト（fs非依存。素材とカタログは呼び出し側が用意） */
export function buildRepairPrompt(
  project: Project,
  instruction: string,
  assetFiles: string[],
  effectCatalog: string,
  /** 一括生成時の各行の元プロンプト（oneshot.json由来。世界観・スタイル語彙の正本） */
  scenePromptByLineNo: Record<number, string> | null = null,
): string {
  const timeline = project.lines
    .map((l, i) => {
      const t = Math.round(Math.max(0, l.startTime + l.offset));
      const fx = l.effects.map((e) => e.id).join("+") || "-";
      return `- ${i + 1} | [${t}s] ${l.lyricText || "（間奏）"} | 絵:${l.image ?? "なし"} | 演出:${fx} | 歌詞アニメ:${l.lyricAnim?.id ?? "-"} | つなぎ:${l.transition?.id ?? "-"}`;
    })
    .join("\n");

  return `あなたはMV編集の赤入れアシスタントです。ユーザーの修正指示を読み、下のタイムラインへの修正パッチを設計してください。

# 修正指示（ユーザーの言葉。最優先で尊重）
${instruction}

# 曲: ${project.meta.title}
${project.meta.direction.trim() ? `# 演出方針\n${project.meta.direction.trim()}\n` : ""}
# タイムライン（行番号 | 時刻 | 歌詞 | 絵 | 演出 | 歌詞アニメ | つなぎ）
${timeline}

# 使える素材（imageパッチはこの一覧のパスだけを使う）
${assetFiles.join("\n") || "（なし）"}
${
    scenePromptByLineNo && Object.keys(scenePromptByLineNo).length
      ? `
# 各行の元の生成プロンプト（一括生成時の設計。背景・世界観・スタイル語彙の正本）
${Object.entries(scenePromptByLineNo)
    .map(([no, p]) => `- ${no}: ${p}`)
    .join("\n")}
`
      : ""
  }

# 使えるエフェクト（idはこのカタログだけを使う）
${effectCatalog}

# ルール
- lineNo は上のタイムラインの行番号（1始まり）
- 絵の差し替えは既存素材から選ぶ。指示に合う素材が無ければ kind:"needs-generation" にして生成用の英語promptを添える（生成はしない）
- needs-generation の prompt には必ず "same girl and EXACTLY the same art style as the reference image: same line quality, same shading technique, same flat color palette. Do not upgrade or modernize the art style" を含める（親画像参照で生成されるため。抽象カットでも画風・タッチは親に合わせる。⚠️"anime illustration"のような一般語は汎用アニメ塗りに引っ張られるので書かない）
- needs-generation を書く行に「元の生成プロンプト」がある場合:
  - **部分修正**の指示（寄り引き・表情・ポーズ等）→ 元プロンプトを下敷きに、指示された部分だけ書き換える（背景・色・世界観の記述は残す＝隣のカットと世界がつながる）
  - **新規イメージ**への変更指示 → 場面の記述は自由に書き直してよい。ただし元プロンプトの背景・世界観・スタイル語彙（空・雲・色・画風。例: teal sky with pixelated clouds, flat colors）は必ず引き継ぐ
- 「動画化して」「実際に動かして」など動画生成(i2v)の要求は kind:"needs-i2v"。motionPrompt は英語で、既定は「キャラの動きは控えめ・カメラと環境（光/雲/髪/布）が動きを担う」。ユーザーが動きの強さや内容を指定したらそれを最優先で motionPrompt に反映する
- needs-i2v の model は指示が無ければ省略（既定Kling=高品質）。「安い方/速い方/Seedanceで」なら "seedance"。duration は既定5秒、「10秒」と言われたら 10
- 絵に疑似的な動き（ズーム・揺れ等）を足すだけで足りるなら kind:"effects" のカメラ演出。本当に絵の中身が動く必要がある時だけ needs-i2v を使う
- 指示に無いことは変えない（最小の赤入れ）。1つの指示に複数行が該当するなら行ごとにパッチを分ける
- summary は日本語1文で「何行目をどうするか」

# 出力形式（このJSONだけを出力）
{"patches": [
  {"kind": "image", "lineNo": 14, "image": "images/xxx.png", "summary": "...", "reason": "..."},
  {"kind": "lyricAnim", "lineNo": 5, "effect": {"id": "lyric-glow", "params": {}}, "summary": "..."},
  {"kind": "effects", "lineNo": 5, "mode": "replace", "effects": [{"id": "film-grain"}], "summary": "..."},
  {"kind": "transition", "lineNo": 9, "transition": {"id": "crossfade"}, "summary": "..."},
  {"kind": "needs-generation", "lineNo": 20, "summary": "...", "prompt": "english image prompt"},
  {"kind": "needs-i2v", "lineNo": 8, "motionPrompt": "english motion prompt", "summary": "..."}
]}`;
}
