"use client";
import React, { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Clapperboard, Undo2, Redo2, Plus } from "lucide-react";
import { useEditor } from "@/lib/store";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SnapshotMenu } from "./SnapshotMenu";
import { SetupDialog } from "./SetupDialog";
import { StyleDialog } from "./StyleDialog";
import { LookDialog } from "./LookDialog";
import { RenderDialog } from "./RenderDialog";

/** 上部バー: プロジェクト切替・タブ切替・セットアップ・様式・Undo/Redo・履歴・書き出し */
export const TopBar: React.FC<{
  saving: boolean;
  unsaved: boolean;
  flushSave: () => Promise<void>;
  reloadProject: () => Promise<void>;
}> = ({ saving, unsaved, flushSave, reloadProject }) => {
  const project = useEditor((s) => s.project);
  const projectName = useEditor((s) => s.projectName);
  const tab = useEditor((s) => s.tab);
  const setTab = useEditor((s) => s.setTab);
  const temporal = useEditor.temporal;
  const router = useRouter();
  const [projects, setProjects] = useState<{ name: string; title: string }[]>([]);

  useEffect(() => {
    fetch("/api/projects")
      .then((r) => r.json())
      .then((d) =>
        setProjects(
          (d.projects ?? []).filter((p: { broken?: boolean }) => !p.broken),
        ),
      )
      .catch(() => {});
  }, []);

  return (
    <div className="flex h-11 items-center gap-2 border-b bg-card px-3">
      <Link
        href="/"
        className="flex items-center gap-1.5 text-sm font-bold tracking-wide text-primary transition-opacity hover:opacity-80"
      >
        <Clapperboard className="size-4" /> MV Forge
      </Link>

      {/* プロジェクト切り替え */}
      <Select
        value={projectName}
        onValueChange={(v) => {
          if (v === "__home__") router.push("/");
          else if (v !== projectName) router.push(`/editor/${encodeURIComponent(v)}`);
        }}
      >
        <SelectTrigger className="h-7 max-w-56 text-xs" title="プロジェクトを切り替え">
          <SelectValue placeholder={project?.meta.title} />
        </SelectTrigger>
        <SelectContent>
          {projects.map((p) => (
            <SelectItem key={p.name} value={p.name} className="text-xs">
              {p.title}
            </SelectItem>
          ))}
          <SelectSeparator />
          <SelectItem value="__home__" className="text-xs">
            <span className="flex items-center gap-1">
              <Plus className="size-3" /> 新しいプロジェクト…
            </span>
          </SelectItem>
        </SelectContent>
      </Select>

      <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)} className="ml-2">
        <TabsList className="h-7">
          <TabsTrigger value="prologue" className="h-6 text-xs">
            プロローグ
          </TabsTrigger>
          <TabsTrigger value="main" className="h-6 text-xs">
            本編
          </TabsTrigger>
          <TabsTrigger value="outro" className="h-6 text-xs">
            アウトロ
          </TabsTrigger>
          <TabsTrigger value="shorts" className="h-6 text-xs">
            ショート
          </TabsTrigger>
        </TabsList>
      </Tabs>

      <div className="ml-auto flex items-center gap-1.5">
        <span className="mr-1 flex items-center gap-1 text-[10px] text-muted-foreground">
          <span
            className={`inline-block size-1.5 rounded-full ${
              saving
                ? "animate-pulse bg-amber-400"
                : unsaved
                  ? "bg-yellow-400"
                  : "bg-emerald-500"
            }`}
          />
          {saving ? "保存中…" : unsaved ? "未保存" : "保存済み"}
        </span>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 px-2 text-xs"
          title="元に戻す (⌘Z)"
          onClick={() => temporal.getState().undo()}
        >
          <Undo2 className="size-3.5" />
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 px-2 text-xs"
          title="やり直す (⇧⌘Z)"
          onClick={() => temporal.getState().redo()}
        >
          <Redo2 className="size-3.5" />
        </Button>
        <SnapshotMenu flushSave={flushSave} reloadProject={reloadProject} />
        <SetupDialog />
        <StyleDialog />
        <LookDialog />
        <RenderDialog />
      </div>
    </div>
  );
};
