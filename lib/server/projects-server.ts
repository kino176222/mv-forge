import "./server-guard";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";
import { migrateProject, type Project } from "../schema";

const execFileAsync = promisify(execFile);

/** MVプロジェクト（1曲=1フォルダ）の置き場所 */
export function projectsRoot(): string {
  return (
    process.env.MVFORGE_PROJECTS_ROOT ?? path.join(process.cwd(), "projects")
  );
}

/** プロジェクト名 → フォルダ絶対パス（パストラバーサル対策込み） */
export function projectDir(name: string): string {
  if (!name || name.includes("..") || name.includes("/") || name.includes("\\")) {
    throw new Error(`invalid project name: ${name}`);
  }
  return path.join(projectsRoot(), name);
}

/** プロジェクト内ファイルの絶対パス: フォルダ外への脱出を防ぐ */
export function projectFile(name: string, file: string): string {
  const dir = projectDir(name);
  const abs = path.resolve(dir, file);
  if (!abs.startsWith(dir + path.sep)) {
    throw new Error(`invalid file path: ${file}`);
  }
  return abs;
}

export function listProjects(): { name: string; title: string; broken?: boolean }[] {
  const root = projectsRoot();
  if (!fs.existsSync(root)) return [];
  return fs
    .readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => {
      const jsonPath = path.join(root, d.name, "project.json");
      if (!fs.existsSync(jsonPath)) return null; // project.json自体が無い＝対象外フォルダ
      try {
        const title =
          JSON.parse(fs.readFileSync(jsonPath, "utf8")).meta?.title ?? d.name;
        return { name: d.name, title };
      } catch {
        // 破損は黙って消さず可視化する（.bakからの復元手順に気づけるように）
        return { name: d.name, title: `${d.name}（project.json破損）`, broken: true };
      }
    })
    .filter((p): p is { name: string; title: string; broken?: boolean } => p !== null);
}

export async function loadProject(name: string): Promise<Project> {
  const jsonPath = path.join(projectDir(name), "project.json");
  const raw = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
  const project = migrateProject(raw);

  // 曲・朗読の長さが未計測なら ffprobe で自動計測して埋める（手入力を仕様から消す）
  let changed = false;
  if (project.meta.songDuration <= 0 && project.meta.songFile) {
    const dur = await probeDuration(name, project.meta.songFile);
    if (dur > 0) {
      project.meta.songDuration = dur;
      changed = true;
    }
  }
  if (
    project.prologue.enabled &&
    project.prologue.audioFile &&
    project.prologue.duration <= 0
  ) {
    const dur = await probeDuration(name, project.prologue.audioFile);
    if (dur > 0) {
      project.prologue.duration = dur;
      changed = true;
    }
  }
  if (changed) saveProject(name, project);
  return project;
}

/**
 * キー順を固定したpretty printで保存（git差分が読めるように）。
 * 全編集資産が1ファイルに集約されるため、
 * 一時ファイル→rename のアトミック書き込み＋ .bak 1世代で破損に備える。
 */
export function saveProject(name: string, project: Project): void {
  const jsonPath = path.join(projectDir(name), "project.json");
  const tmpPath = `${jsonPath}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(project, null, 2) + "\n", "utf8");
  if (fs.existsSync(jsonPath)) {
    fs.copyFileSync(jsonPath, `${jsonPath}.bak`);
  }
  fs.renameSync(tmpPath, jsonPath);
}

/**
 * 既存プロジェクトを雛形に、様式（フォント・色・エンドカード・声設定等）だけを
 * 引き継いだ新規プロジェクトを作る。lines・素材参照は空にする。
 * 8曲アルバムのようなシリーズ制作で、世界観設定の再入力を消すための機能。
 */
export async function projectFromTemplate(
  templateName: string,
  newTitle: string,
): Promise<Project> {
  const tpl = await loadProject(templateName);
  const { emptyProject } = await import("../schema");
  const fresh = emptyProject(newTitle);
  fresh.meta = {
    ...fresh.meta,
    title: newTitle,
    fps: tpl.meta.fps,
    width: tpl.meta.width,
    height: tpl.meta.height,
    textStyle: structuredClone(tpl.meta.textStyle),
  };
  fresh.outro = {
    ...structuredClone(tpl.outro),
    image: null, // 素材はプロジェクト固有なので引き継がない
    endCard: {
      ...structuredClone(tpl.outro.endCard),
      songTitle: "", // 曲名は新曲で入れ直す（アーティスト名・Created byは残す）
    },
  };
  fresh.prologue = {
    ...structuredClone(tpl.prologue),
    enabled: false,
    audioFile: null,
    duration: 0,
    image: null,
    subtitle: { enabled: false, stanzas: [], anim: tpl.prologue.subtitle.anim },
    gen: { ...structuredClone(tpl.prologue.gen), script: "", adoptedTake: "" },
  };
  return fresh;
}

export async function probeDuration(
  name: string,
  file: string,
): Promise<number> {
  try {
    const abs = projectFile(name, file);
    if (!fs.existsSync(abs)) return 0;
    const { stdout } = await execFileAsync("ffprobe", [
      "-v",
      "quiet",
      "-show_entries",
      "format=duration",
      "-of",
      "csv=p=0",
      abs,
    ]);
    return Number(stdout.trim()) || 0;
  } catch {
    return 0;
  }
}

/** 画像の「指紋」。⚠️スタンプ（同名で中身差し替え）の検知に使う */
export function fileHash(name: string, file: string): string | null {
  try {
    const abs = projectFile(name, file);
    const buf = fs.readFileSync(abs);
    return crypto.createHash("md5").update(buf).digest("hex").slice(0, 16);
  } catch {
    return null;
  }
}

/** 親画像（キャラ・世界観の基準）: プロジェクト直下の parent.png/jpg を自動検出 */
export function findParentImage(name: string): string | null {
  for (const f of ["parent.png", "parent.jpg", "parent.jpeg", "parent.webp"]) {
    const abs = path.join(projectDir(name), f);
    if (fs.existsSync(abs)) return abs;
  }
  return null;
}

const IMAGE_EXT = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif"]);
const AUDIO_EXT = new Set([".mp3", ".wav", ".m4a", ".aac", ".ogg", ".flac"]);
const VIDEO_EXT = new Set([".mp4", ".webm", ".mov"]);

export interface VideoAsset {
  file: string;
  /** 尺（秒）。取れなければ0 */
  durationSec: number;
  /** 🔗 延長生成の系譜: この動画の親（videos/xxx.mp4）。無ければnull */
  parent: string | null;
}

export interface AssetList {
  images: { file: string; hash: string; hasDepth: boolean; hasSubject: boolean }[];
  videos: VideoAsset[];
  audios: string[];
  lrcs: string[];
}

/** 延長生成の系譜記録（videos/lineage.json）。concat時に追記される */
export function readLineage(
  name: string,
): { ext: string; parent: string; segment: string }[] {
  try {
    const p = path.join(projectDir(name), "videos", "lineage.json");
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return [];
  }
}

export function appendLineage(
  name: string,
  rec: { ext: string; parent: string; segment: string },
): void {
  const p = path.join(projectDir(name), "videos", "lineage.json");
  const cur = readLineage(name);
  cur.push({ ...rec });
  fs.writeFileSync(p, JSON.stringify(cur, null, 1));
}

/** 同期版の尺取得（listAssets用。動画は数本なのでコストは軽い） */
function probeDurationSync(abs: string): number {
  try {
    const out = execFileSync(
      "ffprobe",
      ["-v", "quiet", "-show_entries", "format=duration", "-of", "csv=p=0", abs],
      { timeout: 10_000 },
    );
    return Number(String(out).trim()) || 0;
  } catch {
    return 0;
  }
}

export function listAssets(name: string): AssetList {
  const dir = projectDir(name);
  const images: AssetList["images"] = [];
  const videoFiles: string[] = [];
  const audios: string[] = [];
  const lrcs: string[] = [];

  const scan = (rel: string) => {
    const abs = path.join(dir, rel);
    if (!fs.existsSync(abs)) return;
    for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
      const relPath = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (["images", "assets", "videos"].includes(entry.name)) scan(relPath);
        continue;
      }
      const ext = path.extname(entry.name).toLowerCase();
      if (
        IMAGE_EXT.has(ext) &&
        !entry.name.endsWith(".depth.png") &&
        !entry.name.endsWith(".subject.png")
      ) {
        images.push({
          file: relPath,
          hash: fileHash(name, relPath) ?? "",
          hasDepth: fs.existsSync(
            path.join(dir, relPath.replace(/\.[^.]+$/, ".depth.png")),
          ),
          hasSubject: fs.existsSync(
            path.join(dir, relPath.replace(/\.[^.]+$/, ".subject.png")),
          ),
        });
      } else if (VIDEO_EXT.has(ext) && rel.startsWith("videos")) {
        // exports/ の書き出しmp4を素材扱いしないよう videos/ 配下だけ拾う。
        // .pp.mp4（ループ用ピンポン版）は本体の付属品なので一覧に出さない
        if (!/\.pp\.(mp4|webm|mov)$/i.test(entry.name)) videoFiles.push(relPath);
      } else if (AUDIO_EXT.has(ext)) {
        audios.push(relPath);
      } else if (ext === ".lrc") {
        lrcs.push(relPath);
      }
    }
  };
  scan("");
  images.sort((a, b) => a.file.localeCompare(b.file, "ja"));
  videoFiles.sort((a, b) => a.localeCompare(b, "ja"));
  // 尺と系譜（延長の親子関係）を付与
  const lineage = readLineage(name);
  const parentOf = new Map(lineage.map((l) => [l.ext, l.parent]));
  const videos: VideoAsset[] = videoFiles.map((file) => ({
    file,
    durationSec: probeDurationSync(path.join(dir, file)),
    parent: parentOf.get(file) ?? null,
  }));
  return { images, videos, audios, lrcs };
}
