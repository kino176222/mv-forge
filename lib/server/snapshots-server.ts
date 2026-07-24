import "./server-guard";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { projectDir } from "./projects-server";

/**
 * 途中セーブ（スナップショット）の履歴DB。
 *
 * 各プロジェクトの project.json は本体リポで既に追跡されているため、projects 配下に
 * 通常の .git を作るとネスト衝突する。そこで履歴gitを「.git ではない別名」
 * `projects/<name>/.snapshots.git` に置き、git-dir と work-tree を明示して
 * project.json だけを管理する。本体リポ側は .gitignore で除外済み。
 * ＝本体リポともKinoの手動gitとも完全に独立した、制作データ専用の履歴。
 */

function snapGitDir(name: string): string {
  return path.join(projectDir(name), ".snapshots.git");
}

/** name に紐づく履歴DBへ git を実行（work-tree=projectDir・追跡対象は project.json のみ）。 */
function git(name: string, args: string[]): string {
  return execFileSync(
    "git",
    ["--git-dir", snapGitDir(name), "--work-tree", projectDir(name), ...args],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
}

/** 履歴DBが無ければ初期化。コミット主体を固定し、identity未設定環境でも失敗しないようにする。 */
export function ensureRepo(name: string): void {
  const dir = snapGitDir(name);
  if (fs.existsSync(dir)) return;
  git(name, ["init", "-q"]);
  git(name, ["config", "user.name", "mv-forge"]);
  git(name, ["config", "user.email", "mvforge@local"]);
  git(name, ["config", "commit.gpgsign", "false"]);
}

/** 現在の project.json を1コミットとして保存。ラベル＝コミットメッセージ。返り値＝新HEADのsha。 */
export function saveSnapshot(name: string, label?: string): string {
  ensureRepo(name);
  git(name, ["add", "project.json"]);
  const msg = (label ?? "").trim() || "スナップショット";
  // --allow-empty: 変更が無くても「この瞬間に戻れる目印」を意図的に残す
  git(name, ["commit", "-q", "--allow-empty", "-m", msg]);
  return git(name, ["rev-parse", "HEAD"]).trim();
}

export type Snapshot = { sha: string; at: number; label: string };

/** 履歴一覧（新しい順）。DB未作成なら空。 */
export function listSnapshots(name: string): Snapshot[] {
  if (!fs.existsSync(snapGitDir(name))) return [];
  const out = git(name, ["log", "--pretty=format:%H%x1f%ct%x1f%s"]).trim();
  if (!out) return [];
  return out.split("\n").map((line) => {
    const [sha, ct, ...rest] = line.split("\x1f");
    return { sha, at: Number(ct) * 1000, label: rest.join("\x1f") };
  });
}

/**
 * 指定コミットへ project.json を巻き戻す。
 * 破壊防止のため、まず現在の状態を「復元前の自動退避」として1コミット積んでから checkout する。
 */
export function restoreSnapshot(name: string, sha: string): void {
  ensureRepo(name);
  git(name, ["add", "project.json"]);
  git(name, ["commit", "-q", "--allow-empty", "-m", "復元前の自動退避"]);
  git(name, ["checkout", sha, "--", "project.json"]);
}

/** sha の形式検証（arg注入・不正参照の防止）。 */
export function isValidSha(sha: unknown): sha is string {
  return typeof sha === "string" && /^[0-9a-f]{7,40}$/.test(sha);
}

/** プロジェクト名の軽いガード（パストラバーサル防止）。 */
export function isValidProjectName(name: unknown): name is string {
  return (
    typeof name === "string" &&
    name.length > 0 &&
    !name.includes("/") &&
    !name.includes("\\") &&
    !name.includes("..")
  );
}
