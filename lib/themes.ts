import type { EffectInstance, Project } from "./schema";

/**
 * テーマセット（大きな流れのプリセット）。
 * - palette: AI一括提案の「手札」をこの範囲に絞る（provideする部品の実体ではなく絞り込み定義）
 * - policy:  AIプロンプトに入る方針書（曲全体の緩急のガイド）
 * - defaults: ワンクリック一括適用で全区間に配る代表構成（AIを待たない即席版）
 * 部品はすべて lib/effects-meta.ts の既存id。テーマ追加はこの配列に足すだけ。
 */

export interface MvTheme {
  id: string;
  name: string;
  description: string;
  palette: {
    camera: string[];
    overlay: string[];
    transition: string[];
    lyric: string[];
    /** AI手札に加える装飾（decorカテゴリ）。省略可 */
    decor?: string[];
  };
  policy: string;
  defaults: {
    /** 区間の入り（先頭区間には付けない） */
    transition: EffectInstance;
    /** 区間頭に順繰りで配るカメラ（単調さ回避のため複数） */
    cameras: EffectInstance[];
    /** 全区間に敷く空気感オーバーレイ */
    overlays: EffectInstance[];
    /** 全行の出方 */
    lyricAnim: EffectInstance;
    /** 区間頭の行だけに配る装飾（全行に敷くとうるさい見せ場部品）。省略可 */
    lyricDecor?: EffectInstance;
  };
}

export const MV_THEMES: MvTheme[] = [
  {
    id: "emo",
    name: "エモ",
    description: "バラード・切なさ・余韻。ゆっくり溶ける切替と光の空気感",
    palette: {
      camera: ["slow-zoom-in", "slow-zoom-out", "pan", "parallax"],
      overlay: ["bokeh-orbs", "particles", "film-grain", "light-leak", "rain-drops"],
      transition: ["luma-fade", "crossfade", "fade-black", "flash-white"],
      lyric: [
        "lyric-karaoke-fill",
        "lyric-blur-in",
        "lyric-fade",
        "lyric-echo",
        "lyric-glow",
        "lyric-wave",
      ],
    },
    policy:
      "切替はゆっくり（luma-fadeとcrossfade中心、章の変わり目だけfade-black）。カメラはslow-zoom系で寄り引きを交互に。オーバーレイは1区間1個まで、bokeh-orbsやparticles(dust/光)で空気を足す。歌詞は聴かせたい行にlyric-karaoke-fill、それ以外はlyric-blur-in/fade。flash-whiteはサビ頭の1回だけ。",
    defaults: {
      transition: { id: "luma-fade", params: { duration: 1.2, from: "light" } },
      cameras: [
        { id: "slow-zoom-in", params: { amount: 1.15 } },
        { id: "slow-zoom-out", params: { amount: 1.12 } },
      ],
      overlays: [{ id: "bokeh-orbs", params: { count: 7, size: 150, hue: 40, intensity: 0.5 } }],
      lyricAnim: { id: "lyric-karaoke-fill", params: { hue: 340, dim: 0.55 } },
    },
  },
  {
    id: "pop",
    name: "ポップ",
    description: "アップテンポ・元気・リズム重視。キレのある切替とビート同期",
    palette: {
      camera: ["punch-zoom", "slow-zoom-in", "pan"],
      overlay: ["particles", "line-sweep", "shake", "light-streaks"],
      transition: ["whip-pan", "slice", "cut", "flash-white"],
      lyric: [
        "lyric-bounce",
        "lyric-wave",
        "lyric-stagger",
        "lyric-hero-pop",
        "lyric-karaoke-fill",
      ],
    },
    policy:
      "切替はキレ重視（whip-panとslice中心、間奏明けはflash-white、細かい割りはcut）。カメラはpunch-zoomをサビ頭に、beatSyncを積極的に使う。オーバーレイはline-sweepやshake(beat)でリズムを可視化。歌詞はlyric-bounce/waveの弾む系、サビはlyric-hero-pop解禁。",
    defaults: {
      transition: { id: "whip-pan", params: { duration: 0.35, direction: "left", blur: 1 } },
      cameras: [
        { id: "punch-zoom", params: { amount: 1.35, duration: 0.4, beatSync: "off" } },
        { id: "slow-zoom-in", params: { amount: 1.2 } },
      ],
      overlays: [
        { id: "particles", params: { type: "light", count: 24, size: 20, speed: 1.4, beatSync: "beat" } },
      ],
      lyricAnim: { id: "lyric-bounce", params: {} },
    },
  },
  {
    id: "fantasy",
    name: "幻想",
    description: "夜・エモ・幻想の見せ場。針金の光線が文字の周りを泳ぎ、光の粒と玉ボケで包む",
    palette: {
      camera: ["slow-zoom-in", "slow-zoom-out", "pan", "parallax"],
      overlay: ["particles", "bokeh-orbs", "light-leak"],
      transition: ["luma-fade", "crossfade", "fade-black", "flash-white"],
      lyric: ["lyric-gather", "lyric-blur-in", "lyric-echo", "lyric-glow"],
      decor: ["decor-neon-script"],
    },
    policy:
      "夜と幻想の空気を最優先。切替はluma-fade/crossfadeでゆっくり溶かし、章の変わり目だけfade-black。カメラはslow-zoom系で静かに寄り引き。オーバーレイはparticles(光)を薄く常備し、見せ場だけbokeh-orbs(玉ボケ)を厚めに。歌詞はlyric-gather中心、平常行はlyric-blur-in。電撃ライン(decor-neon-script)は区間頭やサビなど見せ場の行だけに（全行に付けると密度過多）。",
    defaults: {
      transition: { id: "luma-fade", params: { duration: 1.2, from: "light" } },
      cameras: [
        { id: "slow-zoom-in", params: { amount: 1.16, originX: 50, originY: 32 } },
        { id: "slow-zoom-out", params: { amount: 1.12 } },
      ],
      overlays: [
        { id: "particles", params: { type: "light", count: 14, size: 14, speed: 0.6, beatSync: "off" } },
        // 見せ場の包み: 旧ornate-frame（アーカイブ済み・静止C評価）→ 玉ボケ（A評価）へ差し替え
        { id: "bokeh-orbs", params: { count: 8, size: 150, hue: 45, intensity: 0.5 } },
      ],
      lyricAnim: {
        id: "lyric-gather",
        params: { spread: 90, stagger: 0.5, inDuration: 1.3, wobble: 0.6, pos: "bottom", chroma: 0.5 },
      },
      lyricDecor: {
        id: "decor-neon-script",
        params: { shape: "wire", color: "white", hue: 45, drawTime: 1.3, thickness: 2.6, glow: 0.9, wobble: 0, delay: 0.25 },
      },
    },
  },
  {
    id: "cinema",
    name: "シネマ",
    description: "映画的・物語調。黒帯＋グレイン＋落ち着いた切替",
    palette: {
      camera: ["slow-zoom-in", "slow-zoom-out", "pan", "parallax"],
      overlay: ["cinescope", "film-grain", "particles", "light-leak"],
      transition: ["fade-black", "crossfade", "luma-fade", "wipe"],
      lyric: ["lyric-fade", "lyric-type", "lyric-tracking", "lyric-blur-in", "lyric-karaoke-fill"],
    },
    policy:
      "全区間にcinescope＋film-grainを敷いて映画の画にする（オーバーレイ枠はこの2つを優先）。切替は章の区切りをfade-black、通常はcrossfade/luma-fade。カメラはpanとslow-zoomで淡々と。歌詞は控えめに（lyric-fade/type/tracking）、感情の頂点だけlyric-karaoke-fill。",
    defaults: {
      transition: { id: "fade-black", params: { duration: 1.2 } },
      cameras: [
        { id: "pan", params: { direction: "left", amount: 8 } },
        { id: "slow-zoom-in", params: { amount: 1.12 } },
      ],
      overlays: [
        { id: "cinescope", params: { ratio: "2.35", vignette: 0.5, weave: 0.3 } },
        { id: "film-grain", params: { intensity: 0.25, size: 2 } },
      ],
      lyricAnim: { id: "lyric-fade", params: {} },
    },
  },
];

export function themeById(id: string | null | undefined): MvTheme | null {
  if (!id) return null;
  return MV_THEMES.find((t) => t.id === id) ?? null;
}

/** テーマが参照する全id（パレット＋defaults）。整合性チェックとAI手札の絞りに使う */
export function themePaletteIds(theme: MvTheme): string[] {
  const ids = new Set<string>([
    ...theme.palette.camera,
    ...theme.palette.overlay,
    ...theme.palette.transition,
    ...theme.palette.lyric,
    ...(theme.palette.decor ?? []),
    theme.defaults.transition.id,
    ...theme.defaults.cameras.map((c) => c.id),
    ...theme.defaults.overlays.map((o) => o.id),
    theme.defaults.lyricAnim.id,
    ...(theme.defaults.lyricDecor ? [theme.defaults.lyricDecor.id] : []),
  ]);
  return [...ids];
}

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/**
 * ワンクリック一括適用: テーマの代表構成を全区間・全行に決定論的に配る。
 * - 区間頭（先頭行 or imageを持つ行）: transition＋camera（順繰り）＋overlays
 * - それ以外の行: effects/transition をクリア（区間頭以外が持っていても効かないため）
 * - 全行: lyricAnim を defaults に
 * - lyricDecor を持つテーマ: 区間頭の行だけに配り、他の行はクリア（見せ場の密度管理）。
 *   持たないテーマは lyricDecor に触らない（既存テーマの後方互換）
 * store.mutate 内で呼べば undo（⌘Z）で丸ごと戻せる。
 */
export function applyThemeToProject(project: Project, theme: MvTheme): void {
  let sectionIdx = 0;
  project.lines.forEach((line, i) => {
    const isHead = i === 0 || line.image !== null;
    if (isHead) {
      line.transition =
        sectionIdx === 0 ? null : clone(theme.defaults.transition);
      line.effects = [
        clone(theme.defaults.cameras[sectionIdx % theme.defaults.cameras.length]),
        ...theme.defaults.overlays.map(clone),
      ];
      sectionIdx += 1;
    } else {
      line.effects = [];
      line.transition = null;
    }
    line.lyricAnim = clone(theme.defaults.lyricAnim);
    if (theme.defaults.lyricDecor) {
      line.lyricDecor = isHead ? clone(theme.defaults.lyricDecor) : null;
    }
  });
}
