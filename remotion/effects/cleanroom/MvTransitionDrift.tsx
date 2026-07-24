import React, { useId, useMemo } from "react";
import {
  AbsoluteFill,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

/**
 * MvTransitionDrift — ドリフト（漂い流れ）トランジション（クリーンルーム実装）
 *
 * 機能: 約1秒のカット間トランジション。映像が一方向へ「漂い流れる」間に
 *       from → to が入れ替わる。ホイップブラー / 色収差 / 光漏れ / 粒子が語彙。
 *
 * 実装は2系統:
 * - 横（left/right）: 実スライド方式。from が画面外へ滑走し、to が反対側から
 *   中央へ流れ込む（左右がほぼタイル状につながる）。水平ホイップブラー＋
 *   中央ズームの膨張近似＋赤/青紫の水平光漏れ帯。
 * - 縦（up/down）: 最大ボケ下でのカット差し替え方式。両カットを縦ブラー最大に
 *   した中盤の窓でクロスフェードし、継ぎ目をブラーで隠す。スメアゴースト＋
 *   寒色グレード＋ピンク縦帯リーク＋中央閃光。
 *
 * 設計メモ:
 * - 全効果量は基準幅1920に対する比率で持ち、scale = width/1920 で解像度非依存。
 * - 緩急はイージング関数でなく折れ線キーフレームの線形サンプル（interpolate）。
 * - 色収差は screen 再結合方式（分離0で原画復元）。暗転回避のため
 *   colorInterpolationFilters="sRGB" を必ず指定。効果が小さい端では
 *   フィルタ自体を外して素の画へ戻す。
 * - 乱数はすべて (seed, frame, index) の決定論ハッシュ。Math.random 不使用。
 * - p=0 と p=1 は必ず変形なし・効果なしのクリーンな絵に戻る。
 */

export interface MvTransitionDriftProps {
  /** 旧カット */
  from: React.ReactNode;
  /** 新カット */
  to: React.ReactNode;
  /** トランジション全体の長さ（フレーム） */
  durationInFrames: number;
  /** 流れる方向（forward/backward は縦系へ正規化） */
  direction?: "left" | "right" | "up" | "down" | "forward" | "backward";
  /** 0..1 同家族内の見た目分岐（決定論的） */
  variant?: number;
}

/** (a,b,c) から 0..1 の決定的な擬似乱数（GLSL 定番ハッシュ） */
const rand = (a: number, b: number, c: number): number => {
  const s = Math.sin(a * 127.1 + b * 311.7 + c * 74.7) * 43758.5453123;
  return s - Math.floor(s);
};

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** 折れ線キーフレームの線形サンプル（両端クランプ） */
const kf = (p: number, xs: number[], ys: number[]): number =>
  interpolate(p, xs, ys, {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

/** 赤チャンネルのみ通す行列 */
const R_ONLY =
  "1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0";
/** 緑＋青（シアン側）のみ通す行列 */
const GB_ONLY =
  "0 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 1 0";

export const MvTransitionDrift: React.FC<MvTransitionDriftProps> = ({
  from,
  to,
  durationInFrames,
  direction = "left",
  variant = 0.25,
}) => {
  const frame = useCurrentFrame();
  const { width } = useVideoConfig();
  const rawId = useId();
  const uid = useMemo(() => rawId.replace(/[^a-zA-Z0-9_-]/g, ""), [rawId]);

  const scale = width / 1920;
  const last = Math.max(1, durationInFrames - 1);
  const p = clamp01(frame / last);
  const v = clamp01(variant);
  const vseed = 7 + Math.floor(v * 991);

  // forward/backward は奥行き感の近い縦系へ寄せる
  const dir: "left" | "right" | "up" | "down" =
    direction === "forward" ? "up" : direction === "backward" ? "down" : direction;
  const horizontal = dir === "left" || dir === "right";

  // ---- 共通: 粒状ノイズ（seed はフレーム由来の決定論値で毎フレーム更新） ----
  const grainSeed = (vseed * 31 + frame * 17) % 99991;
  const grainId = `${uid}-grain`;
  const grainLayer = (opacity: number) =>
    opacity < 0.01 ? null : (
      <svg
        width="100%"
        height="100%"
        style={{
          position: "absolute",
          inset: 0,
          mixBlendMode: "overlay",
          opacity: clamp01(opacity),
          pointerEvents: "none",
        }}
        aria-hidden
      >
        <filter id={grainId} x="0%" y="0%" width="100%" height="100%">
          <feTurbulence
            type="fractalNoise"
            baseFrequency="0.9"
            numOctaves={2}
            seed={grainSeed}
            stitchTiles="stitch"
          />
          <feColorMatrix type="saturate" values="0" />
        </filter>
        <rect width="100%" height="100%" filter={`url(#${grainId})`} />
      </svg>
    );

  // ==========================================================================
  // 横ペア（left / right）: 実スライド方式
  // ==========================================================================
  if (horizontal) {
    const dirX = dir === "left" ? -1 : 1;

    // 移動: 開始1割弱から動き出し、8割強で画面外へ（区分線形で中盤が最速）
    const travel = kf(
      p,
      [0, 0.08, 0.32, 0.5, 0.66, 0.82, 1],
      [0, 0, 0.18, 0.52, 0.82, 1, 1]
    );
    const fromX = dirX * travel * width;
    const toX = dirX * (travel - 1) * width;

    // 球面膨張の近似: 中央ズーム。2割弱から膨らみ 4〜5割強で約1.3倍のプラトー
    const zoom = kf(p, [0, 0.18, 0.4, 0.52, 0.8, 1], [1, 1, 1.28, 1.3, 1, 1]);

    // 水平ホイップブラー: 6割弱で最大（画面幅の約3.5%）→終端0
    const bxMax = width * 0.034;
    const hEnv = kf(p, [0, 0.2, 0.58, 0.85, 1], [0, 0.25, 1, 0.08, 0]);
    // 等方ボケ: 山→谷→山→谷→山と脈動（最大は方向ブラーの約1/6）
    const pulse = 0.5 + 0.5 * Math.cos(p * Math.PI * 4);
    const isoGate = kf(p, [0, 0.15, 0.85, 1], [0, 1, 1, 0]);
    const iso = (bxMax / 6) * pulse * isoGate;
    // 動いている間だけの薄い常時水平スメア（台形エンベロープ）
    const trap = kf(p, [0, 0.12, 0.88, 1], [0, 1, 1, 0]);
    const smear = 3 * scale * trap;
    const bx = bxMax * hEnv + iso + smear;
    const by = iso * 0.9 + 0.5 * scale * trap;

    // 色収差: 中盤（45〜50%）で最大（画面幅の0.7%ほど）
    const dSep =
      width * 0.007 * kf(p, [0, 0.2, 0.47, 0.8, 1], [0, 0.25, 1, 0.15, 0]);
    // variant 低（left系）は on 閾値高め、高（right系）は低めの旧仕様寄り
    const sepThreshold = (1.3 - 1.0 * v) * scale;
    const chromaOn = dSep > sepThreshold;

    // フィルム劣化の共通エンベロープ（粒状・彩度落ち・微暗転を1本で駆動）
    const filmE = kf(p, [0, 0.2, 0.5, 0.85, 1], [0, 0.7, 1, 0.5, 0]);
    const sat = 1 - 0.45 * filmE;
    const bright = 1 - 0.14 * filmE;

    // 光漏れ: variant 低=ホイップ頂点に集中して8割弱で消灯 /
    //         高=フィルム包絡線任せで中央グローが長く強めに残る
    const leakEnv =
      v < 0.5
        ? kf(p, [0.24, 0.5, 0.6, 0.78], [0, 1, 1, 0])
        : kf(p, [0.15, 0.5, 0.8, 0.95], [0, 1, 0.55, 0]);
    const glowOpacity = (v < 0.5 ? 0.55 : 0.75) * leakEnv;
    const leakX = fromX / 4; // from の移動量の1/4で視差

    const filterOn = p > 0.008 && p < 0.995 && (bx > 0.1 || filmE > 0.02);
    const pairFilter = filterOn
      ? `url(#${uid}-hp) saturate(${sat.toFixed(3)}) brightness(${bright.toFixed(3)})`
      : undefined;

    return (
      <AbsoluteFill style={{ background: "#000", overflow: "hidden" }}>
        <svg width={0} height={0} style={{ position: "absolute" }} aria-hidden>
          <defs>
            {/* 色収差（screen 再結合）＋非等方ブラーを1本に。sRGB 指定で暗転回避 */}
            <filter
              id={`${uid}-hp`}
              colorInterpolationFilters="sRGB"
              x="-60%"
              y="-25%"
              width="220%"
              height="150%"
            >
              {chromaOn ? (
                <>
                  <feColorMatrix
                    in="SourceGraphic"
                    type="matrix"
                    values={R_ONLY}
                    result="r"
                  />
                  <feOffset
                    in="r"
                    dx={(dirX * dSep).toFixed(2)}
                    dy={0}
                    result="ro"
                  />
                  <feColorMatrix
                    in="SourceGraphic"
                    type="matrix"
                    values={GB_ONLY}
                    result="gb"
                  />
                  <feOffset
                    in="gb"
                    dx={(-dirX * dSep).toFixed(2)}
                    dy={0}
                    result="gbo"
                  />
                  <feBlend in="ro" in2="gbo" mode="screen" result="cc" />
                  <feGaussianBlur
                    in="cc"
                    stdDeviation={`${bx.toFixed(2)} ${by.toFixed(2)}`}
                  />
                </>
              ) : (
                <feGaussianBlur
                  in="SourceGraphic"
                  stdDeviation={`${bx.toFixed(2)} ${by.toFixed(2)}`}
                />
              )}
            </filter>
          </defs>
        </svg>

        {/* ① + ②: from / to のスライドペア（親へ色収差＋グレードを一括適用） */}
        <AbsoluteFill style={{ filter: pairFilter }}>
          <AbsoluteFill
            style={{
              transform: `translateX(${fromX.toFixed(1)}px) scale(${zoom.toFixed(4)})`,
            }}
          >
            {from}
          </AbsoluteFill>
          <AbsoluteFill
            style={{
              transform: `translateX(${toX.toFixed(1)}px) scale(${zoom.toFixed(4)})`,
            }}
          >
            {to}
          </AbsoluteFill>
        </AbsoluteFill>

        {/* 青灰トーンの微調（フィルム包絡線で駆動） */}
        {filmE > 0.02 && (
          <AbsoluteFill
            style={{
              background: "#5a6a8a",
              mixBlendMode: "soft-light",
              opacity: clamp01(0.4 * filmE),
              pointerEvents: "none",
            }}
          />
        )}

        {/* ③ 赤系の水平光漏れ帯（中央やや上）＋下の薄い青紫帯 */}
        {leakEnv > 0.01 && (
          <>
            <div
              style={{
                position: "absolute",
                left: "-6%",
                right: "-6%",
                top: "40%",
                height: "8%",
                background:
                  "linear-gradient(180deg, rgba(255,60,90,0) 0%, rgba(255,64,96,0.92) 42%, rgba(255,130,140,0.55) 68%, rgba(255,60,90,0) 100%)",
                filter: `blur(${(16 * scale).toFixed(1)}px)`,
                mixBlendMode: "screen",
                opacity: clamp01(0.85 * leakEnv),
                transform: `translateX(${leakX.toFixed(1)}px)`,
                pointerEvents: "none",
              }}
            />
            <div
              style={{
                position: "absolute",
                left: "-6%",
                right: "-6%",
                top: "67%",
                height: "6%",
                background:
                  "linear-gradient(180deg, rgba(120,110,255,0) 0%, rgba(126,116,255,0.6) 50%, rgba(120,110,255,0) 100%)",
                filter: `blur(${(14 * scale).toFixed(1)}px)`,
                mixBlendMode: "screen",
                opacity: clamp01(0.5 * leakEnv),
                transform: `translateX(${leakX.toFixed(1)}px)`,
                pointerEvents: "none",
              }}
            />
            {/* ④ 横長中央グロー（暖ピンク） */}
            <AbsoluteFill
              style={{
                background:
                  "radial-gradient(52% 20% at 50% 50%, rgba(255,175,170,0.55) 0%, rgba(255,175,170,0.18) 55%, rgba(255,175,170,0) 78%)",
                mixBlendMode: "screen",
                opacity: clamp01(glowOpacity),
                pointerEvents: "none",
              }}
            />
          </>
        )}

        {/* ⑤ 粒状ノイズ */}
        {grainLayer(0.3 * filmE)}
      </AbsoluteFill>
    );
  }

  // ==========================================================================
  // 縦ペア（up / down）: 最大ボケ下でのカット差し替え方式
  // ==========================================================================
  const vy = dir === "up" ? -1 : 1;

  // 中盤三角波: ズーム・スメア濃度・グレード・粒増量・シェイクを1本で共有
  const tri = kf(p, [0, 0.5, 1], [0, 1, 0]);

  // クロスフェード窓（44%→56%あたり）。from は不透明のまま to を上に乗せる
  const toOp = kf(p, [0.42, 0.56], [0, 1]);
  const fromOp = kf(p, [0.5, 0.62], [1, 0]);

  // 縦ブラー（最大は画面幅の3%弱）と水平RGB分離（最大0.7%ほど）
  const vBlurMax = width * 0.028 * (0.9 + 0.2 * v);
  const dMax = width * 0.007;
  const fromBlur = vBlurMax * kf(p, [0, 0.56, 1], [0, 1, 1]);
  const toBlur = vBlurMax * kf(p, [0, 0.56, 0.82, 1], [1, 1, 0.2, 0]);
  const dFrom = dMax * kf(p, [0, 0.56, 1], [0, 1, 1]);
  const dTo = dMax * kf(p, [0, 0.56, 1], [1, 1, 0]);

  // from: ドリフト方向へ数十px押し出され + 2割弱ズーム
  const fromY = vy * 52 * scale * kf(p, [0, 0.6, 1], [0, 1, 1]);
  const fromZoom = 1 + 0.17 * kf(p, [0, 0.6, 1], [0, 1, 1]);
  // to: 逆側（ドリフト方向の先）から数十px降りて/迫り上がって収まる
  const toY = vy * 46 * scale * kf(p, [0.4, 1], [1, 0]);

  // スメアゴースト: ドリフト方向＋左へ画面の1割ほど（2割→7.5割の区間で線形）
  const ghostY = vy * width * 0.09 * kf(p, [0.2, 0.75], [0, 1]);
  const ghostX = -width * 0.055 * kf(p, [0.2, 0.75], [0, 1]);
  const ghostOp = 0.5 * tri;

  // 親コンテナ: 中盤ピークで約1.10倍のズームパンチ＋微小シェイク（縦優勢）
  const punch = 1 + 0.1 * tri;
  const shakeAmp = 4 * scale * tri;
  const shakeY = (rand(vseed, frame, 21) - 0.5) * 2 * shakeAmp;
  const shakeX = (rand(vseed, frame, 22) - 0.5) * 2 * shakeAmp * 0.45;

  // 寒色（青紫）グレード: 全編薄く、中盤で厚く（端は0でクリーン）
  const coolOp = kf(p, [0, 0.08, 0.5, 0.92, 1], [0, 0.16, 0.46, 0.16, 0]);
  // ピンク縦帯リーク: 2割→8割の窓、ドリフト方向へ数十px流す
  const bandEnv = kf(p, [0.2, 0.42, 0.62, 0.8], [0, 1, 1, 0]);
  const bandY = vy * 55 * scale * kf(p, [0.2, 0.8], [0, 1]);
  // 中央の白〜薄紫の閃光（中盤のみ）
  const flashOp = kf(p, [0.36, 0.5, 0.66], [0, 0.5, 0]);
  // 粒子: 全編常時（下地1割強）＋中盤微増（端は0）
  const grainOp = kf(p, [0, 0.06, 0.5, 0.94, 1], [0, 0.13, 0.25, 0.13, 0]);

  const fromFilterOn = fromOp > 0.001 && (fromBlur > 0.1 || dFrom > 0.3);
  const toFilterOn = toOp > 0.001 && (toBlur > 0.1 || dTo > 0.3);

  /** 縦ブラー＋水平RGB分離（赤左・シアン右）を1つのフィルタに直列で焼き込む */
  const verticalFilter = (id: string, blur: number, d: number) => (
    <filter
      id={id}
      colorInterpolationFilters="sRGB"
      x="-25%"
      y="-70%"
      width="150%"
      height="240%"
    >
      <feColorMatrix
        in="SourceGraphic"
        type="matrix"
        values={R_ONLY}
        result="r"
      />
      <feOffset in="r" dx={(-d).toFixed(2)} dy={0} result="ro" />
      <feColorMatrix
        in="SourceGraphic"
        type="matrix"
        values={GB_ONLY}
        result="gb"
      />
      <feOffset in="gb" dx={d.toFixed(2)} dy={0} result="gbo" />
      <feBlend in="ro" in2="gbo" mode="screen" result="cc" />
      <feGaussianBlur
        in="cc"
        stdDeviation={`${(0.6 * scale).toFixed(2)} ${blur.toFixed(2)}`}
      />
    </filter>
  );

  return (
    <AbsoluteFill style={{ background: "#000", overflow: "hidden" }}>
      <svg width={0} height={0} style={{ position: "absolute" }} aria-hidden>
        <defs>
          {fromFilterOn && verticalFilter(`${uid}-vf`, fromBlur, dFrom)}
          {toFilterOn && verticalFilter(`${uid}-vt`, toBlur, dTo)}
        </defs>
      </svg>

      {/* 親コンテナ: ズームパンチ＋微小シェイク */}
      <AbsoluteFill
        style={{
          transform: `translate(${shakeX.toFixed(1)}px, ${shakeY.toFixed(
            1
          )}px) scale(${punch.toFixed(4)})`,
        }}
      >
        {/* ① from: クリア→縦ブラー最大、押し出し＋ズーム */}
        {fromOp > 0.001 && (
          <AbsoluteFill
            style={{
              opacity: clamp01(fromOp),
              filter: fromFilterOn ? `url(#${uid}-vf)` : undefined,
              transform: `translateY(${fromY.toFixed(1)}px) scale(${fromZoom.toFixed(4)})`,
            }}
          >
            {from}
          </AbsoluteFill>
        )}

        {/* ② スメアゴースト: from/to 重ね束のクローンを screen で流す */}
        {ghostOp > 0.015 && (
          <AbsoluteFill
            style={{
              opacity: clamp01(ghostOp),
              mixBlendMode: "screen",
              transform: `translate(${ghostX.toFixed(1)}px, ${ghostY.toFixed(1)}px)`,
              filter: `blur(${(7 * scale).toFixed(1)}px)`,
              pointerEvents: "none",
            }}
          >
            <AbsoluteFill style={{ opacity: clamp01(fromOp) }}>
              {from}
            </AbsoluteFill>
            <AbsoluteFill style={{ opacity: clamp01(toOp) }}>{to}</AbsoluteFill>
          </AbsoluteFill>
        )}

        {/* ③ to: 縦ブラー最大→クリア、逆側から収まる */}
        {toOp > 0.001 && (
          <AbsoluteFill
            style={{
              opacity: clamp01(toOp),
              filter: toFilterOn ? `url(#${uid}-vt)` : undefined,
              transform: `translateY(${toY.toFixed(1)}px)`,
            }}
          >
            {to}
          </AbsoluteFill>
        )}
      </AbsoluteFill>

      {/* 寒色（青紫）soft-light グレード */}
      {coolOp > 0.01 && (
        <AbsoluteFill
          style={{
            background: "#3d4a8f",
            mixBlendMode: "soft-light",
            opacity: clamp01(coolOp),
            pointerEvents: "none",
          }}
        />
      )}

      {/* ピンクの縦帯光漏れ（左寄り濃・右寄り薄） */}
      {bandEnv > 0.01 && (
        <>
          <div
            style={{
              position: "absolute",
              top: "-8%",
              bottom: "-8%",
              left: "24%",
              width: "13%",
              background:
                "linear-gradient(90deg, rgba(255,120,190,0) 0%, rgba(255,116,196,0.8) 50%, rgba(255,120,190,0) 100%)",
              filter: `blur(${(24 * scale).toFixed(1)}px)`,
              mixBlendMode: "screen",
              opacity: clamp01(0.7 * bandEnv),
              transform: `translateY(${bandY.toFixed(1)}px)`,
              pointerEvents: "none",
            }}
          />
          <div
            style={{
              position: "absolute",
              top: "-8%",
              bottom: "-8%",
              left: "70%",
              width: "10%",
              background:
                "linear-gradient(90deg, rgba(230,120,255,0) 0%, rgba(226,124,255,0.6) 50%, rgba(230,120,255,0) 100%)",
              filter: `blur(${(22 * scale).toFixed(1)}px)`,
              mixBlendMode: "screen",
              opacity: clamp01(0.35 * bandEnv),
              transform: `translateY(${bandY.toFixed(1)}px)`,
              pointerEvents: "none",
            }}
          />
        </>
      )}

      {/* 中央の白〜薄紫の閃光（中盤のみ） */}
      {flashOp > 0.01 && (
        <AbsoluteFill
          style={{
            background:
              "radial-gradient(38% 30% at 50% 46%, rgba(255,246,255,0.9) 0%, rgba(212,192,255,0.4) 55%, rgba(212,192,255,0) 78%)",
            mixBlendMode: "screen",
            opacity: clamp01(flashOp),
            pointerEvents: "none",
          }}
        />
      )}

      {/* 粒子（全編下地＋中盤微増） */}
      {grainLayer(grainOp)}
    </AbsoluteFill>
  );
};
