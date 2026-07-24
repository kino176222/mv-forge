import React from "react";

/**
 * 行（\n）単位スタイル（XpTitleProps.lineStyles と同形）。
 * index=描画行。未設定行は部品の color prop → デザイン既定の順でフォールバック。
 */
export type XpLineStyle = { color?: string };

/** lineStyles に有効な上書きが1つでもあるか（無ければ従来経路のまま＝回帰ゼロ） */
export const hasLineStyles = (lineStyles?: XpLineStyle[]): boolean =>
  !!lineStyles && lineStyles.some((s) => !!s?.color);

/**
 * text を \n 行に分割し、行ごとに lineStyles[i].color を適用して返す。
 * 上書きが無い場合は text をそのまま返す（span を挟まない＝従来と同一の描画）。
 * whiteSpace: pre / pre-wrap のコンテナ内で使う想定（\n テキストノードで改行を維持）。
 */
export function renderStyledLines(
  text: string,
  lineStyles?: XpLineStyle[],
): React.ReactNode {
  if (!hasLineStyles(lineStyles)) return text;
  const lines = String(text).split("\n");
  return lines.map((ln, i) => {
    const c = lineStyles?.[i]?.color;
    return (
      <React.Fragment key={i}>
        {i > 0 ? "\n" : null}
        {c ? <span style={{ color: c }}>{ln}</span> : ln}
      </React.Fragment>
    );
  });
}
