"use client";
import React, { useState } from "react";
import { useEditor } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, Palette, Wrench, X } from "lucide-react";
import { assetUrl } from "@/remotion/asset-url";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

/**
 * 自由プロンプトでの画像生成カード。
 * 素材帯から画像をD&Dすると、その画像をI2I参照して修正できる。
 * AiPane から独立させた自己完結コンポーネント。
 */
export const FreeGenCard: React.FC = () => {
  const projectName = useEditor((s) => s.projectName);
  const [generating, setGenerating] = useState(false);
  const [freePrompt, setFreePrompt] = useState("");
  const [refImage, setRefImage] = useState<string | null>(null); // I2I参照（D&Dで受ける相対パス）
  const [refDragOver, setRefDragOver] = useState(false); // ドロップ受付中のハイライト

  const generateImage = async () => {
    if (!freePrompt.trim()) return;
    setGenerating(true);
    try {
      const res = await fetch("/api/generate-image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          project: projectName,
          prompt: freePrompt,
          refImage: refImage ?? undefined,
        }),
      });
      const d = await res.json();
      if (d.error) throw new Error(d.error);
      // 素材帯を更新して即使えるように
      const assets = await fetch(
        `/api/assets?project=${encodeURIComponent(projectName)}`,
      ).then((r) => r.json());
      if (!assets.error) useEditor.getState().setAssets(assets);
      if (refImage) setRefImage(null); // 参照修正が済んだらクリア
      toast.success(`生成完了: ${d.file} — 素材帯から行へD&Dできます`);
    } catch (e) {
      toast.error(String(e instanceof Error ? e.message : e));
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div
      className={cn(
        "rounded border bg-neutral-900/40 p-2.5 transition-colors",
        refDragOver
          ? "border-amber-500 bg-amber-950/20"
          : "border-neutral-800",
      )}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes("text/mvforge-image")) {
          e.preventDefault();
          setRefDragOver(true);
        }
      }}
      onDragLeave={() => setRefDragOver(false)}
      onDrop={(e) => {
        setRefDragOver(false);
        const file = e.dataTransfer.getData("text/mvforge-image");
        if (file) {
          e.preventDefault();
          setRefImage(file);
        }
      }}
    >
      <div className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-neutral-400">
        <Palette className="size-3.5" /> 画像を生成（自由プロンプト）
      </div>
      {/* 参照中の画像（D&Dで受けた素材）。ここにあれば元画像を修正するI2Iになる */}
      {refImage ? (
        <div className="mb-1.5 flex items-center gap-2 rounded border border-amber-700/50 bg-amber-950/20 p-1">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={assetUrl("", projectName, refImage)}
            alt={refImage}
            className="h-9 w-16 shrink-0 rounded border border-neutral-700 object-cover"
          />
          <span className="min-w-0 flex-1 truncate text-[10px] text-amber-200">
            この画像を修正: {refImage.split("/").pop()}
          </span>
          <button
            onClick={() => setRefImage(null)}
            className="shrink-0 rounded p-0.5 text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200"
            title="参照を外す（通常の新規生成に戻す）"
          >
            <X className="size-3.5" />
          </button>
        </div>
      ) : (
        <div className="mb-1.5 text-[10px] text-neutral-600">
          素材帯から画像をここにD&amp;Dすると、その画像を修正できます
        </div>
      )}
      <Textarea
        className="h-16 text-[11px]"
        placeholder={
          refImage
            ? "例: 左手を5本指に修正して / 背景を夜にして —元画像ベースで修正します"
            : "例: anime girl listening to radio at night, dark room, blue glow, cinematic —16:9で生成されます"
        }
        value={freePrompt}
        onChange={(e) => setFreePrompt(e.target.value)}
      />
      <Button
        size="sm"
        variant="outline"
        className="mt-1.5 h-6 w-full text-xs"
        disabled={generating || !freePrompt.trim()}
        onClick={generateImage}
      >
        {generating ? (
          <>
            <Loader2 className="size-3 animate-spin" /> 生成中…（30秒前後）
          </>
        ) : refImage ? (
          <>
            <Wrench className="size-3" /> この画像を修正して生成
          </>
        ) : (
          <>
            <Palette className="size-3" /> 生成して素材帯へ
          </>
        )}
      </Button>
    </div>
  );
};
