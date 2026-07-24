"use client";
import { Mic, Square, RotateCcw, Wand2, Play, X, Plus } from "lucide-react";
import React from "react";
import { useEditor } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";

/**
 * 🎙️ 録音してボイチェン（自分の演技 → ElevenLabs STS）。
 * いとエモし検証の結論: 泣きの演技はTTSに天井がある。人間が演技した録音を
 * STSで声色だけ変換するのが「ほぼ人間」への道。
 *
 * - 変換先の声は「ボイス手帳」（projects/el-voices.json、全プロジェクト共通）に
 *   名前つきで登録し、TTS試聴つきで選ぶ
 * - 生録音は take_rec_*、変換結果は take_vc_* として narration/ に保存され、
 *   出自（種別・使った声・変換元）は takes.json の台帳に記録される
 */

const pickMime = () =>
  ["audio/webm;codecs=opus", "audio/mp4", "audio/webm"].find(
    (t) => typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(t),
  ) ?? "";

type RecState = "idle" | "recording" | "recorded";

interface Take {
  file: string;
  mtime: number;
  kind: "tts" | "rec" | "vc" | null;
  voiceName: string | null;
}

const isRecTake = (t: Take) =>
  t.kind === "rec" || (!t.kind && t.file.startsWith("narration/take_rec_"));
const isVcTake = (t: Take) =>
  t.kind === "vc" || (!t.kind && t.file.startsWith("narration/take_vc_"));

export const RecordVoiceChange: React.FC = () => {
  const project = useEditor((s) => s.project);
  const projectName = useEditor((s) => s.projectName);
  const mutate = useEditor((s) => s.mutate);

  const [open, setOpen] = React.useState(false);
  const [rec, setRec] = React.useState<RecState>("idle");
  const [elapsed, setElapsed] = React.useState(0);
  const [blobUrl, setBlobUrl] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [converting, setConverting] = React.useState<string | null>(null);
  const [takes, setTakes] = React.useState<Take[]>([]);

  // ボイス手帳
  const [roster, setRoster] = React.useState<{ id: string; name: string }[]>([]);
  const [myVoices, setMyVoices] = React.useState<
    { id: string; name: string }[]
  >([]);
  const [rosterLoaded, setRosterLoaded] = React.useState(false);
  const [addId, setAddId] = React.useState("");
  const [addName, setAddName] = React.useState("");
  const [sampling, setSampling] = React.useState<string | null>(null);
  const sampleAudio = React.useRef<HTMLAudioElement | null>(null);

  const recorderRef = React.useRef<MediaRecorder | null>(null);
  const chunksRef = React.useRef<Blob[]>([]);
  const blobRef = React.useRef<Blob | null>(null);
  const startedAtRef = React.useRef(0);

  const refreshTakes = React.useCallback(async () => {
    const res = await fetch(
      `/api/narration?project=${encodeURIComponent(projectName)}`,
    );
    if (res.ok) {
      const all = ((await res.json()).takes ?? []) as Take[];
      setTakes(all.filter((t) => isRecTake(t) || isVcTake(t)));
    }
  }, [projectName]);

  React.useEffect(() => {
    void refreshTakes();
    const onChanged = () => void refreshTakes();
    window.addEventListener("mvforge:takes-changed", onChanged);
    return () => window.removeEventListener("mvforge:takes-changed", onChanged);
  }, [refreshTakes]);

  // 録音時間の表示更新
  React.useEffect(() => {
    if (rec !== "recording") return;
    const id = setInterval(
      () => setElapsed((Date.now() - startedAtRef.current) / 1000),
      250,
    );
    return () => clearInterval(id);
  }, [rec]);

  // ボイス手帳は開いた初回だけlazy fetch
  React.useEffect(() => {
    if (!open || rosterLoaded) return;
    void (async () => {
      try {
        const res = await fetch("/api/el-voices");
        const d = await res.json();
        if (!res.ok) throw new Error(d.error);
        setRoster(d.voices ?? []);
        setMyVoices(d.myVoices ?? []);
      } catch (e) {
        toast.error(String(e instanceof Error ? e.message : e));
      } finally {
        setRosterLoaded(true);
      }
    })();
  }, [open, rosterLoaded]);

  if (!project) return null;
  const gen = project.prologue.gen;

  const notifyTakesChanged = () =>
    window.dispatchEvent(new CustomEvent("mvforge:takes-changed"));

  // ---- ボイス手帳 ----

  const selectVoice = (v: { id: string; name: string }) =>
    mutate((prj) => {
      prj.prologue.gen.stsVoiceId = v.id;
      prj.prologue.gen.stsVoiceLabel = v.name;
    });

  const registerVoice = async (id: string, name: string) => {
    try {
      const res = await fetch("/api/el-voices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, name }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error);
      setRoster(d.voices);
      return true;
    } catch (e) {
      toast.error(String(e instanceof Error ? e.message : e));
      return false;
    }
  };

  const addVoice = async () => {
    if (!addId.trim() || !addName.trim()) {
      toast.error("voice ID と名前を入力してください");
      return;
    }
    if (await registerVoice(addId.trim(), addName.trim())) {
      selectVoice({ id: addId.trim(), name: addName.trim() });
      setAddId("");
      setAddName("");
      toast.success("ボイス手帳に登録しました");
    }
  };

  const removeVoice = async (id: string) => {
    try {
      const res = await fetch("/api/el-voices", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error);
      setRoster(d.voices);
    } catch (e) {
      toast.error(String(e instanceof Error ? e.message : e));
    }
  };

  const importMyVoices = async () => {
    const known = new Set(roster.map((v) => v.id));
    const news = myVoices.filter((v) => !known.has(v.id));
    for (const v of news) await registerVoice(v.id, v.name);
    toast.success(`My Voicesから${news.length}件登録しました`);
  };

  const playSample = async (v: { id: string; name: string }) => {
    setSampling(v.id);
    try {
      const res = await fetch("/api/el-voices/sample", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ voiceId: v.id }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error);
      sampleAudio.current?.pause();
      const a = new Audio(`/api/el-voices/sample?voiceId=${encodeURIComponent(v.id)}`);
      sampleAudio.current = a;
      void a.play();
    } catch (e) {
      toast.error(String(e instanceof Error ? e.message : e));
    } finally {
      setSampling(null);
    }
  };

  // ---- 録音 ----

  const startRecording = async () => {
    try {
      // ブラウザのノイズ抑制は演技の表情を潰すので全オフ
      // （音量はサーバー側のloudnormが担保する）
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      });
      const mime = pickMime();
      const recorder = new MediaRecorder(
        stream,
        mime ? { mimeType: mime } : undefined,
      );
      chunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType });
        blobRef.current = blob;
        setBlobUrl((prev) => {
          if (prev) URL.revokeObjectURL(prev);
          return URL.createObjectURL(blob);
        });
        stream.getTracks().forEach((t) => t.stop()); // マイク解放
        setRec("recorded");
      };
      recorderRef.current = recorder;
      startedAtRef.current = Date.now();
      setElapsed(0);
      recorder.start();
      setRec("recording");
    } catch (e) {
      toast.error(
        `マイクにアクセスできません: ${String(e instanceof Error ? e.message : e)}`,
      );
    }
  };

  const stopRecording = () => recorderRef.current?.stop();

  const discard = () => {
    if (blobUrl) URL.revokeObjectURL(blobUrl);
    setBlobUrl(null);
    blobRef.current = null;
    setRec("idle");
  };

  /** 録音Blobをアップロードして take_rec_*.mp3 にする。保存先fileを返す */
  const upload = async (): Promise<string> => {
    const blob = blobRef.current;
    if (!blob) throw new Error("録音がありません");
    const form = new FormData();
    form.append("project", projectName);
    const ext = blob.type.includes("mp4") ? "m4a" : "webm";
    form.append("audio", blob, `recording.${ext}`);
    const res = await fetch("/api/narration/record", { method: "POST", body: form });
    const d = await res.json();
    if (!res.ok) throw new Error(d.error);
    return d.file as string;
  };

  /** 既存テイクを選択中の声でSTS変換して take_vc_*.mp3 を作る */
  const requestVoiceChange = async (file: string) => {
    const res = await fetch("/api/narration/voice-change", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        project: projectName,
        file,
        voiceId: gen.stsVoiceId,
        voiceName: gen.stsVoiceLabel,
      }),
    });
    const d = await res.json();
    if (!res.ok) throw new Error(d.error);
  };

  const voiceChange = async (file: string) => {
    if (!gen.stsVoiceId) {
      toast.error("先に変換先の声を選んでください");
      return;
    }
    setConverting(file);
    try {
      await requestVoiceChange(file);
      toast.success(`ボイチェンしました（${gen.stsVoiceLabel}）`);
      await refreshTakes();
      notifyTakesChanged();
    } catch (e) {
      toast.error(String(e instanceof Error ? e.message : e));
    } finally {
      setConverting(null);
    }
  };

  const saveRaw = async () => {
    setSaving(true);
    try {
      await upload();
      toast.success("生声をテイクに保存しました");
      discard();
      await refreshTakes();
      notifyTakesChanged();
    } catch (e) {
      toast.error(String(e instanceof Error ? e.message : e));
    } finally {
      setSaving(false);
    }
  };

  const saveAndConvert = async () => {
    if (!gen.stsVoiceId) {
      toast.error("先に変換先の声を選んでください");
      return;
    }
    setSaving(true);
    setConverting("new");
    try {
      const file = await upload();
      await requestVoiceChange(file);
      toast.success(
        `ボイチェンしました（${gen.stsVoiceLabel}）。生録音もテイクに残っています`,
      );
      discard();
      await refreshTakes();
      notifyTakesChanged();
    } catch (e) {
      toast.error(String(e instanceof Error ? e.message : e));
    } finally {
      setSaving(false);
      setConverting(null);
    }
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

  const mmss = (sec: number) =>
    `${String(Math.floor(sec / 60)).padStart(2, "0")}:${String(Math.floor(sec % 60)).padStart(2, "0")}`;

  return (
    <div className="rounded border border-neutral-800">
      <button
        className="flex w-full items-center justify-between px-3 py-2 text-xs font-medium text-neutral-200 hover:bg-neutral-900"
        onClick={() => setOpen((v) => !v)}
      >
        <span>
          {open ? "▾" : "▸"} <Mic className="inline size-3.5" /> 録音してボイチェン（自分の演技 → ElevenLabs STS）
        </span>
        <span className="text-neutral-500">
          {gen.stsVoiceLabel && `${gen.stsVoiceLabel} ・ `}
          {takes.length > 0 && `${takes.length}テイク`}
        </span>
      </button>
      {open && (
        <div className="space-y-3 border-t border-neutral-800 p-3">
          <p className="text-[10px] leading-relaxed text-neutral-500">
            泣きの演技はTTSに天井がある。自分で演技して録音し、声色だけ変換するのが「ほぼ人間」への道。
            音量は保存時に自動調整されるので、静かな部屋なら普通に録ってOK。
          </p>

          {/* ボイス手帳: 登録した声（クリックで選択、▶で試聴、×で削除） */}
          <div>
            <div className="mb-1 text-xs text-neutral-400">
              変換先の声（ボイス手帳・全プロジェクト共通）
            </div>
            {roster.length > 0 && (
              <div className="grid grid-cols-2 gap-1">
                {roster.map((v) => (
                  <div
                    key={v.id}
                    className={`flex items-center gap-1 rounded border px-2 py-1 ${
                      gen.stsVoiceId === v.id
                        ? "border-amber-500/70 bg-amber-500/10"
                        : "border-neutral-800 hover:bg-neutral-900"
                    }`}
                  >
                    <button
                      className="min-w-0 flex-1 text-left"
                      onClick={() => selectVoice(v)}
                    >
                      <div className="truncate text-xs text-neutral-200">
                        {gen.stsVoiceId === v.id && "✓ "}
                        {v.name}
                      </div>
                      <div className="truncate font-mono text-[10px] text-neutral-500">
                        {v.id}
                      </div>
                    </button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 w-7 shrink-0 p-0 text-xs"
                      title="試聴（初回のみ生成）"
                      disabled={sampling === v.id}
                      onClick={() => void playSample(v)}
                    >
                      {sampling === v.id ? "…" : <Play className="size-3 fill-current" />}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 w-6 shrink-0 p-0 text-neutral-600 hover:text-red-400"
                      title="手帳から削除"
                      onClick={() => void removeVoice(v.id)}
                    >
                      <X className="size-3" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
            {/* 登録フォーム */}
            <div className="mt-1 flex items-center gap-2">
              <Input
                className="h-7 flex-1 font-mono text-xs"
                placeholder="ElevenLabs voice ID"
                value={addId}
                onChange={(e) => setAddId(e.target.value)}
              />
              <Input
                className="h-7 w-36 text-xs"
                placeholder="名前（例: 深夜の少女）"
                value={addName}
                onChange={(e) => setAddName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && void addVoice()}
              />
              <Button
                size="sm"
                variant="outline"
                className="h-7 shrink-0 text-xs"
                onClick={() => void addVoice()}
              >
                <Plus className="size-3" /> 登録
              </Button>
            </div>
            {myVoices.length > 0 && (
              <button
                className="mt-1 text-[10px] text-neutral-500 underline hover:text-neutral-300"
                onClick={() => void importMyVoices()}
              >
                ElevenLabsのMy Voices（{myVoices.length}件）をまとめて手帳に登録する
              </button>
            )}
          </div>

          {/* 録音コントロール */}
          {rec === "idle" && (
            <Button size="sm" className="w-full" onClick={() => void startRecording()}>
              <Mic className="size-3.5" /> 録音を開始
            </Button>
          )}
          {rec === "recording" && (
            <div className="flex items-center gap-3 rounded border border-red-900/50 bg-red-950/30 px-3 py-2">
              <span className="size-2 shrink-0 animate-pulse rounded-full bg-red-500" />
              <span className="font-mono text-sm text-red-300">{mmss(elapsed)}</span>
              <span className="flex-1 text-xs text-neutral-400">録音中…</span>
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs"
                onClick={stopRecording}
              >
                <Square className="size-3 fill-current" /> 停止
              </Button>
            </div>
          )}
          {rec === "recorded" && blobUrl && (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <audio
                  controls
                  className="h-8 min-w-0 flex-1"
                  style={{ colorScheme: "dark" }}
                  src={blobUrl}
                />
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 shrink-0 text-xs"
                  title="録り直す"
                  onClick={discard}
                >
                  <RotateCcw className="size-3" /> 録り直す
                </Button>
              </div>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  className="flex-1"
                  disabled={saving}
                  onClick={() => void saveRaw()}
                >
                  生声のままテイク保存
                </Button>
                <Button
                  size="sm"
                  className="flex-1"
                  disabled={saving || !gen.stsVoiceId}
                  onClick={() => void saveAndConvert()}
                >
                  {converting === "new" ? (
                    "変換中…（30秒〜1分）"
                  ) : (
                    <>
                      <Wand2 className="size-3.5" /> ボイチェンしてテイク保存
                    </>
                  )}
                </Button>
              </div>
            </div>
          )}

          {/* テイク一覧: 全行同じグリッド（バッジ/プレーヤー/アクション/採用）で整列 */}
          {takes.length > 0 && (
            <div className="space-y-2">
              <div className="text-xs text-neutral-400">
                録音・ボイチェンのテイク（新しい順・間の編集は上の朗読生成パネルで）
              </div>
              {takes.map((t) => {
                const f = t.file;
                const isRec = isRecTake(t);
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
                    <div className="flex items-center gap-2">
                      <span
                        className={`w-16 shrink-0 rounded px-1 py-0.5 text-center text-[10px] ${
                          isRec
                            ? "bg-neutral-800 text-neutral-400"
                            : "bg-violet-500/20 text-violet-300"
                        }`}
                      >
                        {isRec ? "生録音" : "ボイチェン"}
                      </span>
                      <audio
                        controls
                        preload="metadata"
                        className="h-8 min-w-0 flex-1"
                        style={{ colorScheme: "dark" }}
                        src={`/api/asset?project=${encodeURIComponent(projectName)}&file=${encodeURIComponent(f)}&v=${t.mtime}`}
                      />
                      <div className="w-36 shrink-0">
                        {isRec ? (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 w-full text-xs"
                            title="この生録音を選択中の声でボイチェン（録り直し不要）"
                            disabled={converting === f || !gen.stsVoiceId}
                            onClick={() => void voiceChange(f)}
                          >
                            {converting === f ? "変換中…" : "この声でボイチェン"}
                          </Button>
                        ) : (
                          <div
                            className="truncate text-center text-[10px] text-violet-300"
                            title={t.voiceName ?? undefined}
                          >
                            {t.voiceName ?? "（声の記録なし）"}
                          </div>
                        )}
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 w-14 shrink-0 text-xs"
                        onClick={() => void adopt(f)}
                      >
                        採用
                      </Button>
                    </div>
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
