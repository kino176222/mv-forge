"use client";
import { Music, Upload } from "lucide-react";
import React, { useRef, useState } from "react";
import { useEditor } from "@/lib/store";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { toSongStructure } from "./Waveform";

/**
 * セットアップ: 曲ファイルの選択と歌詞（LRC）の取り込み。
 * - LRC読込: 手持ちのLRCを貼り付け
 * - ①LRC自動生成: ボーカル音声＋正解歌詞 → Scribeでアライメント下書き
 * どちらも既存行の装飾を引き継ぐ「マージ」対応。
 */
export const SetupDialog: React.FC = () => {
  const project = useEditor((s) => s.project);
  const projectName = useEditor((s) => s.projectName);
  const assets = useEditor((s) => s.assets);
  const mutate = useEditor((s) => s.mutate);
  const setProject = useEditor((s) => s.setProject);
  const setAssets = useEditor((s) => s.setAssets);
  const setBeats = useEditor((s) => s.setBeats);
  const setSongStructure = useEditor((s) => s.setSongStructure);
  const [lrcText, setLrcText] = useState("");
  const [lyricsText, setLyricsText] = useState("");
  const [vocalFile, setVocalFile] = useState("");
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [open, setOpen] = useState(false);

  if (!project) return null;

  /** 音源をアップロード → 素材一覧を更新 → 曲が未設定（実在しない）なら自動セット */
  const uploadAudios = async (files: File[]) => {
    if (!files.length) return;
    setUploading(true);
    try {
      const saved: string[] = [];
      for (const f of files) {
        const form = new FormData();
        form.append("project", projectName);
        form.append("file", f);
        const res = await fetch("/api/assets/upload", { method: "POST", body: form });
        const d = await res.json();
        if (d.error) throw new Error(d.error);
        saved.push(d.file);
      }
      const fresh = await fetch(
        `/api/assets?project=${encodeURIComponent(projectName)}`,
      ).then((r) => r.json());
      if (!fresh.error) setAssets(fresh);
      const audios: string[] = fresh.audios ?? [];
      if (!audios.includes(project.meta.songFile)) {
        // 現在の曲がフォルダに実在しない＝未設定同然なので、いま入れた曲をセット
        mutate((p) => {
          p.meta.songFile = saved[0];
          p.meta.songDuration = 0; // 再計測させる
        });
        toast.success(`${saved.join(", ")} を取り込み、曲にセットしました`);
      } else {
        toast.success(`${saved.join(", ")} を取り込みました（曲の選択肢に追加）`);
      }
    } catch (e) {
      toast.error(String(e instanceof Error ? e.message : e));
    } finally {
      setUploading(false);
    }
  };

  const callLrcApi = async (body: Record<string, unknown>) => {
    setBusy(true);
    try {
      const res = await fetch("/api/lrc", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project: projectName, merge: true, ...body }),
      });
      const d = await res.json();
      if (d.error) throw new Error(d.error);
      setProject(d.project);
      toast.success(
        d.insertedMarkers > 0
          ? `歌詞 ${d.lineCount} 行を読み込みました（前奏/間奏/アウトロにマーカー ${d.insertedMarkers} 個を自動挿入）`
          : `歌詞 ${d.lineCount} 行を読み込みました`,
      );
      // ①LRC完了時にサーバー側で曲構造も自動解析される。走ったら beats を再取得して
      // 波形に即反映＋要約トースト（Waveform の toSongStructure を再利用）。
      if (d.analyzedStructure) {
        try {
          const bd = await fetch(
            `/api/beats?project=${encodeURIComponent(projectName)}`,
          ).then((r) => r.json());
          setBeats(bd.beats ?? []);
          const st = toSongStructure(bd);
          setSongStructure(st);
          if (st?.bpm) {
            const choruses = st.sections.filter((s) => s.kind === "chorus").length;
            toast.success(
              `曲を解析しました: BPM${Math.round(st.bpm)}・サビ${choruses}箇所（切り替えの吸着とAIレコメンドに使われます）`,
            );
          }
        } catch {
          /* 反映失敗は致命でない（手動「ビート検出」で取り直せる） */
        }
      }
      setOpen(false);
    } catch (e) {
      toast.error(String(e instanceof Error ? e.message : e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" className="h-7 text-xs">
          <Music className="size-3.5" /> セットアップ
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>曲と歌詞のセットアップ</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <div className="flex items-center gap-2">
            <span className="w-16 shrink-0 text-xs text-neutral-400">曲</span>
            <Select
              value={project.meta.songFile}
              onValueChange={(v) =>
                mutate((p) => {
                  p.meta.songFile = v;
                  p.meta.songDuration = 0; // 再計測させる
                })
              }
            >
              <SelectTrigger className="h-8 flex-1">
                <SelectValue placeholder="song.mp3" />
              </SelectTrigger>
              <SelectContent>
                {assets.audios.map((a) => (
                  <SelectItem key={a} value={a}>
                    {a}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <span className="font-mono text-xs text-neutral-500">
              {project.meta.songDuration > 0
                ? `${Math.floor(project.meta.songDuration / 60)}:${String(Math.round(project.meta.songDuration % 60)).padStart(2, "0")}`
                : "未計測"}
            </span>
          </div>

          <div
            role="button"
            tabIndex={0}
            onClick={() => fileInputRef.current?.click()}
            onKeyDown={(e) => e.key === "Enter" && fileInputRef.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              const dropped = Array.from(e.dataTransfer.files);
              const audios = dropped.filter((f) =>
                /\.(mp3|wav|m4a|aac|ogg|flac)$/i.test(f.name),
              );
              const rejected = dropped.filter((f) => !audios.includes(f));
              if (rejected.length) {
                toast.error(
                  `音声ファイルのみ対応です: ${rejected.map((f) => f.name).join(", ")}`,
                );
              }
              uploadAudios(audios);
            }}
            className={`flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed px-3 py-3 text-xs transition-colors ${
              dragging
                ? "border-primary bg-primary/10 text-primary"
                : "border-neutral-700 text-neutral-400 hover:border-neutral-500"
            }`}
          >
            <Upload className="size-3.5" />
            {uploading
              ? "アップロード中…"
              : "音源をここにドラッグ&ドロップ（クリックで選択）mp3 / wav / m4a など"}
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept=".mp3,.wav,.m4a,.aac,.ogg,.flac,audio/*"
            multiple
            className="hidden"
            onChange={(e) => {
              uploadAudios(Array.from(e.target.files ?? []));
              e.target.value = "";
            }}
          />

          <Tabs defaultValue="import">
            <TabsList className="h-8">
              <TabsTrigger value="import" className="text-xs">
                LRCを貼り付け
              </TabsTrigger>
              <TabsTrigger value="auto" className="text-xs">
                ① LRC自動生成
              </TabsTrigger>
            </TabsList>
            <TabsContent value="import" className="space-y-2">
              <Textarea
                placeholder={"[00:13.73] 夕焼けの\n[00:15.50] 雲の上で\n…"}
                className="h-40 font-mono text-xs"
                value={lrcText}
                onChange={(e) => setLrcText(e.target.value)}
              />
              <Button
                size="sm"
                disabled={busy || !lrcText.trim()}
                onClick={() => callLrcApi({ mode: "import", lrcText })}
              >
                {busy ? "読込中…" : "読み込む（既存の装飾は引き継ぐ）"}
              </Button>
            </TabsContent>
            <TabsContent value="auto" className="space-y-2">
              <div className="flex items-center gap-2">
                <span className="w-24 shrink-0 text-xs text-neutral-400">
                  ボーカル音声
                </span>
                <Select value={vocalFile} onValueChange={setVocalFile}>
                  <SelectTrigger className="h-8 flex-1">
                    <SelectValue placeholder="vocals.mp3（Sunoのステム推奨）" />
                  </SelectTrigger>
                  <SelectContent>
                    {assets.audios.map((a) => (
                      <SelectItem key={a} value={a}>
                        {a}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Textarea
                placeholder={"正解の歌詞を1行ずつ貼り付け（時刻はAIが探します）\n夕焼けの\n雲の上で\n…"}
                className="h-32 text-xs"
                value={lyricsText}
                onChange={(e) => setLyricsText(e.target.value)}
              />
              <Button
                size="sm"
                disabled={busy || !vocalFile || !lyricsText.trim()}
                onClick={() =>
                  callLrcApi({ mode: "auto", audioFile: vocalFile, lyricsText })
                }
              >
                {busy ? "文字起こし＆アライメント中…" : "自動生成（下書き→あとで微調整）"}
              </Button>
              <p className="text-[11px] text-neutral-500">
                ElevenLabs Scribeで単語時刻を取り、正解歌詞と突き合わせます。
                精度9割前後。ズレた行は表のオフセットで直してください。
              </p>
            </TabsContent>
          </Tabs>
        </div>
      </DialogContent>
    </Dialog>
  );
};
