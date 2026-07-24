import React, { useId, useMemo } from "react";
import {
  AbsoluteFill,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

/**
 * MvTransitionRoll — ロール系カット切替（クリーンルーム実装）
 *
 * 機能: from/to の2枚を「方向モーションブラー＋色収差＋ズーム突進」で繋ぐ
 *       約1秒のトランジション。切替はブラーが最大になる中央の山頂で行い、
 *       継ぎ目をボケの中に隠す。
 *
 * 設計メモ:
 * - 進行を 0..1 に正規化し、ほぼ全パラメータを「台形包絡」（序盤0 → 中央直前で
 *   最大 → 短いプラトー → 終盤0）で駆動。最終フレームは完全にクリーンな to。
 * - 方向ブラーと色収差は1本のSVGフィルタに直列で実装（軸別feGaussianBlur →
 *   R/G/B分離 → R/Bを進行軸に逆向きオフセット → screenで再合成）。
 * - 乱数はすべて (seed, index, salt) の決定的ハッシュ。Math.random 不使用。
 * - 全px量に width/1920 のスケールを掛けて解像度非依存。
 * - 強ブラー時のレイヤー縁の黒透けは、包絡比例の微拡大で隠す。
 * - 色の個性はオーバーレイ層が担当（screenの光もの / saturation・soft-light・
 *   multiplyのグレード）。本体はごく軽い調整のみ。
 */

export interface MvTransitionRollProps {
  /** 去っていく側の絵 */
  from: React.ReactNode;
  /** 入ってくる側の絵 */
  to: React.ReactNode;
  /** トランジション全体の長さ（フレーム） */
  durationInFrames: number;
  /** ロールの進行方向（forward/backward はズーム主体の派生） */
  direction?: "left" | "right" | "up" | "down" | "forward" | "backward";
  /** 0..1 の個体差シード。手ぶれ・ダスト等の乱数と微調整に使う */
  variant?: number;
}

/** 決定的な擬似乱数 0..1（sin ハッシュ） */
const hashRand = (a: number, b: number, c: number): number => {
  const s = Math.sin(a * 91.17 + b * 267.3 + c * 53.7) * 42871.4523;
  return s - Math.floor(s);
};

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

const easeInOutCubic = (t: number) =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

const CLAMP = {
  extrapolateLeft: "clamp",
  extrapolateRight: "clamp",
} as const;

/** R/G/B 単チャンネル抽出用の feColorMatrix values */
const CH = {
  r: "1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0",
  g: "0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0",
  b: "0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0",
};

export const MvTransitionRoll: React.FC<MvTransitionRollProps> = ({
  from,
  to,
  durationInFrames,
  direction = "left",
  variant = 0.5,
}) => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const rawId = useId();
  const uid = useMemo(() => rawId.replace(/[^a-zA-Z0-9_-]/g, ""), [rawId]);

  const sc = width / 1920; // 解像度スケール（px量は1920幅基準）
  const seed = Math.floor(variant * 997) + 13;
  const vJit = 0.9 + 0.2 * (hashRand(seed, 1, 1) * 0.5 + variant * 0.5); // 個体差 ±10%

  const last = Math.max(1, durationInFrames - 1);
  const p = clamp01(frame / last);

  // ---- 方向設定 -----------------------------------------------------------
  const horizontal = direction === "left" || direction === "right";
  const vertical = direction === "up" || direction === "down";
  const depth = direction === "forward" || direction === "backward";
  const dx = direction === "left" ? -1 : direction === "right" ? 1 : 0;
  const dy = direction === "up" ? -1 : direction === "down" ? 1 : 0;

  // ロール移動量（画面比）: 個体差が大きい部分
  const rollAmt =
    direction === "right"
      ? 0.33
      : direction === "left"
        ? 0.14
        : direction === "down"
          ? 0.25
          : direction === "up"
            ? 0.035
            : 0; // forward/backward は平行移動なし
  const amt = rollAmt * vJit;

  // ズーム突進量
  const zoomAmt = depth
    ? direction === "forward"
      ? 0.42
      : -0.22
    : direction === "up"
      ? 0.32
      : direction === "down"
        ? 0.28
        : direction === "left"
          ? 0.24
          : 0.2;

  // ---- 包絡（家族の心臓: 中央集中の台形） ---------------------------------
  // 序盤 ~13% は 0 のまま → 中央直前に立ち上がり → 44〜49% にプラトー → 終盤 0
  const env = interpolate(
    p,
    [0, 0.13, 0.44, 0.49, 0.82, 1],
    [0, 0.05, 1, 1, 0.25, 0],
    CLAMP
  );
  // 光もの用の広い窓（余韻を作る）
  const lightEnv = interpolate(p, [0.22, 0.4, 0.58, 0.78], [0, 1, 1, 0], CLAMP);
  // 中盤の白フラッシュ
  const flash = interpolate(p, [0.38, 0.465, 0.62], [0, 1, 0], CLAMP);

  // ---- カット切替（山頂でクロスフェード） ---------------------------------
  const fadeHalf = direction === "down" ? 0.13 : 0.09;
  const toOpacity = interpolate(
    p,
    [0.47 - fadeHalf, 0.47 + fadeHalf],
    [0, 1],
    CLAMP
  );

  // ---- ロール移動（中盤最速の一往復） -------------------------------------
  const travel = easeInOutCubic(p); // 0→1、中央で最速
  const fromShiftX = dx * amt * travel * width;
  const fromShiftY = dy * amt * travel * height;
  const toShiftX = dx * amt * (travel - 1) * width;
  const toShiftY = dy * amt * (travel - 1) * height;

  // ---- ズーム＋手ぶれ（ステージ） -----------------------------------------
  const zoom = 1 + zoomAmt * env;
  const shakeIdx = Math.floor(p * durationInFrames * 3); // フレームより速い更新
  const mainAmp = 16 * sc * env;
  const crossAmp = 8 * sc * env;
  const shakeX =
    (hashRand(seed, shakeIdx, 5) - 0.5) * 2 * (vertical ? crossAmp : mainAmp);
  const shakeY =
    (hashRand(seed, shakeIdx, 6) - 0.5) * 2 * (horizontal ? crossAmp : mainAmp);

  // ---- 方向ブラー＋色収差の量 ---------------------------------------------
  const blurMax = 82 * sc; // 画面幅の4%強
  const bx = horizontal ? blurMax * env : depth ? 30 * sc * env : 2 * sc * env;
  const by = vertical ? blurMax * env : depth ? 30 * sc * env : 2 * sc * env;
  const abMax = 19 * sc; // 幅の1%前後
  const abX = (horizontal ? 1 : depth ? 0.4 : 0.1) * abMax * env;
  const abY = (vertical ? 1 : depth ? 0.4 : 0.1) * abMax * env;
  const filterOn = env > 0.015;
  // ボケ縁の黒透けを隠す微拡大
  const edgeHide = 1 + 0.09 * env;

  // ---- 本体のグレード（軽微。色は overlay 層が担当） ----------------------
  const bodyGrade =
    direction === "left"
      ? `contrast(${(1 + 0.08 * env).toFixed(3)}) saturate(${(1 - 0.06 * env).toFixed(3)})`
      : direction === "down"
        ? `saturate(${(1 - 0.18 * env).toFixed(3)}) brightness(${(1 - 0.05 * env).toFixed(3)})`
        : `saturate(${(1 - 0.05 * env).toFixed(3)})`;

  // ---- レイヤー描画ヘルパー ------------------------------------------------
  const layer = (
    node: React.ReactNode,
    tx: number,
    ty: number,
    opacity: number,
    key: string
  ) => (
    <AbsoluteFill
      key={key}
      style={{
        opacity,
        filter: filterOn ? `url(#${uid}-mb)` : undefined,
        transform: `translate(${tx.toFixed(1)}px, ${ty.toFixed(1)}px) scale(${edgeHide.toFixed(4)})`,
      }}
    >
      {node}
    </AbsoluteFill>
  );

  // ---- 個体別の飾り（決定的乱数のダスト／スクラッチ） ----------------------
  const flickIdx = Math.floor(frame / 2);
  const dusts =
    direction === "left"
      ? Array.from({ length: 14 }, (_, i) => {
          const on = hashRand(seed, Math.floor(frame / 3), 500 + i) > 0.55;
          return {
            i,
            on,
            x: hashRand(seed, i, 71) * 96 + 2,
            y: hashRand(seed, i, 72) * 92 + 4,
            r: (1.6 + hashRand(seed, i, 73) * 3.4) * sc,
            darkDot: hashRand(seed, i, 74) > 0.6,
          };
        })
      : [];
  const scratchCount = direction === "left" || direction === "up" ? 3 : 0;
  const scratches = Array.from({ length: scratchCount }, (_, i) => ({
    i,
    x: hashRand(seed, i, 91) * 90 + 5,
    on: hashRand(seed, flickIdx, 95 + i) > 0.62,
  }));

  // 右個体: 青い横スジ光のドリフト
  const streakDrift = interpolate(p, [0.2, 0.8], [-18, 22], CLAMP);

  // 左個体: 中央バルジ（複製＋放射マスク＋追加拡大）
  const bulgeOn = direction === "left" && env > 0.03;
  const bulgeSrcTo = p >= 0.47;

  return (
    <AbsoluteFill style={{ background: "#000", overflow: "hidden" }}>
      {/* ---- SVGフィルタ定義（方向ブラー＋色収差 / グレイン） ---- */}
      <svg width={0} height={0} style={{ position: "absolute" }} aria-hidden>
        <defs>
          <filter
            id={`${uid}-mb`}
            x="-40%"
            y="-40%"
            width="180%"
            height="180%"
            colorInterpolationFilters="sRGB"
          >
            <feGaussianBlur
              in="SourceGraphic"
              stdDeviation={`${bx.toFixed(2)} ${by.toFixed(2)}`}
              result="blur"
            />
            <feColorMatrix in="blur" type="matrix" values={CH.r} result="cr" />
            <feColorMatrix in="blur" type="matrix" values={CH.g} result="cg" />
            <feColorMatrix in="blur" type="matrix" values={CH.b} result="cb" />
            <feOffset
              in="cr"
              dx={abX.toFixed(2)}
              dy={abY.toFixed(2)}
              result="ro"
            />
            <feOffset
              in="cb"
              dx={(-abX).toFixed(2)}
              dy={(-abY).toFixed(2)}
              result="bo"
            />
            <feBlend in="ro" in2="cg" mode="screen" result="rg" />
            <feBlend in="rg" in2="bo" mode="screen" />
          </filter>
          <filter id={`${uid}-grain`}>
            <feTurbulence
              type="fractalNoise"
              baseFrequency="0.92"
              numOctaves="2"
              seed={seed + frame}
              stitchTiles="stitch"
            />
            <feColorMatrix
              type="matrix"
              values="0.33 0.33 0.33 0 0  0.33 0.33 0.33 0 0  0.33 0.33 0.33 0 0  0 0 0 1 0"
            />
          </filter>
        </defs>
      </svg>

      {/* ---- ステージ（ズーム突進＋手ぶれ） ---- */}
      <AbsoluteFill
        style={{
          filter: bodyGrade,
          transform: `translate(${shakeX.toFixed(1)}px, ${shakeY.toFixed(1)}px) scale(${zoom.toFixed(4)})`,
        }}
      >
        {toOpacity < 1 && layer(from, fromShiftX, fromShiftY, 1, "from")}
        {toOpacity > 0 && layer(to, toShiftX, toShiftY, toOpacity, "to")}

        {/* 左個体: 中央バルジ（レンズが膨らむ） */}
        {bulgeOn && (
          <AbsoluteFill
            style={{
              opacity: env * 0.9,
              WebkitMaskImage:
                "radial-gradient(circle at 50% 50%, #000 0%, #000 16%, transparent 40%)",
              maskImage:
                "radial-gradient(circle at 50% 50%, #000 0%, #000 16%, transparent 40%)",
            }}
          >
            <AbsoluteFill
              style={{
                filter: filterOn ? `url(#${uid}-mb)` : undefined,
                transform: `translate(${(bulgeSrcTo ? toShiftX : fromShiftX).toFixed(1)}px, ${(bulgeSrcTo ? toShiftY : fromShiftY).toFixed(1)}px) scale(${(1.34 * edgeHide).toFixed(4)})`,
              }}
            >
              {bulgeSrcTo ? to : from}
            </AbsoluteFill>
          </AbsoluteFill>
        )}
      </AbsoluteFill>

      {/* ---- グレード層（個体の色個性） ---- */}
      {direction === "right" && (
        <>
          {/* 脱色（灰色一色を saturation 合成） */}
          <AbsoluteFill
            style={{
              background: "#8a9098",
              mixBlendMode: "saturation",
              opacity: env * 0.8,
            }}
          />
          {/* スチールブルーの冷たいトーン */}
          <AbsoluteFill
            style={{
              background:
                "linear-gradient(180deg, #4a6684 0%, #2c3d52 55%, #16202e 100%)",
              mixBlendMode: "soft-light",
              opacity: env * 0.75,
            }}
          />
        </>
      )}
      {direction === "up" && (
        <>
          {/* 暗いティール2段グレード */}
          <AbsoluteFill
            style={{
              background:
                "linear-gradient(180deg, #0d2b2b 0%, #123a38 50%, #091d1e 100%)",
              mixBlendMode: "multiply",
              opacity: env * 0.65,
            }}
          />
          <AbsoluteFill
            style={{
              background:
                "linear-gradient(180deg, #1e6e66 0%, #17554f 60%, #0e3a37 100%)",
              mixBlendMode: "overlay",
              opacity: env * 0.4,
            }}
          />
        </>
      )}
      {direction === "down" && (
        // 青→紫→ピンクの斜め虹グラデ（常時薄く＋中盤で増量）
        <AbsoluteFill
          style={{
            background:
              "linear-gradient(135deg, #3a6cd8 0%, #7f57cf 45%, #e678c4 100%)",
            mixBlendMode: "screen",
            opacity: 0.1 + env * 0.42,
          }}
        />
      )}

      {/* ---- 光もの（screen 合成） ---- */}
      {direction === "left" && (
        <>
          {/* 暖白ホットスポット（中央やや左）＋水平の光の帯 */}
          <AbsoluteFill
            style={{
              background:
                "radial-gradient(ellipse 34% 30% at 42% 50%, rgba(255,237,214,0.95) 0%, rgba(255,214,168,0.35) 45%, transparent 72%)",
              mixBlendMode: "screen",
              opacity: clamp01(lightEnv * 0.85 + flash * 0.5),
            }}
          />
          <AbsoluteFill
            style={{
              background:
                "linear-gradient(180deg, transparent 40%, rgba(255,228,196,0.5) 50%, transparent 60%)",
              mixBlendMode: "screen",
              opacity: lightEnv * 0.6,
            }}
          />
        </>
      )}
      {direction === "right" && (
        <>
          {/* 青い横スジ光（ロールに追従して右へドリフト） */}
          <div
            style={{
              position: "absolute",
              left: "-10%",
              right: "-10%",
              top: "40%",
              height: "20%",
              background:
                "radial-gradient(ellipse 55% 42% at 50% 50%, rgba(126,176,232,0.9) 0%, rgba(86,130,190,0.35) 55%, transparent 78%)",
              mixBlendMode: "screen",
              opacity: lightEnv * 0.9,
              transform: `translateX(${streakDrift.toFixed(1)}%)`,
            }}
          />
          {/* 弱い白グロー */}
          <AbsoluteFill
            style={{
              background:
                "radial-gradient(ellipse 40% 34% at 50% 48%, rgba(255,255,255,0.55) 0%, transparent 70%)",
              mixBlendMode: "screen",
              opacity: clamp01(flash * 0.55 + lightEnv * 0.2),
            }}
          />
        </>
      )}
      {direction === "up" && (
        // 演出層を1つの包絡でまとめて ON/OFF するのが個体の特徴
        <AbsoluteFill style={{ opacity: lightEnv }}>
          {/* 縦の光ストリーク（細い明帯を縦に強く引き伸ばす） */}
          <AbsoluteFill
            style={{
              background:
                "repeating-linear-gradient(90deg, transparent 0px, transparent 46px, rgba(190,235,224,0.16) 48px, rgba(210,245,236,0.3) 52px, rgba(190,235,224,0.16) 56px, transparent 58px, transparent 120px)",
              mixBlendMode: "screen",
              transform: "scaleY(3.2)",
              opacity: 0.8,
            }}
          />
          {/* 中央ブルーム */}
          <AbsoluteFill
            style={{
              background:
                "radial-gradient(ellipse 42% 34% at 50% 50%, rgba(214,244,236,0.7) 0%, rgba(140,200,188,0.25) 50%, transparent 75%)",
              mixBlendMode: "screen",
              opacity: 0.85,
            }}
          />
          {/* 中央の極細の縦光条 */}
          <div
            style={{
              position: "absolute",
              top: "-5%",
              bottom: "-5%",
              left: "50%",
              width: `${(3 * sc).toFixed(1)}px`,
              transform: "translateX(-50%)",
              background:
                "linear-gradient(180deg, transparent 0%, rgba(235,255,250,0.9) 30%, #f4fffb 50%, rgba(235,255,250,0.9) 70%, transparent 100%)",
              boxShadow: `0 0 ${(18 * sc).toFixed(0)}px rgba(200,255,240,0.8)`,
              mixBlendMode: "screen",
            }}
          />
          {/* 三隅のリーク（緑・シアン・琥珀） */}
          <AbsoluteFill
            style={{
              background:
                "radial-gradient(circle 30% at 4% 8%, rgba(96,200,140,0.4) 0%, transparent 60%), radial-gradient(circle 32% at 96% 12%, rgba(90,205,215,0.35) 0%, transparent 60%), radial-gradient(circle 30% at 90% 94%, rgba(220,175,90,0.3) 0%, transparent 60%)",
              mixBlendMode: "screen",
            }}
          />
          {/* 上向きシェブロン（山型2連）: 中盤に一瞬フラッシュ */}
          <svg
            viewBox="0 0 120 130"
            style={{
              position: "absolute",
              left: "50%",
              top: "50%",
              width: `${(150 * sc).toFixed(0)}px`,
              height: `${(163 * sc).toFixed(0)}px`,
              transform: "translate(-50%, -50%)",
              opacity: interpolate(p, [0.4, 0.46, 0.56], [0, 1, 0], CLAMP),
              filter: `drop-shadow(0 0 ${(12 * sc).toFixed(0)}px rgba(190,255,238,0.95))`,
              mixBlendMode: "screen",
            }}
          >
            <polyline
              points="22,62 60,26 98,62"
              fill="none"
              stroke="#eefff9"
              strokeWidth={13}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <polyline
              points="22,104 60,68 98,104"
              fill="none"
              stroke="#eefff9"
              strokeWidth={13}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </AbsoluteFill>
      )}
      {direction === "down" && (
        <>
          {/* 3本の縦光帯（中央=白、左右=青白）を放射マスクで中央に限定 */}
          <AbsoluteFill
            style={{
              opacity: lightEnv * 0.95,
              filter: `blur(${(6 * sc).toFixed(1)}px)`,
              WebkitMaskImage:
                "radial-gradient(ellipse 55% 70% at 50% 50%, #000 0%, #000 40%, transparent 75%)",
              maskImage:
                "radial-gradient(ellipse 55% 70% at 50% 50%, #000 0%, #000 40%, transparent 75%)",
              mixBlendMode: "screen",
            }}
          >
            {[38, 50, 62].map((x, i) => (
              <div
                key={i}
                style={{
                  position: "absolute",
                  top: "-6%",
                  bottom: "-6%",
                  left: `${x}%`,
                  width: i === 1 ? "5.5%" : "3.5%",
                  transform: "translateX(-50%)",
                  background:
                    i === 1
                      ? "linear-gradient(180deg, transparent, rgba(255,255,255,0.95) 35%, rgba(255,255,255,0.95) 65%, transparent)"
                      : "linear-gradient(180deg, transparent, rgba(196,220,255,0.8) 35%, rgba(196,220,255,0.8) 65%, transparent)",
                }}
              />
            ))}
          </AbsoluteFill>
          {/* 白い大閃光 */}
          <AbsoluteFill
            style={{
              background:
                "radial-gradient(ellipse 55% 48% at 50% 50%, rgba(255,255,255,0.98) 0%, rgba(255,255,255,0.4) 55%, transparent 80%)",
              mixBlendMode: "screen",
              opacity: flash * 0.95,
            }}
          />
        </>
      )}
      {depth && (
        // forward/backward: 汎用の白ブルームのみ
        <AbsoluteFill
          style={{
            background:
              "radial-gradient(ellipse 45% 38% at 50% 50%, rgba(255,255,255,0.85) 0%, transparent 72%)",
            mixBlendMode: "screen",
            opacity: clamp01(flash * 0.8 + lightEnv * 0.25),
          }}
        />
      )}

      {/* ---- ダスト（左個体のみ: 明滅する小円） ---- */}
      {dusts.map(
        (d) =>
          d.on && (
            <div
              key={d.i}
              style={{
                position: "absolute",
                left: `${d.x.toFixed(2)}%`,
                top: `${d.y.toFixed(2)}%`,
                width: `${(d.r * 2).toFixed(1)}px`,
                height: `${(d.r * 2).toFixed(1)}px`,
                borderRadius: "50%",
                background: d.darkDot
                  ? "rgba(10,10,12,0.75)"
                  : "rgba(245,242,235,0.8)",
                opacity: env * 0.85,
              }}
            />
          )
      )}

      {/* ---- 縦スクラッチ（左・上個体: 細線の明滅） ---- */}
      {scratches.map(
        (s) =>
          s.on && (
            <div
              key={s.i}
              style={{
                position: "absolute",
                top: 0,
                bottom: 0,
                left: `${s.x.toFixed(2)}%`,
                width: `${Math.max(1, 1.4 * sc).toFixed(1)}px`,
                background:
                  "linear-gradient(180deg, transparent, rgba(235,232,226,0.5) 20%, rgba(235,232,226,0.5) 80%, transparent)",
                opacity: env * 0.5,
              }}
            />
          )
      )}

      {/* ---- フィルムグレイン（overlay・低不透明度） ---- */}
      <svg
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          mixBlendMode: "overlay",
          opacity: env * (direction === "left" ? 0.14 : 0.09),
          pointerEvents: "none",
        }}
        aria-hidden
      >
        <rect width="100%" height="100%" filter={`url(#${uid}-grain)`} />
      </svg>

      {/* ---- ビネット（周辺減光） ---- */}
      <AbsoluteFill
        style={{
          background:
            "radial-gradient(ellipse 72% 62% at 50% 50%, transparent 55%, rgba(0,0,0,0.5) 100%)",
          opacity: env * (direction === "left" ? 0.7 : 0.5),
          pointerEvents: "none",
        }}
      />
    </AbsoluteFill>
  );
};
