/**
 * 拡張パック世界（remotion/effects/xp/）と本編エディタ世界（lib/effects-meta.ts）を繋ぐ
 * 唯一の接続点。
 *
 * 設計原則:
 * - 本編側は「EffectMeta を返す何か」しか知らない。将来の配布用クリーンパックも同じ穴に刺さる。
 * - ここは registry-meta.ts（純データ・Remotion非依存）だけを import する。
 *   コンポーネント本体（registry-components.ts）は remotion 世界のアダプタ
 *   （Transitions.tsx 等）側でのみ import する。
 * - 配布ビルドでは NEXT_PUBLIC_MVFORGE_XP=0 で私用部品（旧ポート）だけを切除する。
 *   cleanroom 実装へ張替え済みかつ clean-status=publish の部品は配布でも残る。
 */

import {
  XP_PORT_METAS,
  type XpPortMeta,
} from "@/remotion/effects/xp/registry-meta";
import type { EffectMeta, ParamDef } from "@/lib/effects-meta";
import { FONT_METAS } from "@/lib/fonts-meta";
import { isArchived } from "@/lib/xp/archived";
import { xpCleanStatusOf } from "@/lib/xp/clean-status";
import { isCleanroomBacked } from "@/lib/xp/cleanroom-backed";
import { resolveXpAliasId } from "@/lib/xp/id-aliases";

/** 配布ビルドで 私用部品（旧ポート）を切り落とすフラグ */
export const XP_ENABLED = process.env.NEXT_PUBLIC_MVFORGE_XP !== "0";

/**
 * 配布ビルド(XP=0)でも残せる id か:
 * 非アーカイブ ∧ 配布判定=publish ∧ cleanroom実装へ張替え済み。
 * （旧ポートのままの id は clean-status が publish でも配布物に含めない）
 */
export function isDistributableXpId(id: string): boolean {
  return (
    !isArchived(id) && xpCleanStatusOf(id) === "publish" && isCleanroomBacked(id)
  );
}

/** この橋が露出するメタ一覧（私用=全量／配布=クリーン部品のみ） */
const EXPOSED_PORT_METAS: XpPortMeta[] = XP_ENABLED
  ? XP_PORT_METAS
  : XP_PORT_METAS.filter((m) => isDistributableXpId(m.id));

/** 本編エディタ側での 拡張部品の id プレフィックス（Root.tsx の xp-<id> と一貫） */
export const XP_EFFECT_PREFIX = "xp-";

export function isXpEffectId(id: string): boolean {
  return id.startsWith(XP_EFFECT_PREFIX);
}

/**
 * "xp-tx-cross-fade" → "tx-cross-fade"（registry-meta の素id）。
 * 旧体系idで保存された既存プロジェクトのために、ここで旧→新の別名解決も行う
 * （xp- 剥がしの唯一の関所なので、下流のマップ引きは新idだけを考えればよい）。
 */
export function xpPortIdFromEffectId(id: string): string {
  return resolveXpAliasId(id.slice(XP_EFFECT_PREFIX.length));
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const clamp = (n: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, n));

/**
 * transition ポート → 本編 EffectMeta。
 * params は duration 1個から始める（default = 原尺秒）。resolveParams 経由で
 * transitionFrames() と EffectPicker のつまみが無修正で正しく動くのが急所。
 * 色・強さ等の標準ParamSetは Phase2 パラメータ化（docs/phase2-xp-parameterization.md）で追加。
 */
function transitionToEffectMeta(m: XpPortMeta): EffectMeta {
  const durationSec = clamp(round2(m.durationInFrames / m.fps), 0.2, 3);
  const params: ParamDef[] = [
    {
      key: "duration",
      label: "長さ",
      type: "number",
      min: 0.2,
      max: 3,
      step: 0.05,
      default: durationSec,
      unit: "s",
    },
  ];
  return {
    id: XP_EFFECT_PREFIX + m.id,
    name: m.tagline ? `${m.name}（${m.tagline}）` : m.name,
    category: "transition",
    description: m.description,
    params,
  };
}

/**
 * effect（オーバーレイ）ポート → 本編 EffectMeta。category="overlay"。
 * オーバーレイは区間全体にかかるので長さつまみは持たず、v1のつまみは不透明度1本のみ。
 * 色・位置・強さの本格パラメータ化は Phase2（docs/phase2-xp-parameterization.md）に委ねる。
 */
/** ポート個別の追加つまみ（対応ポートだけ）。tint はポートの基調色差し替え（空=デザイン既定） */
const OVERLAY_EXTRA_PARAMS: Record<string, ParamDef[]> = {
  "fx-color-filter": [
    { key: "tint", label: "色", type: "color", default: "" },
  ],
};

function effectToOverlayMeta(m: XpPortMeta): EffectMeta {
  const params: ParamDef[] = [
    {
      key: "opacity",
      label: "不透明度",
      type: "number",
      min: 0,
      max: 100,
      step: 1,
      default: 100,
      unit: "%",
    },
    ...(OVERLAY_EXTRA_PARAMS[m.id] ?? []),
  ];
  return {
    id: XP_EFFECT_PREFIX + m.id,
    name: m.tagline ? `${m.name}（${m.tagline}）` : m.name,
    category: "overlay",
    description: m.description,
    params,
  };
}

/**
 * subtitle ポート → 本編 EffectMeta。category="lyric"（歌詞演出＝行単位テロップ）。
 * 拡張テロップは「デザインごと使う」（スロット単位レイアウトはポート側固定）。
 * つまみはテロップ丸ごとに効くもの:
 * - font: project=プロジェクトのフォント / design=ポート原設計のフォント（注入しない）/ 各フォントid
 * - scale / offsetX / offsetY: LyricLine のラッパーdivで全体を変形（ポート本体は無改造）
 * - color: 文字色（空=デザイン既定。cleanroom家族部品の color prop へ渡す）
 * 行（\n）単位の色は line.lyricSlotStyles（XpTitleProps.lineStyles 経由）。
 * スロット単位の位置・大きさは Phase2 パラメータ化（docs/phase2-xp-parameterization.md）。
 */
const LYRIC_PARAMS: ParamDef[] = [
  {
    key: "font",
    label: "フォント",
    type: "enum",
    default: "project",
    options: [
      { value: "project", label: "プロジェクトのフォント" },
      { value: "design", label: "デザイン既定" },
      ...FONT_METAS.map((f) => ({ value: f.id, label: f.label })),
    ],
  },
  {
    key: "scale",
    label: "大きさ",
    type: "number",
    min: 0.3,
    max: 2,
    step: 0.05,
    default: 1,
    unit: "x",
  },
  {
    key: "offsetX",
    label: "横位置",
    type: "number",
    min: -40,
    max: 40,
    step: 1,
    default: 0,
    unit: "%",
  },
  {
    key: "offsetY",
    label: "縦位置",
    type: "number",
    min: -40,
    max: 40,
    step: 1,
    default: 0,
    unit: "%",
  },
  {
    key: "color",
    label: "文字色",
    type: "color",
    // 空文字=デザイン既定（ポートへ渡さない）。実測既定色を1つも動かさないための番兵値
    default: "",
  },
  {
    key: "delay",
    label: "出だし遅れ",
    type: "number",
    min: 0,
    max: 10,
    step: 0.1,
    default: 0,
    unit: "s",
  },
  {
    key: "duration",
    label: "表示時間",
    type: "number",
    min: 0, // 0=行末まで
    max: 15,
    step: 0.5,
    default: 0,
    unit: "s",
  },
];

function subtitleToLyricMeta(m: XpPortMeta): EffectMeta {
  return {
    id: XP_EFFECT_PREFIX + m.id,
    name: m.tagline ? `${m.name}（${m.tagline}）` : m.name,
    category: "lyric",
    description: `${m.description}（${m.pack}）`,
    params: LYRIC_PARAMS,
  };
}

/**
 * 本編5軸に流す 拡張部品: transition（切替）＋ effect（オーバーレイ）＋ subtitle（歌詞演出）。
 * title 171本のタイトルレーン化と background 10本は次回以降のスコープ外。
 * category で描画経路が分かれる（transition=TransitionIn / overlay=FxStack / lyric=LyricLine）。
 */
export const XP_BRIDGED_EFFECTS: EffectMeta[] = [
  ...EXPOSED_PORT_METAS.filter(
    (m) => m.category === "transition" && !isArchived(m.id),
  ).map(transitionToEffectMeta),
  ...EXPOSED_PORT_METAS.filter(
    (m) => m.category === "effect" && !isArchived(m.id),
  ).map(effectToOverlayMeta),
  ...EXPOSED_PORT_METAS.filter(
    (m) => m.category === "subtitle" && !isArchived(m.id),
  ).map(subtitleToLyricMeta),
];

/** 素id集合: この橋が overlay として流している effect ポートの素id（FxStack の判定用） */
export const XP_OVERLAY_PORT_IDS: Set<string> = new Set(
  EXPOSED_PORT_METAS.filter((m) => m.category === "effect").map((m) => m.id),
);

/** xp-<id> が overlay として橋渡し済みか（素id/接頭辞付きどちらでも） */
export function isXpOverlayEffectId(id: string): boolean {
  const bare = id.startsWith(XP_EFFECT_PREFIX)
    ? xpPortIdFromEffectId(id)
    : resolveXpAliasId(id);
  return XP_OVERLAY_PORT_IDS.has(bare);
}

/** 素id集合: この橋が lyric（歌詞演出）として流している subtitle ポートの素id */
export const XP_LYRIC_PORT_IDS: Set<string> = new Set(
  EXPOSED_PORT_METAS.filter((m) => m.category === "subtitle").map((m) => m.id),
);

/** xp-<id> が歌詞演出として橋渡し済みか（素id/接頭辞付きどちらでも。LyricLine の分岐判定用） */
export function isXpLyricId(id: string): boolean {
  const bare = id.startsWith(XP_EFFECT_PREFIX)
    ? xpPortIdFromEffectId(id)
    : resolveXpAliasId(id);
  return XP_LYRIC_PORT_IDS.has(bare);
}

const bridgedById = new Map(XP_BRIDGED_EFFECTS.map((e) => [e.id, e]));

/** effects-meta.effectById のフォールバック用 O(1) 解決（旧id別名も解決） */
export function xpBridgedEffectById(id: string): EffectMeta | undefined {
  return bridgedById.get(resolveXpAliasId(id));
}

/** タイトル/クレジットレーン用: title/subtitle のメタ（素idのまま扱う） */
export const XP_TITLE_METAS: XpPortMeta[] = EXPOSED_PORT_METAS.filter(
  (m) =>
    (m.category === "title" || m.category === "subtitle") && !isArchived(m.id),
);

export function xpTitleMetaById(id: string): XpPortMeta | undefined {
  const bare = resolveXpAliasId(id);
  return XP_TITLE_METAS.find((m) => m.id === bare);
}
