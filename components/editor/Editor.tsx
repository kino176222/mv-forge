"use client";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useEditor } from "@/lib/store";
import { togglePlay, seekToFrame, playerRef, usePlayback } from "@/lib/player-bridge";
import { deriveTimeline, lineTime, toFrames } from "@/lib/sections";
import { TopBar } from "./TopBar";
import { LinesTable } from "./LinesTable";
import { PlayerPanel } from "./PlayerPanel";
import { Waveform } from "./Waveform";
import { DetailPanel } from "./DetailPanel";
import { AiPane } from "./AiPane";
import { AssetStrip, type AssetPos } from "./AssetStrip";
import { JobsTray } from "./JobsTray";
import { ProloguePanel } from "./ProloguePanel";
import { OutroPanel } from "./OutroPanel";
import { ShortsPanel } from "./ShortsPanel";
import { Toaster } from "@/components/ui/sonner";

/**
 * エディタ本体（§10: 3ペイン＋帯）。
 * 動線: 左の歌詞を上から眺める → 下の帯から絵をD&D → 中下で調整 →
 * 中上プレビューで確認 → 次の行へ。
 */
/** localStorageから幅(px)を読む（範囲外/未設定は既定値）。SSRでは既定値。 */
const readW = (key: string, def: number, min: number, max: number): number => {
  if (typeof window === "undefined") return def;
  const w = Number(localStorage.getItem(key));
  return w >= min && w <= max ? w : def;
};

export const Editor: React.FC<{ projectName: string }> = ({ projectName }) => {
  const init = useEditor((s) => s.init);
  const setAssets = useEditor((s) => s.setAssets);
  const project = useEditor((s) => s.project);
  const dirty = useEditor((s) => s.dirty);
  const tab = useEditor((s) => s.tab);
  // 「どのプロジェクトを読み込み済みか」で持つ＝切り替えた瞬間に derived で false になる。
  // （プロジェクト取り違え事故の対策。setStateを効果の頭で叩かずに済む）
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const loaded = loadedFor === projectName;
  const [saving, setSaving] = useState(false);
  const [savedDirty, setSavedDirty] = useState(0); // 最後に保存できた時点のdirty値
  const [error, setError] = useState<string | null>(null);
  // UIレイアウト設定（好みはlocalStorageに永続化。SSRでは既定値）
  const [aiOpen, setAiOpen] = useState(
    () => typeof window === "undefined" || localStorage.getItem("mvforge:aiOpen") !== "0",
  );
  const [detailH, setDetailH] = useState(() => {
    if (typeof window === "undefined") return 300;
    const h = Number(localStorage.getItem("mvforge:detailH"));
    return h >= 140 ? h : 300;
  });
  const toggleAi = (v: boolean) => {
    setAiOpen(v);
    localStorage.setItem("mvforge:aiOpen", v ? "1" : "0");
  };
  // 素材帯の置き場所（左端/ﾌﾟﾚ左/ﾌﾟﾚ右/下）。好みはlocalStorageに永続化。既定=下
  const [assetPos, setAssetPos] = useState<AssetPos>(() => {
    if (typeof window === "undefined") return "bottom";
    const v = localStorage.getItem("mvforge:assetPos");
    return v === "far-left" || v === "pre-left" || v === "pre-right" || v === "bottom"
      ? v
      : "bottom";
  });
  const changeAssetPos = (p: AssetPos) => {
    setAssetPos(p);
    localStorage.setItem("mvforge:assetPos", p);
  };
  // 素材帯（縦パネル）の幅。ドラッグで調整・localStorageに永続。
  // 各ペインの幅（ドラッグで調整・localStorage永続）。中央プレビューは残り(1fr)。
  const [assetW, setAssetW] = useState(() => readW("mvforge:assetW", 160, 120, 480));
  const [leftW, setLeftW] = useState(() => readW("mvforge:leftW", 360, 240, 720));
  const [aiW, setAiW] = useState(() => readW("mvforge:aiW", 300, 200, 560));
  // 列境界のドラッグ共通処理。dir=+1:右へドラッグで広がる / -1:左へドラッグで広がる。
  const beginResize = (
    e: React.MouseEvent,
    startW: number,
    dir: number,
    min: number,
    max: number,
    apply: (w: number) => void,
    key: string,
  ) => {
    e.preventDefault();
    const startX = e.clientX;
    let last = startW;
    const onMove = (ev: MouseEvent) => {
      last = Math.min(Math.max(startW + dir * (ev.clientX - startX), min), max);
      apply(last);
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      localStorage.setItem(key, String(Math.round(last)));
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };
  const lastSaved = useRef(0);
  const loadedAt = useRef(0);
  const unsaved = loaded && dirty !== savedDirty;

  // プロジェクトをサーバーから読み込み直してストアへ反映（初期ロード＆スナップショット復元後に共用）。
  // loadedAt/savedDirty のリセットまで行うので、直後の自動保存が正しい基準で動く。
  const reloadProject = useCallback(async () => {
    const [proj, assets] = await Promise.all([
      fetch(`/api/project?name=${encodeURIComponent(projectName)}`).then((r) =>
        r.json(),
      ),
      fetch(`/api/assets?project=${encodeURIComponent(projectName)}`).then((r) =>
        r.json(),
      ),
    ]);
    if (proj.error) throw new Error(proj.error);
    init(projectName, proj.project);
    loadedAt.current = Date.now();
    lastSaved.current = 0;
    setSavedDirty(0);
    if (!assets.error) setAssets(assets);
    setLoadedFor(projectName);
  }, [projectName, init, setAssets]);

  // 現在の編集をディスクへ即flush（スナップショット保存/復元の前に「今」を確定させる）。
  const flushSave = useCallback(async () => {
    const current = useEditor.getState();
    if (!current.project || current.projectName !== projectName) return;
    if (current.dirty === lastSaved.current) return; // 未変更なら何もしない
    const res = await fetch("/api/project", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: projectName,
        project: current.project,
        loadedAt: loadedAt.current,
      }),
    });
    if (res.ok) {
      loadedAt.current = Date.now();
      lastSaved.current = current.dirty;
      setSavedDirty(current.dirty);
    }
  }, [projectName]);

  // 初期ロード
  useEffect(() => {
    (async () => {
      try {
        await reloadProject();
      } catch (e) {
        setError(String(e instanceof Error ? e.message : e));
      }
    })();
  }, [reloadProject]);

  // デバウンス自動保存
  useEffect(() => {
    if (!loaded || dirty === 0 || dirty === lastSaved.current) return;
    const timer = setTimeout(async () => {
      const current = useEditor.getState();
      if (!current.project) return;
      // 🛡️ プロジェクト取り違えガード: 切り替え直後はストアがまだ旧プロジェクトを
      // 持っている窓がある。「保存先の名前」と「ストアの中身の名前」が一致しない
      // 保存は絶対にしない（radioがsample-mvの中身で塗り替えられた事故の再発防止）
      if (current.projectName !== projectName) return;
      setSaving(true);
      try {
        const res = await fetch("/api/project", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: projectName,
            project: current.project,
            loadedAt: loadedAt.current,
          }),
        });
        if (res.status === 409) {
          // 他のタブ/AI処理がファイルを更新済み → 最新を読み直す（上書き事故防止）
          const fresh = await fetch(
            `/api/project?name=${encodeURIComponent(projectName)}`,
          ).then((r) => r.json());
          if (fresh.project) {
            init(projectName, fresh.project);
            loadedAt.current = Date.now();
            setSavedDirty(0);
            toast.warning(
              "他の処理（AI提案・LRC生成など）がプロジェクトを更新したため読み直しました。直前の編集が消えた場合はやり直してください",
              { duration: 8000 },
            );
          }
          return;
        }
        loadedAt.current = Date.now();
        lastSaved.current = current.dirty;
        setSavedDirty(current.dirty);
      } finally {
        setSaving(false);
      }
    }, 800);
    return () => clearTimeout(timer);
  }, [dirty, loaded, projectName]);

  // 未保存のままタブを閉じる事故を防ぐ
  useEffect(() => {
    if (!unsaved) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [unsaved]);

  // ウィンドウにフォーカスが戻ったら素材一覧を取り直す
  // （Finderで images/ に足した画像がリロード無しで素材帯に出るように）
  useEffect(() => {
    if (!loaded) return;
    const onFocus = async () => {
      const assets = await fetch(
        `/api/assets?project=${encodeURIComponent(projectName)}`,
      ).then((r) => r.json());
      if (!assets.error) useEditor.getState().setAssets(assets);
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [loaded, projectName]);

  // キーボード: Space=再生/停止, ↑↓=行移動, ←→=オフセット微調整(Shiftで大), Enter=頭出し再生, ⌘Z=Undo
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return;
      if (target.isContentEditable) return;
      if (e.code === "Space") {
        e.preventDefault();
        togglePlay();
      } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const s = useEditor.getState();
        const next = Math.max(
          0,
          Math.min(
            (s.project?.lines.length ?? 1) - 1,
            s.selectedLine + (e.key === "ArrowDown" ? 1 : -1),
          ),
        );
        s.selectLine(next);
      } else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        // 赤入れの主作業＝タイミング微調整。ビート吸着もそのまま効く
        const s = useEditor.getState();
        const line = s.project?.lines[s.selectedLine];
        if (!line) return;
        e.preventDefault();
        const step = (e.shiftKey ? 0.5 : 0.05) * (e.key === "ArrowRight" ? 1 : -1);
        s.setLineOffsetSnapped(
          s.selectedLine,
          Math.round((line.offset + step) * 100) / 100,
        );
      } else if (e.key === "Enter") {
        // 選択行の頭出し再生（調整→すぐ確認のループを高速化）
        const s = useEditor.getState();
        const line = s.project?.lines[s.selectedLine];
        if (!line || !s.project) return;
        e.preventDefault();
        const timeline = deriveTimeline(s.project);
        seekToFrame(
          toFrames(timeline.songStart + lineTime(line), s.project.meta.fps),
        );
        playerRef.current?.play();
      } else if (
        e.key.toLowerCase() === "s" &&
        !e.metaKey &&
        !e.ctrlKey &&
        !e.altKey
      ) {
        // 聴きながら分割: 再生ヘッドが今乗っている行を、その位置で2行に割る。
        // 選択行ではなく「鳴っている行」を切るのが再生中の自然な操作。
        e.preventDefault();
        const s = useEditor.getState();
        if (!s.project) return;
        const timeline = deriveTimeline(s.project);
        const songSec =
          usePlayback.getState().frame / s.project.meta.fps - timeline.songStart;
        const lines = s.project.lines;
        let idx = -1;
        for (let i = 0; i < lines.length; i++) {
          const start = lineTime(lines[i]);
          const next = lines[i + 1] ? lineTime(lines[i + 1]) : Infinity;
          if (songSec >= start && songSec < next) {
            idx = i;
            break;
          }
        }
        if (idx < 0) return; // 前奏など、どの行にも乗っていない
        const line = lines[idx];
        if ([...line.lyricText].length < 2) return; // 1文字以下は割れない
        const start = lineTime(line);
        const end = lines[idx + 1] ? lines[idx + 1].startTime : start + 4;
        s.splitLine(idx, Math.min(Math.max(songSec, start + 0.01), end - 0.01));
        s.selectLine(idx);
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) useEditor.temporal.getState().redo();
        else useEditor.temporal.getState().undo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (error) {
    return (
      <div className="flex h-screen items-center justify-center text-sm text-red-400">
        読み込みエラー: {error}
      </div>
    );
  }
  if (!loaded || !project) {
    return (
      <div className="flex h-screen items-center justify-center text-sm text-neutral-500">
        読み込み中…
      </div>
    );
  }

  // 素材帯の配置に応じた列幅テンプレートと、各カラムの視覚順(CSS grid order)。
  // JSXは動かさず order だけで並べ替える（プレビュー等の再マウントを避ける）。
  const assetTok = `${assetW}px`;
  const leftTok = `${leftW}px`;
  const midTok = "minmax(280px,1fr)";
  const aiTok = aiOpen ? `${aiW}px` : "28px";
  const L = {
    "far-left": { asset: 0, lyrics: 1, preview: 2, ai: 3, cols: `${assetTok} ${leftTok} ${midTok} ${aiTok}` },
    "pre-left": { asset: 1, lyrics: 0, preview: 2, ai: 3, cols: `${leftTok} ${assetTok} ${midTok} ${aiTok}` },
    "pre-right": { asset: 2, lyrics: 0, preview: 1, ai: 3, cols: `${leftTok} ${midTok} ${assetTok} ${aiTok}` },
    "bottom": { asset: 0, lyrics: 0, preview: 1, ai: 2, cols: `${leftTok} ${midTok} ${aiTok}` },
  }[assetPos];

  return (
    <div className="flex h-screen flex-col bg-neutral-950 text-neutral-100">
      <TopBar
        saving={saving}
        unsaved={unsaved}
        flushSave={flushSave}
        reloadProject={reloadProject}
      />
      <div className="grid min-h-0 flex-1" style={{ gridTemplateColumns: L.cols }}>
        {/* 素材帯（side配置=縦パネル）。bottom のときは下に横帯で出す（このカラムは無し） */}
        {assetPos !== "bottom" && (
          <div
            className="flex min-h-0 border-r border-neutral-800 bg-neutral-950/60"
            style={{ order: L.asset }}
          >
            {assetPos === "pre-right" && (
              <div
                className="w-1 shrink-0 cursor-col-resize bg-neutral-900 transition-colors hover:bg-neutral-600"
                title="ドラッグで素材帯の幅を調整"
                onMouseDown={(e) =>
                  beginResize(e, assetW, -1, 120, 480, setAssetW, "mvforge:assetW")
                }
              />
            )}
            <div className="min-w-0 flex-1">
              <AssetStrip pos={assetPos} onPos={changeAssetPos} />
            </div>
            {assetPos !== "pre-right" && (
              <div
                className="w-1 shrink-0 cursor-col-resize bg-neutral-900 transition-colors hover:bg-neutral-600"
                title="ドラッグで素材帯の幅を調整"
                onMouseDown={(e) =>
                  beginResize(e, assetW, 1, 120, 480, setAssetW, "mvforge:assetW")
                }
              />
            )}
          </div>
        )}
        {/* 左: 歌詞行の一覧表（主役） or タブごとのパネル。右端ハンドルで幅調整 */}
        <div
          className="flex min-h-0 border-r border-neutral-800 bg-neutral-950/60"
          style={{ order: L.lyrics }}
        >
          <div className="min-w-0 flex-1">
            {tab === "main" && <LinesTable />}
            {tab === "prologue" && <ProloguePanel />}
            {tab === "outro" && <OutroPanel />}
            {tab === "shorts" && <ShortsPanel />}
          </div>
          <div
            className="w-1 shrink-0 cursor-col-resize bg-neutral-900 transition-colors hover:bg-neutral-600"
            title="ドラッグで歌詞ペインの幅を調整"
            onMouseDown={(e) =>
              beginResize(e, leftW, 1, 240, 720, setLeftW, "mvforge:leftW")
            }
          />
        </div>
        {/* 中央: プレビュー（でっかく固定）＋波形＋詳細設定（高さはスプリッタで調整可） */}
        <div
          className="flex min-h-0 flex-col overflow-hidden border-r border-neutral-800"
          style={{ order: L.preview }}
        >
          <PlayerPanel />
          <Waveform />
          {/* ⇕ スプリッタ: 波形と詳細の境目をドラッグで上下（詳細が手狭い問題の緩和） */}
          <div
            className="group flex h-2 shrink-0 cursor-row-resize items-center justify-center bg-neutral-900 hover:bg-neutral-700"
            title="ドラッグで詳細パネルの高さを調整"
            onMouseDown={(e) => {
              e.preventDefault();
              const startY = e.clientY;
              const startH = detailH;
              const onMove = (ev: MouseEvent) => {
                const next = Math.min(
                  Math.max(startH + (startY - ev.clientY), 140),
                  window.innerHeight * 0.7,
                );
                setDetailH(next);
              };
              const onUp = () => {
                window.removeEventListener("mousemove", onMove);
                window.removeEventListener("mouseup", onUp);
                setDetailH((h) => {
                  localStorage.setItem("mvforge:detailH", String(Math.round(h)));
                  return h;
                });
              };
              window.addEventListener("mousemove", onMove);
              window.addEventListener("mouseup", onUp);
            }}
          >
            <div className="h-0.5 w-10 rounded bg-neutral-600 group-hover:bg-neutral-400" />
          </div>
          {/* 詳細パネル: 余裕があれば detailH ちょうど、足りなければ縮んで内部スクロール
              （固定高 shrink-0 だと下段素材帯にはみ出して重なるため flex で縮小可に） */}
          <div
            className="min-h-0 overflow-y-auto"
            style={{ flex: `0 1 ${detailH}px` }}
          >
            <DetailPanel />
          </div>
        </div>
        {/* 右: AI参謀ペイン（開閉式。開いてる時は左端ハンドルで幅調整） */}
        <div className="flex min-h-0 bg-neutral-950/60" style={{ order: L.ai }}>
          {aiOpen && (
            <div
              className="w-1 shrink-0 cursor-col-resize bg-neutral-900 transition-colors hover:bg-neutral-600"
              title="ドラッグでAI参謀ペインの幅を調整"
              onMouseDown={(e) =>
                beginResize(e, aiW, -1, 200, 560, setAiW, "mvforge:aiW")
              }
            />
          )}
          <div className="relative min-w-0 flex-1">
            {aiOpen ? (
              <>
                <button
                  onClick={() => toggleAi(false)}
                  title="AI参謀をたたむ"
                  className="absolute right-2 top-2 z-10 rounded border border-neutral-700 bg-neutral-900 px-1.5 py-0.5 text-[10px] text-neutral-400 hover:text-neutral-100"
                >
                  たたむ »
                </button>
                <AiPane />
              </>
            ) : (
              <button
                onClick={() => toggleAi(true)}
                title="AI参謀をひらく"
                className="flex h-full w-full items-start justify-center pt-3 text-neutral-500 hover:bg-neutral-900 hover:text-amber-300"
              >
                <span
                  className="text-[10px] tracking-widest"
                  style={{ writingMode: "vertical-rl" }}
                >
                  « AI参謀
                </span>
              </button>
            )}
          </div>
        </div>
      </div>
      <JobsTray />
      {assetPos === "bottom" && (
        <AssetStrip pos={assetPos} onPos={changeAssetPos} />
      )}
      <Toaster theme="dark" position="bottom-right" />
    </div>
  );
};
