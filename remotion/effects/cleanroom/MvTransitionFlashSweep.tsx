import React, { useId, useMemo } from "react";
import {
  AbsoluteFill,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

/**
 * MvTransitionFlashSweep — 二段フラッシュ掃引トランジション家族（クリーンルーム実装）
 *
 * 機能: 約1秒（24f）の from→to トランジション。「二段の白フラッシュで目をくらませ、
 *       その裏で方向つきブラーとともにカットを入れ替える」系。
 *
 * 設計メモ:
 * - 進行度 p = frame/(duration-1) を軸に、二種類のエンベロープで全効果を駆動する。
 *   「二山」= フラッシュ・ブラー・微振動用（1/3で0→半分弱で1→6割で谷→7割強で第2峰→8割強で0）
 *   「台形」= 色収差・バルジ・グレイン用（序盤から半分弱まで上昇→短い平坦→終盤までゆっくり下降）
 *   折れ線の直線補間のみでイージング曲線は使わない（鋭い山＝点滅として知覚される速さが命）。
 * - カットは第1フラッシュの直下（p≈0.46）で、クロス幅は全体の1割弱＝ほぼハードカット。
 *   白飛びとブラーが継ぎ目を完全に隠す。
 * - 方向ブラーは SVG feGaussianBlur の stdDeviation "X Y" 軸別指定。主軸:直交軸 ≒ 20:1。
 *   フィルタ領域は上下左右へ 35% 拡張し、ブラー量に比例してコンテンツを進行方向へ押す。
 * - 色収差は feColorMatrix でチャンネル抽出した R/G/B 3層を screen 再合成（isolation で隔離）。
 *   オフセット 0 で元画像へ完全復元。最大ずれは画面幅の 1〜2%。
 * - バルジ（球面膨張）は一様 scale 拡大（1→1.1〜1.3）で近似。
 * - グレインは feTurbulence（高周波・2オクターブ・タイル継ぎ）をフレーム毎に種替えし、
 *   overlay / soft-light で薄く（1〜2割）乗せて中盤の包絡でゲート。
 * - 微振動はフレーム番号ベースの決定的ハッシュ乱数（Math.random 不使用）。振幅は画面幅の 0.5〜1%。
 * - 全 px 量は基準幅 1920 比でスケールし解像度非依存。外部素材・フォント・追加依存なし。
 *
 * 個体差（direction で分岐）:
 * - left : 横優勢ブラー＋左押し。中央やや上の青白い水平ビームが左へドリフト。
 *          グレインなしの最もクリーンな個体。バルジは家族中最大（3割増）。
 * - right: 色収差に右バイアス（R大きく右・Bも浅く右）＋横スメア(scaleX)＋右ドリフト。
 *          リークとフラッシュは暖色の焼け色。overlay グレイン。第2フラッシュは減衰。
 * - up   : 縦スメアが鞭のように「上へ最大→直後に下へ反転→収束」。色収差は縦軸（R上・B下）。
 *          from は上へ抜け to は下から入る。上部に暖色横スジ＋下部に薄青グロー。soft-light グレイン。
 * - down : from/to が画面高の7割ほどの縦ワイプで通り抜ける（from 下へ退場・to 上から着地）。
 *          リークはピンク/マゼンタ、白い横ホットバンドが下方向へ掃引。グレインはフラッシュ連動。
 * - forward/backward: ズーム押し込み系の予備方向（等方ブラー＋バルジ主体）。
 */

export interface MvTransitionFlashSweepProps {
  from: React.ReactNode;
  to: React.ReactNode;
  durationInFrames: number;
  direction?: "left" | "right" | "up" | "down" | "forward" | "backward";
  variant?: number;
}

// ---- 決定的乱数・補助 --------------------------------------------------------

/** (a,b,c) から 0..1 の決定的な擬似乱数（sin ハッシュ） */
const rand = (a: number, b: number, c: number): number => {
  const s = Math.sin(a * 127.1 + b * 311.7 + c * 74.7) * 43758.5453123;
  return s - Math.floor(s);
};

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

const CLAMP = {
  extrapolateLeft: "clamp",
  extrapolateRight: "clamp",
} as const;

// ---- 個体設定 ----------------------------------------------------------------

type GrainMode = "none" | "overlay" | "soft-light";

type DirCfg = {
  /** 進行方向の単位ベクトル（退出方向） */
  ax: number;
  ay: number;
  /** ズーム押し込み系か */
  zoomMode: boolean;
  /** 二山の第2峰の高さ（1=同等） */
  peak2: number;
  /** 主軸ブラー最大 stdDeviation（1920基準px） */
  blurMax: number;
  /** バルジ最大増分（0.3 = 3割増し） */
  bulge: number;
  /** 色収差最大（画面幅比 0..1） */
  aberrPct: number;
  /** R / B チャンネルの軸方向オフセット倍率（+が進行方向） */
  rMul: number;
  bMul: number;
  /** ブラー比例の押し最大（画面幅/高%） */
  pushPct: number;
  /** 縦ワイプの移動量（画面高%）。0 で無効 */
  wipePct: number;
  /** 横スメア scaleX 最大増分 */
  smearX: number;
  /** フラッシュ色と最大量 */
  flashColor: string;
  flashPeak: number;
  grain: GrainMode;
  grainAmt: number;
};

const buildCfg = (
  direction: NonNullable<MvTransitionFlashSweepProps["direction"]>
): DirCfg => {
  switch (direction) {
    case "right":
      return {
        ax: 1,
        ay: 0,
        zoomMode: false,
        peak2: 0.78,
        blurMax: 76,
        bulge: 0.16,
        aberrPct: 0.018,
        rMul: 1,
        bMul: 0.42,
        pushPct: 3.2,
        wipePct: 0,
        smearX: 0.12,
        flashColor: "#ffe8c4",
        flashPeak: 0.95,
        grain: "overlay",
        grainAmt: 0.16,
      };
    case "up":
      return {
        ax: 0,
        ay: -1,
        zoomMode: false,
        peak2: 1,
        blurMax: 88,
        bulge: 0.13,
        aberrPct: 0.014,
        rMul: 1,
        bMul: -1,
        pushPct: 6,
        wipePct: 55,
        smearX: 0,
        flashColor: "#fff8ee",
        flashPeak: 0.92,
        grain: "soft-light",
        grainAmt: 0.14,
      };
    case "down":
      return {
        ax: 0,
        ay: 1,
        zoomMode: false,
        peak2: 0.95,
        blurMax: 72,
        bulge: 0.11,
        aberrPct: 0.015,
        rMul: -1,
        bMul: 1,
        pushPct: 2.5,
        wipePct: 70,
        smearX: 0,
        flashColor: "#ffffff",
        flashPeak: 0.95,
        grain: "overlay",
        grainAmt: 0.12,
      };
    case "forward":
      return {
        ax: 0,
        ay: 0,
        zoomMode: true,
        peak2: 0.9,
        blurMax: 30,
        bulge: 0.26,
        aberrPct: 0.012,
        rMul: -1,
        bMul: 1,
        pushPct: 0,
        wipePct: 0,
        smearX: 0,
        flashColor: "#ffffff",
        flashPeak: 0.92,
        grain: "none",
        grainAmt: 0,
      };
    case "backward":
      return {
        ax: 0,
        ay: 0,
        zoomMode: true,
        peak2: 0.9,
        blurMax: 26,
        bulge: 0.14,
        aberrPct: 0.012,
        rMul: 1,
        bMul: -1,
        pushPct: 0,
        wipePct: 0,
        smearX: 0,
        flashColor: "#f4f7ff",
        flashPeak: 0.9,
        grain: "none",
        grainAmt: 0,
      };
    case "left":
    default:
      return {
        ax: -1,
        ay: 0,
        zoomMode: false,
        peak2: 1,
        blurMax: 82,
        bulge: 0.3,
        aberrPct: 0.012,
        rMul: -1,
        bMul: 1,
        pushPct: 3,
        wipePct: 0,
        smearX: 0,
        flashColor: "#f3f8ff",
        flashPeak: 0.95,
        grain: "none",
        grainAmt: 0,
      };
  }
};

// ---- 本体 --------------------------------------------------------------------

export const MvTransitionFlashSweep: React.FC<MvTransitionFlashSweepProps> = ({
  from,
  to,
  durationInFrames,
  direction = "left",
  variant = 0,
}) => {
  const frame = useCurrentFrame();
  const { width } = useVideoConfig();
  const rawId = useId();
  const uid = useMemo(() => rawId.replace(/[^a-zA-Z0-9_-]/g, ""), [rawId]);

  const k = width / 1920; // 解像度スケール
  const v = clamp01(variant);
  const seed = 11 + Math.floor(v * 997);
  const cfg = useMemo(() => buildCfg(direction), [direction]);

  const last = Math.max(1, durationInFrames - 1);
  const p = clamp01(frame / last);

  // ---- エンベロープ ----------------------------------------------------------
  // 二山: 1/3で0 → 半分弱で1 → 6割で谷 → 7割強で第2峰 → 8割強で0
  const twoPeak = interpolate(
    p,
    [0.33, 0.44, 0.6, 0.72, 0.84],
    [0, 1, 0.12, cfg.peak2, 0],
    CLAMP
  );
  // 台形: 序盤から半分弱まで上昇 → 短い平坦 → 終盤近くまでゆっくり下降
  const trap = interpolate(p, [0.06, 0.43, 0.56, 0.9], [0, 1, 1, 0], CLAMP);

  const flashVal = cfg.flashPeak * (0.92 + 0.08 * rand(seed, 0, 1)) * twoPeak;
  const blurEnv = twoPeak;
  const aberrEnv = trap;
  const bulgeEnv = trap;
  const grainEnv = direction === "down" ? twoPeak : trap;

  // ---- カット（第1フラッシュ直下・クロス幅は全体の1割弱） --------------------
  const switchAt = 0.46;
  const crossW = 0.08;
  const cs = switchAt - crossW / 2;
  const ce = switchAt + crossW / 2;
  const toOp = interpolate(p, [cs, ce], [0, 1], CLAMP);

  // ---- ブラー（主軸:直交軸 ≒ 20:1） -----------------------------------------
  const blurMain = cfg.blurMax * k * blurEnv;
  const sx = cfg.zoomMode
    ? blurMain
    : Math.max(blurMain * Math.abs(cfg.ax), blurMain / 20);
  const sy = cfg.zoomMode
    ? blurMain
    : Math.max(blurMain * Math.abs(cfg.ay), blurMain / 20);
  const blurOn = blurMain > 0.3;

  // ---- 押し（ブラー比例の視線誘導） ------------------------------------------
  // up は鞭: 上へ最大 → 直後に下へ反転 → 収束（符号つき包絡）
  const whip =
    direction === "up"
      ? interpolate(
          p,
          [0.3, 0.44, 0.52, 0.6, 0.72, 0.82],
          [0, 1, -0.5, 0.18, -0.06, 0],
          CLAMP
        )
      : blurEnv;
  const pushX = cfg.ax * cfg.pushPct * whip;
  const pushY = cfg.ay * cfg.pushPct * whip;

  // ---- 縦ワイプ（up/down: from は退場、to は反対側から着地） ------------------
  let fromWipeY = 0;
  let toWipeY = 0;
  if (cfg.wipePct > 0) {
    const fromProg = clamp01(p / ce);
    const toProg = clamp01((p - cs) / (1 - cs));
    // 折れ線（前半ゆっくり→カット付近で一気）。ワイプの継ぎ目はブラーと白飛びが隠す
    const fOut = interpolate(fromProg, [0, 0.55, 1], [0, 0.22, 1], CLAMP);
    const tIn = interpolate(toProg, [0, 0.45, 1], [1, 0.24, 0], CLAMP);
    fromWipeY = cfg.ay * cfg.wipePct * fOut;
    toWipeY = -cfg.ay * cfg.wipePct * tIn;
  }

  // ---- バルジ・スメア・微振動 ------------------------------------------------
  const bulgeScale = 1 + cfg.bulge * bulgeEnv;
  const pushScale = cfg.zoomMode
    ? direction === "backward"
      ? 1 - 0.06 * blurEnv
      : 1 + 0.1 * blurEnv
    : 1;
  const smearScaleX = 1 + cfg.smearX * blurEnv;
  const shakeAmp = 0.008 * width * twoPeak;
  const shakeX = (rand(seed, frame, 21) - 0.5) * 2 * shakeAmp;
  const shakeY = (rand(seed, frame, 22) - 0.5) * 2 * shakeAmp * 0.7;

  // ---- 色収差（R/G/B 3層 screen 再合成） -------------------------------------
  const aberrPx = cfg.aberrPct * width * aberrEnv;
  const axU = cfg.zoomMode ? 1 : cfg.ax;
  const ayU = cfg.zoomMode ? 0.4 : cfg.ay;
  const rOffX = axU * aberrPx * cfg.rMul;
  const rOffY = ayU * aberrPx * cfg.rMul;
  const bOffX = axU * aberrPx * cfg.bMul;
  const bOffY = ayU * aberrPx * cfg.bMul;
  const splitOn = aberrPx > 0.4;

  // ---- グレード（白飛びで彩度が抜ける） --------------------------------------
  const grade = [
    `saturate(${(1 - 0.28 * flashVal).toFixed(3)})`,
    `brightness(${(1 + 0.16 * flashVal).toFixed(3)})`,
    `contrast(${(1 - 0.08 * flashVal).toFixed(3)})`,
  ].join(" ");

  // ---- コンテンツステージ ----------------------------------------------------
  // 注記(性能): 色収差が有効な間は stage が R/G/B の3回マウントされる。
  // 重い content を渡す場合は事前ラスタライズ（<Img>/<OffthreadVideo>）を推奨。
  const stage = (
    <AbsoluteFill>
      {toOp < 0.999 && (
        <AbsoluteFill
          style={{
            transform: `translate(${pushX.toFixed(3)}%, ${(
              pushY + fromWipeY
            ).toFixed(3)}%)`,
          }}
        >
          {from}
        </AbsoluteFill>
      )}
      {toOp > 0.001 && (
        <AbsoluteFill
          style={{
            opacity: toOp,
            transform: `translate(${pushX.toFixed(3)}%, ${(
              pushY + toWipeY
            ).toFixed(3)}%)`,
          }}
        >
          {to}
        </AbsoluteFill>
      )}
    </AbsoluteFill>
  );

  // ---- ライトリーク・光条（個体の個性担当） ----------------------------------
  const leakEnv = trap;
  const beamDrift = interpolate(p, [0.1, 0.9], [6, -12], CLAMP); // left の水平ビーム
  const sweepTop = interpolate(p, [0.3, 0.82], [-18, 108], CLAMP); // down のホットバンド
  const leakHueJitter = Math.round((rand(seed, 1, 2) - 0.5) * 18);

  // ---- グレイン（フレーム毎に種替え） ----------------------------------------
  const grainOn = cfg.grain !== "none" && cfg.grainAmt * grainEnv > 0.02;
  const grainSeed = ((frame * 37 + seed) % 9973) + 1;

  return (
    <AbsoluteFill style={{ background: "#000", overflow: "hidden" }}>
      {/* フィルタ定義（チャンネル抽出＋方向ブラー＋グレイン） */}
      <svg width={0} height={0} style={{ position: "absolute" }} aria-hidden>
        <defs>
          <filter id={`${uid}-r`} colorInterpolationFilters="sRGB">
            <feColorMatrix
              type="matrix"
              values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0"
            />
          </filter>
          <filter id={`${uid}-g`} colorInterpolationFilters="sRGB">
            <feColorMatrix
              type="matrix"
              values="0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0"
            />
          </filter>
          <filter id={`${uid}-b`} colorInterpolationFilters="sRGB">
            <feColorMatrix
              type="matrix"
              values="0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0"
            />
          </filter>
          <filter
            id={`${uid}-blur`}
            x="-35%"
            y="-35%"
            width="170%"
            height="170%"
            colorInterpolationFilters="sRGB"
          >
            <feGaussianBlur
              stdDeviation={`${sx.toFixed(2)} ${sy.toFixed(2)}`}
              edgeMode="duplicate"
            />
          </filter>
          <filter id={`${uid}-grain`}>
            <feTurbulence
              type="fractalNoise"
              baseFrequency="0.9"
              numOctaves={2}
              seed={grainSeed}
              stitchTiles="stitch"
            />
            <feColorMatrix type="saturate" values="0" />
          </filter>
        </defs>
      </svg>

      {/* 本体（微振動＋バルジ＋スメア＋グレード → 方向ブラー → RGB分離） */}
      <AbsoluteFill
        style={{
          transform: `translate(${shakeX.toFixed(1)}px, ${shakeY.toFixed(
            1
          )}px) scale(${(bulgeScale * pushScale).toFixed(
            4
          )}) scaleX(${smearScaleX.toFixed(4)})`,
          filter: grade,
        }}
      >
        <AbsoluteFill
          style={{ filter: blurOn ? `url(#${uid}-blur)` : undefined }}
        >
          {splitOn ? (
            <AbsoluteFill style={{ isolation: "isolate" }}>
              {/* G: 基準位置 */}
              <AbsoluteFill style={{ filter: `url(#${uid}-g)` }}>
                {stage}
              </AbsoluteFill>
              {/* R / B: 軸に沿って互い違いにオフセット。整列時は元の色へ完全復元 */}
              <AbsoluteFill
                style={{
                  filter: `url(#${uid}-r)`,
                  mixBlendMode: "screen",
                  transform: `translate(${rOffX.toFixed(1)}px, ${rOffY.toFixed(
                    1
                  )}px)`,
                }}
              >
                {stage}
              </AbsoluteFill>
              <AbsoluteFill
                style={{
                  filter: `url(#${uid}-b)`,
                  mixBlendMode: "screen",
                  transform: `translate(${bOffX.toFixed(1)}px, ${bOffY.toFixed(
                    1
                  )}px)`,
                }}
              >
                {stage}
              </AbsoluteFill>
            </AbsoluteFill>
          ) : (
            stage
          )}
        </AbsoluteFill>
      </AbsoluteFill>

      {/* left: 中央やや上の青白い水平ビーム（左へゆっくりドリフト） */}
      {direction === "left" && leakEnv > 0.02 && (
        <div
          style={{
            position: "absolute",
            top: "36%",
            left: `${(beamDrift - 12).toFixed(2)}%`,
            width: "124%",
            height: "13%",
            background:
              "linear-gradient(180deg, rgba(214,232,255,0) 0%, rgba(214,232,255,0.7) 40%, #f4faff 50%, rgba(214,232,255,0.7) 60%, rgba(214,232,255,0) 100%)",
            filter: `blur(${(26 * k).toFixed(1)}px)`,
            mixBlendMode: "screen",
            opacity: 0.75 * leakEnv,
            pointerEvents: "none",
          }}
        />
      )}

      {/* right: 暖色（オレンジ〜クリーム）のライトリーク */}
      {direction === "right" && leakEnv > 0.02 && (
        <AbsoluteFill
          style={{
            background: `linear-gradient(${262 + leakHueJitter}deg, rgba(255,166,88,0) 30%, rgba(255,166,88,0.5) 58%, rgba(255,222,178,0.85) 76%, rgba(255,166,88,0) 96%)`,
            filter: `blur(${(42 * k).toFixed(1)}px)`,
            mixBlendMode: "screen",
            opacity: 0.9 * leakEnv,
            pointerEvents: "none",
          }}
        />
      )}

      {/* up: 上部の暖色横スジ＋下部の薄青グローバンド */}
      {direction === "up" && leakEnv > 0.02 && (
        <>
          <div
            style={{
              position: "absolute",
              top: "4%",
              left: "-12%",
              width: "124%",
              height: "9%",
              background:
                "linear-gradient(180deg, rgba(255,192,128,0) 0%, rgba(255,192,128,0.8) 50%, rgba(255,192,128,0) 100%)",
              filter: `blur(${(22 * k).toFixed(1)}px)`,
              mixBlendMode: "screen",
              opacity: 0.7 * leakEnv,
              pointerEvents: "none",
            }}
          />
          <div
            style={{
              position: "absolute",
              bottom: "0%",
              left: "-12%",
              width: "124%",
              height: "16%",
              background:
                "linear-gradient(0deg, rgba(150,190,255,0.55) 0%, rgba(150,190,255,0) 100%)",
              filter: `blur(${(30 * k).toFixed(1)}px)`,
              mixBlendMode: "screen",
              opacity: 0.6 * leakEnv,
              pointerEvents: "none",
            }}
          />
        </>
      )}

      {/* down: ピンク/マゼンタのリーク＋下方向へ掃引する白い横ホットバンド */}
      {direction === "down" && leakEnv > 0.02 && (
        <>
          <AbsoluteFill
            style={{
              background: `linear-gradient(${168 + leakHueJitter}deg, rgba(255,110,190,0) 26%, rgba(255,110,190,0.4) 52%, rgba(150,120,255,0.35) 74%, rgba(150,120,255,0) 94%)`,
              filter: `blur(${(44 * k).toFixed(1)}px)`,
              mixBlendMode: "screen",
              opacity: 0.8 * leakEnv,
              pointerEvents: "none",
            }}
          />
          <div
            style={{
              position: "absolute",
              top: `${sweepTop.toFixed(2)}%`,
              left: "-10%",
              width: "120%",
              height: "9%",
              background:
                "linear-gradient(180deg, rgba(255,255,255,0) 0%, rgba(255,255,255,0.85) 45%, #ffffff 50%, rgba(255,255,255,0.85) 55%, rgba(255,255,255,0) 100%)",
              filter: `blur(${(18 * k).toFixed(1)}px)`,
              mixBlendMode: "screen",
              opacity: 0.85 * leakEnv,
              pointerEvents: "none",
            }}
          />
        </>
      )}

      {/* グレイン（フレーム毎に種替え・中盤の包絡でゲート） */}
      {grainOn && (
        <svg
          width="100%"
          height="100%"
          style={{
            position: "absolute",
            inset: 0,
            mixBlendMode: cfg.grain === "overlay" ? "overlay" : "soft-light",
            opacity: clamp01(cfg.grainAmt * grainEnv),
            pointerEvents: "none",
          }}
          aria-hidden
        >
          <rect width="100%" height="100%" filter={`url(#${uid}-grain)`} />
        </svg>
      )}

      {/* 白フラッシュ本体（二段エンベロープ・screen 合成） */}
      {flashVal > 0.005 && (
        <AbsoluteFill
          style={{
            background: `radial-gradient(120% 120% at 50% 46%, #ffffff 0%, ${cfg.flashColor} 55%, ${cfg.flashColor} 100%)`,
            mixBlendMode: "screen",
            opacity: clamp01(flashVal),
            pointerEvents: "none",
          }}
        />
      )}
    </AbsoluteFill>
  );
};
