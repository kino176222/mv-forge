"use client";
import React, { useCallback, useState } from "react";
import { History, Save, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { useEditor } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

type Snapshot = { sha: string; at: number; label: string };

/** 経過時間を「たった今 / n分前 / n時間前 / n日前」で表示（詳細は時刻ツールチップに委ねる） */
function ago(ms: number): string {
  const s = Math.max(0, Math.floor((Date.now() - ms) / 1000));
  if (s < 60) return "たった今";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}分前`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}時間前`;
  return `${Math.floor(h / 24)}日前`;
}

/** 一覧に常時出す実日時「YYYY/MM/DD HH:mm」。空欄保存時の既定の名前にも使う。 */
function fmtDateTime(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/**
 * 途中セーブ（スナップショット）UI。
 * 「現在を保存」＋履歴一覧＋復元を1つのポップオーバーに集約。
 * 保存/復元の前後で flushSave（現在をディスクへ確定）と reloadProject（復元後の読み直し）を呼ぶ。
 */
export const SnapshotMenu: React.FC<{
  flushSave: () => Promise<void>;
  reloadProject: () => Promise<void>;
}> = ({ flushSave, reloadProject }) => {
  const projectName = useEditor((s) => s.projectName);
  const [open, setOpen] = useState(false);
  const [list, setList] = useState<Snapshot[]>([]);
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);

  const refetch = useCallback(async () => {
    if (!projectName) return;
    const r = await fetch(
      `/api/project/snapshots?name=${encodeURIComponent(projectName)}`,
    ).then((res) => res.json());
    if (r.snapshots) setList(r.snapshots);
  }, [projectName]);

  const onOpenChange = (v: boolean) => {
    setOpen(v);
    if (v) refetch().catch(() => {});
  };

  const save = async () => {
    if (!projectName || busy) return;
    setBusy(true);
    try {
      await flushSave(); // 「今」をディスクへ確定してから履歴に刻む
      // 名前は任意。空欄なら日時を既定の名前にする（「日付＋名前がデフォで出る」）
      const finalLabel = label.trim() || fmtDateTime(Date.now());
      const res = await fetch("/api/project/snapshots", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: projectName, label: finalLabel }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "保存に失敗");
      setLabel("");
      await refetch();
      toast.success("この版を保存しました");
    } catch (e) {
      toast.error(String(e instanceof Error ? e.message : e));
    } finally {
      setBusy(false);
    }
  };

  const restore = async (snap: Snapshot) => {
    if (busy) return;
    if (
      !window.confirm(
        `「${snap.label}」（${ago(snap.at)}）の状態に戻します。\n今の状態は自動で退避されるので失われません。よろしいですか？`,
      )
    )
      return;
    setBusy(true);
    try {
      await flushSave(); // 現在を確定 → サーバ側で自動退避コミットに含める
      const res = await fetch("/api/project/snapshots", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: projectName, sha: snap.sha }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "復元に失敗");
      await reloadProject(); // 巻き戻した project.json を読み直す（loadedAt等もリセット）
      await refetch();
      toast.success("この版に戻しました");
    } catch (e) {
      toast.error(String(e instanceof Error ? e.message : e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 gap-1 px-2 text-xs"
          title="この編集を保存して、あとで戻れるようにする（履歴）"
        >
          <History className="size-3.5" /> 履歴
        </Button>
      </PopoverTrigger>
      <PopoverContent
        side="bottom"
        align="end"
        className="w-80 border-neutral-800 bg-neutral-950 p-2"
      >
        <div className="mb-2 flex items-center gap-1.5">
          <Input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") save();
            }}
            placeholder="名前（空欄なら日時が入ります）"
            className="h-8 text-xs"
          />
          <Button
            size="sm"
            className="h-8 shrink-0 gap-1 px-2 text-xs"
            disabled={busy || !projectName}
            onClick={save}
          >
            <Save className="size-3.5" /> 保存
          </Button>
        </div>
        <div className="mb-1 text-[10px] text-neutral-500">
          保存した版はいつでも戻せます（今の状態は復元時に自動退避）
        </div>
        <ScrollArea className="max-h-64">
          {list.length === 0 ? (
            <div className="px-1 py-4 text-center text-xs text-neutral-600">
              まだ保存された版はありません
            </div>
          ) : (
            <ul className="space-y-1">
              {list.map((snap, i) => (
                <li
                  key={snap.sha}
                  className="flex items-center gap-2 rounded border border-neutral-800 px-2 py-1.5"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-xs text-neutral-200">
                      {snap.label || "（無題）"}
                      {i === 0 && (
                        <span className="ml-1.5 text-[10px] text-emerald-400">
                          最新
                        </span>
                      )}
                    </div>
                    <div
                      className="text-[10px] text-neutral-500"
                      title={ago(snap.at)}
                    >
                      {fmtDateTime(snap.at)}
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-6 shrink-0 gap-1 px-1.5 text-[10px]"
                    disabled={busy}
                    onClick={() => restore(snap)}
                    title="この版に戻す"
                  >
                    <RotateCcw className="size-3" /> 復元
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
};
