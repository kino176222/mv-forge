"use client";
import { create } from "zustand";
import { temporal } from "zundo";
import type { Cut, EffectInstance, Line, Project, Short } from "./schema";
import { newLineId, splitLineAt, mergeLines } from "./lrc";
import { snapToMusic } from "./beat-snap";
import { adoptAllSuggestionsInPlace } from "./adopt-suggest";

/**
 * エディタの状態。project の変更だけが Undo/Redo（zundo）の対象。
 * 保存は Editor 側でデバウンス自動保存（PUT /api/project）。
 */

export interface AssetImage {
  file: string;
  hash: string;
  hasDepth: boolean;
  hasSubject: boolean;
}

/** 曲構造（beats.json v2 の拡張フィールド）。旧形式では null。 */
export interface SongStructure {
  bpm?: number;
  downbeats: number[];
  sections: { start: number; end: number; level: string; kind?: string }[];
}

interface EditorState {
  projectName: string;
  project: Project | null;
  assets: {
    images: AssetImage[];
    videos: { file: string; durationSec: number; parent: string | null }[];
    audios: string[];
    lrcs: string[];
  };
  beats: number[];
  /** 小節頭優先の音ハメ＋可視化に使う曲構造（v2）。旧形式では null。 */
  songStructure: SongStructure | null;
  selectedLine: number;
  tab: "prologue" | "main" | "outro" | "shorts";
  /** ショートタブで編集中のショートid（縦プレビューの駆動元） */
  selectedShortId: string | null;
  /** フレーミング調整中の対象キー（行id/カットid）。サムネ選択とプレビュー直接ドラッグで共有 */
  framingKey: string | null;
  dirty: number; // 保存待ちカウンタ（変更のたび++）

  init(projectName: string, project: Project): void;
  setAssets(assets: EditorState["assets"]): void;
  setBeats(beats: number[]): void;
  setSongStructure(structure: SongStructure | null): void;
  selectLine(i: number): void;
  setTab(tab: EditorState["tab"]): void;
  setProject(project: Project): void;
  selectShort(id: string | null): void;
  setFramingKey(key: string | null): void;

  addShort(short: Short): void;
  updateShort(id: string, patch: Partial<Short>): void;
  removeShort(id: string): void;

  /** projectを不変更新する汎用ヘルパー（Undo単位になる） */
  mutate(fn: (draft: Project) => void): void;

  updateLine(index: number, patch: Partial<Line>): void;
  setLineImage(index: number, image: string | null): void;
  addCut(index: number, cut: Cut): void;
  updateCut(index: number, cutId: string, patch: Partial<Cut>): void;
  removeCut(index: number, cutId: string): void;
  swapCutMedia(index: number, cutId: string, dir: "left" | "right"): void;
  setLineOffsetSnapped(index: number, offset: number): void;
  addMarkerLine(startTime: number): void;
  splitLine(index: number, atSec: number): void;
  mergeLine(index: number): void;
  removeLine(index: number): void;
  adoptSuggestion(index: number): void;
  adoptAllSuggestions(): void;
  revertToSuggestion(index: number): void;
}

function clone<T>(v: T): T {
  return structuredClone(v);
}

/**
 * undo履歴の間引き（先頭エッジthrottle）。
 * スライダー・チップドラッグは pointermove ごとに set を呼ぶため、無間引きだと
 * 1ドラッグで履歴limit(100)が押し流され「⌘Zが数px単位でしか戻らない」実害が出る。
 * 連続変更の先頭（＝操作直前の状態）だけを履歴に積むことで ≈1ドラッグ1エントリにする。
 * ストア自体は毎回更新される（ライブプレビューは維持）。
 */
function throttleHandleSet<T extends (...args: never[]) => unknown>(fn: T, ms: number): T {
  let last = 0;
  return ((...args: never[]) => {
    const now = Date.now();
    if (now - last < ms) return;
    last = now;
    return fn(...args);
  }) as T;
}

/** ✂️✂️ カット不変条件の一元強制: at昇順・cuts[0].at=0・line.image=cuts[0].image */
function normalizeCutsDraft(line: Line): void {
  if (line.cuts.length === 0) return;
  line.cuts.sort((a, b) => a.at - b.at);
  line.cuts[0] = { ...line.cuts[0], at: 0 };
  line.image = line.cuts[0].image;
}

export const useEditor = create<EditorState>()(
  temporal(
    (set, get) => ({
      projectName: "",
      project: null,
      assets: { images: [], videos: [], audios: [], lrcs: [] },
      beats: [],
      songStructure: null,
      selectedLine: 0,
      tab: "main",
      selectedShortId: null,
      framingKey: null,
      dirty: 0,

      init: (projectName, project) =>
        set({ projectName, project, selectedLine: 0, selectedShortId: null, framingKey: null, dirty: 0 }),
      setAssets: (assets) => set({ assets }),
      setBeats: (beats) => set({ beats }),
      setSongStructure: (structure) => set({ songStructure: structure }),
      selectLine: (i) => set({ selectedLine: i }),
      setTab: (tab) => set({ tab }),
      setProject: (project) => set({ project, dirty: get().dirty + 1 }),
      selectShort: (id) => set({ selectedShortId: id, framingKey: null }),
      setFramingKey: (key) => set({ framingKey: key }),

      // ショートCRUD（1操作=1 undo。カットCRUDと同パターン）
      addShort: (short) => {
        get().mutate((p) => {
          p.shorts.push(clone(short));
        });
        set({ selectedShortId: short.id });
      },
      updateShort: (id, patch) =>
        get().mutate((p) => {
          p.shorts = p.shorts.map((s) => (s.id === id ? { ...s, ...patch } : s));
        }),
      removeShort: (id) => {
        get().mutate((p) => {
          p.shorts = p.shorts.filter((s) => s.id !== id);
        });
        if (get().selectedShortId === id) set({ selectedShortId: null });
      },

      mutate: (fn) => {
        const project = get().project;
        if (!project) return;
        const draft = clone(project);
        fn(draft);
        set({ project: draft, dirty: get().dirty + 1 });
      },

      updateLine: (index, patch) =>
        get().mutate((p) => {
          p.lines[index] = { ...p.lines[index], ...patch };
        }),

      // 区間の分割・結合セマンティクス（v1.3 A-2）:
      // 画像を途中行に置く＝分割。effectsは各行が持ったままなので、
      // 旧区間の演出は旧先頭行に残り、新区間はまっさらで始まる。
      // ✂️✂️ カット割りとの整合: image を外す＝cuts も全消去。差し替え＝cuts[0].image を同期
      setLineImage: (index, image) =>
        get().mutate((p) => {
          const line = { ...p.lines[index], image };
          if (image === null) line.cuts = [];
          else if (line.cuts.length > 0)
            line.cuts = [{ ...line.cuts[0], image }, ...line.cuts.slice(1)];
          p.lines[index] = line;
        }),

      // ✂️✂️ カットCRUD（1操作=1 undo。不変条件は normalizeCutsDraft で強制）
      addCut: (index, cut) =>
        get().mutate((p) => {
          const line = { ...p.lines[index] };
          if (!line.image) return; // 絵の無い行（継続行）にはカットを作らない
          // 初回: 行直付け値（Lv.1トリム等）から cuts[0] を合成して引き継ぐ
          const seed =
            line.cuts.length === 0
              ? [
                  {
                    id: newLineId(),
                    image: line.image,
                    i2vSource: line.i2vSource,
                    at: 0,
                    trimStart: line.videoTrimStart,
                    trimEnd: line.videoTrimEnd,
                    videoLoop: line.videoLoop,
                    videoRate: line.videoRate,
                    videoAnchor: line.videoAnchor,
                    frameScale: line.frameScale,
                    frameX: line.frameX,
                    frameY: line.frameY,
                    credit: null,
                  },
                ]
              : line.cuts;
          line.cuts = [...seed, cut];
          normalizeCutsDraft(line);
          p.lines[index] = line;
        }),

      updateCut: (index, cutId, patch) =>
        get().mutate((p) => {
          const line = { ...p.lines[index] };
          line.cuts = line.cuts.map((c) => (c.id === cutId ? { ...c, ...patch } : c));
          normalizeCutsDraft(line);
          p.lines[index] = line;
        }),

      removeCut: (index, cutId) =>
        get().mutate((p) => {
          const line = { ...p.lines[index] };
          const rest = line.cuts.filter((c) => c.id !== cutId);
          if (rest.length <= 1) {
            // 1カット以下＝カット割り解除。残った1本の中身を行直付けへ書き戻す（Lv.1に戻る）
            const solo = rest[0];
            line.cuts = [];
            if (solo) {
              line.image = solo.image;
              line.i2vSource = solo.i2vSource;
              line.videoTrimStart = solo.trimStart;
              line.videoTrimEnd = solo.trimEnd;
              line.videoLoop = solo.videoLoop;
              line.videoRate = solo.videoRate;
              line.videoAnchor = solo.videoAnchor;
              // フレーミングも行直付けへ戻す（残る1本がカード1以外でも見た目が保たれる）
              line.frameScale = solo.frameScale;
              line.frameX = solo.frameX;
              line.frameY = solo.frameY;
            }
          } else {
            line.cuts = rest;
            normalizeCutsDraft(line);
          }
          p.lines[index] = line;
        }),

      // 隣のカットと「絵＋トリム等の中身」を交換（atグリッド維持＝音ハメが崩れない）
      swapCutMedia: (index, cutId, dir) =>
        get().mutate((p) => {
          const line = { ...p.lines[index] };
          const sorted = [...line.cuts].sort((a, b) => a.at - b.at);
          const i = sorted.findIndex((c) => c.id === cutId);
          const j = i + (dir === "left" ? -1 : 1);
          if (i === -1 || j < 0 || j >= sorted.length) return;
          const media = ({ at: _at, id: _id, ...rest }: Cut) => rest;
          const a = sorted[i];
          const b = sorted[j];
          sorted[i] = { ...media(b), at: a.at, id: a.id };
          sorted[j] = { ...media(a), at: b.at, id: b.id };
          line.cuts = sorted;
          normalizeCutsDraft(line);
          p.lines[index] = line;
        }),

      setLineOffsetSnapped: (index, offset) => {
        const { beats, songStructure, project } = get();
        if (!project) return;
        // 小節頭優先の音ハメ量子化（beat-snap に一本化）。効き幅0.35s。
        const start = project.lines[index].startTime;
        const snapped = snapToMusic(
          start + offset,
          { beats, downbeats: songStructure?.downbeats },
          0.35,
        );
        const next = Math.round((snapped - start) * 1000) / 1000;
        get().updateLine(index, { offset: next });
      },

      addMarkerLine: (startTime) =>
        get().mutate((p) => {
          const line: Line = {
            id: newLineId(),
            lyricText: "",
            startTime,
            offset: 0,
            words: [],
            behindSubject: false,
            showLyric: true,
            source: "manual",
            image: null,
            i2vSource: null,
            videoLoop: "pingpong",
            videoTrimStart: 0,
            videoTrimEnd: null,
            videoRate: null,
            videoAnchor: "head",
            frameScale: 1,
            frameX: 0,
            frameY: 0,
            effects: [],
            lookOff: false,
            transition: null,
            lyricAnim: null,
            lyricDecor: null,
            charFx: [],
            cuts: [],
            credit: null,
            aiSuggestion: null,
          };
          p.lines.push(line);
          p.lines.sort((a, b) => a.startTime + a.offset - (b.startTime + b.offset));
        }),

      // ③LRC分割: 1行を単語秒スナップで2行に割る（1操作=1 undo）。
      // 後半は継続行として頭情報をリセットし、words[] を正しく分配（splitLineAt）。
      splitLine: (index, atSec) =>
        get().mutate((p) => {
          const line = p.lines[index];
          if (!line) return;
          const pair = splitLineAt(line, atSec);
          if (!pair) return;
          p.lines.splice(index, 1, pair[0], pair[1]);
          p.lines.sort((a, b) => a.startTime + a.offset - (b.startTime + b.offset));
        }),

      // ③の逆: 行 index と次の行 index+1 を1行に結合（words/charFx を併合）。
      mergeLine: (index) =>
        get().mutate((p) => {
          const a = p.lines[index];
          const b = p.lines[index + 1];
          if (!a || !b) return;
          p.lines.splice(index, 2, mergeLines(a, b));
        }),

      removeLine: (index) =>
        get().mutate((p) => {
          if (p.lines[index]?.source === "manual") p.lines.splice(index, 1);
        }),

      adoptSuggestion: (index) =>
        get().mutate((p) => {
          const line = p.lines[index];
          const s = line.aiSuggestion;
          if (!s) return;
          const isHead = line.image !== null || index === 0 || s.imageFile;
          if (s.imageFile && !line.image) line.image = s.imageFile;
          if (isHead) {
            if (s.effects.length > 0) line.effects = clone(s.effects) as EffectInstance[];
            if (s.transition) line.transition = clone(s.transition);
          }
          if (s.lyricAnim) line.lyricAnim = clone(s.lyricAnim);
        }),

      // コピー規則の単一の真実は lib/adopt-suggest.ts（一発出しStep 8と共用）
      adoptAllSuggestions: () => get().mutate((p) => adoptAllSuggestionsInPlace(p)),

      revertToSuggestion: (index) => get().adoptSuggestion(index),
    }),
    {
      partialize: (state) => ({ project: state.project }),
      limit: 100,
      handleSet: (handleSet) => throttleHandleSet(handleSet, 300),
    },
  ),
);
