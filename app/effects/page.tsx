import React from "react";
import Link from "next/link";
import { ArrowLeft, Layers } from "lucide-react";
import { EFFECTS } from "@/lib/effects-meta";
import { XP_PORT_METAS } from "@/remotion/effects/xp/registry-meta";
import { UnifiedGallery } from "@/components/effects/UnifiedGallery";
import { MVFORGE_DIST } from "@/lib/brand";

/**
 * 統一エフェクト図鑑。自作部品（effects-meta）と拡張ポート（registry）を
 * 1つのブラウズ体験（検索・お気に入り・ホバー再生・拡大）で見る。
 * EffectPicker からは /effects#<id> で該当カードへ飛べる。
 */

export const metadata = { title: "エフェクト図鑑 | mv-forge" };

export default function EffectsPage() {
  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100">
      <header className="sticky top-0 z-10 border-b border-neutral-800 bg-neutral-950/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3">
          <Link
            href="/"
            className="flex items-center gap-1 text-xs text-neutral-400 hover:text-neutral-100"
          >
            <ArrowLeft className="size-3.5" /> プロジェクト一覧
          </Link>
          <div className="flex items-center gap-1.5 text-sm font-semibold">
            <Layers className="size-4" /> エフェクト図鑑
          </div>
          <span className="text-[11px] text-neutral-500">
            {MVFORGE_DIST
              ? `全${EFFECTS.length + XP_PORT_METAS.length}本`
              : `自作${EFFECTS.length} + 拡張${XP_PORT_METAS.length} ＝ 全${
                  EFFECTS.length + XP_PORT_METAS.length
                }本`}
          </span>
          {!MVFORGE_DIST && (
            <div className="ml-auto flex items-center gap-4">
              <Link
                href="/xp/flare"
                className="text-xs text-neutral-400 hover:text-neutral-100"
              >
                フレア図鑑
              </Link>
              <Link
                href="/xp/inventory"
                className="text-xs text-neutral-400 hover:text-neutral-100"
              >
                棚卸し
              </Link>
            </div>
          )}
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-8">
        <UnifiedGallery initialSource="all" />
      </main>
    </div>
  );
}
