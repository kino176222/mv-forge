"use client";
import { readXpFavorites } from "@/lib/xp/favorites";
import React, { useState } from "react";
import { useEditor } from "@/lib/store";
import { Button } from "@/components/ui/button";
import {
  Loader2,
  Bot,
  Check,
  Palette,
  BrainCircuit,
  Package,
  Copy,
  Plus,
  ChevronRight,
  ChevronDown,
  Info,
} from "lucide-react";
import { StylePackSelect } from "./StylePackSelect";
import { StyleDialog } from "./StyleDialog";
import { formatDurationJa } from "@/lib/utils";
import { toast } from "sonner";
import { Textarea } from "@/components/ui/textarea";
import { AiModelSelect } from "./AiModelSelect";
import { MV_THEMES, applyThemeToProject, type MvTheme } from "@/lib/themes";
import { ThemeBuilderDialog } from "./ThemeBuilderDialog";
import { Switch } from "@/components/ui/switch";
import { ParentBatchCard } from "./ParentBatchCard";
import { OneshotDialog } from "./OneshotDialog";
import { RepairConsole } from "./RepairConsole";
import { FreeGenCard } from "./FreeGenCard";
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
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

/** ホバーで解説が出るボタンラッパー */
const HelpTip: React.FC<{ tip: React.ReactNode; children: React.ReactNode }> = ({
  tip,
  children,
}) => (
  <Tooltip delayDuration={300}>
    <TooltipTrigger asChild>{children}</TooltipTrigger>
    <TooltipContent side="left" className="max-w-64 text-xs leading-relaxed">
      {tip}
    </TooltipContent>
  </Tooltip>
);

/** ラベル＋ⓘ（ホバーで解説）。TooltipProvider の内側で使う */
const TipLabel: React.FC<{ label: string; tip: React.ReactNode }> = ({
  label,
  tip,
}) => (
  <span className="flex items-center gap-1 text-[10px] text-neutral-500">
    {label}
    <HelpTip tip={tip}>
      <span className="inline-flex cursor-help text-neutral-500 hover:text-neutral-300">
        <Info className="size-3" />
      </span>
    </HelpTip>
  </span>
);

/**
 * 右ペイン: AI参謀。
 * - AIレコメンド1本（絵の配役＋演出を提案して反映。既定は即反映、⌘Zで戻せる）
 * - 思考の展開（理由・全体方針）と不足素材アドバイス（プロンプト付き）
 * - 生成機能は絶対に載せない。「作るべきもの」を教える参謀に徹する
 */
export const AiPane: React.FC = () => {
  const project = useEditor((s) => s.project);
  const projectName = useEditor((s) => s.projectName);
  const setProject = useEditor((s) => s.setProject);
  const adoptAll = useEditor((s) => s.adoptAllSuggestions);
  const [running, setRunning] = useState<null | "suggest" | "draft">(null);
  const [statusText, setStatusText] = useState("");
  const [elapsedSec, setElapsedSec] = useState(0); // 実行中の経過時間表示

  React.useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => setElapsedSec((s) => s + 1), 1000);
    return () => clearInterval(timer);
  }, [running]);
  // 口頭修正（赤入れ）は RepairConsole.tsx、自由プロンプト生成は FreeGenCard.tsx に分離済み
  const [generating, setGenerating] = useState<number | null>(null); // 不足素材の生成中index
  // 好みはlazy initializerでlocalStorageから直読み（Editor.tsxと同パターン。
  // マウント時effectでsetStateを叩くとカスケード再レンダ＝lint error になる）
  const [model, setModel] = useState(() =>
    typeof window === "undefined" ? "" : (localStorage.getItem("mvforge-suggest-model") ?? ""),
  );
  // 「足りない素材」の開閉。件数だけ見せて既定は閉（縦に長くなりすぎるため）
  const [missingOpen, setMissingOpen] = useState(false);
  // AIレコメンド: 既定は届いたら即反映。慎重派だけ「適用前に確認する」をオンにする。
  const [confirmBeforeApply, setConfirmBeforeApply] = useState(
    () =>
      typeof window !== "undefined" &&
      localStorage.getItem("mvforge-confirm-before-apply") === "1",
  );
  // 確認モードで届いた提案がまだ未反映か（反映ボタンの出し分けに使う）
  const [pendingSuggest, setPendingSuggest] = useState(false);

  React.useEffect(() => {
    // 自作テーマ（サーバ保存）を読み込み、内蔵テーマと合わせて選択肢にする
    fetch("/api/themes")
      .then((r) => r.json())
      .then((d) => setUserThemes(Array.isArray(d.themes) ? d.themes : []))
      .catch(() => {});
  }, []);
  const changeModel = (v: string) => {
    const id = v === "__default__" ? "" : v;
    setModel(id);
    localStorage.setItem("mvforge-suggest-model", id);
  };
  const changeConfirmBeforeApply = (v: boolean) => {
    setConfirmBeforeApply(v);
    localStorage.setItem("mvforge-confirm-before-apply", v ? "1" : "0");
  };

  // テーマセット（大きな流れ）: AI提案の手札を絞る＋一括適用の代表構成
  const [theme, setTheme] = useState(() =>
    typeof window === "undefined" ? "" : (localStorage.getItem("mvforge-theme") ?? ""),
  );
  // 自作テーマ（themes.user.json）。内蔵とマージして選択肢・名前解決に使う
  const [userThemes, setUserThemes] = useState<MvTheme[]>([]);
  const [themeBuilderOpen, setThemeBuilderOpen] = useState(false);
  const allThemes = React.useMemo(
    () => [...MV_THEMES, ...userThemes],
    [userThemes],
  );
  // 「詳細設定（プリセット・テーマ・強さ）」の開閉。既定は閉。
  const [detailOpen, setDetailOpen] = useState(false);
  const mutate = useEditor((s) => s.mutate);
  const changeTheme = (v: string) => {
    const id = v === "__none__" ? "" : v;
    setTheme(id);
    localStorage.setItem("mvforge-theme", id);
  };
  const deleteUserTheme = async (id: string) => {
    try {
      const res = await fetch(`/api/themes?id=${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error ?? "削除に失敗");
      setUserThemes(Array.isArray(d.themes) ? d.themes : []);
      if (theme === id) changeTheme("__none__");
      toast.success("自作テーマを削除しました");
    } catch (e) {
      toast.error(`削除に失敗: ${e instanceof Error ? e.message : e}`);
    }
  };
  const applyTheme = () => {
    const th = allThemes.find((t) => t.id === theme);
    if (!th || !project) return;
    mutate((p) => applyThemeToProject(p, th));
    toast.success(
      `テーマ「${th.name}」を全区間に一括適用しました（⌘Zで丸ごと戻せます）`,
    );
  };

  /** 不足素材（advice.missingAssets）のその場生成 */
  const generateImage = async (prompt: string, index: number) => {
    setGenerating(index);
    try {
      const res = await fetch("/api/generate-image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project: projectName, prompt }),
      });
      const d = await res.json();
      if (d.error) throw new Error(d.error);
      // 素材帯を更新して即使えるように
      const assets = await fetch(
        `/api/assets?project=${encodeURIComponent(projectName)}`,
      ).then((r) => r.json());
      if (!assets.error) useEditor.getState().setAssets(assets);
      toast.success(`生成完了: ${d.file} — 素材帯から行へD&Dできます`);
    } catch (e) {
      toast.error(String(e instanceof Error ? e.message : e));
    } finally {
      setGenerating(null);
    }
  };

  const runSuggest = async (draft: boolean) => {
    setRunning(draft ? "draft" : "suggest");
    setPendingSuggest(false); // 再実行時は前回の未反映フラグをリセット
    setElapsedSec(0);
    setStatusText("AI参謀が全シーンを見ています…（画像も1枚ずつ確認するので数分かかります）");
    try {
      // お気に入り（図鑑の星）を手札としてAIに渡す（curated手札に合流）
      const favorites: string[] = readXpFavorites();
      const start = await fetch("/api/suggest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project: projectName, draft, model, theme, favorites }),
      }).then((r) => r.json());
      if (start.error) throw new Error(start.error);

      // ポーリング
      for (;;) {
        await new Promise((r) => setTimeout(r, 4000));
        const job = await fetch(
          `/api/suggest?id=${start.id}&project=${encodeURIComponent(projectName)}`,
        ).then((r) => r.json());
        if (job.status === "done") break;
        if (job.status === "error") throw new Error(job.error);
        if (job.status === "cancelled" || job.status === "interrupted") {
          toast.info(
            job.status === "cancelled"
              ? "AI提案をキャンセルしました"
              : "AI提案が中断されました",
          );
          return;
        }
      }
      // 提案が書き込まれた project を取り直す
      const fresh = await fetch(
        `/api/project?name=${encodeURIComponent(projectName)}`,
      ).then((r) => r.json());
      if (fresh.project) {
        setProject(fresh.project);
        if (confirmBeforeApply) {
          // 慎重モード: 自動反映せず、未反映フラグを立てて手動ボタンを出す
          setPendingSuggest(true);
          toast.success(
            "AIレコメンドが届きました。「提案を確認して反映」で反映できます",
          );
        } else {
          // 既定: 届いたらそのまま一括反映（⌘Zで丸ごと戻せる）
          adoptAll();
          toast.success("AIレコメンドを反映しました（⌘Zで戻せます）");
        }
      }
    } catch (e) {
      toast.error(`AI提案に失敗: ${e instanceof Error ? e.message : e}`);
    } finally {
      setRunning(null);
      setStatusText("");
    }
  };

  const advice = project?.aiAdvice;

  // 詳細を畳んでいる時に「非既定値があるよ」と示すヒント（パック名／テーマ名／強さ）
  const suggestMode = project?.meta.suggestMode ?? "standard";
  const detailHints = [
    project?.meta.stylePack?.name,
    theme ? (allThemes.find((t) => t.id === theme)?.name ?? theme) : "",
    suggestMode !== "standard"
      ? ({ simple: "シンプル", rich: "攻め" } as Record<string, string>)[
          suggestMode
        ]
      : "",
  ].filter(Boolean) as string[];

  return (
    <div className="flex h-full flex-col gap-3 overflow-y-auto p-3 text-sm">
      <div className="flex items-center gap-1.5 text-xs font-semibold tracking-wide text-neutral-400">
        <BrainCircuit className="size-3.5" /> AI参謀（演出プランナー）
      </div>

      {/* 整列の法則: ラベルは全部「上置き」・コントロールは全幅。
          セレクトの選択中表示は短い名前だけ（説明はドロップダウン内のみ）＝横に見切れない */}
      <div className="space-y-2">
        <div className="space-y-1">
          <span className="block text-[10px] text-neutral-500">モデル</span>
          <AiModelSelect
            value={model}
            onChange={changeModel}
            triggerClassName="h-6 w-full text-[11px]"
          />
        </div>
        <div className="space-y-1">
          <span className="block text-[10px] text-neutral-500">
            演出方針（自由記述。ショット設計・AI提案・i2vの全部に効く）
          </span>
          <Textarea
            placeholder="例: 夜の切なさ基調。サビは畳みかける。キャラの顔アップ多め、攻めた演出OK"
            className="min-h-14 text-xs"
            value={project?.meta.direction ?? ""}
            onChange={(e) =>
              mutate((p) => {
                p.meta.direction = e.target.value;
              })
            }
          />
        </div>
        {/* 詳細設定（プリセット・テーマ・強さ）: 折りたたみ。既定は閉 */}
        <div className="rounded border border-neutral-800/80">
          <button
            type="button"
            onClick={() => setDetailOpen((o) => !o)}
            className="flex w-full items-center gap-1 px-2 py-1.5 text-left text-[11px] text-neutral-400 hover:text-neutral-200"
          >
            {detailOpen ? (
              <ChevronDown className="size-3.5 shrink-0" />
            ) : (
              <ChevronRight className="size-3.5 shrink-0" />
            )}
            <span className="font-medium">詳細設定（プリセット・テーマ・強さ）</span>
            {!detailOpen && detailHints.length > 0 && (
              <span className="ml-auto min-w-0 truncate text-[10px] text-neutral-600">
                {detailHints.join(" / ")}
              </span>
            )}
          </button>
          {detailOpen && (
            <TooltipProvider>
              <div className="space-y-2 border-t border-neutral-800/80 p-2">
                {/* プリセット（見た目の型。おすすめの動き/濃さも入る） */}
                <div className="space-y-1">
                  <TipLabel
                    label="プリセット"
                    tip="選ぶ＝一括適用（⌘Zで戻る）。作る・微調整はテロップ様式→「登録」で棚に並ぶ"
                  />
                  <StylePackSelect
                    hideHeader
                    onApplied={(pack) => {
                      // 推奨テーマ付きパックの適用時、localStorage は StylePackSelect が更新済み。
                      // ここでは自分のテーマstateを同期する。
                      if (pack.recommendedTheme) setTheme(pack.recommendedTheme);
                    }}
                  />
                  <StyleDialog />
                  <p className="text-[10px] leading-relaxed text-neutral-600">
                    プリセット＝保存棚。フォント・色・縁取りの微調整は
                    「テロップ様式」（作業台）でこの曲だけに効かせ、
                    気に入ったら「登録」で棚へ。
                  </p>
                </div>
                {/* テーマ（動きの語彙＝AIの手札） */}
                <div className="space-y-1">
                  <TipLabel
                    label="テーマ"
                    tip="動きの語彙（切替・カメラ・歌詞演出の手札）。AIはこの手札から選ぶ"
                  />
                  <Select value={theme || "__none__"} onValueChange={changeTheme}>
                    <SelectTrigger className="h-6 w-full text-[11px]">
                      <SelectValue>
                        {theme ? (allThemes.find((t) => t.id === theme)?.name ?? theme) : "指定なし"}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__" className="text-xs">
                        <span>指定なし</span>
                        <span className="ml-1.5 text-[10px] text-neutral-500">全手札から提案</span>
                      </SelectItem>
                      <SelectGroup>
                        <SelectLabel>内蔵テーマ</SelectLabel>
                        {MV_THEMES.map((t) => (
                          <SelectItem key={t.id} value={t.id} className="text-xs">
                            <span>{t.name}</span>
                            <span className="ml-1.5 text-[10px] text-neutral-500">{t.description}</span>
                          </SelectItem>
                        ))}
                      </SelectGroup>
                      {userThemes.length > 0 && (
                        <SelectGroup>
                          <SelectLabel>自作テーマ</SelectLabel>
                          {userThemes.map((t) => (
                            <SelectItem key={t.id} value={t.id} className="text-xs">
                              <span>{t.name}</span>
                              <span className="ml-1.5 text-[10px] text-neutral-500">{t.description}</span>
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      )}
                    </SelectContent>
                  </Select>
                  {/* AIなしで即配る: テーマの代表構成を全区間に一括（雰囲気の下見用） */}
                  {theme && (
                    <HelpTip
                      tip={
                        <>
                          <b>雰囲気の下見用。</b>
                          AIレコメンドと違い強弱はつきません（全区間同じ）。
                          テーマの代表構成（つなぎ・カメラ・空気感・歌詞の出方）を
                          その場で全区間に配ります。⌘Zで戻せます。
                        </>
                      }
                    >
                      <button
                        type="button"
                        disabled={!project?.lines.length}
                        onClick={applyTheme}
                        className="block text-left text-[10px] text-neutral-500 underline-offset-2 hover:text-neutral-300 hover:underline disabled:opacity-50"
                      >
                        AIなしで即配る（全区間同じ・⌘Z）
                      </button>
                    </HelpTip>
                  )}
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 w-full text-xs"
                    onClick={() => setThemeBuilderOpen(true)}
                  >
                    <Plus className="size-3.5" />
                    テーマを作る（手札を自分で組む）
                  </Button>
                  {userThemes.some((t) => t.id === theme) && (
                    <button
                      type="button"
                      onClick={() => deleteUserTheme(theme)}
                      className="block text-[10px] text-neutral-600 underline-offset-2 hover:text-red-400 hover:underline"
                    >
                      この自作テーマを削除
                    </button>
                  )}
                </div>
                {/* 強さ（濃さ＝弱/標準/攻め） */}
                <div className="space-y-1">
                  <TipLabel label="強さ" tip="濃さ（弱/標準/攻め）" />
                  <Select
                    value={project?.meta.suggestMode ?? "standard"}
                    onValueChange={(v) =>
                      mutate((p) => {
                        p.meta.suggestMode = v as "simple" | "standard" | "rich";
                      })
                    }
                  >
                    <SelectTrigger className="h-6 w-full text-[11px]">
                      <SelectValue>
                        {{ simple: "シンプル", standard: "スタンダード", rich: "攻め" }[
                          project?.meta.suggestMode ?? "standard"
                        ]}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="simple" className="text-xs">
                        <span>シンプル</span>
                        <span className="ml-1.5 text-[10px] text-neutral-500">テロップ静かめ・overlay最小</span>
                      </SelectItem>
                      <SelectItem value="standard" className="text-xs">
                        <span>スタンダード</span>
                        <span className="ml-1.5 text-[10px] text-neutral-500">統一ルールのみ（2〜3系統）</span>
                      </SelectItem>
                      <SelectItem value="rich" className="text-xs">
                        <span>攻め</span>
                        <span className="ml-1.5 text-[10px] text-neutral-500">系統を広げて多彩に</span>
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </TooltipProvider>
          )}
        </div>
        {/* 自作テーマビルダー（詳細を畳んでも開いたままにできるよう常時マウント） */}
        <ThemeBuilderDialog
          open={themeBuilderOpen}
          onOpenChange={setThemeBuilderOpen}
          onSaved={(t) => {
            setUserThemes((prev) => [...prev.filter((u) => u.id !== t.id), t]);
            changeTheme(t.id);
          }}
        />
        <TooltipProvider>
          {/* 主アクション: AIレコメンド（常に絵の配役＋演出を提案し、既定は即反映） */}
          <HelpTip
            tip={
              <>
                <b>これ1本でOK。</b>
                AIが全シーンを見て、絵の配役（まだ絵が無い行だけ）と
                演出（カメラ・光・つなぎ・歌詞アニメ）を考えて反映します。
                あなたが置いた絵は動かしません。気に入らない所だけ後から赤入れを。
                {confirmBeforeApply && (
                  <>
                    <br />
                    いまは「適用前に確認する」がオン＝届いても自動では反映しません。
                  </>
                )}
              </>
            }
          >
            <Button
              className="w-full justify-start"
              size="sm"
              disabled={running !== null || !project?.lines.length}
              onClick={() => runSuggest(true)}
            >
              {running !== null ? <Loader2 className="animate-spin" /> : <Bot />}
              {running !== null ? "AIレコメンド作成中…（数分かかります）" : "AIレコメンド"}
            </Button>
          </HelpTip>
          <p className="px-0.5 text-[10px] leading-relaxed text-neutral-500">
            絵の配役＋演出を提案して反映（⌘Zで戻せます）
          </p>
          {/* 🚀一発出し: 曲＋親画像＋歌詞からドラフト完成までノンストップ（一気通貫MV生成 v1.0） */}
          <OneshotDialog />
          <p className="px-0.5 text-[10px] leading-relaxed text-neutral-500">
            シーン設計→画像生成→配役→演出まで一気に組み上げます
          </p>
          {/* 慎重派向けの小トグル: 適用前に確認する（既定オフ） */}
          <div className="flex items-center gap-2 px-0.5">
            <Switch
              id="confirm-before-apply"
              checked={confirmBeforeApply}
              onCheckedChange={changeConfirmBeforeApply}
              className="scale-90"
            />
            <label
              htmlFor="confirm-before-apply"
              className="cursor-pointer text-[10px] text-neutral-500"
            >
              適用前に確認する（自動反映せず、下のボタンで反映）
            </label>
          </div>
          {/* 確認モードで未反映の提案がある時だけ出す（旧・提案を全採用） */}
          {confirmBeforeApply && pendingSuggest && (
            <HelpTip
              tip={
                <>
                  届いているAIレコメンドをまとめて反映します。
                  あなたが置いた絵は動かしません。反映後も元提案は残るので、
                  行ごとにAI案へ戻せます。⌘Zで丸ごと戻せます。
                </>
              }
            >
              <Button
                className="w-full justify-start"
                size="sm"
                variant="secondary"
                disabled={running !== null}
                onClick={() => {
                  adoptAll();
                  setPendingSuggest(false);
                  toast.success("AIレコメンドを反映しました（⌘Zで戻せます）");
                }}
              >
                <Check />
                提案を確認して反映
              </Button>
            </HelpTip>
          )}
        </TooltipProvider>
        {running && (
          <div className="space-y-1">
            <p className="text-xs text-neutral-500">
              {statusText} 経過{formatDurationJa(elapsedSec)}（目安2〜5分）
            </p>
            <div className="h-1 w-full overflow-hidden rounded bg-neutral-800">
              <div className="h-full w-1/3 animate-[ai-slide_1.6s_ease-in-out_infinite] rounded bg-primary/70" />
              <style>{`@keyframes ai-slide { 0% { margin-left: -33% } 100% { margin-left: 100% } }`}</style>
            </div>
          </div>
        )}
        <p className="text-[11px] leading-relaxed text-neutral-600">
          提案はMAXプランのClaude（定額）で動きます。提案は別枠保存なので、
          手で上書きしてもいつでもAI案に戻せます。尺には触れません。
        </p>
      </div>

      {/* 口頭修正コンソール（赤入れ）: RepairConsole.tsx に分離 */}
      <RepairConsole model={model} />

      {advice && (
        <>
          <div className="rounded border border-neutral-800 bg-neutral-900/60 p-2.5">
            <div className="mb-1 text-xs font-medium text-neutral-400">全体方針</div>
            <p className="text-xs leading-relaxed text-neutral-200">
              {advice.summary || "（なし）"}
            </p>
          </div>

          {advice.missingAssets.length > 0 && (
            <div className="rounded border border-amber-900/50 bg-amber-950/20 p-2.5">
              <button
                type="button"
                onClick={() => setMissingOpen((o) => !o)}
                className="flex w-full items-center gap-1.5 text-left text-xs font-medium text-amber-300"
              >
                {missingOpen ? (
                  <ChevronDown className="size-3.5 shrink-0" />
                ) : (
                  <ChevronRight className="size-3.5 shrink-0" />
                )}
                <Package className="size-3.5" /> 足りない素材（
                {advice.missingAssets.length}件）
              </button>
              {missingOpen && (
              <div className="mt-1.5 space-y-2">
                {advice.missingAssets.map((m, i) => (
                  <div key={i} className="text-xs">
                    <div className="text-neutral-200">{m.what}</div>
                    <div className="mt-0.5 flex items-start gap-1">
                      <code className="flex-1 rounded bg-neutral-900 p-1.5 text-[10px] leading-snug text-neutral-400">
                        {m.prompt}
                      </code>
                      <div className="flex flex-col gap-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-6 px-1.5 text-[10px]"
                          title="プロンプトをコピー"
                          onClick={() => {
                            navigator.clipboard.writeText(m.prompt);
                            toast.success("プロンプトをコピーしました");
                          }}
                        >
                          <Copy className="size-3" />
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-6 px-1.5 text-[10px]"
                          title="この絵をfal.aiで生成して素材帯へ"
                          disabled={generating !== null}
                          onClick={() => generateImage(m.prompt, i)}
                        >
                          {generating === i ? (
                            <Loader2 className="size-3 animate-spin" />
                          ) : (
                            <Palette className="size-3" />
                          )}
                        </Button>
                      </div>
                    </div>
                  </div>
                ))}
                <p className="text-[10px] text-neutral-600">
                  パレット=その場で生成（fal.ai）。Midjourney等の外部生成派はコピーして
                  images/ フォルダへ（ウィンドウに戻れば素材帯に自動反映）
                </p>
              </div>
              )}
            </div>
          )}
        </>
      )}

      {/* 🎬 親画像から一式生成（親画像理論） */}
      <ParentBatchCard model={model} />

      {/* 自由プロンプト生成: FreeGenCard.tsx に分離 */}
      <FreeGenCard />
    </div>
  );
};
