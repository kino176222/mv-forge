import React from "react";
import {
  AbsoluteFill,
  useCurrentFrame,
  useVideoConfig,
  interpolate,
  spring,
} from "remotion";
import { loadFont as loadInter } from "@remotion/google-fonts/Inter";
import { loadFont as loadNotoSansJP } from "@remotion/google-fonts/NotoSansJP";

// 旧レンダの見出しは Mac ローカルの重量級グロテスク（Helvetica/SF系）想定。
// 配布ビルドで化けないよう、字形の近いネオグロテスク Inter 800 に置換し、
// 和文グリフは Noto Sans JP 800 で受ける。ローカルフォント名は一切直書きしない。
const { fontFamily: INTER } = loadInter("normal", {
  weights: ["800"],
  subsets: ["latin", "latin-ext"],
});
const { fontFamily: NOTO_SANS_JP } = loadNotoSansJP("normal", {
  weights: ["700", "800"],
  subsets: ["japanese", "latin"],
});

/**
 * KineticTitleFamilyCR — 躍動タイポ（キネティックタイトル）の家族部品。
 *
 * 白紙実装（機能記述と自前レンダの
 * 見た目＝「巨大な白い重量級見出しが動的に登場する」だけを根拠に白紙から作成）。
 * ./ports/ からは import しない。
 *
 * 大きな見出しが variant によって別種の動きで入場→保持→退場する。
 * variant(0..1) は内部で 5 つのスタイルプリセットへ振り分けられ、
 * 0.0 / 0.25 / 0.5 / 0.75 / 1.0 で動き・レイアウト・装飾がはっきり変わる。
 * これ1コンポで kinetic-title 系 28 本を賄う。
 *
 * プリセット:
 *   0 PUNCH（variant<0.2）… 見出し全体が極小からオーバーシュートで弾け出る。
 *      軽い回転の揺り戻し＋ブラー抜けで殴り込むインパクト系。
 *   1 ROTATE（0.2..0.4）… 単語ごとに rotateX(-90°→0°) で床から起き上がる
 *      3Dフリップ・カスケード。奥行きのある回転系。
 *   2 SPLIT（0.4..0.6）… 文字を上下 half に分割し、上半分が左から・下半分が
 *      右から滑り込んで中央で合体する分割スライド系。
 *   3 STACK（0.6..0.8）… 行を1行ずつ下からせり上げて積む多段スタック系。
 *      各行に色アクセントのアンダーバーが伸びる。
 *   4 WIPE（0.8..1.0）… 先端に色帯を持つワイプで左→右へ塗り出す。
 *      退場は右へ抜けるクリップ・ワイプ系。
 *
 * durationInFrames に対して 入場→保持→退場 を必ず配置し、保持区間を長く取る。
 * 決定論的（Math.random / Date 不使用、すべて useCurrentFrame 基準）。
 * text と durationInFrames だけで完成した見た目になる（XpTitleProps 互換）。
 */
export type KineticTitleFamilyCRProps = {
  /** 表示する見出し。1行想定だが改行 \n が来ても崩れない */
  text: string;
  /** この見出しが画面に居る総フレーム数 */
  durationInFrames: number;
  /** 文字サイズ(px)。巨大なほどこの効果らしい */
  fontSize?: number;
  /** フォント。既定は重量級グロテスク＋和文フォールバック */
  fontFamily?: string;
  /** 0..1。内部で 5 プリセットに振り分け */
  variant?: number;
  /** 主役色 */
  color?: string;
};

const clamp01 = (t: number): number => Math.min(1, Math.max(0, t));
const easeOutCubic = (t: number): number => 1 - Math.pow(1 - t, 3);
const easeInCubic = (t: number): number => t * t * t;
const easeInOut = (t: number): number =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

/** variant(0..1) → プリセット番号(0..4) */
const pickPreset = (v: number): number => {
  const c = clamp01(v);
  if (c < 0.2) return 0;
  if (c < 0.4) return 1;
  if (c < 0.6) return 2;
  if (c < 0.8) return 3;
  return 4;
};

/** プリセット固有のアクセント色（装飾用。主役は常に color） */
const ACCENTS = ["#ff3b46", "#41b8ff", "#ffcf3b", "#37e0a6", "#ff5cf0"];

export const KineticTitleFamilyCR: React.FC<KineticTitleFamilyCRProps> = ({
  text,
  durationInFrames,
  fontSize = 150,
  fontFamily = `'${INTER}', '${NOTO_SANS_JP}', sans-serif`,
  variant = 0,
  color = "#ffffff",
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const preset = pickPreset(variant);
  const accent = ACCENTS[preset];
  const safeText = text.length > 0 ? text : " ";
  const lines = safeText.split("\n");

  // ---- 共通タイムライン: 入場 → 保持 → 退場 -------------------------------
  const enterDur = Math.max(8, Math.min(22, Math.round(durationInFrames * 0.32)));
  const exitDur = Math.max(6, Math.min(16, Math.round(durationInFrames * 0.24)));
  // 退場は終端の 2f 手前で完了させ、それまではしっかり保持
  const exitStart = Math.max(enterDur + 2, durationInFrames - exitDur - 2);
  const exitT = clamp01((frame - exitStart) / Math.max(1, exitDur));
  const exitEase = easeInCubic(exitT);
  const groupOpacity = 1 - exitEase;

  // 共通コンテナ（中央寄せ）。退場の抜けは各プリセットで加算する
  const containerBase: React.CSSProperties = {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    textAlign: "center",
    maxWidth: "92%",
    fontFamily,
    fontWeight: 800,
    color,
    lineHeight: 1.02,
    letterSpacing: "-0.01em",
    textShadow: "0 6px 34px rgba(0,0,0,0.45)",
    whiteSpace: "pre-wrap",
  };

  let content: React.ReactNode = null;

  // ======================================================================
  // 0) PUNCH — 極小からオーバーシュートで弾ける
  // ======================================================================
  if (preset === 0) {
    const s = spring({
      frame,
      fps,
      durationInFrames: enterDur,
      config: { damping: 9, mass: 0.7, stiffness: 120 },
    });
    const scale = interpolate(s, [0, 1], [0.28, 1]) + exitEase * 0.35;
    const rot = interpolate(s, [0, 1], [-7, 0]);
    // 入場直後だけ僅かにブラー、退場でも軽く滲ませる
    const blur = interpolate(s, [0, 1], [14, 0]) + exitEase * 10;
    content = (
      <div
        style={{
          ...containerBase,
          fontSize,
          transform: `scale(${scale}) rotate(${rot}deg)`,
          filter: `blur(${blur}px)`,
        }}
      >
        {lines.map((ln, i) => (
          <div key={i}>{ln === "" ? " " : ln}</div>
        ))}
      </div>
    );
  }

  // ======================================================================
  // 1) ROTATE — 単語ごとに床から起き上がる 3D フリップ
  // ======================================================================
  else if (preset === 1) {
    const stagger = 2.2;
    let wordIdx = 0;
    content = (
      <div
        style={{
          ...containerBase,
          fontSize,
          perspective: 1400,
          transform: `translateY(${-exitEase * 60}px)`,
        }}
      >
        {lines.map((ln, li) => {
          const words = ln === "" ? [" "] : ln.split(" ");
          return (
            <div
              key={li}
              style={{
                display: "flex",
                flexWrap: "wrap",
                justifyContent: "center",
                gap: "0 0.28em",
              }}
            >
              {words.map((w, wi) => {
                const idx = wordIdx++;
                const s = spring({
                  frame: frame - idx * stagger,
                  fps,
                  durationInFrames: enterDur,
                  config: { damping: 13, mass: 0.6 },
                });
                const rx = interpolate(s, [0, 1], [-92, 0]) + exitEase * 88;
                const op = interpolate(s, [0, 1], [0, 1]);
                return (
                  <span
                    key={wi}
                    style={{
                      display: "inline-block",
                      transformOrigin: "50% 100%",
                      transform: `rotateX(${rx}deg)`,
                      opacity: op,
                    }}
                  >
                    {w}
                  </span>
                );
              })}
            </div>
          );
        })}
      </div>
    );
  }

  // ======================================================================
  // 2) SPLIT — 上下 half を左右から滑り込ませて中央で合体
  // ======================================================================
  else if (preset === 2) {
    const s = spring({
      frame,
      fps,
      durationInFrames: enterDur,
      config: { damping: 15, mass: 0.8 },
    });
    // 入場: half が外から中央へ。退場: 逆に外へ散る
    const off = interpolate(s, [0, 1], [1, 0]) + exitEase;
    const dx = off * fontSize * 1.15;
    const gap = off * 0.16 + exitEase * 0.18; // 合体時は 0、離れると隙間
    const flat = safeText.replace(/\n/g, " ");
    const halfBase: React.CSSProperties = {
      ...containerBase,
      position: "absolute",
      left: 0,
      top: 0,
      width: "100%",
      height: "100%",
      fontSize,
      whiteSpace: "nowrap",
    };
    content = (
      <div style={{ position: "relative", width: "100%", height: fontSize * 1.4 }}>
        {/* 上半分: 左から */}
        <div
          style={{
            ...halfBase,
            clipPath: `inset(0 0 ${50 + gap * 100}% 0)`,
            transform: `translateX(${-dx}px)`,
          }}
        >
          {flat}
        </div>
        {/* 下半分: 右から */}
        <div
          style={{
            ...halfBase,
            clipPath: `inset(${50 + gap * 100}% 0 0 0)`,
            transform: `translateX(${dx}px)`,
          }}
        >
          {flat}
        </div>
        {/* 合体ラインの色アクセント（合体時に薄く光る） */}
        <div
          style={{
            position: "absolute",
            left: "10%",
            top: "50%",
            width: "80%",
            height: 4,
            background: accent,
            transform: "translateY(-50%)",
            opacity: (1 - off) * (1 - exitEase) * 0.9,
          }}
        />
      </div>
    );
  }

  // ======================================================================
  // 3) STACK — 行を下からせり上げて積む（多段スタック＋アンダーバー）
  // ======================================================================
  else if (preset === 3) {
    const stagger = 3.5;
    content = (
      <div
        style={{
          ...containerBase,
          fontSize,
          transform: `translateY(${-exitEase * 80}px)`,
          gap: "0.04em",
        }}
      >
        {lines.map((ln, li) => {
          const s = spring({
            frame: frame - li * stagger,
            fps,
            durationInFrames: enterDur,
            config: { damping: 16, mass: 0.8 },
          });
          const ty = interpolate(s, [0, 1], [fontSize * 0.9, 0]);
          const op = interpolate(s, [0, 1], [0, 1]);
          const barW = easeOutCubic(clamp01(s)) * (1 - exitEase);
          return (
            <div
              key={li}
              style={{
                overflow: "hidden",
                paddingBottom: "0.12em",
              }}
            >
              <div
                style={{
                  transform: `translateY(${ty + exitEase * fontSize * 0.5}px)`,
                  opacity: op,
                }}
              >
                {ln === "" ? " " : ln}
              </div>
              <div
                style={{
                  height: Math.max(4, fontSize * 0.05),
                  width: `${barW * 100}%`,
                  margin: "0.06em auto 0",
                  background: accent,
                  borderRadius: 999,
                }}
              />
            </div>
          );
        })}
      </div>
    );
  }

  // ======================================================================
  // 4) WIPE — 先端に色帯を持つワイプで左→右へ塗り出す
  // ======================================================================
  else {
    // 入場ワイプ: 0→100% 表示。退場ワイプ: 右端から消えていく
    const inT = easeInOut(clamp01(frame / Math.max(1, enterDur)));
    const revealR = (1 - inT) * 100; // 右側の隠れ量
    const exitR = exitEase * 100; // 退場で右から食われる（残る左側）
    // 表示範囲 = 左 exit% を削り、右 reveal% を削る
    const clipLeft = exitR;
    const clipRight = Math.max(revealR, 0);
    // 先端の色帯位置（入場中のみ）
    const edgeX = inT * 100;
    content = (
      <div style={{ position: "relative", width: "100%", display: "flex", justifyContent: "center" }}>
        <div style={{ position: "relative", display: "inline-block" }}>
          <div
            style={{
              ...containerBase,
              fontSize,
              clipPath: `inset(0 ${clipRight}% 0 ${clipLeft}%)`,
            }}
          >
            {lines.map((ln, i) => (
              <div key={i}>{ln === "" ? " " : ln}</div>
            ))}
          </div>
          {/* 入場ワイプの先端色帯 */}
          <div
            style={{
              position: "absolute",
              top: "-6%",
              left: `calc(${edgeX}% - 3px)`,
              width: 8,
              height: "112%",
              background: accent,
              opacity: inT > 0.02 && inT < 0.99 ? 0.95 : 0,
              boxShadow: `0 0 24px ${accent}`,
            }}
          />
        </div>
      </div>
    );
  }

  return (
    <AbsoluteFill
      style={{
        pointerEvents: "none",
        alignItems: "center",
        justifyContent: "center",
        opacity: groupOpacity,
      }}
    >
      {content}
    </AbsoluteFill>
  );
};

export default KineticTitleFamilyCR;
