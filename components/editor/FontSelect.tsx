"use client";
import { BookOpen, RefreshCw } from "lucide-react";
import React, { useMemo, useState } from "react";
import { useEditor } from "@/lib/store";
import { FONTS, fontById } from "@/remotion/fonts";
import {
  organizeLocalFonts,
  parseFontCache,
  LOCAL_FONTS_CACHE_KEY,
} from "@/lib/local-fonts";
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
 * フォント選択の共有部品。
 * 収録フォント（Google Fonts）＋Macローカルフォント（Morisawa等）＋書体名手入力の橋渡し、
 * ローカルフォント読込ボタン、選択中フォントのプレビューまでを1セットで持つ。
 * 状態は useEditor（project.meta.textStyle.font）から自分で読み書きする自己完結型。
 * className は外側の余白調整用（既定は space-y-3 で StyleDialog の見た目を保つ）。
 */
export const FontSelect: React.FC<{ className?: string }> = ({ className }) => {
  const project = useEditor((s) => s.project);
  const mutate = useEditor((s) => s.mutate);
  // 前回読み込んだ一覧を初回描画時に復元（毎回「読込」不要で一覧に見える）。
  const [localFonts, setLocalFonts] = useState<string[]>(() =>
    parseFontCache(
      typeof window !== "undefined"
        ? window.localStorage.getItem(LOCAL_FONTS_CACHE_KEY)
        : null,
    ),
  );

  const organized = useMemo(() => organizeLocalFonts(localFonts), [localFonts]);

  // Macにインストール済みのフォント一覧（Morisawa等）をブラウザAPIで読む。
  // Morisawaで書体を増やしたら、このボタンを押すだけで最新が一覧に反映される。
  const loadLocalFonts = async () => {
    try {
      const query = (
        window as unknown as {
          queryLocalFonts?: () => Promise<{ family: string }[]>;
        }
      ).queryLocalFonts;
      if (!query) throw new Error("このブラウザは非対応（Chrome/Edge推奨）");
      const fonts = await query();
      const families = [...new Set(fonts.map((f) => f.family))];
      setLocalFonts(families);
      window.localStorage.setItem(
        LOCAL_FONTS_CACHE_KEY,
        JSON.stringify(families),
      );
      const org = organizeLocalFonts(families);
      toast.success(
        `Morisawa ${org.morisawa.length}書体を一覧に表示しました（Mac標準フォントは除外）`,
      );
    } catch (e) {
      toast.error(
        `フォント一覧を取得できませんでした（${e instanceof Error ? e.message : e}）。書体名の手入力は使えます`,
      );
    }
  };

  if (!project) return null;
  const ts = project.meta.textStyle;

  // ドロップダウンの現在値: google ID / system:書体名 / 手動入力(__manual__) を橋渡し
  const systemFamily = ts.font.startsWith("system:")
    ? ts.font.slice("system:".length)
    : "";
  const isListedSystem =
    systemFamily !== "" && localFonts.includes(systemFamily);
  const selectValue = ts.font.startsWith("system:")
    ? isListedSystem
      ? ts.font
      : "__manual__"
    : ts.font;

  return (
    <div className={cn("space-y-3", className)}>
      <div className="flex items-center gap-2">
        <span className="w-24 text-xs text-neutral-400">フォント</span>
        <Select
          value={selectValue}
          onValueChange={(v) =>
            mutate((p) => {
              if (v === "__manual__") {
                // 手入力モードへ。既に system:xxx でなければ空にして入力欄を出す
                if (!p.meta.textStyle.font.startsWith("system:"))
                  p.meta.textStyle.font = "system:";
              } else {
                p.meta.textStyle.font = v; // google ID か system:書体名
              }
            })
          }
        >
          <SelectTrigger className="h-8 w-full min-w-0 flex-1">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="max-h-[50vh] min-w-[24rem]">
            <SelectGroup>
              <SelectLabel>収録フォント（Google Fonts）</SelectLabel>
              {FONTS.map((f) => (
                <SelectItem
                  key={f.id}
                  value={f.id}
                  preview={
                    <span
                      style={{ fontFamily: f.family, fontSize: 18 }}
                      className="text-neutral-100"
                    >
                      あの日の空
                    </span>
                  }
                >
                  {f.label} — {f.vibe}
                </SelectItem>
              ))}
            </SelectGroup>
            {organized.morisawa.length > 0 && (
              <SelectGroup>
                <SelectLabel>Morisawa（インストール済み）</SelectLabel>
                {organized.morisawa.map((f) => (
                  <SelectItem
                    key={`m:${f}`}
                    value={`system:${f}`}
                    preview={
                      <span
                        style={{ fontFamily: `'${f}'`, fontSize: 18 }}
                        className="text-neutral-100"
                      >
                        あの日の空
                      </span>
                    }
                  >
                    {f}
                  </SelectItem>
                ))}
              </SelectGroup>
            )}
            <SelectGroup>
              <SelectLabel>手動</SelectLabel>
              <SelectItem value="__manual__">書体名を手入力…</SelectItem>
            </SelectGroup>
          </SelectContent>
        </Select>
        <Button
          size="sm"
          variant="outline"
          className="h-8 shrink-0 px-2 text-xs"
          title="Macのインストール済みフォント（Morisawaで増やした書体含む）を読み込み/更新"
          onClick={loadLocalFonts}
        >
          {localFonts.length > 0 ? (
            <>
              <RefreshCw className="size-3.5" /> 更新
            </>
          ) : (
            <>
              <BookOpen className="size-3.5" /> 読込
            </>
          )}
        </Button>
      </div>

      {localFonts.length === 0 && (
        <p className="text-[10px] leading-relaxed text-neutral-500">
          「読込」でMorisawaのアクティベート済み書体が一覧に並びます（Chrome/Edge推奨。Mac標準フォントは除外）。
          一度読めば次回以降は自動表示。Morisawaで書体を増やしたら「更新」で反映。名前が特殊で出ない書体は「手入力」で指定可。
        </p>
      )}

      {selectValue === "__manual__" && (
        <div className="flex items-center gap-2">
          <span className="w-24 text-xs text-neutral-400">書体名（手入力）</span>
          <input
            list="mvforge-local-fonts"
            className="h-8 flex-1 rounded-md border border-input bg-transparent px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            placeholder="例: A-OTF UD新ゴ Pr6N M"
            value={systemFamily}
            onChange={(e) =>
              mutate((p) => {
                p.meta.textStyle.font = `system:${e.target.value}`;
              })
            }
          />
          <datalist id="mvforge-local-fonts">
            {localFonts.map((f) => (
              <option key={f} value={f} />
            ))}
          </datalist>
        </div>
      )}

      {/* 選択中フォントのプレビュー */}
      <div
        className="rounded border border-neutral-800 bg-black px-3 py-2 text-center"
        style={{
          fontFamily: fontById(ts.font).family,
          fontWeight: fontById(ts.font).weight,
          fontSize: Math.min(30, ts.size * 0.5),
          color: "#fff",
        }}
      >
        夜を越えて 君へ届け 1234
      </div>
    </div>
  );
};
