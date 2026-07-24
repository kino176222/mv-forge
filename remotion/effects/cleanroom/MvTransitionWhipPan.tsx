import React, { useId, useMemo } from "react";
import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from "remotion";

/**
 * MvTransitionWhipPan — 高速カメラ振りトランジション家族（クリーンルーム実装）
 *
 * 機能: 一軸モーションブラー＋その頂点での旧新入れ替えで「カメラを勢いよく振った」
 *       ように見せる超短尺トランジション群（実尺 0.4〜0.5 秒想定）。
 *
 * 設計メモ:
 * - 進行度 p = frame/(duration-1) を軸に、パン / ブラー / フラッシュ / 揺れ / ズームを
 *   独立のエンベロープ関数として計算し、最後にレイヤーへ合成する。
 * - 一軸ブラーは SVG feGaussianBlur の stdDeviation を "X Y" で軸別に与える
 *   （水平パンなら "N 0"）。フィルタ領域はブラー方向へ大きく広げて端切れを防ぐ。
 *   ブラーで縁が黒く滲む対策として、頂点で 1〜2 割ズームインして縁を画面外へ押し出す。
 * - 旧→新の乗り替えは 2 方式:
 *   (a) filmstrip: 両カットを実距離で横並びにして 1 画面ぶん流し、切れ目ごとブラーで隠す
 *   (b) cross: 最大ブラーの瞬間に、ごく狭い幅の急峻な不透明度クロス
 * - variant(0..1) から家族内の個体（8 モード）とシードを決定論的に導出。
 *   乱数はすべて種付きハッシュ（Math.random 不使用）。揺れは毎秒 15 回の離散更新。
 * - 全ピクセル量は基準幅 1920 比でスケールし解像度非依存。
 * - 外部素材・フォント・追加依存なし（CSS/SVG/remotion 標準のみ）。
 */

export interface MvTransitionWhipPanProps {
  /** 旧カット */
  from: React.ReactNode;
  /** 新カット */
  to: React.ReactNode;
  /** トランジション全体の長さ（フレーム） */
  durationInFrames: number;
  /** パン方向。forward/backward はズーム押し込み系（スライドなし） */
  direction?: "left" | "right" | "up" | "down" | "forward" | "backward";
  /** 0..1 同家族内の見た目分岐（決定論的にモードとシードへ変換） */
  variant?: number;
}

// ---- 決定的乱数・イージング -------------------------------------------------

/** (a,b,c) から 0..1 の決定的な擬似乱数（sin ハッシュ） */
const rand = (a: number, b: number, c: number): number => {
  const s = Math.sin(a * 127.1 + b * 311.7 + c * 74.7) * 43758.5453123;
  return s - Math.floor(s);
};

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const smoothstep = (t: number) => {
  const x = clamp01(t);
  return x * x * (3 - 2 * x);
};
const easeInCubic = (t: number) => {
  const x = clamp01(t);
  return x * x * x;
};
const easeOutCubic = (t: number) => 1 - Math.pow(1 - clamp01(t), 3);

/** 中央頂点の三角パルス 0→1→0 */
const tri = (t: number) => Math.max(0, 1 - Math.abs(2 * clamp01(t) - 1));
/** 中心 c・半幅 w の山 */
const bump = (t: number, c: number, w: number) =>
  Math.max(0, 1 - Math.abs((t - c) / w));
/** 台形: a までに立ち上げ b から落とす */
const trap = (t: number, a: number, b: number) => {
  const x = clamp01(t);
  if (x <= 0 || x >= 1) return 0;
  if (x < a) return x / a;
  if (x > b) return (1 - x) / (1 - b);
  return 1;
};

// ---- 個体（モード）設定 ------------------------------------------------------

type BandKind = "none" | "swoosh" | "lightwhip" | "shadow";

type ModeCfg = {
  /** filmstrip 方式（true）か不透明度クロス方式（false）か */
  strip: boolean;
  /** クロス方式での乗り替え位置 0..1 */
  switchAt: number;
  /** 一軸ブラーの最大 stdDeviation（1920 基準 px）。cssBlur 時は CSS blur px */
  blurMax: number;
  /** SVG 一軸ブラーの代わりに CSS 等方ブラー＋過渡グレードを使う */
  cssBlur: boolean;
  blurEnv: (p: number) => number;
  /** 新カット側に別のブラー包絡を使う場合のみ指定 */
  toBlurEnv?: (p: number) => number;
  flashEnv: (p: number) => number;
  flashPeak: number;
  flashColor: string;
  /** 頂点でのズームイン量（縁の黒滲み対策込み） */
  zoomAmt: number;
  shakeEnv: (p: number) => number;
  shakePx: number;
  /** 微回転の最大角（deg）。0 で無効 */
  rotAmp: number;
  /** 水平光条の本数 */
  streaks: number;
  band: BandKind;
  /** 薄い斜めストライプ光条 */
  stripes: boolean;
  /** 暖色ライトリーク */
  leak: boolean;
  /** 露出の不規則な明滅列 */
  flicker: boolean;
  /** 軸をわずかに斜めへ倒す（0 で無効） */
  tilt: number;
};

const buildCfg = (mode: number): ModeCfg => {
  const base: ModeCfg = {
    strip: true,
    switchAt: 0.5,
    blurMax: 120,
    cssBlur: false,
    blurEnv: (p) => Math.pow(tri(p), 1.15),
    flashEnv: (p) => Math.pow(bump(p, 0.5, 0.24), 1.4),
    flashPeak: 0.7,
    flashColor: "#ffffff",
    zoomAmt: 0.12,
    shakeEnv: (p) => Math.pow(tri(p), 1.15),
    shakePx: 14,
    rotAmp: 0,
    streaks: 3,
    band: "none",
    stripes: false,
    leak: false,
    flicker: false,
    tilt: 0,
  };
  switch (mode) {
    case 0:
      // 家族の基準形。両カットを実距離で並走スライドし、切れ目をブラーと微振動で隠す最小構成
      return base;
    case 1:
      // ほぼ縦の斜め。揺れの山が 2 つ（退出/進入）で中央ゼロ、ブラーは中盤保持。
      // 微ズーム＋切替時の微回転＋薄い斜めストライプ光条
      return {
        ...base,
        strip: false,
        blurMax: 95,
        blurEnv: (p) => trap(p, 0.16, 0.84),
        flashEnv: (p) => Math.pow(bump(p, 0.5, 0.2), 1.5),
        flashPeak: 0.55,
        zoomAmt: 0.08,
        shakeEnv: (p) => Math.max(bump(p, 0.18, 0.2), bump(p, 0.82, 0.2)),
        shakePx: 16,
        rotAmp: 1.6,
        streaks: 0,
        stripes: true,
        tilt: 0.28,
      };
    case 2:
      // ブラー台形（早く立てて長く保持）、乗り替えは前半で完了。
      // 中央を横切る白い発光帯＋強めの全面白フラッシュが看板
      return {
        ...base,
        strip: false,
        switchAt: 0.34,
        blurMax: 105,
        blurEnv: (p) => trap(p, 0.1, 0.66),
        flashEnv: (p) => Math.pow(bump(p, 0.34, 0.26), 1.3),
        flashPeak: 0.9,
        zoomAmt: 0.1,
        shakePx: 12,
        streaks: 2,
        band: "swoosh",
      };
    case 3:
      // 旧と新に別々のブラー（旧は頂点へ増大、新は頂点から減衰）。
      // 水平光条痕を多めに乱数配置、暖色白の強フラッシュ、ズームは家族内最大級
      return {
        ...base,
        strip: false,
        blurMax: 135,
        blurEnv: (p) => Math.pow(clamp01(p / 0.5), 1.6),
        toBlurEnv: (p) => Math.pow(clamp01((1 - p) / 0.5), 1.6),
        flashEnv: (p) => Math.pow(bump(p, 0.5, 0.3), 1.2),
        flashPeak: 0.95,
        flashColor: "#fff3e2",
        zoomAmt: 0.2,
        shakeEnv: (p) => tri(p),
        shakePx: 15,
        streaks: 6,
      };
    case 4:
      // 暗転系。中央の黒帯を multiply で重ねブラー頂点で最濃、露出は不規則な明滅列。
      // filmstrip なので両カットは同方向へ流れる
      return {
        ...base,
        blurMax: 95,
        blurEnv: (p) => Math.pow(tri(p), 1.2),
        flashEnv: () => 0,
        flashPeak: 0,
        zoomAmt: 0.06,
        shakePx: 12,
        streaks: 0,
        band: "shadow",
        flicker: true,
      };
    case 5:
      // 暖色コア（白芯＋クリーム裾）の斜め光帯がパン方向へ薙ぐ。
      // フラッシュ強度はブラー包絡と同一形、縦揺れ＋微回転
      return {
        ...base,
        strip: false,
        blurMax: 115,
        blurEnv: (p) => Math.pow(tri(p), 1.05),
        flashEnv: (p) => Math.pow(tri(p), 1.05),
        flashPeak: 0.8,
        flashColor: "#fff4e0",
        zoomAmt: 0.12,
        shakePx: 15,
        rotAmp: 1.2,
        streaks: 2,
        band: "lightwhip",
      };
    case 6:
      // CSS 等方ブラー＋脱彩＋増光の過渡グレードで速度感を作る。
      // フラッシュは立ち上げ→ホールドの台形、暖色ライトリークと押し込みズーム
      return {
        ...base,
        strip: false,
        switchAt: 0.45,
        blurMax: 18,
        cssBlur: true,
        blurEnv: (p) => trap(p, 0.18, 0.7),
        flashEnv: (p) => trap(p, 0.22, 0.66),
        flashPeak: 0.85,
        flashColor: "#fff6ea",
        zoomAmt: 0.18,
        shakeEnv: (p) => trap(p, 0.18, 0.7),
        shakePx: 8,
        streaks: 0,
        leak: true,
      };
    case 7:
    default:
      // filmstrip のプッシュスライド。フラッシュの山を前半、ブラーの山を後半とずらす
      return {
        ...base,
        blurMax: 105,
        blurEnv: (p) => Math.pow(bump(p, 0.64, 0.38), 1.1),
        flashEnv: (p) => Math.pow(bump(p, 0.3, 0.26), 1.3),
        flashPeak: 0.8,
        zoomAmt: 0.1,
        shakeEnv: (p) => Math.pow(bump(p, 0.64, 0.38), 1.1),
        shakePx: 12,
        streaks: 2,
      };
  }
};

// ---- 本体 --------------------------------------------------------------------

export const MvTransitionWhipPan: React.FC<MvTransitionWhipPanProps> = ({
  from,
  to,
  durationInFrames,
  direction = "left",
  variant = 0,
}) => {
  const frame = useCurrentFrame();
  const { width, fps } = useVideoConfig();
  const rawId = useId();
  const uid = useMemo(() => rawId.replace(/[^a-zA-Z0-9_-]/g, ""), [rawId]);

  const k = width / 1920; // 解像度スケール
  const v = clamp01(variant);
  const mode = Math.min(7, Math.floor(v * 8));
  const seed = 13 + Math.floor(v * 997);
  const cfg = useMemo(() => buildCfg(mode), [mode]);

  const last = Math.max(1, durationInFrames - 1);
  const p = clamp01(frame / last);

  // ---- 方向ベクトル（退出方向） ---------------------------------------------
  const zoomMode = direction === "forward" || direction === "backward";
  let ax: number;
  let ay: number;
  switch (direction) {
    case "right":
      ax = 1;
      ay = 0;
      break;
    case "up":
      ax = 0;
      ay = -1;
      break;
    case "down":
      ax = 0;
      ay = 1;
      break;
    case "forward":
    case "backward":
    case "left":
    default:
      ax = -1;
      ay = 0;
      break;
  }
  if (cfg.tilt > 0 && !zoomMode) {
    // 軸を垂直成分側へわずかに倒す（「ほぼ縦の斜め」等）
    const px = -ay;
    const py = ax;
    const tx = ax + px * cfg.tilt;
    const ty = ay + py * cfg.tilt;
    const len = Math.hypot(tx, ty) || 1;
    ax = tx / len;
    ay = ty / len;
  }
  const angleDeg = (Math.atan2(ay, ax) * 180) / Math.PI;

  // ---- エンベロープ ------------------------------------------------------------
  const bEnv = cfg.blurEnv(p);
  const bEnvTo = cfg.toBlurEnv ? cfg.toBlurEnv(p) : bEnv;
  const flashVal = cfg.flashPeak * cfg.flashEnv(p);
  const zoomEnv = Math.max(bEnv, bEnvTo);

  const blurPx = cfg.blurMax * k * bEnv;
  const blurPxTo = cfg.blurMax * k * bEnvTo;
  const sxF = blurPx * Math.abs(ax);
  const syF = blurPx * Math.abs(ay);
  const sxT = blurPxTo * Math.abs(ax);
  const syT = blurPxTo * Math.abs(ay);
  const svgBlurOnF = !cfg.cssBlur && blurPx > 0.3;
  const svgBlurOnT = !cfg.cssBlur && blurPxTo > 0.3;

  // ---- 揺れ（毎秒 15 回の離散更新・振幅は包絡に比例） -------------------------
  const tIdx = Math.floor((frame * 15) / Math.max(1, fps));
  const sEnv = cfg.shakeEnv(p);
  const vShakeBias = cfg.band === "lightwhip" ? 1.4 : 0.7; // 縦揺れ強調個体
  const shakeX = (rand(seed, tIdx, 1) - 0.5) * 2 * cfg.shakePx * k * sEnv;
  const shakeY =
    (rand(seed, tIdx, 2) - 0.5) * 2 * cfg.shakePx * k * sEnv * vShakeBias;
  const rotSign = rand(seed, 0, 3) > 0.5 ? 1 : -1;
  const rot =
    cfg.rotAmp *
    rotSign *
    (mode === 1 ? bump(p, cfg.switchAt, 0.2) : Math.sin(Math.PI * p));

  // ---- ズーム（押し出しで縁の黒滲みを隠す） -----------------------------------
  let scale: number;
  if (zoomMode) {
    const push = 0.1 * smoothstep(p) + cfg.zoomAmt * 0.5 * zoomEnv;
    scale = direction === "backward" ? 1 + 0.12 - push : 1 + push;
  } else {
    scale = 1 + cfg.zoomAmt * zoomEnv;
  }

  // ---- スライド量 ---------------------------------------------------------------
  const eStrip = smoothstep(p); // ease-in-out: 中央最速＝ホイップ感
  const crossW = 0.1;
  const cs = cfg.switchAt - crossW / 2;
  const ce = cfg.switchAt + crossW / 2;
  const toOp = interpolate(p, [cs, ce], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const travel = zoomMode ? 0 : 118; // %
  const fromProg = clamp01(p / ce);
  const toProg = clamp01((p - cs) / (1 - cs));
  const fromShift = travel * easeInCubic(fromProg); // 旧: 加速して退出
  const toShift = travel * (1 - easeOutCubic(toProg)); // 新: 減速して定位置へ

  // ズーム押し込み系のスケール分離
  const fromPushScale =
    direction === "backward"
      ? Math.max(0.55, 1 - 0.3 * easeInCubic(fromProg))
      : 1 + 0.35 * easeInCubic(fromProg);
  const toPushScale =
    direction === "backward"
      ? 1 - 0.12 * toShiftless(toProg)
      : 1 + 0.16 * toShiftless(toProg);

  // ---- 露出（グレード） ---------------------------------------------------------
  let brightness = 1 + 0.12 * flashVal;
  if (cfg.flicker) {
    const flick = (rand(seed, tIdx, 5) - 0.5) * 0.55;
    brightness = 1 - 0.22 * bEnv + flick * bEnv;
  }
  const gradeParts: string[] = [];
  if (cfg.cssBlur) {
    gradeParts.push(`blur(${blurPx.toFixed(1)}px)`);
    gradeParts.push(`saturate(${(1 - 0.55 * bEnv).toFixed(3)})`);
    gradeParts.push(`contrast(${(1 + 0.06 * bEnv).toFixed(3)})`);
    brightness = 1 + 0.4 * flashVal + 0.1 * bEnv;
  }
  gradeParts.push(`brightness(${Math.max(0.2, brightness).toFixed(3)})`);
  const grade = gradeParts.join(" ");

  // ---- 光条（静的配置×包絡で出し入れ。位置・太さ・明るさは種付きハッシュ） ----
  const streakDefs = useMemo(
    () =>
      Array.from({ length: cfg.streaks }, (_, i) => ({
        top: 6 + rand(seed, i, 10) * 86,
        left: rand(seed, i, 11) * 34,
        w: 42 + rand(seed, i, 12) * 55,
        h: 0.9 + rand(seed, i, 13) * 3,
        bri: 0.45 + rand(seed, i, 14) * 0.55,
        warm: rand(seed, i, 15),
      })),
    [cfg.streaks, seed]
  );

  // ---- 帯・リークの包絡 ----------------------------------------------------------
  const bandEnv =
    cfg.band === "swoosh"
      ? trap(p, 0.1, 0.52)
      : cfg.band === "shadow"
        ? Math.pow(tri(p), 1.1)
        : bEnv;
  const leakEnv = 0.7 * bump(p, 0.46, 0.3);
  const sweep = smoothstep(p) * 160 - 80; // 光帯の薙ぎ位置（%）

  // ---- レイヤー -----------------------------------------------------------------
  const fromLayer = (offX: number, offY: number, extraScale = 1) => (
    <AbsoluteFill
      style={{
        transform: `translate(${offX.toFixed(3)}%, ${offY.toFixed(
          3
        )}%) scale(${extraScale.toFixed(4)})`,
      }}
    >
      {from}
    </AbsoluteFill>
  );
  const toLayer = (offX: number, offY: number, extraScale = 1) => (
    <AbsoluteFill
      style={{
        transform: `translate(${offX.toFixed(3)}%, ${offY.toFixed(
          3
        )}%) scale(${extraScale.toFixed(4)})`,
      }}
    >
      {to}
    </AbsoluteFill>
  );

  let content: React.ReactNode;
  if (cfg.strip) {
    // filmstrip: 両カットを実距離で並べて 1 画面ぶん流す。切れ目はブラーが隠す
    content = (
      <AbsoluteFill
        style={{
          transform: `translate(${(ax * 100 * eStrip).toFixed(3)}%, ${(
            ay * 100 * eStrip
          ).toFixed(3)}%)`,
          filter: svgBlurOnF ? `url(#${uid}-bf)` : undefined,
        }}
      >
        {eStrip < 1 && fromLayer(0, 0)}
        {toLayer(-ax * 100, -ay * 100)}
      </AbsoluteFill>
    );
  } else if (cfg.toBlurEnv) {
    // 旧新で別ブラー: レイヤーごとにフィルタを掛ける
    content = (
      <AbsoluteFill>
        {toOp < 0.999 && (
          <AbsoluteFill
            style={{
              filter: svgBlurOnF ? `url(#${uid}-bf)` : undefined,
              opacity: 1,
            }}
          >
            {fromLayer(
              ax * fromShift,
              ay * fromShift,
              zoomMode ? fromPushScale : 1
            )}
          </AbsoluteFill>
        )}
        {toOp > 0.001 && (
          <AbsoluteFill
            style={{
              filter: svgBlurOnT ? `url(#${uid}-bt)` : undefined,
              opacity: toOp,
            }}
          >
            {toLayer(-ax * toShift, -ay * toShift, zoomMode ? toPushScale : 1)}
          </AbsoluteFill>
        )}
      </AbsoluteFill>
    );
  } else {
    // 共有ブラー: 2 レイヤーをまとめて 1 回だけフィルタ（クロスの継ぎ目も一緒に溶ける）
    content = (
      <AbsoluteFill style={{ filter: svgBlurOnF ? `url(#${uid}-bf)` : undefined }}>
        {toOp < 0.999 &&
          fromLayer(ax * fromShift, ay * fromShift, zoomMode ? fromPushScale : 1)}
        {toOp > 0.001 && (
          <AbsoluteFill style={{ opacity: toOp }}>
            {toLayer(-ax * toShift, -ay * toShift, zoomMode ? toPushScale : 1)}
          </AbsoluteFill>
        )}
      </AbsoluteFill>
    );
  }

  return (
    <AbsoluteFill style={{ background: "#000", overflow: "hidden" }}>
      {/* 一軸ブラー定義（領域はブラー方向へ大きく拡張） */}
      <svg width={0} height={0} style={{ position: "absolute" }} aria-hidden>
        <defs>
          <filter
            id={`${uid}-bf`}
            x="-100%"
            y="-100%"
            width="300%"
            height="300%"
            colorInterpolationFilters="sRGB"
          >
            <feGaussianBlur
              stdDeviation={`${sxF.toFixed(2)} ${syF.toFixed(2)}`}
              edgeMode="duplicate"
            />
          </filter>
          <filter
            id={`${uid}-bt`}
            x="-100%"
            y="-100%"
            width="300%"
            height="300%"
            colorInterpolationFilters="sRGB"
          >
            <feGaussianBlur
              stdDeviation={`${sxT.toFixed(2)} ${syT.toFixed(2)}`}
              edgeMode="duplicate"
            />
          </filter>
        </defs>
      </svg>

      {/* シェイク＋ズーム＋グレードのラッパー */}
      <AbsoluteFill
        style={{
          transform: `translate(${shakeX.toFixed(1)}px, ${shakeY.toFixed(
            1
          )}px) rotate(${rot.toFixed(3)}deg) scale(${scale.toFixed(4)})`,
          filter: grade,
        }}
      >
        {content}
      </AbsoluteFill>

      {/* 光条（白コア＋暖色の裾。パン軸に沿って回転） */}
      {cfg.streaks > 0 && bEnv > 0.02 && (
        <AbsoluteFill
          style={{
            transform: `rotate(${angleDeg <= -90 || angleDeg > 90 ? angleDeg + 180 : angleDeg}deg) scale(1.6)`,
            mixBlendMode: "screen",
            pointerEvents: "none",
          }}
        >
          {streakDefs.map((s, i) => {
            const skirt = `rgba(255, ${Math.round(
              236 - s.warm * 26
            )}, ${Math.round(210 - s.warm * 60)}, 0.75)`;
            return (
              <div
                key={i}
                style={{
                  position: "absolute",
                  top: `${s.top.toFixed(2)}%`,
                  left: `${s.left.toFixed(2)}%`,
                  width: `${s.w.toFixed(2)}%`,
                  height: `${s.h.toFixed(2)}%`,
                  borderRadius: 999,
                  background: `linear-gradient(90deg, transparent 0%, ${skirt} 32%, #ffffff 50%, ${skirt} 68%, transparent 100%)`,
                  filter: `blur(${(7 * k).toFixed(1)}px)`,
                  opacity: clamp01(s.bri * bEnv * (0.75 + 0.5 * rand(seed, tIdx, 40 + i))),
                }}
              />
            );
          })}
        </AbsoluteFill>
      )}

      {/* 斜めストライプ光条（薄く・両側にランプ） */}
      {cfg.stripes && bEnv > 0.02 && (
        <AbsoluteFill
          style={{
            background: `repeating-linear-gradient(${(angleDeg + 90).toFixed(
              1
            )}deg, rgba(255,246,228,0) 0px, rgba(255,246,228,0.4) ${(26 * k).toFixed(0)}px, rgba(255,246,228,0) ${(52 * k).toFixed(0)}px, rgba(255,246,228,0) ${(96 * k).toFixed(0)}px)`,
            filter: `blur(${(5 * k).toFixed(1)}px)`,
            mixBlendMode: "screen",
            opacity: 0.18 * bEnv,
            pointerEvents: "none",
          }}
        />
      )}

      {/* 中央を横切る白い発光帯 */}
      {cfg.band === "swoosh" && bandEnv > 0.02 && (
        <AbsoluteFill
          style={{
            transform: `rotate(${angleDeg <= -90 || angleDeg > 90 ? angleDeg + 180 : angleDeg}deg) scale(1.6)`,
            mixBlendMode: "screen",
            pointerEvents: "none",
          }}
        >
          <div
            style={{
              position: "absolute",
              top: "40%",
              left: "-10%",
              width: "120%",
              height: "20%",
              background:
                "linear-gradient(180deg, rgba(255,255,255,0) 0%, rgba(255,255,255,0.9) 45%, #ffffff 50%, rgba(255,255,255,0.9) 55%, rgba(255,255,255,0) 100%)",
              filter: `blur(${(22 * k).toFixed(1)}px)`,
              opacity: 0.85 * bandEnv,
            }}
          />
        </AbsoluteFill>
      )}

      {/* 暖色コアの斜め光帯（パン方向へ薙ぐ） */}
      {cfg.band === "lightwhip" && bEnv > 0.02 && (
        <AbsoluteFill
          style={{
            transform: `translate(${(ax * sweep).toFixed(2)}%, ${(
              ay * sweep
            ).toFixed(2)}%) rotate(${(angleDeg + 18).toFixed(1)}deg) scale(1.8)`,
            mixBlendMode: "screen",
            pointerEvents: "none",
          }}
        >
          <div
            style={{
              position: "absolute",
              top: "-30%",
              left: "24%",
              width: "52%",
              height: "160%",
              background:
                "linear-gradient(90deg, rgba(255,214,150,0) 0%, rgba(255,214,150,0.8) 30%, #fffdf4 50%, rgba(255,214,150,0.8) 70%, rgba(255,214,150,0) 100%)",
              filter: `blur(${(26 * k).toFixed(1)}px)`,
              opacity: 0.9 * bEnv,
            }}
          />
        </AbsoluteFill>
      )}

      {/* 暗転系の黒帯（進行軸と直交・multiply・頂点で最濃） */}
      {cfg.band === "shadow" && bandEnv > 0.02 && (
        <AbsoluteFill
          style={{
            transform: `rotate(${angleDeg <= -90 || angleDeg > 90 ? angleDeg + 180 : angleDeg}deg) scale(1.6)`,
            mixBlendMode: "multiply",
            pointerEvents: "none",
          }}
        >
          <div
            style={{
              position: "absolute",
              inset: 0,
              background:
                "linear-gradient(90deg, rgba(255,255,255,1) 14%, rgba(40,40,44,1) 42%, rgba(8,8,10,1) 50%, rgba(40,40,44,1) 58%, rgba(255,255,255,1) 86%)",
              filter: `blur(${(14 * k).toFixed(1)}px)`,
              opacity: 0.88 * bandEnv,
            }}
          />
        </AbsoluteFill>
      )}

      {/* 暖色ライトリーク（フラッシュ直後に頂点） */}
      {cfg.leak && leakEnv > 0.02 && (
        <AbsoluteFill
          style={{
            background:
              "linear-gradient(115deg, rgba(255,178,102,0) 28%, rgba(255,178,102,0.55) 54%, rgba(255,224,176,0.85) 70%, rgba(255,178,102,0) 92%)",
            filter: `blur(${(48 * k).toFixed(1)}px)`,
            mixBlendMode: "screen",
            opacity: leakEnv,
            pointerEvents: "none",
          }}
        />
      )}

      {/* 最上段の全面フラッシュ（露出が飛ぶ白 or 暖色白） */}
      {flashVal > 0.005 && (
        <AbsoluteFill
          style={{
            background: cfg.flashColor,
            mixBlendMode: "screen",
            opacity: clamp01(flashVal),
            pointerEvents: "none",
          }}
        />
      )}
    </AbsoluteFill>
  );
};

/** 新カットの押し込みスケール用: 1→0 へ減衰する残距離 */
function toShiftless(toProg: number): number {
  return 1 - easeOutCubic(toProg);
}
