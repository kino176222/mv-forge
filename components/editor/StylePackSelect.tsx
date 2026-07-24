"use client";
import { Package, Save } from "lucide-react";
import React, { useEffect, useMemo, useState } from "react";
import { useEditor } from "@/lib/store";
import {
  STYLE_PACKS,
  applyStylePackInPlace,
  packFromProject,
} from "@/lib/style-packs";
import type { StylePack } from "@/lib/schema";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/**
 * プリセット（スタイルパック）の共有部品。
 * 見た目の型（フォント・色・ルック）を一括適用し、おすすめの動き（テーマ）と
 * 濃さ（強さ）も一緒にセットする。自作パックの登録／解除もここで完結する。
 * 状態は useEditor（project.meta.stylePack ほか）から自分で読み書きする自己完結型。
 *
 * テーマ（recommendedTheme）は project ではなく localStorage("mvforge-theme") が正本なので、
 * 適用時にこのコンポーネントが localStorage を更新し、onApplied で呼び出し側（AiPane）へ通知する。
 */
export const StylePackSelect: React.FC<{
  className?: string;
  /** 見た目の型のヘッダ行を隠す（呼び出し側が独自ラベルを付ける場合に使う） */
  hideHeader?: boolean;
  /** 推奨テーマ付きパックを適用したとき、呼び出し側のテーマstateを同期するために呼ぶ */
  onApplied?: (pack: StylePack) => void;
}> = ({ className, hideHeader, onApplied }) => {
  const project = useEditor((s) => s.project);
  const mutate = useEditor((s) => s.mutate);

  // 自作パック（サーバ保存）を読み込み、内蔵パックと合わせて選択肢にする
  const [userPacks, setUserPacks] = useState<StylePack[]>([]);
  useEffect(() => {
    fetch("/api/style-packs")
      .then((r) => r.json())
      .then((d) => setUserPacks(Array.isArray(d.packs) ? d.packs : []))
      .catch(() => {});
  }, []);
  const allPacks = useMemo(() => [...STYLE_PACKS, ...userPacks], [userPacks]);

  if (!project) return null;
  const activePack = project.meta.stylePack;

  const applyPack = (id: string) => {
    const pack = allPacks.find((p) => p.id === id);
    if (!pack) return;
    mutate((p) => applyStylePackInPlace(p, pack));
    // テーマ（recommendedTheme）は localStorage が正本。ここで流し込み、呼び出し側へ通知する。
    if (pack.recommendedTheme) {
      localStorage.setItem("mvforge-theme", pack.recommendedTheme);
      onApplied?.(pack);
    }
    const hasRecommend = !!pack.recommendedTheme || !!pack.recommendedMode;
    toast.success(
      hasRecommend
        ? `プリセット「${pack.name}」を適用。テーマ・強さもおすすめ値をセットしました（あとから個別に変更可）`
        : `プリセット「${pack.name}」を適用（色などは下で微調整できます）`,
    );
  };
  const releasePack = () =>
    mutate((p) => {
      p.meta.stylePack = null;
    });
  const savePack = async () => {
    const name = window.prompt(
      "この設定をパック名で登録（別の曲でも選べます）",
      activePack?.name ?? "",
    );
    if (!name?.trim()) return;
    // 今選んでいるテーマ（localStorageが正本）を recommendedTheme として一緒に焼く
    const currentThemeId = localStorage.getItem("mvforge-theme") ?? "";
    const pack = packFromProject(
      project,
      `user-${Date.now()}`,
      name.trim(),
      currentThemeId,
    );
    try {
      const res = await fetch("/api/style-packs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pack }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error ?? "保存に失敗");
      setUserPacks(Array.isArray(d.packs) ? d.packs : []);
      mutate((p) => {
        p.meta.stylePack = pack;
      });
      toast.success(`パック「${name.trim()}」を登録しました`);
    } catch (e) {
      toast.error(`登録に失敗: ${e instanceof Error ? e.message : e}`);
    }
  };

  return (
    <div
      className={cn(
        "rounded border border-amber-900/50 bg-amber-950/20 p-2 space-y-2",
        className,
      )}
    >
      {!hideHeader && (
        <div className="flex items-center gap-1.5 text-xs text-amber-200">
          <Package className="size-3.5" /> プリセット（見た目の型）
          {activePack && (
            <span className="ml-auto rounded bg-amber-900/50 px-1.5 py-0.5 text-[10px]">
              適用中: {activePack.name}
            </span>
          )}
        </div>
      )}
      {/* 狭いペイン（AI参謀）でも崩れないよう、Selectは単独行＋ボタンは下の行 */}
      <div className="space-y-1.5">
        <Select value={activePack?.id ?? ""} onValueChange={applyPack}>
          <SelectTrigger className="h-8 w-full min-w-0">
            <SelectValue placeholder="プリセットを選ぶ…" />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectLabel>内蔵パック</SelectLabel>
              {STYLE_PACKS.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name}
                </SelectItem>
              ))}
            </SelectGroup>
            {userPacks.length > 0 && (
              <SelectGroup>
                <SelectLabel>自作パック</SelectLabel>
                {userPacks.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectGroup>
            )}
          </SelectContent>
        </Select>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            className="h-7 min-w-0 flex-1 px-2 text-xs"
            onClick={savePack}
            title="現在の設定を名前を付けてパックとして登録（別の曲でも選べる）"
          >
            <Save className="size-3.5" /> 登録
          </Button>
          {activePack && (
            <Button
              size="sm"
              variant="ghost"
              className="h-7 shrink-0 px-2 text-xs text-neutral-400"
              onClick={releasePack}
              title="型の記録を外す（見た目はそのまま。戻すのは⌘Z）"
            >
              解除
            </Button>
          )}
        </div>
      </div>
      {!hideHeader && (
        <p className="text-[10px] leading-relaxed text-neutral-500">
          プリセット＝保存棚。選ぶとフォント・色・ルックがこの曲に一括で入ります（⌘Zで戻る）。
          下のつまみが作業台＝微調整はこの曲だけに効き、保存済みプリセットは変わりません。
          気に入ったら「登録」で棚に保存（同名は上書き）。
        </p>
      )}
    </div>
  );
};
