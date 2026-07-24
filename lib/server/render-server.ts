import "./server-guard";
import path from "node:path";
import fs from "node:fs";
import { loadProject, projectDir } from "./projects-server";
import { persistJob, jobHandle, isCancelRequested, dropHandle } from "./jobs-server";
import { renderPreset, type RenderPresetId } from "../render-presets";
import { applyShortToProject } from "../shorts";

/**
 * mp4書き出し（§8）。
 * - プレビューと同じ remotion/ のコンポジションをそのまま焼く（同一性の保証）
 * - frameRange 指定で「区間だけ書き出し」、scale 0.5 で「ドラフト画質」
 * - webpackバンドルはソースのmtimeをキーにキャッシュ（編集が反映されない罠を防ぐ）
 * - ジョブは簡易FIFO（同時1件）。連打してもヘッドレスChromeが並走しない
 */

export interface RenderJob {
  id: string;
  status:
    | "queued"
    | "bundling"
    | "rendering"
    | "done"
    | "error"
    | "cancelled"
    | "interrupted";
  progress: number; // 0..1
  outFile: string | null;
  error: string | null;
  startedAt: number;
  /** レンダリング開始時刻（残り時間の推定用。queued/bundling中はnull） */
  renderStartedAt: number | null;
  projectName: string;
}

type JobsGlobal = typeof globalThis & {
  __mvforgeJobs?: Map<string, RenderJob>;
  __mvforgeBundle?: { key: string; promise: Promise<string> };
  __mvforgeRenderQueue?: Promise<void>;
};

const g = globalThis as JobsGlobal;

export function jobs(): Map<string, RenderJob> {
  if (!g.__mvforgeJobs) g.__mvforgeJobs = new Map();
  return g.__mvforgeJobs;
}

/** remotion/ と lib/ の最新mtime。変わっていたらバンドルを作り直す */
function sourcesKey(): string {
  let latest = 0;
  for (const dir of ["remotion", "lib"]) {
    const walk = (d: string) => {
      for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, entry.name);
        if (entry.isDirectory()) walk(p);
        else latest = Math.max(latest, fs.statSync(p).mtimeMs);
      }
    };
    const abs = path.join(process.cwd(), dir);
    if (fs.existsSync(abs)) walk(abs);
  }
  return String(latest);
}

export async function getBundle(): Promise<string> {
  const key = sourcesKey();
  if (!g.__mvforgeBundle || g.__mvforgeBundle.key !== key) {
    const promise = (async () => {
      const { bundle } = await import("@remotion/bundler");
      return bundle({
        entryPoint: path.join(process.cwd(), "remotion", "index.ts"),
        webpackOverride: (config) => ({
          ...config,
          resolve: {
            ...config.resolve,
            alias: {
              ...(config.resolve?.alias as Record<string, string> | undefined),
              "@": process.cwd(),
            },
          },
        }),
      });
    })();
    g.__mvforgeBundle = { key, promise };
    promise.catch(() => {
      g.__mvforgeBundle = undefined; // 失敗したら次回作り直す
    });
  }
  return g.__mvforgeBundle.promise;
}

/**
 * 検出済みビート＋小節頭（beats.json）。ビート同期エフェクト／小節同期カメラ
 * （プッシュイン）を書き出しにもプレビューと同じく効かせる。
 */
function loadBeatsData(projectName: string): {
  beats: number[];
  downbeats: number[];
} {
  try {
    const file = path.join(projectDir(projectName), "beats.json");
    if (!fs.existsSync(file)) return { beats: [], downbeats: [] };
    const data = JSON.parse(fs.readFileSync(file, "utf8"));
    return {
      beats: Array.isArray(data.beats) ? data.beats : [],
      downbeats: Array.isArray(data.downbeats) ? data.downbeats : [],
    };
  } catch {
    return { beats: [], downbeats: [] };
  }
}

export interface RenderRequest {
  projectName: string;
  assetBase: string; // 例 http://localhost:3000（レンダラーが素材を読むURL）
  frameRange?: [number, number] | null; // 区間だけ書き出し
  draft?: boolean; // 解像度半分の試し刷り
  label?: string;
  preset?: RenderPresetId; // 書き出しプリセット（省略時 youtube＝従来どおり）
  // ショート書き出し: project.shorts[] のid。指定時は applyShortToProject で
  // 縦合成（解像度/文字/フレーミング/texts）＋frameRange を導出（frameRange指定より優先）
  shortId?: string | null;
}

/** レンダは直列実行（簡易FIFO）。5分超×複数並走でのリソース逼迫を防ぐ */
function enqueue(run: () => Promise<void>): void {
  const prev = g.__mvforgeRenderQueue ?? Promise.resolve();
  g.__mvforgeRenderQueue = prev.then(run, run);
}

export function startRender(reqParams: RenderRequest): RenderJob {
  const id = `render-${Date.now().toString(36)}`;
  const job: RenderJob = {
    id,
    status: "queued",
    progress: 0,
    outFile: null,
    error: null,
    startedAt: Date.now(),
    renderStartedAt: null,
    projectName: reqParams.projectName,
  };
  jobs().set(id, job);
  const persist = (opts?: { throttleMs?: number }) =>
    persistJob(reqParams.projectName, "render", id, job, opts);
  persist();
  jobHandle(id); // FIFO待ちの間もキャンセルフラグを立てられるように先に確保

  enqueue(async () => {
    try {
      // FIFOで順番待ちしている間にキャンセルされたら、バンドルに入らず終端
      if (isCancelRequested(id)) {
        job.status = "cancelled";
        persist();
        dropHandle(id);
        return;
      }
      job.status = "bundling";
      persist();
      const { renderMedia, selectComposition, ensureBrowser, makeCancelSignal } =
        await import("@remotion/renderer");
      await ensureBrowser();
      const serveUrl = await getBundle();
      const project = await loadProject(reqParams.projectName);
      // プリセット適用: meta を書き換えた project を inputProps に載せるだけで
      // calculateMetadata（remotion/Root.tsx）が解像度に追従する
      const preset = renderPreset(reqParams.preset);
      let frameRange = reqParams.frameRange ?? null;
      if (reqParams.shortId) {
        // ショート書き出し: 縦合成（解像度/文字/フレーミング/texts）と範囲を
        // applyShortToProject に一任＝縦プレビュー（PlayerPanel）と完全に同じ経路
        const short = project.shorts.find((s) => s.id === reqParams.shortId);
        const composed = short ? applyShortToProject(project, short, preset.id) : null;
        if (!composed) {
          throw new Error(
            "ショートが見つからないか、範囲の歌詞行が消えています（ショートタブで範囲を選び直してください）",
          );
        }
        Object.assign(project, composed.project);
        frameRange = composed.frameRange;
      } else {
        if (preset.width && preset.height) {
          project.meta.width = preset.width;
          project.meta.height = preset.height;
        }
        if (preset.textScale !== 1) {
          project.meta.textStyle.size = Math.round(
            project.meta.textStyle.size * preset.textScale,
          );
          // 行ごとのサイズ上書きにも同じ底上げを掛ける（全体値と挙動を揃える）
          for (const line of project.lines) {
            if (line.textStyle?.size != null) {
              line.textStyle.size = Math.round(
                line.textStyle.size * preset.textScale,
              );
            }
          }
        }
      }
      const beatsData = loadBeatsData(reqParams.projectName);
      const inputProps = {
        project,
        projectName: reqParams.projectName,
        assetBase: reqParams.assetBase,
        beats: beatsData.beats,
        downbeats: beatsData.downbeats,
      };
      const composition = await selectComposition({
        serveUrl,
        id: "MV",
        inputProps,
      });

      const exportsDir = path.join(projectDir(reqParams.projectName), "exports");
      fs.mkdirSync(exportsDir, { recursive: true });
      const stamp = new Date()
        .toISOString()
        .slice(0, 19)
        .replaceAll(":", "-");
      const suffix = [
        reqParams.label ?? (reqParams.frameRange ? "section" : "full"),
        preset.suffix || null,
        reqParams.draft ? "draft" : null,
      ]
        .filter(Boolean)
        .join("_");
      const outFile = path.join(exportsDir, `${stamp}_${suffix}.mp4`);

      job.status = "rendering";
      job.renderStartedAt = Date.now();
      persist();
      const { cancelSignal, cancel } = makeCancelSignal();
      jobHandle(id).onCancel = () => cancel();
      await renderMedia({
        composition,
        serveUrl,
        codec: "h264",
        crf: preset.crf,
        outputLocation: outFile,
        inputProps,
        frameRange,
        scale: reqParams.draft ? 0.5 : 1,
        cancelSignal,
        onProgress: ({ progress }) => {
          job.progress = progress;
          persist({ throttleMs: 1000 });
        },
      });
      job.status = "done";
      job.progress = 1;
      job.outFile = outFile;
      persist();
    } catch (e) {
      if (isCancelRequested(id)) {
        job.status = "cancelled";
        job.error = null;
      } else {
        job.status = "error";
        job.error = e instanceof Error ? (e.stack ?? e.message) : String(e);
      }
      persist();
    } finally {
      dropHandle(id);
    }
  });

  return job;
}

/**
 * 現在フレームの静止画書き出し（YouTubeサムネ等）。
 * プレビューと同じ設計図をそのまま焼くので、テロップ・エフェクト込みで出る。
 */
export async function renderThumbnail(params: {
  projectName: string;
  assetBase: string;
  frame: number;
}): Promise<string> {
  const { renderStill, selectComposition, ensureBrowser } = await import(
    "@remotion/renderer"
  );
  await ensureBrowser();
  const serveUrl = await getBundle();
  const project = await loadProject(params.projectName);
  const beatsData = loadBeatsData(params.projectName);
  const inputProps = {
    project,
    projectName: params.projectName,
    assetBase: params.assetBase,
    beats: beatsData.beats,
    downbeats: beatsData.downbeats,
  };
  const composition = await selectComposition({ serveUrl, id: "MV", inputProps });
  const exportsDir = path.join(projectDir(params.projectName), "exports");
  fs.mkdirSync(exportsDir, { recursive: true });
  const stamp = new Date().toISOString().slice(0, 19).replaceAll(":", "-");
  const outFile = path.join(exportsDir, `${stamp}_thumb.png`);
  await renderStill({
    composition,
    serveUrl,
    output: outFile,
    inputProps,
    frame: Math.max(0, Math.min(params.frame, composition.durationInFrames - 1)),
  });
  return outFile;
}
