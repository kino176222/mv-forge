"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Clapperboard, Plus, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface ProjectEntry {
  name: string;
  title: string;
  broken?: boolean;
}

/** プロジェクト一覧（MV1本＝1フォルダ）。量産の入口 */
export default function Home() {
  const [projects, setProjects] = useState<ProjectEntry[]>([]);
  const [newName, setNewName] = useState("");
  const [template, setTemplate] = useState(""); // 空=白紙
  const [error, setError] = useState("");
  const router = useRouter();

  useEffect(() => {
    fetch("/api/projects")
      .then((r) => r.json())
      .then((d) => setProjects(d.projects ?? []));
  }, []);

  const createProject = async () => {
    const name = newName.trim();
    if (!name) return;
    const res = await fetch("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, template: template || undefined }),
    });
    const d = await res.json();
    if (d.error) {
      setError(d.error);
      return;
    }
    router.push(`/editor/${encodeURIComponent(name)}`);
  };

  const usable = projects.filter((p) => !p.broken);

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-6 py-16">
      <h1 className="flex items-center gap-2 text-2xl font-bold">
        <Clapperboard className="size-6 text-primary" /> MV Forge
      </h1>
      <p className="mt-1 text-sm text-neutral-400">
        Sunoの曲＋持込画像＋歌詞で、1曲アニメMVを準量産する合成エンジン
      </p>

      <div className="mt-8 space-y-2">
        {projects.map((p) =>
          p.broken ? (
            <div
              key={p.name}
              className="block rounded-lg border border-red-900/60 bg-red-950/20 px-4 py-3"
            >
              <div className="flex items-center gap-2 font-medium text-red-300">
                <TriangleAlert className="size-4" /> {p.title}
              </div>
              <div className="font-mono text-xs text-neutral-500">
                projects/{p.name}/project.json.bak から復元できます（.bakを project.json に戻す）
              </div>
            </div>
          ) : (
            <Link
              key={p.name}
              href={`/editor/${encodeURIComponent(p.name)}`}
              className="block rounded-lg border border-neutral-800 bg-neutral-900/60 px-4 py-3 transition-colors hover:border-neutral-600"
            >
              <div className="font-medium">{p.title}</div>
              <div className="font-mono text-xs text-neutral-500">projects/{p.name}/</div>
            </Link>
          ),
        )}
        {projects.length === 0 && (
          <p className="text-sm text-neutral-500">
            まだプロジェクトがありません。下から作成してください。
          </p>
        )}
      </div>

      <div className="mt-8 space-y-2">
        <div className="flex gap-2">
          <Input
            placeholder="新しいプロジェクト名（例: my-mv-01）"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && createProject()}
          />
          <Button onClick={createProject}>
            <Plus className="size-4" /> 作成
          </Button>
        </div>
        {usable.length > 0 && (
          <div className="flex items-center gap-2">
            <span className="shrink-0 text-xs text-neutral-500">様式の雛形</span>
            <Select value={template || "__blank__"} onValueChange={(v) => setTemplate(v === "__blank__" ? "" : v)}>
              <SelectTrigger className="h-8 flex-1 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__blank__" className="text-xs">
                  白紙から作る
                </SelectItem>
                {usable.map((p) => (
                  <SelectItem key={p.name} value={p.name} className="text-xs">
                    「{p.title}」の様式を引き継ぐ（フォント・色・エンドカード等）
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
      </div>
      {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
      <p className="mt-4 text-xs leading-relaxed text-neutral-600">
        曲はエディタの「セットアップ」からドラッグ&ドロップで入れられます。
        画像・動画は projects/&lt;名前&gt;/ の images/・videos/ へ。量産はフォルダごとコピーが基本。
      </p>
    </main>
  );
}
