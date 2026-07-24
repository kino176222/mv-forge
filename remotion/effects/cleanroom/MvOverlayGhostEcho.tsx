import React from "react";
import {
  AbsoluteFill,
  Sequence,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

/**
 * MvOverlayGhostEcho — 元映像(children)自身の複製だけを素材にした多重露光オーバーレイ。
 * クリーンルーム実装（技法メモとポスターの雰囲気のみを根拠に白紙から作成）。
 *
 * 原理: 下地の children は常に最下層でシャープ・不透明のまま残し、その複製を
 * 変形・ぼかし・明部抽出（コントラスト強調で暗部を黒に潰す）した層を screen
 * （1プリセットのみ color-dodge）で上に「足すだけ」。輪郭と暗部の担保は下地が持つ。
 *
 * variant(0..1) → 5プリセット:
 *   0.00 CLONES_MONO  モノクロ多重露光。3クローンが時差三角包絡で段階増殖(color-dodge)
 *   0.25 CLONES_DREAM 脱色→暖色再着色クローンの左右鏡像ペア×2波＋寒色ウォッシュ
 *   0.50 GLOW_TRAIL   明部抽出×2半径のブルーム＋真・過去フレーム残像3枚(指数減衰)
 *   0.75 SPIN_ECHO    中心回りの扇状回転残像11枚＋微ズーム＋無彩色ブルーム下地
 *   1.00 INK_DRIFT    下限クランプ正弦が駆動する水平ドリフト疑似トレイル8枚＋乳白もや
 *
 * 完全決定論的（乱数不使用）。intensity(0..100) はエンベロープ出力への乗算のみ。
 * ぼかし半径・オフセットは基準幅1920に対する出力幅比でスケール（解像度非依存）。
 */
export interface MvOverlayGhostEchoProps {
  children: React.ReactNode; // 下の絵。全面に描画して上に質感を重ねる
  durationInFrames: number;
  intensity?: number; // 0..100
  variant?: number; // 0..1 同家族内の見た目分岐（決定論的に）
  tint?: string; // 任意: 基調色の差し替え（空/未指定=デザイン既定）
}

const clamp = (n: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, n));

// 緩急づけ: 折れ線エンベロープの角を丸めるスムーズステップ
const smooth = (t: number) => {
  const c = clamp(t, 0, 1);
  return c * c * (3 - 2 * c);
};

// 三角エンベロープ（正規化進行 p が start..end の間で 0→1→0）
const tri = (p: number, start: number, end: number) => {
  if (p <= start || p >= end || end <= start) return 0;
  const t = (p - start) / (end - start);
  return t < 0.5 ? t * 2 : (1 - t) * 2;
};

const layerBase: React.CSSProperties = {
  position: "absolute",
  inset: 0,
  pointerEvents: "none",
};

export const MvOverlayGhostEcho: React.FC<MvOverlayGhostEchoProps> = ({
  children,
  durationInFrames,
  intensity = 100,
  variant = 0,
  tint,
}) => {
  const frame = useCurrentFrame();
  const { width, fps } = useVideoConfig();
  const dur = Math.max(1, durationInFrames);
  const k = clamp(intensity / 100, 0, 1);
  const preset = Math.round(clamp(variant, 0, 1) * 4); // 0..4
  const sc = width / 1920; // 解像度スケール
  const p = frame / dur; // 正規化進行 0..1
  const sec = frame / fps;

  // 台形エンベロープ: イン側は先頭基準・アウト側は終端基準で読み、min合成
  // （中盤ホールドが尺に応じて伸びる）。角はスムーズステップで丸める。
  const rise = Math.max(1, Math.min(dur * 0.2, fps * 1.2));
  const fall = Math.min(dur * 0.25, fps * 0.9);
  const fallStart = Math.max(0, Math.min(dur - fall, dur - 2));
  const eIn = interpolate(frame, [0, rise], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const eOut =
    dur >= 3
      ? interpolate(frame, [fallStart, dur - 1], [1, 0], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        })
      : 1;
  const E = smooth(Math.min(eIn, eOut)) * k; // 効果量（intensity込み）

  const hasTint = typeof tint === "string" && tint.length > 0;

  let rootFilter: string | undefined;
  let baseStyle: React.CSSProperties | undefined;
  const layers: React.ReactNode[] = [];

  if (preset === 0) {
    // ---- CLONES_MONO: モノクロ標準形 --------------------------------------
    // 最外殻でモノクロ化＋レベル補正近似。効果量に応じて恒等変換へ補間して
    // 自然に入り抜きする（効果量フェード）。
    rootFilter = `grayscale(${E}) contrast(${1 + 0.16 * E}) brightness(${
      1 + 0.05 * E
    })`;
    // 3クローン: 位置・拡大率を変え、時差スタートの三角包絡で 1→2→3 枚と増殖
    const clones = [
      { dx: -0.045, s: 1.06, a: 0.08, b: 0.6 },
      { dx: 0.038, s: 1.12, a: 0.26, b: 0.78 },
      { dx: -0.022, s: 1.19, a: 0.44, b: 0.97 },
    ];
    clones.forEach((c, i) => {
      const env = smooth(tri(p, c.a, c.b));
      const op = 0.4 * env * k; // 群全体の不透明度は4割程度に抑制
      if (op < 0.01) return;
      const breathe = 1 + 0.012 * Math.sin(sec * 1.4 + i * 2.1);
      layers.push(
        <div
          key={`mono-${i}`}
          style={{
            ...layerBase,
            mixBlendMode: "color-dodge",
            opacity: op,
            transform: `translateX(${c.dx * width * env}px) scale(${
              c.s * breathe
            })`,
            filter: `contrast(1.9) brightness(1.04) blur(${3 * sc}px)`,
          }}
        >
          {children}
        </div>,
      );
    });
    // 仕上げのソフトフォーカス: 大きめにぼかし数%拡大して縁の暗落ちを画面外へ
    if (E > 0.01) {
      layers.push(
        <div
          key="mono-soft"
          style={{
            ...layerBase,
            mixBlendMode: "screen",
            opacity: 0.3 * E,
            transform: "scale(1.06)",
            filter: `blur(${26 * sc}px) contrast(1.5) brightness(1.05)`,
          }}
        >
          {children}
        </div>,
      );
    }
  } else if (preset === 1) {
    // ---- CLONES_DREAM: カラーのドリーミー版 -------------------------------
    // 尺可変はテンプレ振付の比例伸縮方式（正規化進行 p で全振付を駆動）。
    const warm = hasTint ? (tint as string) : "#c8794e"; // 退色フィルム風の暖色
    const cool = "#3fa8a0"; // 空気づけの寒色ウォッシュ
    // 左右鏡像ペア×2波（前半=小ずらし小拡大、後半=大ずらし大拡大）
    const clones = [
      { dx: -0.03, s: 1.05, mirror: false, a: 0.04, b: 0.58 },
      { dx: 0.03, s: 1.05, mirror: true, a: 0.04, b: 0.58 },
      { dx: -0.085, s: 1.16, mirror: true, a: 0.38, b: 0.97 },
      { dx: 0.085, s: 1.16, mirror: false, a: 0.38, b: 0.97 },
    ];
    clones.forEach((c, i) => {
      const env = smooth(tri(p, c.a, c.b));
      const op = 0.5 * env * k;
      if (op < 0.01) return;
      const sx = c.mirror ? -c.s : c.s;
      layers.push(
        <div
          key={`dream-${i}`}
          style={{
            ...layerBase,
            mixBlendMode: "screen",
            opacity: op,
            transform: `translateX(${
              c.dx * width * env
            }px) scale(${sx}, ${c.s})`,
          }}
        >
          {/* 脱色→単色レイヤーをcolorで再着色＋overlayで深み足しの2段 */}
          <div style={{ ...layerBase, isolation: "isolate" }}>
            <AbsoluteFill
              style={{
                filter: `grayscale(1) contrast(1.55) brightness(1.06) blur(${
                  7 * sc
                }px)`,
              }}
            >
              {children}
            </AbsoluteFill>
            <AbsoluteFill
              style={{ background: warm, mixBlendMode: "color", opacity: 0.85 }}
            />
            <AbsoluteFill
              style={{
                background: warm,
                mixBlendMode: "overlay",
                opacity: 0.32,
              }}
            />
          </div>
        </div>,
      );
    });
    // 画面全体の空気づけ: 寒色を soft-light で薄く1枚（暖×寒の対比が要）
    if (E > 0.01) {
      layers.push(
        <AbsoluteFill
          key="dream-wash"
          style={{
            background: cool,
            mixBlendMode: "soft-light",
            opacity: 0.34 * E,
            pointerEvents: "none",
          }}
        />,
      );
    }
  } else if (preset === 2) {
    // ---- GLOW_TRAIL: 幾何クローン無しのグロウ特化 -------------------------
    // 暖色は素材由来で彩度を微増するのみ
    rootFilter = `saturate(${1 + 0.18 * E})`;
    // 明部抽出×2半径（広域ブルーム＋近接グロウ）。ブルームは無彩色寄り＝階調操作のみ
    if (E > 0.01) {
      layers.push(
        <div
          key="glow-wide"
          style={{
            ...layerBase,
            mixBlendMode: "screen",
            opacity: 0.45 * E,
            transform: "scale(1.05)",
            filter: `blur(${40 * sc}px) contrast(1.8) brightness(1.08)`,
          }}
        >
          {children}
        </div>,
        <div
          key="glow-near"
          style={{
            ...layerBase,
            mixBlendMode: "screen",
            opacity: 0.5 * E,
            transform: "scale(1.015)",
            filter: `blur(${10 * sc}px) contrast(1.95)`,
          }}
        >
          {children}
        </div>,
      );
    }
    // 真・過去フレーム残像: Sequence の開始オフセットで過去の映像を3枚。指数的減衰
    const echoes = [
      { delaySec: 0.12, op: 0.5 },
      { delaySec: 0.3, op: 0.33 },
      { delaySec: 0.6, op: 0.2 },
    ];
    echoes.forEach((e, i) => {
      const delay = Math.max(1, Math.round(e.delaySec * fps));
      const op = e.op * E;
      if (op < 0.01 || frame < delay) return;
      layers.push(
        <div
          key={`echo-${i}`}
          style={{
            ...layerBase,
            mixBlendMode: "screen",
            opacity: op,
            transform: `scale(${1 + (i + 1) * 0.008})`,
            filter: `contrast(1.7) brightness(1.03) blur(${2.5 * sc}px)`,
          }}
        >
          <Sequence from={delay} showInTimeline={false}>
            {children}
          </Sequence>
        </div>,
      );
    });
  } else if (preset === 3) {
    // ---- SPIN_ECHO: 回転残像（長尺向け） ----------------------------------
    // 下地にも微ぼかし＋正弦の微回転ゆらぎ
    const wobble = 0.45 * Math.sin((sec / 2.4) * Math.PI * 2) * E;
    baseStyle = {
      filter: `blur(${1.2 * sc * E}px)`,
      transform: `rotate(${wobble}deg)`,
    };
    // 無彩色ブルーム下地
    if (E > 0.01) {
      layers.push(
        <div
          key="spin-bloom"
          style={{
            ...layerBase,
            mixBlendMode: "screen",
            opacity: 0.3 * E,
            transform: "scale(1.04)",
            filter: `blur(${22 * sc}px) grayscale(1) contrast(1.8) brightness(1.06)`,
          }}
        >
          {children}
        </div>,
      );
    }
    // 現フレームを中心回りに段階回転（合計40度ほどの扇）＋1枚ごと微ズームで11枚
    const fan = 40 * E * (0.9 + 0.2 * Math.sin((sec / 3.4) * Math.PI * 2));
    for (let i = 1; i <= 11; i++) {
      const op = (0.3 - (i - 1) * 0.026) * E;
      if (op < 0.01) continue;
      const ang = (fan * i) / 11;
      const s = 1 + i * 0.013 * E;
      layers.push(
        <div
          key={`spin-${i}`}
          style={{
            ...layerBase,
            mixBlendMode: "screen",
            opacity: op,
            transform: `rotate(${ang}deg) scale(${s})`,
            filter: "contrast(1.65) brightness(1.02)",
          }}
        >
          {children}
        </div>,
      );
    }
  } else {
    // ---- INK_DRIFT: 疑似トレイル方式の代表 --------------------------------
    // 下限クランプ付き正弦オシレータが水平ドリフト＋横伸縮を駆動。
    // 過去時刻代入の8枚（線形減衰）が水平のインク滲みを作る。
    const osc = (f: number) => {
      const raw = Math.sin(((f / fps) * Math.PI * 2) / 3.2 + 0.7);
      return Math.max(raw, -0.25); // 下限クランプ
    };
    // 中盤ピークでコントラストが一段増す
    const midPeak = smooth(tri(p, 0.15, 0.85));
    baseStyle = { filter: `contrast(${1 + 0.22 * midPeak * k})` };
    const step = Math.max(1, Math.round(fps * 0.085));
    for (let i = 1; i <= 8; i++) {
      const op = (0.34 - (i - 1) * 0.04) * E; // 線形減衰
      if (op < 0.01) continue;
      const o = osc(frame - i * step); // 過去時刻を代入した変形で現フレームを描く
      const dx = o * 0.055 * width * E;
      const sx = 1 + o * 0.1 * E;
      layers.push(
        <div
          key={`ink-${i}`}
          style={{
            ...layerBase,
            mixBlendMode: "screen",
            opacity: op,
            transform: `translateX(${dx}px) scale(${sx}, ${1 + o * 0.015 * E})`,
            filter: `contrast(1.7) brightness(1.02) blur(${3.5 * sc}px)`,
          }}
        >
          {children}
        </div>,
      );
    }
    // 超大ぼかしの乳白もや層がゆっくり漂動
    if (E > 0.01) {
      const hx = 0.02 * width * Math.sin((sec / 6) * Math.PI * 2);
      const hy = 0.01 * width * Math.sin((sec / 8.5) * Math.PI * 2 + 1.3);
      layers.push(
        <div
          key="ink-haze"
          style={{
            ...layerBase,
            mixBlendMode: "screen",
            opacity: 0.22 * E,
            transform: `translate(${hx}px, ${hy}px) scale(1.1)`,
            filter: `blur(${60 * sc}px) brightness(1.25)`,
          }}
        >
          {children}
        </div>,
      );
      if (hasTint) {
        layers.push(
          <AbsoluteFill
            key="ink-tint"
            style={{
              background: tint,
              mixBlendMode: "soft-light",
              opacity: 0.25 * E,
              pointerEvents: "none",
            }}
          />,
        );
      }
    }
  }

  // tint指定があるのに基調色の出番が無いプリセットには、薄い空気づけとして1枚
  if (hasTint && (preset === 0 || preset === 2 || preset === 3) && E > 0.01) {
    layers.push(
      <AbsoluteFill
        key="tint-wash"
        style={{
          background: tint,
          mixBlendMode: "soft-light",
          opacity: 0.22 * E,
          pointerEvents: "none",
        }}
      />,
    );
  }

  return (
    <AbsoluteFill
      style={{ isolation: "isolate", background: "#000", pointerEvents: "none" }}
    >
      <AbsoluteFill style={{ filter: rootFilter }}>
        {/* 下地: 元映像そのまま（個体により軽い色調補正のみ） */}
        <AbsoluteFill style={baseStyle}>{children}</AbsoluteFill>
        {layers}
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
