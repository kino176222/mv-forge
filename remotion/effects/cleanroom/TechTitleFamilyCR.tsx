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

// 配布ビルドでフォントが化けないよう、ローカルフォント名は一切直書きせず
// @remotion/google-fonts から読む。ラテンはネオグロテスクの Inter、
// 和文グリフは Noto Sans JP で受ける。数字の等幅感が欲しい装飾も Inter で賄う。
const { fontFamily: INTER } = loadInter("normal", {
  weights: ["400", "700", "900"],
  subsets: ["latin", "latin-ext"],
});
const { fontFamily: NOTO_SANS_JP } = loadNotoSansJP("normal", {
  weights: ["400", "700", "900"],
  subsets: ["japanese", "latin"],
});

/**
 * TechTitleFamilyCR — モダンで無機質なテキストタイトルの家族部品。
 *
 * クリーンルーム実装（旧レンダのポスターの「見た目のみ」と機能記述を根拠に、
 * 既存実装を参照せず白紙から作成）。tech / typography / title の3カテゴリを
 * 1コンポで賄うため、variant(0..1) を【5種】のスタイルプリセットへ振り分ける。
 *
 *   variant≈0.00  HUD          … 監視カメラ風UI。角ブラケット＋十字グリッド＋
 *                                等幅ラベル(SYS//・REC タイムコード・SCAN)＋
 *                                ティール発光のセンタータイトル。
 *   variant≈0.25  EDITORIAL    … 雑誌的タイポ。クリーム色の極太タイトルを
 *                                上下のヘアラインが中央から開いて縁取る。上品。
 *   variant≈0.50  BLUEPRINT    … 設計図/等幅。字間を広げた大文字タイトルを
 *                                上下の目盛りライン＋左右ティック＋通し番号で挟み、
 *                                左→右のクリップワイプで出す。
 *   variant≈0.75  DISPLAY      … 極太ディスプレイ。画面幅いっぱいの白タイトルが
 *                                自分のベースラインからマスクせり上がりで立ち上がる。
 *   variant≈1.00  BRACKET      … ライン装飾。全幅の細線2本の間にタイトルを置き、
 *                                左右の角括弧と小さなトラッキングラベルを添える。
 *
 * どのプリセットも durationInFrames に対して「入場→保持→退場」を配置し、
 * 決定論的（useCurrentFrame ベース、Math.random/Date 不使用）。text と
 * durationInFrames だけで完成した見た目になり、renderStill でも例外を出さない。
 */
export type TechTitleFamilyCRProps = {
  /** 表示する文言（1行想定。改行 \n が来ても縦積みで崩れない） */
  text: string;
  /** この部品が画面に居る総フレーム数（Sequence の長さに合わせる） */
  durationInFrames: number;
  /** タイトルの文字サイズ(px)。省略時 150 */
  fontSize?: number;
  /** フォント。省略時は Inter → Noto Sans JP のフォールバック連鎖 */
  fontFamily?: string;
  /** スタイルプリセット選択 0..1（0/0.25/0.5/0.75/1 で見た目が明確に変わる） */
  variant?: number;
  /** 主役タイトルの塗り色。省略時 #ffffff */
  color?: string;
};

const clamp01 = (t: number): number => Math.min(1, Math.max(0, t));

/** variant(0..1) を 0..4 の離散プリセット番号へ */
const presetOf = (v: number): number =>
  Math.min(4, Math.max(0, Math.round(clamp01(v) * 4)));

/** frame からダミータイムコード HH:MM:SS:FF を決定論生成（HUD装飾用） */
const timecode = (frame: number, fps: number): string => {
  const base = frame + 60 * 60 * 1 + 60 * 9; // 01:09:.. あたりから流れる体裁
  const ff = Math.floor(base % Math.max(1, fps));
  const totalSec = Math.floor(base / Math.max(1, fps));
  const ss = totalSec % 60;
  const mm = Math.floor(totalSec / 60) % 60;
  const hh = Math.floor(totalSec / 3600) % 100;
  const p2 = (n: number) => String(n).padStart(2, "0");
  return `${p2(hh)}:${p2(mm)}:${p2(ss)}:${p2(ff)}`;
};

/** text から短い英数コードを決定論生成（HUD の「SYS // XXXX」用） */
const shortCode = (text: string): string => {
  let h = 0;
  for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) >>> 0;
  const aln = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  let out = "";
  let x = h || 0x9e3779b1;
  for (let i = 0; i < 4; i++) {
    out += aln[x % aln.length];
    x = Math.floor(x / aln.length) + 7;
  }
  return out;
};

/** \n で分割して縦積みの行配列に */
const toLines = (text: string): string[] => {
  const parts = text.split("\n");
  return parts.length ? parts : [text];
};

export const TechTitleFamilyCR: React.FC<TechTitleFamilyCRProps> = ({
  text,
  durationInFrames,
  fontSize = 150,
  fontFamily = `'${INTER}', '${NOTO_SANS_JP}', sans-serif`,
  variant = 0,
  color = "#ffffff",
}) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();

  const preset = presetOf(variant);
  const lines = toLines(text);

  // ---- 共通タイミング（入場→保持→退場） ----
  const enterDur = Math.max(6, Math.min(22, Math.round(durationInFrames * 0.32)));
  const exitDur = Math.max(5, Math.min(16, Math.round(durationInFrames * 0.24)));
  const exitStart = Math.max(enterDur + 1, durationInFrames - exitDur - 2);

  // 入場進捗 0..1（バネで減速停止）
  const appear = spring({
    frame,
    fps,
    config: { damping: 200, mass: 0.7 },
    durationInFrames: enterDur,
  });
  // 退場進捗 0..1（最終フレーム手前で完了。終盤でも保持中は0=見えている）
  const exit = interpolate(frame, [exitStart, durationInFrames - 2], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  // 保険の全体フェード（退場後に何も残さない）
  const globalOpacity =
    interpolate(frame, [0, Math.min(4, enterDur)], [0, 1], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    }) * (1 - exit);

  const accent = "#5eead4"; // HUD のティール
  const titleFont = fontFamily;

  // 共通のタイトル要素（プリセットごとに style を差し替えて使う）
  const renderTitle = (style: React.CSSProperties, weight = 900) => (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        lineHeight: 1.02,
        fontFamily: titleFont,
        fontWeight: weight,
        ...style,
      }}
    >
      {lines.map((ln, i) => (
        <span key={i} style={{ whiteSpace: "pre" }}>
          {ln.length ? ln : " "}
        </span>
      ))}
    </div>
  );

  // =====================================================================
  // Preset 0 — HUD（監視カメラUI・ティール発光）
  // =====================================================================
  if (preset === 0) {
    const gridX = Math.round(width * 0.51);
    // 発光のちらつき（入場直後だけ。決定論・sinベース）
    const settle = clamp01((frame - enterDur) / 8);
    const flick =
      0.72 + 0.28 * Math.abs(Math.sin(frame * 0.9)) * (1 - settle) + settle;
    const glow = Math.min(1, flick);
    const uiReveal = clamp01(appear * 1.1);
    const bw = fontSize * 0.9; // ブラケットのスパン目安
    const bracketPad = fontSize * 1.4;

    const bracket = (corner: "tl" | "tr" | "bl" | "br") => {
      const len = 46;
      const th = 3;
      const isT = corner[0] === "t";
      const isL = corner[1] === "l";
      const vy: React.CSSProperties = isT ? { top: 0 } : { bottom: 0 };
      const hx: React.CSSProperties = isL ? { left: 0 } : { right: 0 };
      return (
        <div
          style={{
            position: "absolute",
            width: len,
            height: len,
            ...vy,
            ...hx,
            opacity: uiReveal,
          }}
        >
          <div
            style={{
              position: "absolute",
              ...hx,
              ...(isT ? { top: 0 } : { bottom: 0 }),
              width: len,
              height: th,
              background: accent,
            }}
          />
          <div
            style={{
              position: "absolute",
              ...vy,
              ...(isL ? { left: 0 } : { right: 0 }),
              width: th,
              height: len,
              background: accent,
            }}
          />
        </div>
      );
    };

    return (
      <AbsoluteFill
        style={{
          opacity: globalOpacity,
          pointerEvents: "none",
          fontFamily: titleFont,
        }}
      >
        {/* 十字グリッド */}
        <div
          style={{
            position: "absolute",
            left: gridX,
            top: 0,
            bottom: 0,
            width: 1,
            background: `${accent}59`,
            opacity: uiReveal,
          }}
        />
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            top: 116,
            height: 1,
            background: `${accent}59`,
            opacity: uiReveal,
          }}
        />
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            bottom: 150,
            height: 1,
            background: `${accent}33`,
            opacity: uiReveal,
          }}
        />

        {/* 等幅ラベル群 */}
        <div
          style={{
            position: "absolute",
            left: 64,
            top: 78,
            color: accent,
            fontWeight: 700,
            fontSize: 26,
            letterSpacing: "0.28em",
            opacity: uiReveal,
          }}
        >
          {`SYS // ${shortCode(text)}`}
        </div>
        <div
          style={{
            position: "absolute",
            right: 64,
            top: 78,
            color: accent,
            fontWeight: 700,
            fontSize: 26,
            letterSpacing: "0.22em",
            opacity: uiReveal,
            display: "flex",
            alignItems: "center",
            gap: 12,
          }}
        >
          <span
            style={{
              width: 11,
              height: 11,
              borderRadius: "50%",
              background: "#ff5b5b",
              display: "inline-block",
              opacity: 0.6 + 0.4 * Math.abs(Math.sin(frame * 0.4)),
            }}
          />
          {`REC ${timecode(frame, fps)}`}
        </div>
        <div
          style={{
            position: "absolute",
            left: 64,
            bottom: 74,
            color: accent,
            fontWeight: 700,
            fontSize: 24,
            letterSpacing: "0.28em",
            opacity: uiReveal,
          }}
        >
          SCAN 100%
        </div>

        {/* 角ブラケット＋タイトル */}
        <AbsoluteFill
          style={{ alignItems: "center", justifyContent: "center" }}
        >
          <div
            style={{
              position: "relative",
              padding: `${bracketPad}px ${bracketPad}px`,
              minWidth: bw,
              transform: `scale(${0.94 + 0.06 * appear})`,
            }}
          >
            {bracket("tl")}
            {bracket("tr")}
            {bracket("bl")}
            {bracket("br")}
            {renderTitle(
              {
                fontSize,
                color,
                letterSpacing: "0.04em",
                textTransform: "uppercase",
                textShadow: `0 0 ${18 * glow}px ${accent}, 0 0 ${
                  42 * glow
                }px ${accent}cc`,
                opacity: 0.35 + 0.65 * appear,
              },
              900,
            )}
          </div>
        </AbsoluteFill>
      </AbsoluteFill>
    );
  }

  // =====================================================================
  // Preset 1 — EDITORIAL（雑誌的タイポ・クリーム＋ヘアライン）
  // =====================================================================
  if (preset === 1) {
    const cream = color === "#ffffff" ? "#efe9dd" : color;
    const drift = (1 - appear) * 40; // 下からわずかに浮き上がる
    const ruleW = interpolate(appear, [0, 1], [0, fontSize * 3.4]);
    const rule = (
      <div
        style={{
          width: ruleW,
          maxWidth: "78vw",
          height: 2,
          background: cream,
          opacity: 0.9,
        }}
      />
    );
    return (
      <AbsoluteFill
        style={{
          opacity: globalOpacity,
          pointerEvents: "none",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: titleFont,
        }}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: fontSize * 0.16,
            transform: `translateY(${drift}px)`,
          }}
        >
          {rule}
          {renderTitle(
            {
              fontSize,
              color: cream,
              letterSpacing: "0.02em",
              textTransform: "uppercase",
              opacity: appear,
              textShadow: "0 6px 40px rgba(0,0,0,0.45)",
            },
            900,
          )}
          {rule}
        </div>
      </AbsoluteFill>
    );
  }

  // =====================================================================
  // Preset 2 — BLUEPRINT（設計図・等幅・左→右クリップワイプ）
  // =====================================================================
  if (preset === 2) {
    const wipe = interpolate(appear, [0, 1], [0, 100]);
    const clip = `inset(0 ${100 - wipe}% 0 0)`;
    const tickCount = 24;
    const ticks = Array.from({ length: tickCount }, (_, i) => {
      const on = i / tickCount <= appear;
      const tall = i % 4 === 0;
      return (
        <div
          key={i}
          style={{
            width: 1,
            height: tall ? 16 : 9,
            background: color,
            opacity: on ? 0.75 : 0,
          }}
        />
      );
    });
    const railW = Math.min(width * 0.86, fontSize * lines[0].length * 0.72 + 200);
    const rail = (label: string) => (
      <div
        style={{
          width: railW,
          maxWidth: "86vw",
          display: "flex",
          flexDirection: "column",
          gap: 6,
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between" }}>
          <span
            style={{
              color,
              fontSize: 22,
              fontWeight: 700,
              letterSpacing: "0.3em",
              opacity: 0.8 * appear,
            }}
          >
            {label}
          </span>
          <span
            style={{
              color,
              fontSize: 22,
              fontWeight: 700,
              letterSpacing: "0.3em",
              opacity: 0.8 * appear,
            }}
          >
            {shortCode(text)}
          </span>
        </div>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-end",
            height: 16,
          }}
        >
          {ticks}
        </div>
      </div>
    );
    return (
      <AbsoluteFill
        style={{
          opacity: globalOpacity,
          pointerEvents: "none",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: titleFont,
        }}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: fontSize * 0.14,
          }}
        >
          {rail("01 // TITLE")}
          <div style={{ clipPath: clip, WebkitClipPath: clip }}>
            {renderTitle(
              {
                fontSize,
                color,
                letterSpacing: "0.14em",
                textTransform: "uppercase",
                fontWeight: 700,
              },
              700,
            )}
          </div>
          {rail("REC // 100%")}
        </div>
      </AbsoluteFill>
    );
  }

  // =====================================================================
  // Preset 3 — DISPLAY（極太・マスクせり上がり）
  // =====================================================================
  if (preset === 3) {
    const rise = interpolate(appear, [0, 1], [1.15, 0]); // 行高ぶん下から
    const track = interpolate(appear, [0, 1], [0.16, 0.0]);
    return (
      <AbsoluteFill
        style={{
          opacity: globalOpacity,
          pointerEvents: "none",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: titleFont,
        }}
      >
        <div style={{ overflow: "hidden", padding: "0.12em 0.2em" }}>
          <div
            style={{
              transform: `translateY(${rise * 100}%)`,
            }}
          >
            {renderTitle(
              {
                fontSize: fontSize * 1.15,
                color,
                letterSpacing: `${track}em`,
                textTransform: "uppercase",
                textShadow: "0 8px 44px rgba(0,0,0,0.5)",
              },
              900,
            )}
          </div>
        </div>
      </AbsoluteFill>
    );
  }

  // =====================================================================
  // Preset 4 — BRACKET（全幅ライン＋角括弧＋ラベル）
  // =====================================================================
  const lineW = interpolate(appear, [0, 1], [0, 46]); // 中央から左右へ %
  const line = (
    <div
      style={{
        position: "relative",
        width: "100%",
        height: 2,
        display: "flex",
        justifyContent: "center",
      }}
    >
      <div
        style={{
          width: `${lineW}%`,
          height: "100%",
          background: color,
          opacity: 0.85,
        }}
      />
    </div>
  );
  const bracketMark = (left: boolean) => {
    const st: React.CSSProperties = {
      position: "absolute",
      top: "50%",
      transform: "translateY(-50%)",
      width: fontSize * 0.22,
      height: fontSize * 0.9,
      borderTop: `3px solid ${color}`,
      borderBottom: `3px solid ${color}`,
      opacity: appear,
    };
    if (left) {
      st.left = -fontSize * 0.55;
      st.borderLeft = `3px solid ${color}`;
    } else {
      st.right = -fontSize * 0.55;
      st.borderRight = `3px solid ${color}`;
    }
    return <div style={st} />;
  };
  return (
    <AbsoluteFill
      style={{
        opacity: globalOpacity,
        pointerEvents: "none",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: titleFont,
      }}
    >
      <div
        style={{
          width: "80vw",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: fontSize * 0.2,
        }}
      >
        <span
          style={{
            color,
            fontSize: 24,
            fontWeight: 700,
            letterSpacing: "0.42em",
            textTransform: "uppercase",
            opacity: 0.7 * appear,
          }}
        >
          {shortCode(text)}
        </span>
        {line}
        <div style={{ position: "relative", padding: "0 0.1em" }}>
          {bracketMark(true)}
          {bracketMark(false)}
          {renderTitle(
            {
              fontSize,
              color,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              opacity: appear,
            },
            900,
          )}
        </div>
        {line}
      </div>
    </AbsoluteFill>
  );
};
