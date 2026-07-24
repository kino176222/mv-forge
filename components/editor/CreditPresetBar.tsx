"use client";

import React from "react";
import { Save, Trash2 } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { TitleCard } from "@/lib/schema";
import {
  BUILTIN_CREDIT_PRESETS,
  type CreditPreset,
} from "@/lib/credit-presets";

/**
 * クレジットプリセットの差し込み/保存バー（openingCard と行クレジットの両方で使う）。
 * - 選ぶ＝即差し込み（card を複製して onApply。以降は通常のつまみで微調整）
 * - 保存＝今の設定一式に名前を付けて credit-presets.user.json へ（プロジェクト横断）
 * - 同名で保存すると上書き。自作プリセットは選択後にゴミ箱で削除できる
 */
export function CreditPresetBar({
  current,
  onApply,
}: {
  current: TitleCard | null;
  onApply: (card: TitleCard) => void;
}) {
  const [userPresets, setUserPresets] = React.useState<CreditPreset[]>([]);
  const [selectedId, setSelectedId] = React.useState<string>("");
  const [saveName, setSaveName] = React.useState("");

  React.useEffect(() => {
    fetch("/api/credit-presets")
      .then((r) => r.json())
      .then((d) => setUserPresets(d.presets ?? []))
      .catch(() => {});
  }, []);

  const allPresets = [...BUILTIN_CREDIT_PRESETS, ...userPresets];

  const apply = (id: string) => {
    setSelectedId(id);
    const preset = allPresets.find((p) => p.id === id);
    if (preset) onApply(JSON.parse(JSON.stringify(preset.card)) as TitleCard);
  };

  const save = async () => {
    if (!current || !saveName.trim()) return;
    // 同名の自作プリセットがあれば上書き（idを引き継ぐ）
    const existing = userPresets.find((p) => p.name === saveName.trim());
    const preset: CreditPreset = {
      id: existing?.id ?? `cp-${Date.now().toString(36)}`,
      name: saveName.trim(),
      card: JSON.parse(JSON.stringify(current)) as TitleCard,
    };
    const res = await fetch("/api/credit-presets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ preset }),
    });
    const d = await res.json();
    if (d.presets) {
      setUserPresets(d.presets);
      setSaveName("");
      setSelectedId(preset.id);
    }
  };

  const removeSelected = async () => {
    if (!userPresets.some((p) => p.id === selectedId)) return; // 内蔵は消せない
    const res = await fetch(`/api/credit-presets?id=${encodeURIComponent(selectedId)}`, {
      method: "DELETE",
    });
    const d = await res.json();
    if (d.presets) {
      setUserPresets(d.presets);
      setSelectedId("");
    }
  };

  const selectedIsUser = userPresets.some((p) => p.id === selectedId);
  const selectedHint = allPresets.find((p) => p.id === selectedId)?.hint;

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2 text-xs">
        <span className="w-16 shrink-0 text-neutral-400">プリセット</span>
        <Select value={selectedId} onValueChange={apply}>
          <SelectTrigger className="h-6 flex-1 text-xs">
            <SelectValue placeholder="作り置きから差す" />
          </SelectTrigger>
          <SelectContent>
            {BUILTIN_CREDIT_PRESETS.map((p) => (
              <SelectItem key={p.id} value={p.id} className="text-xs">
                {p.name}
              </SelectItem>
            ))}
            {userPresets.map((p) => (
              <SelectItem key={p.id} value={p.id} className="text-xs">
                ★ {p.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {selectedIsUser && (
          <button
            type="button"
            onClick={removeSelected}
            title="このプリセットを削除"
            className="text-neutral-500 transition hover:text-red-400"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      {selectedHint && (
        <p className="pl-[4.5rem] text-[10px] text-neutral-500">{selectedHint}</p>
      )}
      {current && (
        <div className="flex items-center gap-2 text-xs">
          <span className="w-16 shrink-0 text-neutral-400">保存</span>
          <input
            value={saveName}
            onChange={(e) => setSaveName(e.target.value)}
            placeholder="今の設定に名前を付けて作り置き"
            className="h-6 flex-1 rounded border border-neutral-800 bg-neutral-900 px-2 text-xs text-neutral-200 placeholder:text-neutral-600 focus:border-neutral-600 focus:outline-none"
          />
          <button
            type="button"
            onClick={save}
            disabled={!saveName.trim()}
            title="プリセットとして保存（同名は上書き）"
            className="text-neutral-400 transition hover:text-neutral-100 disabled:opacity-40"
          >
            <Save className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
    </div>
  );
}
