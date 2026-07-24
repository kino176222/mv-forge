"use client";
import { Mic, Sparkles, Lightbulb, Play, Clock } from "lucide-react";
import React from "react";
import { useEditor } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Slider } from "@/components/ui/slider";
import { toast } from "sonner";
import { FISH_VOICE_PRESETS } from "@/lib/fish-voices";

/**
 * 🎙️ 朗読生成（Fish Audio S2-Pro）。
 * レシピ（テキスト・声・パラメータ）は project.prologue.gen に保存され、
 * 生成テイクは narration/ に溜まる。採用で prologue.mp3 に反映。
 *
 * 運用の学び（いとエモし検証より）:
 * - エモさの主源泉は声モデル選び。タグは微調整装置
 * - 演出は冒頭に一括指示＋タメが欲しい箇所にだけ [pause]（刻むとパッチワークになる）
 * - 日本語はタグ発火が不安定 → 複数テイク生成して選抜が前提
 */

const DEFAULT_SCRIPT = `[深夜にひとりで囁くように、ゆっくりと切なく、余韻を残しながら詩を朗読する] ここに詩を書く。 [pause] タメたい言葉の前にだけポーズを置く。`;

export const NarrationGen: React.FC = () => {
  const project = useEditor((s) => s.project);
  const projectName = useEditor((s) => s.projectName);
  const mutate = useEditor((s) => s.mutate);

  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [voices, setVoices] = React.useState<
    { id: string; title: string; taskCount: number }[]
  >([]);
  const [searching, setSearching] = React.useState(false);
  const [generating, setGenerating] = React.useState(false);
  const [suggesting, setSuggesting] = React.useState(false);
  const [suggestReason, setSuggestReason] = React.useState("");
  const [voiceQueries, setVoiceQueries] = React.useState<string[]>([]);
  const [takes, setTakes] = React.useState<
    {
      file: string;
      mtime: number;
      silences: { at: number; dur: number }[];
      kind: "tts" | "rec" | "vc" | null;
      voiceName: string | null;
    }[]
  >([]);
  const audioRefs = React.useRef<Record<string, HTMLAudioElement | null>>({});
  const [durations, setDurations] = React.useState<Record<string, number>>({});
  const [silence, setSilence] = React.useState<{
    file: string;
    at: number;
    dur: number;
  } | null>(null);
  const [inserting, setInserting] = React.useState(false);
  const [playhead, setPlayhead] = React.useState<{
    file: string;
    t: number;
  } | null>(null);
  const [sampling, setSampling] = React.useState<string | null>(null);
  const sampleAudio = React.useRef<HTMLAudioElement | null>(null);

  const refreshTakes = React.useCallback(async () => {
    const res = await fetch(
      `/api/narration?project=${encodeURIComponent(projectName)}`,
    );
    if (res.ok) setTakes((await res.json()).takes ?? []);
  }, [projectName]);

  React.useEffect(() => {
    void refreshTakes();
    // 録音・ボイチェン（RecordVoiceChange）側でテイクが増えたら追従
    const onChanged = () => void refreshTakes();
    window.addEventListener("mvforge:takes-changed", onChanged);
    return () => window.removeEventListener("mvforge:takes-changed", onChanged);
  }, [refreshTakes]);

  if (!project) return null;
  const gen = project.prologue.gen;

  const search = async (q?: string) => {
    const term = (q ?? query).trim();
    if (!term) return;
    if (q) setQuery(q);
    setSearching(true);
    try {
      const res = await fetch(
        `/api/narration/voices?q=${encodeURIComponent(term)}`,
      );
      const d = await res.json();
      if (!res.ok) throw new Error(d.error);
      setVoices(d.voices ?? []);
      if ((d.voices ?? []).length === 0) toast.info("日本語対応の声が見つかりません");
    } catch (e) {
      toast.error(String(e instanceof Error ? e.message : e));
    } finally {
      setSearching(false);
    }
  };

  const playSample = async (voiceId: string) => {
    setSampling(voiceId);
    try {
      const res = await fetch("/api/narration/voice-sample", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project: projectName, voiceId }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error);
      sampleAudio.current?.pause();
      const a = new Audio(
        `/api/asset?project=${encodeURIComponent(projectName)}&file=${encodeURIComponent(d.file)}`,
      );
      sampleAudio.current = a;
      void a.play();
    } catch (e) {
      toast.error(String(e instanceof Error ? e.message : e));
    } finally {
      setSampling(null);
    }
  };

  const suggest = async () => {
    setSuggesting(true);
    try {
      const res = await fetch("/api/narration/suggest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project: projectName }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error);
      const s = d.suggestion;
      mutate((prj) => {
        prj.prologue.gen.script = s.script;
        prj.prologue.gen.temperature = s.temperature;
        prj.prologue.gen.speed = s.speed;
      });
      setVoiceQueries(s.voiceQueries ?? []);
      setSuggestReason(s.reason ?? "");
      toast.success("AI提案を台本とパラメータに反映しました");
    } catch (e) {
      toast.error(String(e instanceof Error ? e.message : e));
    } finally {
      setSuggesting(false);
    }
  };

  const generate = async () => {
    if (!gen.voiceId) {
      toast.error("先に声モデルを選んでください");
      return;
    }
    setGenerating(true);
    try {
      const res = await fetch("/api/narration", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          project: projectName,
          text: gen.script,
          referenceId: gen.voiceId,
          voiceLabel: gen.voiceLabel,
          temperature: gen.temperature,
          speed: gen.speed,
          takes: 2,
        }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error);
      toast.success(`${d.files.length}テイク生成しました`);
      await refreshTakes();
    } catch (e) {
      toast.error(String(e instanceof Error ? e.message : e));
    } finally {
      setGenerating(false);
    }
  };

  // 間の編集（挿入/削除）: テイク本体がその場で更新される（新ファイルは作らない）
  const editGap = async (
    file: string,
    op:
      | { type: "insert"; at: number; dur: number }
      | { type: "delete"; index: number },
  ) => {
    setInserting(true);
    try {
      const res = await fetch("/api/narration/gaps", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project: projectName, file, op }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error);
      toast.success(
        op.type === "insert"
          ? "間を挿入しました（このテイクが更新されました）"
          : "間を削除しました",
      );
      setSilence(null);
      await refreshTakes();
      audioRefs.current[file]?.load(); // 音声が差し替わったので再読込
      if (gen.adoptedTake === file) await adopt(file); // 採用中なら prologue.mp3 も追従
    } catch (e) {
      toast.error(String(e instanceof Error ? e.message : e));
    } finally {
      setInserting(false);
    }
  };

  const insertSilence = async () => {
    if (!silence) return;
    await editGap(silence.file, {
      type: "insert",
      at: silence.at,
      dur: silence.dur,
    });
  };

  const deleteSilence = async (
    file: string,
    index: number,
    s: { at: number; dur: number },
  ) => {
    if (!window.confirm(`${s.at.toFixed(1)}秒の間（${s.dur}秒）を削除しますか？`))
      return;
    await editGap(file, { type: "delete", index });
  };

  const adopt = async (file: string) => {
    try {
      const res = await fetch("/api/narration/adopt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project: projectName, file }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error);
      mutate((prj) => {
        prj.prologue.audioFile = d.audioFile;
        prj.prologue.duration = d.duration;
        prj.prologue.gen.adoptedTake = file;
      });
      toast.success(`採用しました（${d.duration.toFixed(1)}s）`);
    } catch (e) {
      toast.error(String(e instanceof Error ? e.message : e));
    }
  };

  return (
    <div className="rounded border border-neutral-800">
      <button
        className="flex w-full items-center justify-between px-3 py-2 text-xs font-medium text-neutral-200 hover:bg-neutral-900"
        onClick={() => setOpen((v) => !v)}
      >
        <span>
          {open ? "▾" : "▸"} <Mic className="inline size-3.5" /> 朗読を生成する（Fish Audio S2-Pro / AI提案つき）
        </span>
        <span className="text-neutral-500">
          {gen.voiceLabel && `${gen.voiceLabel} ・ `}
          {takes.length > 0 && `${takes.length}テイク`}
        </span>
      </button>
      {open && (
        <div className="space-y-3 border-t border-neutral-800 p-3">

      {/* ✨ AIレコメンド: 詩から台本・声・パラメータを提案 */}
      <Button
        size="sm"
        variant="outline"
        className="w-full"
        disabled={suggesting}
        onClick={() => void suggest()}
      >
        {suggesting ? (
          "AIが演出を考え中…（30秒〜1分）"
        ) : (
          <>
            <Sparkles className="size-3.5" /> AIに演出を提案してもらう（詩→台本・声・パラメータ）
          </>
        )}
      </Button>
      {suggestReason && (
        <p className="text-[10px] leading-relaxed text-neutral-400">
          <Lightbulb className="inline size-3" /> {suggestReason}
        </p>
      )}
      {voiceQueries.length > 0 && (
        <div className="flex flex-wrap items-center gap-1">
          <span className="text-[10px] text-neutral-500">おすすめの声検索:</span>
          {voiceQueries.map((q) => (
            <button
              key={q}
              className="rounded-full border border-neutral-700 px-2 py-0.5 text-[10px] text-neutral-300 hover:bg-neutral-800"
              onClick={() => void search(q)}
            >
              {q}
            </button>
          ))}
        </div>
      )}

      {/* プリセットの声（厳選リスト）: クリックで選択、▶で試聴 */}
      <div>
        <div className="mb-1 text-xs text-neutral-400">
          声を選ぶ（再生ボタンで試聴・初回のみ生成）
        </div>
        <div className="grid grid-cols-2 gap-1">
          {FISH_VOICE_PRESETS.map((v) => (
            <div
              key={v.id}
              className={`flex items-center gap-1 rounded border px-2 py-1 ${
                gen.voiceId === v.id
                  ? "border-amber-500/70 bg-amber-500/10"
                  : "border-neutral-800 hover:bg-neutral-900"
              }`}
            >
              <button
                className="min-w-0 flex-1 text-left"
                onClick={() =>
                  mutate((prj) => {
                    prj.prologue.gen.voiceId = v.id;
                    prj.prologue.gen.voiceLabel = v.title;
                  })
                }
              >
                <div className="truncate text-xs text-neutral-200">
                  {gen.voiceId === v.id && "✓ "}
                  {v.title}
                </div>
                <div className="truncate text-[10px] text-neutral-500">{v.note}</div>
              </button>
              <Button
                size="sm"
                variant="ghost"
                className="h-6 w-7 shrink-0 p-0 text-xs"
                title="試聴"
                disabled={sampling === v.id}
                onClick={() => void playSample(v.id)}
              >
                {sampling === v.id ? "…" : <Play className="size-3 fill-current" />}
              </Button>
            </div>
          ))}
        </div>
      </div>

      {/* 声モデル検索 */}
      <div className="flex items-center gap-2">
        <span className="w-28 shrink-0 text-xs text-neutral-400">他を探す</span>
        <Input
          className="h-8 flex-1 text-xs"
          placeholder="例: 切ない / 囁き / 朗読 女性"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void search()}
        />
        <Button
          size="sm"
          variant="outline"
          className="h-8"
          disabled={searching}
          onClick={() => void search()}
        >
          {searching ? "検索中…" : "検索"}
        </Button>
      </div>
      {voices.length > 0 && (
        <div className="max-h-28 space-y-1 overflow-y-auto">
          {voices.map((v) => (
            <button
              key={v.id}
              className={`block w-full rounded px-2 py-1 text-left text-xs hover:bg-neutral-800 ${
                gen.voiceId === v.id ? "bg-neutral-800 text-white" : "text-neutral-400"
              }`}
              onClick={() =>
                mutate((prj) => {
                  prj.prologue.gen.voiceId = v.id;
                  prj.prologue.gen.voiceLabel = v.title;
                })
              }
            >
              {v.title}
              <span className="ml-2 text-[10px] text-neutral-500">
                利用{v.taskCount}回
              </span>
            </button>
          ))}
        </div>
      )}
      {gen.voiceLabel && (
        <div className="text-xs text-neutral-400">
          選択中: <span className="text-neutral-200">{gen.voiceLabel}</span>
        </div>
      )}

      {/* タグ入りテキスト */}
      <Textarea
        className="h-32 font-mono text-xs"
        placeholder={DEFAULT_SCRIPT}
        value={gen.script}
        onChange={(e) =>
          mutate((prj) => {
            prj.prologue.gen.script = e.target.value;
          })
        }
      />
      <p className="text-[10px] leading-relaxed text-neutral-500">
        冒頭に [演出の一括指示]、タメたい語の直前にだけ [pause]。刻みすぎると不自然になる。
      </p>

      {/* パラメータ */}
      <div className="flex items-center gap-2">
        <span className="w-28 shrink-0 text-xs text-neutral-400">表現力</span>
        <Slider
          className="flex-1"
          min={0.3}
          max={1}
          step={0.05}
          value={[gen.temperature]}
          onValueChange={([v]) =>
            mutate((prj) => {
              prj.prologue.gen.temperature = v;
            })
          }
        />
        <span className="w-10 text-right font-mono text-xs">
          {gen.temperature.toFixed(2)}
        </span>
      </div>
      <div className="flex items-center gap-2">
        <span className="w-28 shrink-0 text-xs text-neutral-400">話速</span>
        <Slider
          className="flex-1"
          min={0.5}
          max={1.5}
          step={0.05}
          value={[gen.speed]}
          onValueChange={([v]) =>
            mutate((prj) => {
              prj.prologue.gen.speed = v;
            })
          }
        />
        <span className="w-10 text-right font-mono text-xs">
          {gen.speed.toFixed(2)}
        </span>
      </div>

      <Button
        size="sm"
        className="w-full"
        disabled={generating || !gen.script.trim()}
        onClick={() => void generate()}
      >
        {generating ? "生成中…（2テイク・30秒ほど）" : "2テイク生成"}
      </Button>

      {/* テイク一覧 */}
      {takes.length > 0 && (
        <div className="space-y-2">
          <div className="text-xs text-neutral-400">
            テイク（新しい順・聴いて採用）
          </div>
          {takes.map((t) => {
            const f = t.file;
            const total = durations[f] ?? 0;
            return (
            <div
              key={f}
              className={`space-y-1 rounded px-1 py-0.5 ${
                gen.adoptedTake === f
                  ? "border border-amber-500/70 bg-amber-500/10"
                  : ""
              }`}
            >
              {gen.adoptedTake === f && (
                <div className="px-1 text-[10px] font-medium text-amber-400">
                  ✓ 採用中（prologue.mp3）
                </div>
              )}
              {/* 出自バッジ（台帳から。旧テイクはファイル名でフォールバック） */}
              {(t.kind === "rec" ||
                (!t.kind && f.startsWith("narration/take_rec_"))) && (
                <div className="px-1 text-[10px] text-neutral-500">🎙 生録音</div>
              )}
              {(t.kind === "vc" ||
                (!t.kind && f.startsWith("narration/take_vc_"))) && (
                <div className="px-1 text-[10px] text-violet-400">
                  🎭 ボイチェン{t.voiceName ? `（${t.voiceName}）` : ""}
                </div>
              )}
              <div className="flex items-center gap-2">
                <audio
                  controls
                  preload="metadata"
                  className="h-8 min-w-0 flex-1"
                  style={{ colorScheme: "dark" }}
                  ref={(el) => {
                    audioRefs.current[f] = el;
                  }}
                  onLoadedMetadata={(e) => {
                    // currentTargetはハンドラ終了後nullになるため、setStateの外で先に読む
                    const dur = e.currentTarget.duration;
                    setDurations((d) => ({ ...d, [f]: dur }));
                  }}
                  onPause={(e) => {
                    // 一時停止 = その位置に間を入れる、の体験（再生し切った時は出さない）
                    const el = e.currentTarget;
                    if (el.ended || el.currentTime === 0) return;
                    setSilence({
                      file: f,
                      at: Math.round(el.currentTime * 10) / 10,
                      dur: silence?.dur ?? 1.5,
                    });
                  }}
                  onTimeUpdate={(e) => {
                    const t = e.currentTarget.currentTime;
                    setPlayhead({ file: f, t });
                  }}
                  src={`/api/asset?project=${encodeURIComponent(projectName)}&file=${encodeURIComponent(f)}&v=${t.mtime}`}
                />
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 shrink-0 text-xs"
                  title="現在の再生位置に間を挿入"
                  onClick={() =>
                    setSilence({
                      file: f,
                      at:
                        Math.round(
                          (audioRefs.current[f]?.currentTime ?? 0) * 10,
                        ) / 10,
                      dur: silence?.dur ?? 1.5,
                    })
                  }
                >
                  間+
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 shrink-0 text-xs"
                  onClick={() => void adopt(f)}
                >
                  採用
                </Button>
              </div>
              {/* タイムライン: 全長=音声全体。白線=再生位置 / アンバー=間（クリックで削除）/ 灰色クリック=頭出し */}
              {total > 0 && (
                <div
                  className="relative mx-1 h-2.5 cursor-pointer overflow-hidden rounded bg-neutral-800"
                  title="クリック=頭出し / アンバー（間）クリック=削除"
                  onClick={(e) => {
                    const rect = e.currentTarget.getBoundingClientRect();
                    const ratio = (e.clientX - rect.left) / rect.width;
                    const el = audioRefs.current[f];
                    if (el) el.currentTime = ratio * total;
                  }}
                >
                  {t.silences.map((s, i) => (
                    <div
                      key={i}
                      className="absolute top-0 h-full rounded bg-amber-500 hover:bg-red-500"
                      title={`間 ${s.dur}s（クリックで削除）`}
                      style={{
                        left: `${(s.at / total) * 100}%`,
                        width: `${Math.max((s.dur / total) * 100, 1.5)}%`,
                      }}
                      onClick={(e) => {
                        e.stopPropagation();
                        void deleteSilence(f, i, s);
                      }}
                    />
                  ))}
                  {playhead?.file === f && (
                    <div
                      className="pointer-events-none absolute top-0 h-full w-0.5 bg-white"
                      style={{ left: `${(playhead.t / total) * 100}%` }}
                    />
                  )}
                </div>
              )}
              {silence?.file === f && (
                <div className="flex items-center gap-2 rounded border border-neutral-800 px-2 py-1 text-xs">
                  <span className="text-neutral-400">位置</span>
                  <Input
                    type="number"
                    step={0.1}
                    min={0}
                    className="h-6 w-20 text-xs"
                    value={silence.at}
                    onChange={(e) =>
                      setSilence({ ...silence, at: Number(e.target.value) })
                    }
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-6 shrink-0 text-[10px]"
                    title="プレーヤーの現在位置を「位置」に反映"
                    onClick={() =>
                      setSilence({
                        ...silence,
                        at:
                          Math.round(
                            (audioRefs.current[f]?.currentTime ?? 0) * 10,
                          ) / 10,
                      })
                    }
                  >
                    <Clock className="size-3" /> 現在位置
                  </Button>
                  <span className="text-neutral-400">秒に、無音</span>
                  <Input
                    type="number"
                    step={0.5}
                    min={0.5}
                    max={15}
                    className="h-6 w-16 text-xs"
                    value={silence.dur}
                    onChange={(e) =>
                      setSilence({ ...silence, dur: Number(e.target.value) })
                    }
                  />
                  <span className="text-neutral-400">秒</span>
                  <Button
                    size="sm"
                    className="h-6 text-xs"
                    disabled={inserting}
                    onClick={() => void insertSilence()}
                  >
                    {inserting ? "挿入中…" : "挿入"}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 text-xs"
                    onClick={() => setSilence(null)}
                  >
                    ×
                  </Button>
                </div>
              )}
            </div>
            );
          })}
        </div>
      )}
        </div>
      )}
    </div>
  );
};
