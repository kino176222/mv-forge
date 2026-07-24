"use client";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Check, Loader2, MessageCircleQuestion, Rocket, X } from "lucide-react";
import { useEditor } from "@/lib/store";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { I2V_MODELS } from "@/lib/ai-models";
import { AiModelSelect } from "./AiModelSelect";
import { ONESHOT_STEPS, type OneshotJob } from "@/lib/oneshot/types";
import { estimateCost } from "@/lib/oneshot/cost";

/**
 * 🚀 一発出し: 曲＋親画像＋歌詞から、方針対話→シーン設計→画像生成(+AI判定)→動画化(+AI判定)
 * →演出・テロップまでノンストップで組み上げる（正本: 2026-07-16_一気通貫MV生成_仕様書_v1.0）。
 * ゲートは2つ: 開始前の方針（このダイアログ＝ゲート1）と完成ドラフトのプレビュー（ゲート2）。
 * 例外はコスト上限超過時の cost-gate のみ。
 */

interface DialogueQuestion {
  id: string;
  question: string;
  options: { label: string; detail?: string }[];
}

export const OneshotDialog: React.FC = () => {
  const project = useEditor((s) => s.project);
  const projectName = useEditor((s) => s.projectName);
  const assets = useEditor((s) => s.assets);
  const setProject = useEditor((s) => s.setProject);
  const setAssets = useEditor((s) => s.setAssets);

  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState("ume");
  const [model, setModel] = useState("");
  const [i2vModel, setI2vModel] = useState(I2V_MODELS[0].id);
  const [tone, setTone] = useState("calm");
  const [metaphor, setMetaphor] = useState("balanced");
  const [lyricsText, setLyricsText] = useState("");
  const [vocalFile, setVocalFile] = useState("");
  const [direction, setDirection] = useState("");
  const [questions, setQuestions] = useState<DialogueQuestion[] | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [loadingQuestions, setLoadingQuestions] = useState(false);
  const [job, setJob] = useState<OneshotJob | null>(null);
  /** 開始リクエスト飛行中（ダブルクリックの二重起動防止） */
  const [starting, setStarting] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const running =
    job !== null && !["done", "error", "cancelled", "interrupted"].includes(job.phase);

  const estimate = useMemo(() => {
    if (!project) return null;
    return estimateCost(
      mode as "ume" | "take" | "matsu",
      project.meta.songDuration,
      i2vModel,
    );
  }, [project, mode, i2vModel]);

  // 進捗ポーリング（2秒）。完了でプロジェクトと素材を取り直す
  useEffect(() => {
    if (!job || !running) return;
    let stopped = false;
    const tick = async () => {
      try {
        const d = await fetch(
          `/api/oneshot?project=${encodeURIComponent(projectName)}&id=${encodeURIComponent(job.id)}`,
        ).then((r) => r.json());
        if (stopped || !d.job) return;
        setJob(d.job);
        const phase: string = d.job.phase;
        if (phase === "done") {
          const [freshP, freshA] = await Promise.all([
            fetch(`/api/project?name=${encodeURIComponent(projectName)}`).then((r) => r.json()),
            fetch(`/api/assets?project=${encodeURIComponent(projectName)}`).then((r) => r.json()),
          ]);
          if (freshP.project) setProject(freshP.project);
          if (!freshA.error) setAssets(freshA);
          toast.success(
            "一発出しが完了しました。プレビューで完成ドラフトを確認してください（微調整→書き出しへ）",
          );
        } else if (phase === "error") {
          toast.error(`一発出しが失敗しました: ${d.job.error ?? ""}`);
        } else if (!stopped) {
          timerRef.current = setTimeout(tick, 2000);
        }
      } catch {
        if (!stopped) timerRef.current = setTimeout(tick, 4000);
      }
    };
    timerRef.current = setTimeout(tick, 2000);
    return () => {
      stopped = true;
      if (timerRef.current) clearTimeout(timerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job?.id, running, projectName]);

  if (!project) return null;

  /** ② 方針対話: AIが親画像＋歌詞＋曲構造を見て選択式質問を作る（数分かかる） */
  const askQuestions = async () => {
    setLoadingQuestions(true);
    try {
      const d = await fetch("/api/oneshot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "questions", project: projectName, model }),
      }).then((r) => r.json());
      if (d.error) throw new Error(d.error);
      setQuestions(d.questions);
      setAnswers({});
    } catch (e) {
      toast.error(String(e instanceof Error ? e.message : e));
    } finally {
      setLoadingQuestions(false);
    }
  };

  /** 回答を方針テキストに合成（会話ログは捨てる。残るのはこのテキストだけ） */
  const adoptAnswers = () => {
    if (!questions) return;
    const lines = questions
      .filter((q) => answers[q.id])
      .map((q) => `${q.question} → ${answers[q.id]}`);
    setDirection((prev) => [prev.trim(), ...lines].filter(Boolean).join("\n"));
    setQuestions(null);
    toast.success("回答を方針に反映しました（下のテキストで微調整できます）");
  };

  const start = async () => {
    if (starting) return;
    setStarting(true);
    try {
      const res = await fetch("/api/oneshot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          project: projectName,
          mode,
          model,
          i2vModel,
          tone,
          metaphor,
          lyricsText: lyricsText.trim() || undefined,
          audioFile: vocalFile || undefined,
          direction: direction.trim() || undefined,
        }),
      });
      const d = await res.json();
      if (d.error) throw new Error(d.error);
      setJob(d.job);
      toast.info("一発出しを開始しました。完成までノンストップで進みます");
    } catch (e) {
      toast.error(String(e instanceof Error ? e.message : e));
    } finally {
      setStarting(false);
    }
  };

  const approveCost = async () => {
    if (!job) return;
    const d = await fetch("/api/oneshot", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "confirm-cost", project: projectName, id: job.id }),
    }).then((r) => r.json());
    if (d.error) toast.error(d.error);
    else toast.success("コストを承認しました。続行します");
  };

  const cancel = async () => {
    if (!job) return;
    await fetch(
      `/api/jobs?project=${encodeURIComponent(projectName)}&id=${encodeURIComponent(job.id)}`,
      { method: "DELETE" },
    );
    toast.info("一発出しをキャンセルしました（生成済みの素材は残ります）");
  };

  const hasLines = project.lines.length > 0;
  const needsI2v = mode !== "ume";

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" className="w-full justify-start">
          <Rocket className="size-3.5" /> 一発出し
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>一発出し（曲＋親画像＋歌詞 → 完成ドラフト）</DialogTitle>
        </DialogHeader>

        {job === null ? (
          <div className="space-y-3 text-sm">
            <p className="text-[11px] text-neutral-500">
              曲と親画像はこのプロジェクトに投入済みであること（曲=セットアップ／親画像=AIレコメンド下のカード）。
              開始後は完成までノンストップ。ダメな絵はAIが検品して自動で作り直します。
            </p>

            <div className="flex items-center gap-2">
              <span className="w-20 shrink-0 text-xs text-neutral-400">動画化</span>
              <Select value={mode} onValueChange={setMode}>
                <SelectTrigger className="h-8 flex-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ume" className="text-xs">
                    梅 — 動画化なし・カメラFXで動かす
                  </SelectItem>
                  <SelectItem value="take" className="text-xs">
                    竹 — サビだけ動画化＋他はパララックス
                  </SelectItem>
                  <SelectItem value="matsu" className="text-xs">
                    松 — すべて動かす（全シーン動画化）
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            {needsI2v && (
              <div className="flex items-center gap-2">
                <span className="w-20 shrink-0 text-xs text-neutral-400">動画モデル</span>
                <Select value={i2vModel} onValueChange={setI2vModel}>
                  <SelectTrigger className="h-8 flex-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {I2V_MODELS.map((m) => (
                      <SelectItem key={m.id} value={m.id} className="text-xs">
                        {m.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {estimate && (
              <p className="rounded border border-neutral-800 bg-neutral-900 px-2 py-1.5 text-[11px] text-neutral-400">
                概算費用: <b className="text-neutral-200">¥{estimate.minYen.toLocaleString()}〜¥{estimate.maxYen.toLocaleString()}</b>
                （画像{estimate.imageCountMin}〜{estimate.imageCountMax}枚
                {estimate.clipCountMax > 0 && `・動画${estimate.clipCountMin}〜${estimate.clipCountMax}本`}）
                ※単価表ベースの概算。上限の約1.3倍を超える計画になった場合は途中で承認を求めます
              </p>
            )}

            <div className="flex items-center gap-2">
              <span className="w-20 shrink-0 text-xs text-neutral-400">演出トーン</span>
              <Select value={tone} onValueChange={setTone}>
                <SelectTrigger className="h-8 flex-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="calm" className="text-xs">
                    大人しめ（既定） — テロップ・切替は控えめ。カメラは動く
                  </SelectItem>
                  <SelectItem value="standard" className="text-xs">
                    標準 — サビだけ演出強め
                  </SelectItem>
                  <SelectItem value="bold" className="text-xs">
                    派手 — 演出全開
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center gap-2">
              <span className="w-20 shrink-0 text-xs text-neutral-400">さじ加減</span>
              <Select value={metaphor} onValueChange={setMetaphor}>
                <SelectTrigger className="h-8 flex-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="literal" className="text-xs">
                    直喩寄り — 歌詞の情景をそのまま（分かりやすさ優先）
                  </SelectItem>
                  <SelectItem value="balanced" className="text-xs">
                    バランス（既定） — 直喩3割・間接5割・抽象2割
                  </SelectItem>
                  <SelectItem value="poetic" className="text-xs">
                    詩的 — 歌詞をほぼ直接描かず、情緒と質感で語る
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center gap-2">
              <span className="w-20 shrink-0 text-xs text-neutral-400">AIモデル</span>
              <AiModelSelect
                value={model}
                onChange={setModel}
                triggerClassName="h-8 flex-1"
              />
            </div>

            {/* ② 方針対話（3〜5問・選択式）。歌詞が読み込み済みのときに使える */}
            {questions === null ? (
              <Button
                size="sm"
                variant="outline"
                className="w-full justify-start"
                disabled={loadingQuestions || !hasLines}
                onClick={askQuestions}
                title={hasLines ? "" : "先に歌詞を取り込む（または下の歌詞欄に貼って一度LRC生成）と使えます"}
              >
                {loadingQuestions ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <MessageCircleQuestion className="size-3.5" />
                )}
                {loadingQuestions
                  ? "AIが質問を考えています…（親画像と歌詞を見ています。数分かかります）"
                  : "方針をAIと決める（3〜5問の選択式・任意）"}
              </Button>
            ) : (
              <div className="space-y-2 rounded border border-neutral-800 bg-neutral-900 p-2">
                {questions.map((q) => (
                  <div key={q.id} className="space-y-1">
                    <p className="text-xs text-neutral-200">{q.question}</p>
                    <div className="flex flex-wrap gap-1">
                      {q.options.map((o) => (
                        <button
                          key={o.label}
                          type="button"
                          title={o.detail ?? ""}
                          onClick={() => setAnswers((prev) => ({ ...prev, [q.id]: o.label }))}
                          className={`rounded border px-2 py-0.5 text-[11px] transition-colors ${
                            answers[q.id] === o.label
                              ? "border-primary bg-primary/20 text-primary"
                              : "border-neutral-700 text-neutral-400 hover:border-neutral-500"
                          }`}
                        >
                          {o.label}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
                <div className="flex gap-2 pt-1">
                  <Button size="sm" className="h-6 text-xs" onClick={adoptAnswers}>
                    回答を方針に反映
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 text-xs"
                    onClick={() => setQuestions(null)}
                  >
                    やめる
                  </Button>
                </div>
              </div>
            )}

            <div className="space-y-1">
              <span className="text-xs text-neutral-400">演出方針（対話の結果もここに入る。自由に直してOK）</span>
              <Textarea
                placeholder="例: 夕暮れの切なさ基調。サビは顔アップで感情を出す"
                className="h-20 text-xs"
                value={direction}
                onChange={(e) => setDirection(e.target.value)}
              />
            </div>

            <div className="space-y-1">
              <span className="text-xs text-neutral-400">
                歌詞テキスト{hasLines ? "（取り込み済みの歌詞を使うなら空のまま）" : "（必須。LRCを自動生成します）"}
              </span>
              <Textarea
                placeholder={"正解の歌詞を1行ずつ貼り付け\n夕焼けの\n雲の上で\n…"}
                className="h-20 text-xs"
                value={lyricsText}
                onChange={(e) => setLyricsText(e.target.value)}
              />
              {lyricsText.trim() && (
                <div className="flex items-center gap-2">
                  <span className="w-24 shrink-0 text-[11px] text-neutral-500">ボーカル音声</span>
                  <Select value={vocalFile || "__song__"} onValueChange={(v) => setVocalFile(v === "__song__" ? "" : v)}>
                    <SelectTrigger className="h-7 flex-1 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__song__" className="text-xs">
                        本編音源を使う（ステム推奨）
                      </SelectItem>
                      {assets.audios.map((a) => (
                        <SelectItem key={a} value={a} className="text-xs">
                          {a}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>

            <Button size="sm" className="w-full" onClick={start} disabled={starting}>
              <Rocket className="size-3.5" />
              {starting ? "開始しています…" : "一発出しスタート（完成までノンストップ）"}
            </Button>
          </div>
        ) : (
          <div className="space-y-3 text-sm">
            <ol className="space-y-1.5">
              {ONESHOT_STEPS.map((s, i) => {
                const isDone = job.phase === "done" || i < job.stepIndex;
                const isCurrent = running && i === job.stepIndex;
                const showCount =
                  isCurrent && job.total > 0 && ["images", "i2v", "depth"].includes(s.phase);
                return (
                  <li key={s.phase} className="flex items-center gap-2 text-xs">
                    {isDone ? (
                      <Check className="size-3.5 text-emerald-500" />
                    ) : isCurrent ? (
                      <Loader2 className="size-3.5 animate-spin text-primary" />
                    ) : (
                      <span className="inline-block size-3.5 rounded-full border border-neutral-700" />
                    )}
                    <span className={isCurrent ? "text-neutral-100" : "text-neutral-400"}>
                      {isCurrent && job.stepLabel ? job.stepLabel : s.label}
                      {showCount && (
                        <span className="ml-1 text-neutral-500">
                          {job.done}/{job.total}
                        </span>
                      )}
                    </span>
                  </li>
                );
              })}
            </ol>

            {job.phase === "cost-gate" && (
              <div className="space-y-2 rounded border border-amber-700 bg-amber-950/40 p-2">
                <p className="text-xs text-amber-300">
                  確定見積 ¥{(job.planYen ?? 0).toLocaleString()} が上限 ¥
                  {(job.capYen ?? 0).toLocaleString()} を超えました。続行しますか？
                </p>
                <div className="flex gap-2">
                  <Button size="sm" className="h-6 text-xs" onClick={approveCost}>
                    承認して続行
                  </Button>
                  <Button size="sm" variant="outline" className="h-6 text-xs" onClick={cancel}>
                    やめる
                  </Button>
                </div>
              </div>
            )}

            {job.planSummary && (
              <p className="rounded border border-neutral-800 bg-neutral-900 p-2 text-[11px] text-neutral-400">
                設計意図: {job.planSummary}（{job.planCount}シーン
                {job.planYen !== null && `・確定見積 約¥${job.planYen.toLocaleString()}`}）
              </p>
            )}
            {job.spentUsd > 0 && (
              <p className="text-[11px] text-neutral-500">
                概算使用額: ¥{Math.round(job.spentUsd * 155).toLocaleString()}（単価表ベース）
              </p>
            )}
            {job.rejectedImages.length > 0 && (
              <p className="text-[11px] text-neutral-500">
                AI判定で不採用のまま終わった画像 {job.rejectedImages.length} 枚は rejected/ に退避しました
              </p>
            )}
            {job.failedImages.length > 0 && (
              <p className="text-[11px] text-amber-500">
                生成に失敗した画像 {job.failedImages.length} 枚は静止画なしで続行しました
              </p>
            )}
            {job.i2vRejected.length > 0 && (
              <p className="text-[11px] text-neutral-500">
                動画化を見送った（静止画のまま残した）シーン: {job.i2vRejected.length} 件
              </p>
            )}

            {job.phase === "done" && (
              <p className="text-xs text-emerald-500">
                完成ドラフトができました。プレビューで確認→微調整→書き出しへ。
              </p>
            )}
            {job.phase === "error" && (
              <p className="text-xs text-red-400">失敗: {job.error}</p>
            )}
            {(job.phase === "cancelled" || job.phase === "interrupted") && (
              <p className="text-xs text-neutral-400">
                中断しました（生成済みの素材は残っています）
              </p>
            )}

            <div className="flex gap-2">
              {running ? (
                <Button size="sm" variant="outline" onClick={cancel}>
                  <X className="size-3.5" /> キャンセル
                </Button>
              ) : (
                <Button size="sm" variant="outline" onClick={() => setJob(null)}>
                  入力に戻る
                </Button>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};
