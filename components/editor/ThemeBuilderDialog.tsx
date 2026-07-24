"use client";
import React, { useMemo, useState } from "react";
import {
  Wand2,
  Video,
  Layers,
  ArrowLeftRight,
  Type,
  BookOpen,
} from "lucide-react";
import { toast } from "sonner";
import { useEditor } from "@/lib/store";
import { effectsByCategory } from "@/lib/effects-meta";
import type { EffectCategory } from "@/lib/effects-meta";
import { buildUserTheme, usedEffectIdsByCategory } from "@/lib/theme-builder";
import type { MvTheme } from "@/lib/themes";
import { LazyPlayerCard } from "@/components/effects/LazyPlayerCard";
import {
  FxPreview,
  FX_PREVIEW_FRAMES,
  FX_PREVIEW_FPS,
} from "@/remotion/FxPreview";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

/**
 * 自作テーマ（AI一括提案の手札＋方針＋即席適用の代表構成）を組むダイアログ。
 * カテゴリ別に手札をトグル選択→登録で themes.user.json に保存する。
 * プレビュー枠は上部に1つだけ（チップごとにPlayerを立てない）:
 * ホバー中の演出を優先表示し、離すと最後にクリックした演出に戻る。
 */

type PickKey = "camera" | "overlay" | "transition" | "lyric";

const SECTIONS: {
  key: PickKey;
  cat: EffectCategory;
  label: string;
  Icon: React.ComponentType<{ className?: string }>;
}[] = [
  { key: "camera", cat: "camera", label: "カメラ", Icon: Video },
  { key: "overlay", cat: "overlay", label: "重ね", Icon: Layers },
  { key: "transition", cat: "transition", label: "切替", Icon: ArrowLeftRight },
  { key: "lyric", cat: "lyric", label: "歌詞演出", Icon: Type },
];

const emptyPicks = (): Record<PickKey, string[]> => ({
  camera: [],
  overlay: [],
  transition: [],
  lyric: [],
});

export const ThemeBuilderDialog: React.FC<{
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved?: (theme: MvTheme) => void;
}> = ({ open, onOpenChange, onSaved }) => {
  const project = useEditor((s) => s.project);
  const [name, setName] = useState("");
  const [policy, setPolicy] = useState("");
  const [picks, setPicks] = useState<Record<PickKey, string[]>>(emptyPicks);
  // プレビュー対象: ホバー中の演出 > 最後にクリックした演出
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  const previewId = hoverId ?? focusId;

  // カテゴリ別のカタログ（ダイアログを開くたびに再計算されるが軽量）
  const catalog = useMemo(
    () =>
      Object.fromEntries(
        SECTIONS.map((s) => [s.key, effectsByCategory(s.cat)]),
      ) as Record<PickKey, ReturnType<typeof effectsByCategory>>,
    [],
  );
  const previewMeta = useMemo(() => {
    if (!previewId) return null;
    for (const list of Object.values(catalog)) {
      const hit = list.find((e) => e.id === previewId);
      if (hit) return hit;
    }
    return null;
  }, [catalog, previewId]);

  const toggle = (key: PickKey, id: string) =>
    setPicks((prev) => {
      const has = prev[key].includes(id);
      return {
        ...prev,
        [key]: has ? prev[key].filter((x) => x !== id) : [...prev[key], id],
      };
    });

  // 「いまこの曲の演出から作る」: 現在のプロジェクトで使われているidでプリフィル
  const prefillFromProject = () => {
    if (!project) return;
    const used = usedEffectIdsByCategory(project);
    setPicks({
      camera: used.camera,
      overlay: used.overlay,
      transition: used.transition,
      lyric: used.lyric,
    });
    const n =
      used.camera.length +
      used.overlay.length +
      used.transition.length +
      used.lyric.length;
    if (n === 0) {
      toast.info("この曲にはまだ演出が入っていません（手札は手動で選べます）");
    } else {
      toast.success(`いまの曲から ${n} 個の手札をプリフィルしました`);
    }
  };

  const reset = () => {
    setName("");
    setPolicy("");
    setPicks(emptyPicks());
    setHoverId(null);
    setFocusId(null);
  };

  const submit = async () => {
    let theme: MvTheme;
    try {
      theme = buildUserTheme({
        id: `user-theme-${Date.now()}`,
        name,
        policy,
        picks,
      });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
      return;
    }
    try {
      const res = await fetch("/api/themes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ theme }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error ?? "保存に失敗");
      toast.success(`テーマ「${theme.name}」を登録しました`);
      onSaved?.(theme);
      reset();
      onOpenChange(false);
    } catch (e) {
      toast.error(`登録に失敗: ${e instanceof Error ? e.message : e}`);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] max-w-lg flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle>自作テーマを組む</DialogTitle>
        </DialogHeader>

        {/* 演出プレビュー（非スクロール領域に固定。Playerはこの1枠だけ） */}
        <div className="shrink-0 space-y-1">
          {previewId ? (
            // key を付けない: ホバーのたびに Player を作り直すと高速スイープでもたつく。
            // 同一 Player に inputProps 更新で差し替える（EffectPicker の大プレビューと同じ流儀）
            <LazyPlayerCard
              component={FxPreview as React.FC<Record<string, unknown>>}
              inputProps={{ effectId: previewId }}
              durationInFrames={FX_PREVIEW_FRAMES}
              fps={FX_PREVIEW_FPS}
              width={640}
              height={360}
            />
          ) : (
            <div className="flex aspect-video w-full items-center justify-center rounded bg-neutral-950 px-4 text-center text-[11px] text-neutral-600">
              下のチップにマウスを乗せると、ここで演出をプレビューできます
            </div>
          )}
          <div className="flex h-4 items-center gap-1.5 text-[10px] text-neutral-500">
            {previewMeta && (
              <>
                <span className="min-w-0 truncate">
                  {previewMeta.name}
                  <span className="ml-1 text-neutral-600">
                    {previewMeta.description}
                  </span>
                </span>
                <a
                  href={`/effects#${previewMeta.id}`}
                  target="_blank"
                  rel="noreferrer"
                  className="ml-auto flex shrink-0 items-center gap-0.5 underline-offset-2 hover:text-neutral-300 hover:underline"
                >
                  <BookOpen className="size-3" /> 図鑑で見る
                </a>
              </>
            )}
          </div>
        </div>

        <div className="min-w-0 flex-1 space-y-3 overflow-y-auto overflow-x-hidden pr-1 text-sm">
          <p className="text-[11px] leading-relaxed text-neutral-500">
            カテゴリごとに使いたい演出（手札）を選びます。AI一括提案はこの手札の中だけで出方を選び、
            ワンクリック適用は各カテゴリの先頭を代表構成にします。切替と歌詞演出は各1つ以上が必須です。
          </p>

          <div className="flex items-center gap-2">
            <span className="w-14 shrink-0 text-xs text-neutral-400">名前</span>
            <Input
              className="h-8 flex-1 text-sm"
              placeholder="例: 夜想エモ"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <Button
              size="sm"
              variant="outline"
              className="h-8 shrink-0 px-2 text-xs"
              onClick={prefillFromProject}
              title="いまこの曲で使われている演出を手札にプリフィルする"
            >
              <Wand2 className="size-3.5" /> いまこの曲の演出から作る
            </Button>
          </div>

          <div className="flex items-start gap-2">
            <span className="w-14 shrink-0 pt-1.5 text-xs text-neutral-400">方針</span>
            <Textarea
              className="min-h-14 flex-1 text-sm"
              placeholder="空欄なら定型文（統一感を最優先。強い演出は見せ場だけ）が入ります"
              value={policy}
              onChange={(e) => setPolicy(e.target.value)}
            />
          </div>

          {SECTIONS.map(({ key, label, Icon }) => (
            <div key={key} className="space-y-1.5">
              <div className="flex items-center gap-1.5 text-xs text-neutral-300">
                <Icon className="size-3.5" /> {label}
                <span className="text-neutral-600">（{picks[key].length}）</span>
              </div>
              <div className="flex flex-wrap gap-1">
                {catalog[key].map((e) => {
                  const on = picks[key].includes(e.id);
                  return (
                    <Button
                      key={e.id}
                      size="sm"
                      variant={on ? "secondary" : "outline"}
                      className={
                        "h-6 px-2 text-[11px] " +
                        (on
                          ? "bg-amber-800/70 text-amber-50 hover:bg-amber-800"
                          : "text-neutral-400")
                      }
                      title={e.description}
                      onClick={() => {
                        setFocusId(e.id);
                        toggle(key, e.id);
                      }}
                      onMouseEnter={() => setHoverId(e.id)}
                      onMouseLeave={() =>
                        setHoverId((h) => (h === e.id ? null : h))
                      }
                    >
                      {e.name}
                    </Button>
                  );
                })}
              </div>
            </div>
          ))}

          <div className="flex items-center justify-end gap-2 pt-1">
            <Button
              size="sm"
              variant="ghost"
              className="h-8 px-2 text-xs text-neutral-400"
              onClick={() => onOpenChange(false)}
            >
              閉じる
            </Button>
            <Button size="sm" className="h-8 px-3 text-xs" onClick={submit}>
              テーマを登録
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};
