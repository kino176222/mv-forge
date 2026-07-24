import React from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";

/**
 * MvOverlayLightLeak — 暖色の光漏れ・フィルム焼け・シネマ照明を元映像の上に
 * 重ねる光オーバーレイ家族のクリーンルーム実装（技法メモのみを根拠に白紙から作成）。
 *
 * 構成の考え方:
 *   元映像(children)は最下層に全面表示し、その上に screen（加算系）の
 *   放射グラデーションを何枚も重ねて光のにじみを描く。白飛びの頂点だけ
 *   plus-lighter の小さなコアを足し、照明系は multiply のライトマップを
 *   1枚挟んで「暗くする層」を持つ。粒状は overlay の中立グレー・ノイズタイル。
 *
 * variant(0..1) → 4プリセット:
 *   0.00 EMBER  縁の焼けが4つの時間窓でふわっと重なる（台形フェード＋白飛びコア＋縦筋）
 *   0.33 PLUME  短尺の抜け専用。暗ティール下地＋黄〜赤の縦にじみ3枚、頭最大→終端0
 *   0.66 LAMP   右上光源の定常照明。乗算ライトマップ＋ボケ玉の緩回転＋漂う塵
 *   1.00 DECAY  イベント表駆動のバーン群＋毎フレーム引き直す埃・毛＋グレイン
 *
 * 時間は常に秒で扱う。振り付けはテンプレ基準秒（進行率×テンプレ尺）に写像して
 * 尺可変に比例伸縮し、フリッカー等の速い揺らぎは実時間の 1/24 秒 tick で刻む。
 * 完全決定論（Math.random 不使用）。px 値はフルHD幅基準でスケール。
 */
export interface MvOverlayLightLeakProps {
  children: React.ReactNode;
  durationInFrames: number;
  intensity?: number; // 0..100（1以下なら 0..1 として解釈。省略時=最大）
  variant?: number; // 0..1 家族内の見た目分岐
  tint?: string; // 任意: 画面全体へ薄く掛ける色被せ（soft-light）
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

// 頭と尻に緩急を乗せる smoothstep
const ease = (t: number) => {
  const x = clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
};

// sin の山（0→1→0）を少し尖らせた寿命カーブ
const hill = (t: number) => {
  const x = clamp(t, 0, 1);
  return Math.pow(Math.sin(Math.PI * x), 1.35);
};

// 決定論ハッシュ（0..1）
const hash01 = (n: number) => {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453123;
  return x - Math.floor(x);
};

// 低周波ワンダー: 周波数と位相をずらした正弦波3本の和（-1..1）
const wander = (t: number, seed: number) => {
  const p1 = hash01(seed * 3 + 1) * 6.283;
  const p2 = hash01(seed * 5 + 2) * 6.283;
  const p3 = hash01(seed * 7 + 3) * 6.283;
  return (
    (Math.sin(t * 0.61 + p1) + 0.6 * Math.sin(t * 1.27 + p2) + 0.35 * Math.sin(t * 2.09 + p3)) /
    1.95
  );
};

// overlay 合成用の中立グレー・ノイズタイル（彩度ゼロ化した手続きノイズ）
const GRAIN_SVG = `<svg xmlns='http://www.w3.org/2000/svg' width='256' height='256'><filter id='g'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' seed='7' stitchTiles='stitch'/><feColorMatrix type='saturate' values='0'/></filter><rect width='256' height='256' filter='url(#g)' opacity='0.9'/></svg>`;
const GRAIN_URL = `url("data:image/svg+xml;utf8,${encodeURIComponent(GRAIN_SVG)}")`;

// プリセットごとのテンプレ尺（秒）。振り付けはこの秒に写像して伸縮する
const TEMPLATE_SEC = [10, 61 / 24, 10, 10];

export const MvOverlayLightLeak: React.FC<MvOverlayLightLeakProps> = ({
  children,
  durationInFrames,
  intensity,
  variant = 0,
  tint,
}) => {
  const frame = useCurrentFrame();
  const { width, height, fps } = useVideoConfig();
  const dur = Math.max(1, durationInFrames);
  const s = width / 1920; // フルHD幅基準の解像度スケール
  const minDim = Math.min(width, height);

  const k =
    intensity === undefined ? 1 : clamp(intensity > 1 ? intensity / 100 : intensity, 0, 1);
  const v = clamp(variant, 0, 1);
  const preset = Math.round(v * 3); // 0..3

  const sec = frame / fps; // 実時間（秒）
  const p = clamp(frame / Math.max(1, dur - 1), 0, 1); // 進行率
  const u = p * TEMPLATE_SEC[preset]; // テンプレ基準秒
  const tick = Math.floor(sec * 24); // 1/24秒刻みの整数tick（fps非依存）
  const flick = 0.9 + 0.2 * hash01(tick * 13 + preset * 101); // ±1割のチラつき

  // 焼けプルーム1個ぶんの描画（EMBER / DECAY 共用）
  // b: 明るさ 0..1 / whiten: コアの白飛び量 0..1
  const burn = (opts: {
    key: string;
    cx: number; // px
    cy: number; // px
    r: number; // px（にじみ半径の目安）
    b: number;
    whiten: number;
    rot: number; // deg
    seed: number;
    streak?: boolean;
  }) => {
    const { cx, cy, r, b, whiten, rot, seed } = opts;
    const w = r * 3.1;
    const h = r * 2.4;
    const jitterX = (hash01(tick * 7 + seed * 29) - 0.5) * 10 * s;
    return (
      <div
        key={opts.key}
        style={{
          position: "absolute",
          left: cx - w / 2,
          top: cy - h / 2,
          width: w,
          height: h,
          transform: `rotate(${rot}deg)`,
          pointerEvents: "none",
        }}
      >
        {/* 暖色プルーム: 中心クリーム→琥珀→橙→深い赤茶→透明 */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            background:
              "radial-gradient(ellipse at 50% 50%, rgba(255,244,220,0.95) 0%, rgba(255,178,94,0.85) 20%, rgba(255,116,46,0.6) 44%, rgba(150,46,16,0.35) 66%, rgba(150,46,16,0) 82%)",
            filter: `blur(${28 * s}px)`,
            mixBlendMode: "screen",
            opacity: clamp(b, 0, 1),
          }}
        />
        {/* 白飛びコア: 純加算の小レイヤーで飽和させる */}
        <div
          style={{
            position: "absolute",
            left: "32%",
            top: "28%",
            width: "36%",
            height: "44%",
            background:
              "radial-gradient(ellipse at 50% 50%, rgba(255,252,242,0.9) 0%, rgba(255,224,170,0.4) 45%, rgba(255,224,170,0) 75%)",
            filter: `blur(${10 * s}px)`,
            mixBlendMode: "plus-lighter",
            opacity: clamp(b * whiten, 0, 1),
          }}
        />
        {/* 縦筋ハレーション: 細い縦縞を放射マスクで光源近傍だけに */}
        {opts.streak !== false && (
          <div
            style={{
              position: "absolute",
              inset: "6%",
              backgroundImage:
                "repeating-linear-gradient(90deg, rgba(255,226,186,0.5) 0px, rgba(255,226,186,0.5) 2px, rgba(255,226,186,0) 2px, rgba(255,226,186,0) 8px)",
              backgroundPositionX: jitterX,
              WebkitMaskImage:
                "radial-gradient(ellipse at 50% 50%, rgba(0,0,0,1) 18%, rgba(0,0,0,0) 68%)",
              maskImage:
                "radial-gradient(ellipse at 50% 50%, rgba(0,0,0,1) 18%, rgba(0,0,0,0) 68%)",
              filter: `blur(${1.6 * s}px)`,
              mixBlendMode: "screen",
              opacity: clamp(b * b * 0.6, 0, 1),
            }}
          />
        )}
      </div>
    );
  };

  let overlays: React.ReactNode = null;
  let childFilter: string | undefined;

  if (preset === 0) {
    // ---- EMBER: 4つの時間窓で縁の焼けがふわっと重なる ----
    // 各窓に台形フェード。明るさに sin山＋チラつき、面積が育つほどコアを白へ
    const windows = [
      { t0: 0.3, t1: 3.4, cx: 0.07, cy: 0.44, rot: -9 },
      { t0: 2.7, t1: 6.0, cx: 0.9, cy: 0.16, rot: 13 },
      { t0: 5.2, t1: 8.3, cx: 0.15, cy: 0.86, rot: -21 },
      { t0: 7.2, t1: 9.9, cx: 0.93, cy: 0.55, rot: 6 },
    ];
    const pop = Math.min(ease(sec / 0.2), ease(((dur - 1 - frame) / fps) / 0.2)); // ハードポップ回避
    overlays = (
      <>
        {windows.map((wd, i) => {
          const local = (u - wd.t0) / (wd.t1 - wd.t0);
          if (local <= 0 || local >= 1) return null;
          const trap = Math.min(ease((u - wd.t0) / 0.55), ease((wd.t1 - u) / 0.55), 1);
          const life = 0.55 + 0.45 * hill(local); // 燃えの息づかい
          const b = trap * life * flick * k * pop;
          const grow = 1 + 0.3 * hill(local);
          const cx = (wd.cx + 0.035 * wander(sec, i * 11 + 2)) * width;
          const cy = (wd.cy + 0.03 * wander(sec, i * 17 + 5)) * height;
          return burn({
            key: `ember-${i}`,
            cx,
            cy,
            r: minDim * 0.3 * grow,
            b,
            whiten: 0.35 + 0.6 * hill(local), // 面積が大きいほど白飛び
            rot: wd.rot + 4 * wander(sec, i * 23 + 7),
            seed: i + 1,
          });
        })}
      </>
    );
  } else if (preset === 1) {
    // ---- PLUME: 短尺の抜け専用。頭最大→終端0、極短フェードインでポップ回避 ----
    const env = ease(sec / 0.2) * (1 - p) * k; // 頭最大→終端へ直線的に0
    const plumes = [
      { x: 0.28, wRatio: 0.2, colA: "rgba(255,214,120,0.9)", colB: "rgba(255,140,50,0.55)", seed: 31 },
      { x: 0.54, wRatio: 0.26, colA: "rgba(255,170,70,0.85)", colB: "rgba(210,70,30,0.5)", seed: 47 },
      { x: 0.79, wRatio: 0.17, colA: "rgba(255,120,60,0.8)", colB: "rgba(160,36,24,0.5)", seed: 59 },
    ];
    overlays = (
      <AbsoluteFill
        style={{
          mixBlendMode: "screen",
          opacity: clamp(env, 0, 1),
          // 強ブラー（画面幅の3%弱）＋軽いレベル補正近似で実写素材っぽいにじみに
          filter: `blur(${width * 0.026}px) contrast(1.18) saturate(1.25)`,
          pointerEvents: "none",
        }}
      >
        {/* 暗ティール下地: screenで載せてもごく僅かしか持ち上がらない暗さ */}
        <AbsoluteFill
          style={{
            background: "linear-gradient(180deg, #071a1e 0%, #0a2329 60%, #06161a 100%)",
          }}
        />
        {/* 黄〜赤の縦にじみプルーム3枚。低周波ワンダーで呼吸 */}
        {plumes.map((pl, i) => {
          const px = (pl.x + 0.022 * wander(sec, pl.seed)) * width;
          const breathe = 1 + 0.08 * wander(sec * 1.3, pl.seed + 4);
          return (
            <div
              key={`plume-${i}`}
              style={{
                position: "absolute",
                left: px - width * pl.wRatio * 0.5,
                top: "-25%",
                width: width * pl.wRatio,
                height: "150%",
                background: `radial-gradient(ellipse 50% 46% at 50% ${44 + 8 * wander(sec * 0.8, pl.seed + 9)}%, ${pl.colA} 0%, ${pl.colB} 46%, rgba(120,30,16,0) 74%)`,
                transform: `scaleY(${breathe})`,
              }}
            />
          );
        })}
        {/* 差し色: 薄いシアンのウォッシュを1発だけ */}
        <div
          style={{
            position: "absolute",
            left: "2%",
            top: "10%",
            width: "34%",
            height: "70%",
            background:
              "radial-gradient(ellipse at 50% 50%, rgba(120,220,230,0.22) 0%, rgba(120,220,230,0) 70%)",
          }}
        />
      </AbsoluteFill>
    );
  } else if (preset === 2) {
    // ---- LAMP: 右上から差す定常の暖色照明。エンベロープ無し ----
    const srcX = (0.87 + 0.02 * wander(sec, 71)) * width;
    const srcY = (0.1 + 0.02 * wander(sec, 73)) * height;
    const breathe = 1 + 0.07 * wander(sec * 0.9, 79);
    const bokehCols = [
      "rgba(110,170,180,0.16)",
      "rgba(150,120,190,0.13)",
      "rgba(190,200,120,0.14)",
      "rgba(100,150,200,0.12)",
      "rgba(200,150,110,0.15)",
      "rgba(120,190,160,0.12)",
    ];
    const dustCount = 12;
    overlays = (
      <>
        {/* 乗算ライトマップ: ビネット＋左=青ティール→右=暖グレーの斜めグラデ */}
        <AbsoluteFill
          style={{
            background:
              "linear-gradient(115deg, rgba(26,48,58,0.85) 0%, rgba(70,72,70,0.45) 55%, rgba(120,96,66,0.18) 100%), radial-gradient(ellipse 80% 75% at 62% 40%, rgba(255,255,255,0) 45%, rgba(10,14,18,0.75) 100%)",
            mixBlendMode: "multiply",
            opacity: 0.62 * k,
            pointerEvents: "none",
          }}
        />
        {/* 主光源: 右上の暖色にじみ（呼吸＋微ワンダー） */}
        <div
          style={{
            position: "absolute",
            left: srcX - minDim * 0.85,
            top: srcY - minDim * 0.72,
            width: minDim * 1.7,
            height: minDim * 1.44,
            background:
              "radial-gradient(ellipse at 50% 50%, rgba(255,232,190,0.85) 0%, rgba(255,180,100,0.5) 30%, rgba(200,110,50,0.22) 55%, rgba(200,110,50,0) 78%)",
            filter: `blur(${30 * s}px)`,
            transform: `scale(${breathe}) rotate(${3 * wander(sec * 0.7, 83)}deg)`,
            mixBlendMode: "screen",
            opacity: 0.85 * k * flick,
            pointerEvents: "none",
          }}
        />
        {/* 光源コア: 純加算で白飛びの頂点 */}
        <div
          style={{
            position: "absolute",
            left: srcX - minDim * 0.16,
            top: srcY - minDim * 0.14,
            width: minDim * 0.32,
            height: minDim * 0.28,
            background:
              "radial-gradient(ellipse at 50% 50%, rgba(255,250,238,0.8) 0%, rgba(255,236,200,0) 70%)",
            filter: `blur(${16 * s}px)`,
            mixBlendMode: "plus-lighter",
            opacity: 0.55 * k,
            pointerEvents: "none",
          }}
        />
        {/* ボケ玉: 彩度低めの大玉を極薄alphaで、レイヤーごと緩回転（縁が出ないよう大きめに） */}
        <AbsoluteFill
          style={{
            inset: "-25%",
            width: "150%",
            height: "150%",
            transform: `rotate(${sec * 1.6}deg)`,
            mixBlendMode: "screen",
            opacity: k,
            pointerEvents: "none",
          }}
        >
          {bokehCols.map((col, i) => {
            const bx = 12 + hash01(i * 19 + 4) * 76;
            const by = 10 + hash01(i * 31 + 8) * 80;
            const br = minDim * (0.1 + 0.12 * hash01(i * 41 + 6));
            return (
              <div
                key={`bokeh-${i}`}
                style={{
                  position: "absolute",
                  left: `calc(${bx}% - ${br}px)`,
                  top: `calc(${by}% - ${br}px)`,
                  width: br * 2,
                  height: br * 2,
                  borderRadius: "50%",
                  background: `radial-gradient(circle at 50% 50%, ${col} 0%, ${col} 55%, rgba(0,0,0,0) 78%)`,
                  filter: `blur(${8 * s}px)`,
                }}
              />
            );
          })}
        </AbsoluteFill>
        {/* 漂う塵: ゆっくり上昇＋横に正弦揺れ、画面端でラップ。光源に近いほど明るい */}
        {Array.from({ length: dustCount }).map((_, i) => {
          const h1 = hash01(i * 13 + 2);
          const h2 = hash01(i * 29 + 5);
          const h3 = hash01(i * 43 + 9);
          const speed = 0.014 + 0.028 * h1; // 画面比/秒
          const sway = 0.01 + 0.02 * h2;
          const phase = h3 * 6.283;
          const y0 = hash01(i * 57 + 11);
          const yy = ((y0 - sec * speed) % 1.2 + 1.2) % 1.2 - 0.1;
          const xx = hash01(i * 71 + 3) + sway * Math.sin(sec * (0.5 + h2) + phase);
          const dx = xx * width;
          const dy = yy * height;
          const dist = Math.hypot(dx - srcX, dy - srcY) / minDim;
          const near = clamp(1.15 - dist * 0.75, 0.15, 1);
          const blink = 0.55 + 0.45 * Math.sin(sec * (1.2 + h1 * 1.6) + phase * 2);
          const dr = (1.4 + 2.6 * h2 * h2) * s;
          return (
            <div
              key={`dust-${i}`}
              style={{
                position: "absolute",
                left: dx,
                top: dy,
                width: dr * 2,
                height: dr * 2,
                borderRadius: "50%",
                background: "rgba(255,238,210,0.85)",
                filter: `blur(${0.8 * s}px)`,
                mixBlendMode: "screen",
                opacity: clamp(0.7 * near * blink * k, 0, 1),
                pointerEvents: "none",
              }}
            />
          );
        })}
      </>
    );
  } else {
    // ---- DECAY: イベント表駆動のバーン群＋毎フレームの埃・毛＋グレイン ----
    childFilter = "contrast(1.06) saturate(1.03)"; // 元映像への軽いコントラスト締め
    const env =
      Math.min(ease(sec / 0.7), ease(((dur - 1 - frame) / fps) / 0.7)) * k;
    // イベント表: 開始・寿命・位置・大きさ・ピークを決定論で並べる（テンプレ秒）
    const events = Array.from({ length: 6 }).map((_, i) => {
      const h1 = hash01(i * 101 + 17);
      const h2 = hash01(i * 103 + 19);
      const h3 = hash01(i * 107 + 23);
      const h4 = hash01(i * 109 + 29);
      const edgeLeft = h2 < 0.5;
      return {
        start: i * 1.45 + h1 * 0.9,
        life: 1.5 + h3 * 1.1,
        cx: edgeLeft ? 0.05 + h4 * 0.2 : 0.75 + h4 * 0.2,
        cy: 0.12 + h2 * 0.76,
        r: minDim * (0.16 + 0.14 * h3),
        peak: 0.65 + 0.35 * h1,
        rot: (h4 - 0.5) * 44,
      };
    });
    // 毎フレーム引き直す埃（小粒優勢の分布）と、たまに出る毛
    const dustN = 10;
    const dustDensity = hash01(tick * 3 + 41) < 0.8; // 確率で間引いて密度を揺らす
    const hairOn = hash01(tick * 17 + 3) < 0.16;
    const hairX = hash01(tick * 23 + 7) * width;
    const hairY = hash01(tick * 31 + 11) * height;
    const hairRot = hash01(tick * 37 + 13) * 360;
    const hairLen = (30 + 50 * hash01(tick * 41 + 17)) * s;
    overlays = (
      <>
        {events.map((ev, i) => {
          const local = (u - ev.start) / ev.life;
          if (local <= 0 || local >= 1) return null;
          const b = hill(local) * ev.peak * flick * env;
          const grow = 1 + 0.13 * ease(local); // 燃え広がりでひと回り成長
          return burn({
            key: `decay-${i}`,
            cx: ev.cx * width,
            cy: ev.cy * height,
            r: ev.r * grow,
            b,
            whiten: 0.55 + 0.45 * hill(local), // 白金コア
            rot: ev.rot,
            seed: i + 51,
          });
        })}
        {/* 埃: 白い小円を毎フレーム配置し直す */}
        {dustDensity &&
          Array.from({ length: dustN }).map((_, j) => {
            const ha = hash01(tick * 131 + j * 7 + 1);
            const hb = hash01(tick * 137 + j * 11 + 2);
            const hc = hash01(tick * 139 + j * 13 + 3);
            if (hc > 0.72) return null;
            const dr = (0.7 + 2.8 * ha * ha) * s; // 二乗で小粒優勢
            return (
              <div
                key={`spec-${j}`}
                style={{
                  position: "absolute",
                  left: hb * width,
                  top: hash01(tick * 149 + j * 17 + 4) * height,
                  width: dr * 2,
                  height: dr * 2,
                  borderRadius: "50%",
                  background: "rgba(255,250,240,0.9)",
                  mixBlendMode: "screen",
                  opacity: clamp((0.3 + 0.5 * hc) * env, 0, 1),
                  pointerEvents: "none",
                }}
              />
            );
          })}
        {/* 毛: 細長い角丸矩形をランダム回転＋軽いスキューで、たまにだけ */}
        {hairOn && (
          <div
            style={{
              position: "absolute",
              left: hairX,
              top: hairY,
              width: 1.6 * s,
              height: hairLen,
              borderRadius: 2 * s,
              background: "rgba(245,240,232,0.75)",
              transform: `rotate(${hairRot}deg) skewX(${(hash01(tick * 43 + 19) - 0.5) * 24}deg)`,
              mixBlendMode: "screen",
              opacity: 0.7 * env,
              pointerEvents: "none",
            }}
          />
        )}
        {/* 粒状: 中立グレー・ノイズタイルを overlay で。tickで位置を揺らす */}
        <AbsoluteFill
          style={{
            backgroundImage: GRAIN_URL,
            backgroundSize: `${256 * s}px ${256 * s}px`,
            backgroundPosition: `${hash01(tick * 53 + 5) * 256 * s}px ${hash01(tick * 59 + 6) * 256 * s}px`,
            mixBlendMode: "overlay",
            opacity: 0.2 * env,
            pointerEvents: "none",
          }}
        />
      </>
    );
  }

  return (
    <AbsoluteFill style={{ isolation: "isolate", pointerEvents: "none" }}>
      {/* 元映像は最下層に全面表示（DECAYのみ軽いコントラスト締め） */}
      <AbsoluteFill style={childFilter ? { filter: childFilter } : undefined}>
        {children}
      </AbsoluteFill>
      {overlays}
      {tint && (
        <AbsoluteFill
          style={{
            background: `linear-gradient(135deg, ${tint}, transparent 55%, ${tint})`,
            mixBlendMode: "soft-light",
            opacity: 0.3 * k,
            pointerEvents: "none",
          }}
        />
      )}
    </AbsoluteFill>
  );
};
