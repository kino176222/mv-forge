"use client";

import { useEffect, useState } from "react";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AI_MODELS,
  AI_PROVIDER_LABELS,
  type AiProvider,
} from "@/lib/ai-models";

/**
 * AI参謀のモデル選択（全プロバイダを1リストで・見出しでグループ分け）。
 * インストール済みCLIを /api/ai-providers で検出し、未検出のものは
 * 「（未検出）」付きのdisabledで見せる＝何が使えるようになるかも伝わる。
 */

type Detected = Record<AiProvider, boolean>;

// 検出結果はモジュール内で共有（AiPaneとOneshotDialogで二重フェッチしない）
let detectedCache: Detected | null = null;
let detectedPromise: Promise<Detected> | null = null;

function fetchDetected(): Promise<Detected> {
  if (detectedCache) return Promise.resolve(detectedCache);
  if (!detectedPromise) {
    detectedPromise = fetch("/api/ai-providers")
      .then((r) => r.json())
      .then((d: Detected) => {
        detectedCache = d;
        return d;
      })
      .catch(() => {
        detectedPromise = null;
        // 検出に失敗しても従来どおりclaudeは選べるようにする
        return { claude: true, codex: false, gemini: false };
      });
  }
  return detectedPromise;
}

const PROVIDER_ORDER: AiProvider[] = ["claude", "codex", "gemini"];

export function AiModelSelect({
  value,
  onChange,
  triggerClassName,
}: {
  value: string;
  onChange: (id: string) => void;
  triggerClassName?: string;
}) {
  const [detected, setDetected] = useState<Detected | null>(detectedCache);
  useEffect(() => {
    let alive = true;
    void fetchDetected().then((d) => {
      if (alive) setDetected(d);
    });
    return () => {
      alive = false;
    };
  }, []);

  return (
    <Select
      value={value || "__default__"}
      onValueChange={(v) => onChange(v === "__default__" ? "" : v)}
    >
      <SelectTrigger className={triggerClassName}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {PROVIDER_ORDER.map((provider) => {
          const models = AI_MODELS.filter((m) => m.provider === provider);
          if (models.length === 0) return null;
          const missing = detected ? !detected[provider] : provider !== "claude";
          return (
            <SelectGroup key={provider}>
              <SelectLabel className="text-[10px] text-neutral-500">
                {AI_PROVIDER_LABELS[provider]}
                {missing ? "（未検出）" : ""}
              </SelectLabel>
              {models.map((m) => (
                <SelectItem
                  key={m.id || "__default__"}
                  value={m.id || "__default__"}
                  disabled={missing}
                  className="text-xs"
                >
                  {m.label}
                </SelectItem>
              ))}
            </SelectGroup>
          );
        })}
      </SelectContent>
    </Select>
  );
}
