"use client";
import React from "react";
import { Button } from "@/components/ui/button";
import { Lightbulb, Plus, X } from "lucide-react";
import type { XpTextSpec } from "@/lib/xp/text-specs";
import type { SlotStyle } from "@/lib/schema";

/**
 * 拡張テロップの複数スロット書式を「1行目・2行目…」の分割フォームで編集する。
 * 値の実体は line.lyricText 1本のまま（スロットを規約の区切り文字で組み立てて返す）。
 * どのスロットに何が入るかは lib/xp-text-specs.ts の定義が知っている。
 *
 * 行ごとの色（slotStyles）は「描画される \n 行」単位の配列で持つ。
 * スロット定義がある場合もフォーム側で スロット→行index に展開して書き込む
 * （複数行OKの最終スロットは、その時点の全所属行に同じ色を書く）。
 */

const fieldCls =
  "w-full rounded border border-neutral-800 bg-neutral-900 px-2 py-1 text-xs text-neutral-200 placeholder:text-neutral-600 focus:border-neutral-600 focus:outline-none";

const HEX6 = /^#[0-9a-fA-F]{6}$/;

const Hint: React.FC<{ text: string }> = ({ text }) => (
  <p className="flex items-start gap-1 text-[11px] leading-relaxed text-neutral-500">
    <Lightbulb className="mt-0.5 size-3 shrink-0" />
    {text}
  </p>
);

/** 行/スロットの色スウォッチ（未設定=デザイン既定。×で既定に戻す） */
const ColorDot: React.FC<{
  value?: string;
  onChange(v: string | undefined): void;
}> = ({ value, onChange }) => (
  <span className="flex shrink-0 items-center gap-0.5 pt-0.5">
    <input
      type="color"
      title={value ? `この行の文字色: ${value}` : "この行の文字色（今はデザイン既定）"}
      value={HEX6.test(value ?? "") ? (value as string) : "#ffffff"}
      onChange={(e) => onChange(e.target.value)}
      className="h-6 w-6 shrink-0 cursor-pointer rounded border border-neutral-800 bg-neutral-900 p-0"
    />
    {value ? (
      <button
        type="button"
        title="デザイン既定の色に戻す"
        onClick={() => onChange(undefined)}
        className="text-neutral-500 hover:text-neutral-300"
      >
        <X className="size-3" />
      </button>
    ) : (
      <span className="w-3" />
    )}
  </span>
);

/** styles配列のidx位置にcolorを書く（末尾の空エントリはJSONを汚さないよう落とす） */
const withColorAt = (
  styles: SlotStyle[] | undefined,
  indices: number[],
  color: string | undefined,
): SlotStyle[] => {
  const next: SlotStyle[] = [...(styles ?? [])].map((s) => ({ ...s }));
  const maxIdx = Math.max(...indices);
  while (next.length <= maxIdx) next.push({});
  for (const i of indices) next[i] = { ...next[i], color };
  while (
    next.length > 0 &&
    Object.values(next[next.length - 1]).every((v) => v === undefined)
  )
    next.pop();
  return next;
};

/**
 * スロット定義が無い拡張テロップ用: 現在のテキストの行数ぶんだけ
 * 「1行目/2行目…」の色スウォッチを出す（行数はテキスト依存＝ハードコードしない）。
 */
export const XpLineColorRows: React.FC<{
  text: string;
  styles?: SlotStyle[];
  onChange(next: SlotStyle[]): void;
}> = ({ text, styles, onChange }) => {
  const lines = text.split("\n");
  if (lines.length < 2) return null;
  return (
    <div className="space-y-1">
      <div className="text-[11px] font-medium text-neutral-400">行ごとの色</div>
      {lines.map((ln, i) => (
        <div key={i} className="flex items-center gap-2">
          <span className="w-12 shrink-0 text-[11px] text-neutral-400">
            {i + 1}行目
          </span>
          <span className="min-w-0 flex-1 truncate text-[11px] text-neutral-500">
            {ln || "（空行）"}
          </span>
          <ColorDot
            value={styles?.[i]?.color}
            onChange={(c) => onChange(withColorAt(styles, [i], c))}
          />
        </div>
      ))}
    </div>
  );
};

export const XpTextSlotsForm: React.FC<{
  spec: XpTextSpec;
  value: string;
  onChange(v: string): void;
  /** 行（\n）単位の色。省略時は色スウォッチを出さない（従来表示） */
  slotStyles?: SlotStyle[];
  onSlotStylesChange?(next: SlotStyle[]): void;
}> = ({ spec, value, onChange, slotStyles, onSlotStylesChange }) => {
  if (spec.kind === "note") {
    return <Hint text={spec.hint} />;
  }

  if (spec.kind === "slots") {
    const sep = spec.sep ?? "\n";
    const raw = value.split(sep);
    // 最後のスロットは残り全部を受ける（複数行OKスロット・区切り文字入り対応）
    const parts = spec.slots.map((_, i) =>
      i === spec.slots.length - 1 ? raw.slice(i).join(sep) : (raw[i] ?? ""),
    );
    const setPart = (idx: number, v: string) => {
      const next = parts.map((p, i) => (i === idx ? v : p));
      // 末尾の空スロットは区切りごと落とす（"a||" を残さない）
      while (next.length > 1 && next[next.length - 1] === "") next.pop();
      onChange(next.join(sep));
    };
    // スロット→描画行indexの対応（sep="|" は1行に並ぶ書式なので行単位色は出さない）
    const lineIndicesOf = (slotIdx: number): number[] => {
      if (sep !== "\n") return [];
      const before = parts.slice(0, slotIdx).join("\n");
      const start = slotIdx === 0 ? 0 : before.split("\n").length;
      const count = Math.max(1, parts[slotIdx].split("\n").length);
      return Array.from({ length: count }, (_, k) => start + k);
    };
    const showColors = sep === "\n" && !!onSlotStylesChange;
    return (
      <div className="space-y-1">
        {spec.slots.map((slot, i) => (
          <div key={i} className="flex items-start gap-2">
            <span className="w-28 shrink-0 pt-1 text-[11px] text-neutral-400">
              {slot.label}
            </span>
            {slot.multiline ? (
              <textarea
                rows={Math.max(1, parts[i].split("\n").length)}
                className={`${fieldCls} resize-none`}
                placeholder={slot.placeholder}
                value={parts[i]}
                onChange={(e) => setPart(i, e.target.value)}
              />
            ) : (
              <input
                className={fieldCls}
                placeholder={slot.placeholder}
                value={parts[i]}
                onChange={(e) => setPart(i, e.target.value)}
              />
            )}
            {showColors && (
              <ColorDot
                value={slotStyles?.[lineIndicesOf(i)[0]]?.color}
                onChange={(c) =>
                  onSlotStylesChange!(
                    withColorAt(slotStyles, lineIndicesOf(i), c),
                  )
                }
              />
            )}
          </div>
        ))}
        {spec.hint && <Hint text={spec.hint} />}
      </div>
    );
  }

  // rows: 可変行 × 固定列（credits名簿）。行= \n / 列= " | " で組み立てる
  const rows = (value.length > 0 ? value.split("\n") : [""]).map((r) =>
    r.split("|").map((s) => s.trim()),
  );
  const commit = (rs: string[][]) =>
    onChange(
      rs
        .map((cells) =>
          cells.every((c) => c === "") ? "" : cells.join(" | "),
        )
        .join("\n"),
    );
  const setCell = (ri: number, ci: number, v: string) => {
    const rs = rows.map((r) => [...r]);
    while (rs[ri].length < spec.columns.length) rs[ri].push("");
    rs[ri][ci] = v;
    commit(rs);
  };
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2">
        <span className="w-6 shrink-0" />
        {spec.columns.map((c, i) => (
          <span key={i} className="flex-1 text-[11px] text-neutral-400">
            {c.label}
          </span>
        ))}
        <span className="w-6 shrink-0" />
      </div>
      {rows.map((cells, ri) => (
        <div key={ri} className="flex items-center gap-2">
          <span className="w-6 shrink-0 text-right text-[11px] text-neutral-500">
            {ri + 1}
          </span>
          {spec.columns.map((col, ci) => (
            <input
              key={ci}
              className={`${fieldCls} flex-1`}
              placeholder={col.placeholder}
              value={cells[ci] ?? ""}
              onChange={(e) => setCell(ri, ci, e.target.value)}
            />
          ))}
          {onSlotStylesChange && (
            <ColorDot
              value={slotStyles?.[ri]?.color}
              onChange={(c) =>
                onSlotStylesChange(withColorAt(slotStyles, [ri], c))
              }
            />
          )}
          <Button
            size="sm"
            variant="ghost"
            className="h-6 w-6 shrink-0 p-0 text-neutral-500 hover:text-red-400"
            title="この行を削除"
            onClick={() => commit(rows.filter((_, i) => i !== ri))}
          >
            <X className="size-3" />
          </Button>
        </div>
      ))}
      <div className="flex items-center justify-between">
        <Button
          size="sm"
          variant="outline"
          className="h-6 gap-1 text-[11px]"
          onClick={() => commit([...rows, spec.columns.map(() => "")])}
        >
          <Plus className="size-3" />
          行を追加
        </Button>
        {spec.hint && <Hint text={spec.hint} />}
      </div>
    </div>
  );
};
