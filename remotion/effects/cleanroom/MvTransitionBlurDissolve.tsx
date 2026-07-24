import React, { useId, useMemo } from "react";
import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from "remotion";

/**
 * MvTransitionBlurDissolve — ブラー溶解トランジション家族（クリーンルーム実装）
 *
 * 機能: 強いブラー／黒沈み／ノイズで画を一度「潰す・溶かす」ことで視認性を落とし、
 *       その最大破壊の真下で旧カット(from)→新カット(to)を入れ替えるMV用トランジション。
 *
 * 進行: p = frame/(dur-1)。前半で破壊量 0→最大、中盤ピーク（長尺系は頂点を少し保持）、
 *       後半で新カット側の破壊を解いてクリーンに着地する「対称な山」。
 *       バウンスやオーバーシュートは無し。緩急は smoothstep の後掛けで作る。
 *
 * 設計メモ:
 * - 最背面は黒ベタ＋overflow:hidden。ブラーで縁が透けても黒に落ちるだけにする。
 * - 質感の中核はサイズ0のsvgに定義したフィルタ（CSS filter: url(#id) で参照）。
 *   フィルタ領域は上下左右に2割広げ、ブラーのはみ出しを収める。
 * - 異方性ブラーは stdDeviation="横 縦" の縦優勢（縦≒横の2倍）。edgeMode=duplicate。
 *   ブラー量に比例してレイヤーを数%拡大し、縁の透け（黒フチ）を画面外へ追い出す。
 * - 色収差は R/G/B を feColorMatrix で単チャンネル化→feOffset で左右逆方向にずらし
 *   → screen 合成。ずれ0なら原画に完全復元される。
 * - グレインは feTurbulence(fractalNoise 高周波) を彩度0にして overlay で全画面に。
 *   seed をフレーム毎に進めて粒を動かす。
 * - 乱数は (seed, index, salt) の決定的ハッシュのみ。Math.random は不使用。
 * - px系の最大量は 1920 幅基準で定義し scale=width/1920 を掛ける（解像度非依存）。
 * - この家族は無方向（direction は契約互換のため受けるが使用しない）。
 *
 * variant（0..1 → 6段階に量子化）による個体差:
 *  0: 最短最鋭 — ブラー山の頂点直下でほぼハードカット。縦優勢シェイク（中盤最大→3/4で収束）
 *  1: 最ソフト — to は全尺リニアでフェードイン、from は前半保持→後半減衰。装飾なし
 *  2: 黒沈み — 中盤の黒頂点の真下で素早く入替。ブラー＋コントラスト増は脇役（単一フィルタ層）
 *  3: 全部盛り — 波状歪み＋一様ブラー＋横色収差＋膨張ズーム＋白ブルーム＋暖色リーク横断
 *               ＋グレイン＋固定ダスト/縦スクラッチ＋退色＋シェイク
 *  4: 夢想系 — ブラーが3連パルスで脈動。暖色オーラ常時薄灯り（対角に寒色）＋
 *               fromズームイン/toズームアウトのサージ＋ビネット
 *  5: ノイズ溶解 — ブラー不使用。高濃度グレイン＋色収差＋中央白ブルーム＋コントラスト増。
 *               to を土台に from を上置きして 1→0 で剥がす
 */

export interface MvTransitionBlurDissolveProps {
  /** 旧カット */
  from: React.ReactNode;
  /** 新カット */
  to: React.ReactNode;
  /** トランジション全体の長さ（フレーム） */
  durationInFrames: number;
  /** 契約互換のためのプロパティ（この家族は無方向のため未使用） */
  direction?: "left" | "right" | "up" | "down" | "forward" | "backward";
  /** 0..1 家族内の見た目分岐（決定論的・6段階に量子化） */
  variant?: number;
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** a..b を 0..1 に正規化してクランプ */
const ramp = (p: number, a: number, b: number) => clamp01((p - a) / (b - a));

/** smoothstep: x²(3-2x)。折れ線の後掛けで頂点位置を保ったまま滑らかにする */
const smooth = (x: number) => {
  const t = clamp01(x);
  return t * t * (3 - 2 * t);
};

/**
 * 中盤ピークの山（0→1→0）。w>0 で頂点を平らに保持（プラトー）。
 * 両肩は smoothstep 済みなので機械的な三角波にならない。
 */
const bump = (p: number, w: number) =>
  Math.min(smooth(ramp(p, 0, 0.5 - w)), 1 - smooth(ramp(p, 0.5 + w, 1)));

/** (a,b,c) から 0..1 の決定的な擬似乱数（正弦ハッシュ） */
const rand = (a: number, b: number, c: number): number => {
  const s = Math.sin(a * 127.1 + b * 311.7 + c * 74.7) * 43758.5453123;
  return s - Math.floor(s);
};

export const MvTransitionBlurDissolve: React.FC<MvTransitionBlurDissolveProps> = ({
  from,
  to,
  durationInFrames,
  variant = 0,
}) => {
  const frame = useCurrentFrame();
  const { width } = useVideoConfig();
  const rawId = useId();
  const uid = useMemo(() => rawId.replace(/[^a-zA-Z0-9_-]/g, ""), [rawId]);

  const sc = width / 1920;
  const last = Math.max(1, durationInFrames - 1);
  const p = clamp01(frame / last);

  const v = clamp01(variant);
  /** 個体番号 0..5 */
  const k = Math.round(v * 5);
  const seed = 11 + Math.round(v * 197);

  // ---- 共通エンベロープ ------------------------------------------------------
  const bumpS = bump(p, 0.001); // 鋭い単峰（短尺系）
  const bumpL = bump(p, 0.05); // 頂点を1割ほど保持する山（長尺系）
  // 3連パルス（夢想系）: |sin(3πp)| は両端0・3つの峰。全体の山で中盤を最大に
  const pulse = Math.abs(Math.sin(p * Math.PI * 3)) * (0.35 + 0.65 * bumpL);

  // ---- ブラー量（縦優勢: 縦≒横の2倍。全部盛りのみ一様） ----------------------
  let blurEnv = 0;
  let blurMaxY = 0; // 縦の最大 stdDeviation (px, 1920幅基準×sc適用済み)
  let uniformBlur = false;
  if (k === 0) {
    blurEnv = bumpS;
    blurMaxY = 54 * sc;
  } else if (k === 1) {
    blurEnv = bumpS;
    blurMaxY = 44 * sc;
  } else if (k === 2) {
    blurEnv = bumpS;
    blurMaxY = 20 * sc;
  } else if (k === 3) {
    blurEnv = bumpL;
    blurMaxY = 40 * sc;
    uniformBlur = true;
  } else if (k === 4) {
    blurEnv = pulse;
    blurMaxY = 38 * sc;
  }
  const by = blurMaxY * blurEnv;
  const bx = uniformBlur ? by : by * 0.5;

  // ---- 入替（最大破壊の真下でクロス） ----------------------------------------
  let toO = 1;
  let fromO = 0;
  if (k === 0) {
    const t = smooth(ramp(p, 0.44, 0.56)); // ほぼハードカット
    toO = t;
    fromO = 1 - t;
  } else if (k === 1) {
    toO = p; // 全尺リニアでフェードイン
    fromO = 1 - smooth(ramp(p, 0.45, 1)); // 前半保持→後半減衰
  } else if (k === 3) {
    const t = smooth(ramp(p, 0.38, 0.62));
    toO = t;
    fromO = 1 - t;
  } else if (k === 4) {
    const t = smooth(ramp(p, 0.3, 0.7));
    toO = t;
    fromO = 1 - t;
  } else if (k === 5) {
    toO = 1; // to を土台に
    fromO = 1 - smooth(ramp(p, 0.1, 0.88)); // from を 1→0 で剥がす
  }
  // k===2 は単一フィルタ層で from/to をまとめる（下で個別処理）
  const swap = smooth(ramp(p, 0.46, 0.54)); // 黒頂点の真下で素早く入替
  const blackO = k === 2 ? bumpS : 0;

  // ---- 色収差・歪み・粒（個体別） --------------------------------------------
  const env5 = bump(p, 0.03);
  const useChroma = k === 3 || k === 5;
  const chromaDx = k === 3 ? 13 * sc * bumpL : k === 5 ? 9 * sc * env5 : 0;
  const useDisp = k === 3;
  const dispScale = useDisp ? 55 * sc * bumpL : 0;
  const useGrain = k === 3 || k === 5;
  const grainO = k === 3 ? 0.08 + 0.14 * bumpL : k === 5 ? 0.25 + 0.45 * env5 : 0;
  const grainSeed = (seed * 13 + frame * 7) % 9973;

  // ---- シェイク（決定論ハッシュ。フレームの2.5倍速で進むインデックス） --------
  const idx = Math.floor(frame * 2.5);
  let shakeX = 0;
  let shakeY = 0;
  if (k === 0) {
    // 中盤最大 → 3/4 で収束。縦優勢
    const env = smooth(ramp(p, 0.06, 0.5)) * (1 - smooth(ramp(p, 0.5, 0.76)));
    shakeX = (rand(seed, idx, 21) - 0.5) * 2 * 0.006 * width * env;
    shakeY = (rand(seed, idx, 22) - 0.5) * 2 * 0.013 * width * env;
  } else if (k === 3) {
    shakeX = (rand(seed, idx, 23) - 0.5) * 2 * 0.007 * width * bumpL;
    shakeY = (rand(seed, idx, 24) - 0.5) * 2 * 0.01 * width * bumpL;
  }

  // ---- スケール（黒フチ隠し＋個体別サージ） ----------------------------------
  const hide = 1 + 0.055 * blurEnv + (k === 5 ? 0.012 * env5 : 0);
  let fromScale = hide;
  let toScale = hide;
  if (k === 3) {
    const swell = 1 + 0.3 * bumpL; // 等倍→3割増→等倍の膨張ズーム
    fromScale = hide * swell;
    toScale = hide * swell;
  } else if (k === 4) {
    fromScale = hide * (1 + 0.12 * smooth(ramp(p, 0, 0.6))); // from ズームイン
    toScale = hide * (1 + 0.12 * (1 - smooth(ramp(p, 0.4, 1)))); // to ズームアウト
  }

  // ---- カラーグレード（CSS filter 併用） --------------------------------------
  const grade =
    k === 3
      ? `saturate(${(1 - 0.42 * bumpL).toFixed(3)}) contrast(${(1 + 0.1 * bumpL).toFixed(3)})`
      : k === 5
        ? `contrast(${(1 + 0.55 * env5).toFixed(3)})`
        : undefined;

  // ---- 装飾（発光・リーク・オーラ・ビネット） ---------------------------------
  const bloomO = k === 3 ? 0.55 * bumpL : k === 5 ? 0.45 * env5 : 0;
  const bloomR1 = 18 + 14 * blurEnv;
  const bloomR2 = 42 + 22 * blurEnv;
  // 全尺横断する暖色リーク（全部盛りのみ）
  const leakX = interpolate(p, [0, 1], [-25, 150]);
  const leakO = k === 3 ? 0.3 + 0.25 * bumpL : 0;
  // 夢想系オーラ: 常時薄く灯り中盤最大
  const auraA = k === 4 ? 0.1 + 0.32 * bumpL : 0;
  const vignetteO = k === 4 ? 0.35 + 0.3 * bumpL : 0;

  // ---- 固定ダスト斑点＋縦スクラッチ（全部盛りのみ・フレーム間で不動） ---------
  const dust = useMemo(
    () =>
      Array.from({ length: 12 }, (_, i) => ({
        left: 2 + rand(seed, i, 501) * 96,
        top: 4 + rand(seed, i, 502) * 92,
        size: 1.5 + rand(seed, i, 503) * 3.5,
        o: 0.1 + rand(seed, i, 504) * 0.22,
      })),
    [seed]
  );
  const scratches = useMemo(
    () =>
      Array.from({ length: 3 }, (_, i) => ({
        left: 5 + rand(seed, i, 601) * 90,
        o: 0.04 + rand(seed, i, 602) * 0.06,
      })),
    [seed]
  );
  const dustO = k === 3 ? 0.15 + 0.25 * bumpL : 0;

  const fxUrl = `url(#${uid}-fx)`;

  return (
    <AbsoluteFill style={{ background: "#000", overflow: "hidden" }}>
      {/* フィルタ定義（サイズ0のsvgにdefsのみ） */}
      <svg width={0} height={0} style={{ position: "absolute" }} aria-hidden>
        <defs>
          <filter
            id={`${uid}-fx`}
            x="-20%"
            y="-20%"
            width="140%"
            height="140%"
            colorInterpolationFilters="sRGB"
          >
            {useDisp ? (
              <>
                {/* 低周波タービュランス→変位マップで画面を波状に揺らす */}
                <feTurbulence
                  type="turbulence"
                  baseFrequency="0.007 0.011"
                  numOctaves={1}
                  seed={seed % 100}
                  result="warpmap"
                />
                <feDisplacementMap
                  in="SourceGraphic"
                  in2="warpmap"
                  scale={dispScale}
                  xChannelSelector="R"
                  yChannelSelector="G"
                  result="warped"
                />
                <feGaussianBlur
                  in="warped"
                  stdDeviation={`${bx.toFixed(2)} ${by.toFixed(2)}`}
                  edgeMode="duplicate"
                  result="soft"
                />
              </>
            ) : (
              <feGaussianBlur
                in="SourceGraphic"
                stdDeviation={`${bx.toFixed(2)} ${by.toFixed(2)}`}
                edgeMode="duplicate"
                result="soft"
              />
            )}
            {useChroma && (
              <>
                {/* R/G/B 単チャンネル化 → 左右逆方向オフセット → screen 再合成。
                    ずれ0なら原画に完全復元される */}
                <feColorMatrix
                  in="soft"
                  type="matrix"
                  values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0"
                  result="chR"
                />
                <feColorMatrix
                  in="soft"
                  type="matrix"
                  values="0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0"
                  result="chG"
                />
                <feColorMatrix
                  in="soft"
                  type="matrix"
                  values="0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0"
                  result="chB"
                />
                <feOffset in="chR" dx={-chromaDx} dy={0} result="chRo" />
                <feOffset in="chB" dx={chromaDx} dy={0} result="chBo" />
                <feBlend in="chRo" in2="chG" mode="screen" result="chRG" />
                <feBlend in="chRG" in2="chBo" mode="screen" />
              </>
            )}
          </filter>
          {useGrain && (
            <filter id={`${uid}-grain`} x="0%" y="0%" width="100%" height="100%">
              {/* 高周波フラクタルノイズを彩度0に。seedをフレーム毎に進めて粒を動かす */}
              <feTurbulence
                type="fractalNoise"
                baseFrequency="0.9"
                numOctaves={2}
                stitchTiles="stitch"
                seed={grainSeed}
              />
              <feColorMatrix type="saturate" values="0" />
            </filter>
          )}
        </defs>
      </svg>

      {/* ---- 映像レイヤー ---- */}
      {k === 2 ? (
        // 黒沈み型: from/to を1つのフィルタ層にまとめ、黒頂点の真下で素早く入替
        <>
          <AbsoluteFill
            style={{
              filter: `${fxUrl} contrast(${(1 + 1.05 * bumpS).toFixed(3)})`,
              transform: `scale(${hide.toFixed(4)})`,
            }}
          >
            <AbsoluteFill>{to}</AbsoluteFill>
            <AbsoluteFill style={{ opacity: clamp01(1 - swap) }}>{from}</AbsoluteFill>
          </AbsoluteFill>
          {/* 主役の黒ベタ（easeInOutの山） */}
          <AbsoluteFill style={{ background: "#000", opacity: clamp01(blackO) }} />
        </>
      ) : (
        // 標準型: 下=to / 上=from。最大破壊の真下で opacity クロス
        <AbsoluteFill
          style={{
            transform: `translate(${shakeX.toFixed(1)}px, ${shakeY.toFixed(1)}px)`,
            filter: grade,
          }}
        >
          <AbsoluteFill
            style={{
              opacity: clamp01(toO),
              filter: fxUrl,
              transform: `scale(${toScale.toFixed(4)})`,
            }}
          >
            {to}
          </AbsoluteFill>
          <AbsoluteFill
            style={{
              opacity: clamp01(fromO),
              filter: fxUrl,
              transform: `scale(${fromScale.toFixed(4)})`,
            }}
          >
            {from}
          </AbsoluteFill>
        </AbsoluteFill>
      )}

      {/* ---- 暖色リーク（全尺横断スイープ） ---- */}
      {leakO > 0.01 && (
        <AbsoluteFill
          style={{
            mixBlendMode: "screen",
            opacity: clamp01(leakO),
            background: `radial-gradient(circle at ${leakX.toFixed(1)}% 45%, rgba(255,140,60,0.75) 0%, rgba(255,80,40,0.25) 30%, rgba(0,0,0,0) 60%)`,
            pointerEvents: "none",
          }}
        />
      )}

      {/* ---- 夢想系オーラ（暖色2点＋対角に寒色1点） ---- */}
      {auraA > 0.01 && (
        <AbsoluteFill
          style={{
            mixBlendMode: "screen",
            background: [
              `radial-gradient(circle at 16% 28%, rgba(255,96,150,${auraA.toFixed(3)}) 0%, rgba(255,96,150,0) 55%)`,
              `radial-gradient(circle at 10% 78%, rgba(255,150,64,${(auraA * 0.9).toFixed(3)}) 0%, rgba(255,150,64,0) 50%)`,
              `radial-gradient(circle at 88% 76%, rgba(112,96,255,${(auraA * 0.8).toFixed(3)}) 0%, rgba(112,96,255,0) 55%)`,
            ].join(", "),
            pointerEvents: "none",
          }}
        />
      )}

      {/* ---- 中央やや上寄りの白ブルーム ---- */}
      {bloomO > 0.01 && (
        <AbsoluteFill
          style={{
            mixBlendMode: "screen",
            opacity: clamp01(bloomO),
            background: `radial-gradient(circle at 50% 42%, rgba(255,250,242,0.9) 0%, rgba(255,235,210,0.35) ${bloomR1.toFixed(1)}%, rgba(0,0,0,0) ${bloomR2.toFixed(1)}%)`,
            pointerEvents: "none",
          }}
        />
      )}

      {/* ---- フィルムグレイン（overlay・粒はフレーム毎に更新） ---- */}
      {useGrain && grainO > 0.01 && (
        <AbsoluteFill
          style={{ mixBlendMode: "overlay", opacity: clamp01(grainO), pointerEvents: "none" }}
        >
          <svg width="100%" height="100%">
            <rect x="0" y="0" width="100%" height="100%" filter={`url(#${uid}-grain)`} />
          </svg>
        </AbsoluteFill>
      )}

      {/* ---- 固定ダスト斑点＋縦スクラッチ ---- */}
      {dustO > 0.01 && (
        <AbsoluteFill style={{ pointerEvents: "none" }}>
          {dust.map((d, i) => (
            <div
              key={`d${i}`}
              style={{
                position: "absolute",
                left: `${d.left.toFixed(2)}%`,
                top: `${d.top.toFixed(2)}%`,
                width: `${(d.size * sc).toFixed(2)}px`,
                height: `${(d.size * sc).toFixed(2)}px`,
                borderRadius: "50%",
                background: "rgba(235,232,225,1)",
                opacity: clamp01(d.o * dustO * 3),
              }}
            />
          ))}
          {scratches.map((s, i) => (
            <div
              key={`s${i}`}
              style={{
                position: "absolute",
                top: 0,
                bottom: 0,
                left: `${s.left.toFixed(2)}%`,
                width: `${Math.max(1, sc).toFixed(2)}px`,
                background: "rgba(240,240,235,1)",
                opacity: clamp01(s.o * dustO * 3),
              }}
            />
          ))}
        </AbsoluteFill>
      )}

      {/* ---- ビネット（夢想系） ---- */}
      {vignetteO > 0.01 && (
        <AbsoluteFill
          style={{
            background:
              "radial-gradient(ellipse at 50% 50%, rgba(0,0,0,0) 52%, rgba(0,0,0,0.55) 100%)",
            opacity: clamp01(vignetteO),
            pointerEvents: "none",
          }}
        />
      )}
    </AbsoluteFill>
  );
};
