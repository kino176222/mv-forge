import React, { useId, useMemo } from "react";
import {
  AbsoluteFill,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

/**
 * MvTransitionFilmScribble — フィルム質感×手描きスクリブルの方向つきトランジション
 * （クリーンルーム実装）
 *
 * 機能: フィルム調の焼け・粒子・色収差の混沌の中を手描きマーカーの落書きが走り、
 *       その頂点で旧カット→新カットが入れ替わる約1秒のトランジション。
 *
 * 設計メモ:
 * - 緩急はイージング曲線ではなく「線形ランプの積層」で作る（中央プラトー型の三角
 *   エンベロープに全効果を比例させ、一撃感を出す）。バウンス/オーバーシュート無し。
 * - カット入替は頂点を挟む狭い窓で新カットの不透明度のみを 0→1。混沌とスクリブル
 *   被覆の下で入替を隠す。
 * - 色収差は feColorMatrix でチャンネル抽出した実レイヤー3枚（R/G/B）を軸方向に
 *   逆向きへずらして screen 合成。整列時は元の色を正確に再構成する。
 * - スクリブルは SVG 線画を手続き生成。丸キャップ太ストローク＋Q曲線の中点ずらしで
 *   マーカーの丸みを出し、毎フレームの微小 translate/rotate＋頂点ジッタ（boil）で
 *   手描きアニメ感を出す。pathLength=1 の dashoffset で「描き込まれていく」掃引。
 * - 乱数はすべて (seed, tick, index) の決定的ハッシュ。Math.random 不使用。
 * - px 系の量はすべて基準幅に対する比で持ち、実解像度で換算（解像度非依存）。
 * - direction で軸と色・質感の個性が変わる（left/up=白＋赤＋ピンク、right=青2階調＋
 *   白芯・暗転・ダスト、down=ピンク/紫＋歪み発光）。forward/backward はズーム主体。
 */

export interface MvTransitionFilmScribbleProps {
  /** 旧カット */
  from: React.ReactNode;
  /** 新カット */
  to: React.ReactNode;
  /** トランジション全体の長さ（フレーム） */
  durationInFrames: number;
  /** 方向族 */
  direction?: "left" | "right" | "up" | "down" | "forward" | "backward";
  /** 0..1 同家族内の見た目分岐（決定論的） */
  variant?: number;
}

/** (a,b,c) から 0..1 の決定的な擬似乱数 */
const rand = (a: number, b: number, c: number): number => {
  const s = Math.sin(a * 127.1 + b * 311.7 + c * 74.7) * 43758.5453123;
  return s - Math.floor(s);
};

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

type Pt = { x: number; y: number };

/** 折れ点を Q 曲線の制御点にして中点を結ぶ（マーカーの丸み） */
const markerPath = (pts: Pt[]): string => {
  if (pts.length < 2) return "";
  let d = `M ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const mx = (pts[i].x + pts[i + 1].x) / 2;
    const my = (pts[i].y + pts[i + 1].y) / 2;
    d += ` Q ${pts[i].x.toFixed(1)} ${pts[i].y.toFixed(1)} ${mx.toFixed(
      1
    )} ${my.toFixed(1)}`;
  }
  const last = pts[pts.length - 1];
  d += ` L ${last.x.toFixed(1)} ${last.y.toFixed(1)}`;
  return d;
};

type Stroke = {
  d: string;
  color: string;
  width: number;
  /** 描き込み順の窓 [開始, 終了]（スクリブル進行 0..1 の中で） */
  win: [number, number];
  opacity?: number;
};

// スクリブルの論理座標系
const VW = 1600;
const VH = 900;

export const MvTransitionFilmScribble: React.FC<
  MvTransitionFilmScribbleProps
> = ({ from, to, durationInFrames, direction = "left", variant = 0 }) => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const rawId = useId();
  const uid = useMemo(() => rawId.replace(/[^a-zA-Z0-9_-]/g, ""), [rawId]);

  const dir = direction;
  const vv = clamp01(variant);
  const seed = 13 + Math.floor(vv * 96) * 7;

  const last = Math.max(1, durationInFrames - 1);
  const p = clamp01(frame / last);

  // 軸ベクトル（forward/backward は無方向＝ズーム主体）
  const ax = dir === "left" ? -1 : dir === "right" ? 1 : 0;
  const ay = dir === "up" ? -1 : dir === "down" ? 1 : 0;
  const isRight = dir === "right";
  const isDown = dir === "down";
  const hasEdgeFade = dir === "left" || dir === "up";

  // ---- 共通エンベロープ（中央プラトー型の三角。頂点はわずかに手前） -----------
  const g = interpolate(p, [0, 0.44, 0.54, 1], [0, 1, 1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  // カット入替: 頂点を挟む狭い窓で新カットの不透明度のみ 0→1
  const toOpacity = interpolate(p, [0.39, 0.59], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  // 光（ブルーム/光漏れ）: 1/4 で満ち、3/4 弱まで保持して減衰（効果類より長い）
  const leakEnv = interpolate(p, [0.04, 0.25, 0.72, 0.98], [0.3, 1, 1, 0.12], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const bloomEnv =
    interpolate(p, [0.18, 0.4, 0.62, 0.82], [0, 1, 0.75, 0], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    }) * (isRight ? 0.12 : 1); // right は頂点で明るくならない

  // スクリブル: 1/8 で描き始め頂点で全面、5/6 で消える
  const scribbleDraw = interpolate(p, [0.125, 0.5], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const scribbleFade = interpolate(p, [0.79, 0.845], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  // ---- 頂点での量感（基準幅比→実 px 換算） -----------------------------------
  const zoomGain = dir === "forward" ? 0.42 : dir === "backward" ? 0.16 : 0.3;
  const zoom = 1 + zoomGain * g;
  const driftX = ax * 0.04 * width * g;
  const driftY = ay * 0.04 * height * g;

  // 微振動: フレームより速い周期でノイズ更新（毎フレーム新値）してガタつきを強調
  const shakeAmp = 0.012 * width * g;
  const shakeX = (rand(seed, frame, 21) - 0.5) * 2 * shakeAmp;
  const shakeY = (rand(seed, frame, 22) - 0.5) * 2 * shakeAmp;
  const shakeRot = (rand(seed, frame, 23) - 0.5) * 0.5 * g;

  // 方向性ブラー（軸方向のみ。forward/backward は等方の弱ブラー）
  const blurAxis = 0.018 * width * g;
  const blurIso = ax === 0 && ay === 0 ? 0.007 * width * g : 0.3 * g;
  const blurSX = Math.abs(ax) * blurAxis + blurIso;
  const blurSY = Math.abs(ay) * blurAxis + blurIso;
  const blurOn = Math.max(blurSX, blurSY) > 0.4;

  // 色収差: 赤と青を軸の逆側へ（無方向族は斜めに散らす）
  const caAmt = 0.014 * width * g;
  const caX = (ax === 0 && ay === 0 ? 0.7 : ax) * caAmt;
  const caY = (ax === 0 && ay === 0 ? 0.4 : ay) * caAmt;
  const caOn = caAmt > 0.6;

  // 脱色・トーン: 頂点でほぼグレースケール。right のみ半分まで暗転
  const gray = clamp01(g * (isDown ? 1 : 0.92));
  const contrast = 1 + 0.18 * g;
  const brightness = isRight ? 1 - 0.5 * g : 1 + 0.07 * g;

  // right のみ: 横伸び＋レンズ膨張ふうの追いスケール
  const stretchX = isRight ? 1 + 0.14 * g : 1;
  // down のみ: 上端 origin の縦ストレッチで下へ崩れる
  const stretchY = isDown ? 1 + 0.2 * g : 1;

  const grade = [
    `grayscale(${gray.toFixed(3)})`,
    `contrast(${contrast.toFixed(3)})`,
    `brightness(${brightness.toFixed(3)})`,
    blurOn ? `url(#${uid}-dirblur)` : "",
  ]
    .filter(Boolean)
    .join(" ");

  const footageTransform = [
    `translate(${(driftX + shakeX).toFixed(1)}px, ${(driftY + shakeY).toFixed(
      1
    )}px)`,
    `rotate(${shakeRot.toFixed(3)}deg)`,
    `scale(${(zoom * stretchX).toFixed(4)}, ${(zoom * stretchY).toFixed(4)})`,
  ].join(" ");

  // ---- フッテージ（旧＋新の重ね。新カット側の不透明度だけで入替） -------------
  const footage = (
    <AbsoluteFill>
      <AbsoluteFill>{from}</AbsoluteFill>
      <AbsoluteFill style={{ opacity: toOpacity }}>{to}</AbsoluteFill>
    </AbsoluteFill>
  );

  // ---- スクリブル生成（boil: 2フレームごとに頂点ジッタを更新） ----------------
  const boilTick = Math.floor(frame / 2);
  const strokes = useMemo<Stroke[]>(() => {
    const out: Stroke[] = [];
    const boilAmp = 5;
    // 頂点ジッタ
    const J = (i: number, k: number) =>
      (rand(seed + i, boilTick, k) - 0.5) * 2 * boilAmp;
    // 軸空間 (u: 進行方向 0→1, v: 横断 0→1) → 画面座標
    const mapPt = (u: number, v: number, ji: number): Pt => {
      let x: number;
      let y: number;
      if (dir === "left") {
        x = (1 - u) * VW;
        y = v * VH;
      } else if (dir === "right") {
        x = u * VW;
        y = v * VH;
      } else if (dir === "up") {
        x = v * VW;
        y = (1 - u) * VH;
      } else if (dir === "down") {
        x = v * VW;
        y = u * VH;
      } else {
        x = u * VW;
        y = v * VH;
      }
      return { x: x + J(ji, 1), y: y + J(ji, 2) };
    };
    // 走り書きループ: 1周強回して端をはみ出させる
    const loop = (
      uc: number,
      vc: number,
      r: number,
      turns: number,
      idBase: number
    ): string => {
      const c = mapPt(uc, vc, idBase);
      const steps = Math.round(18 * turns);
      const pts: Pt[] = [];
      for (let k = 0; k <= steps; k++) {
        const a =
          rand(seed, idBase, 3) * Math.PI * 2 +
          (k / steps) * turns * Math.PI * 2;
        const rj = 1 + (rand(seed + k, idBase, 4) - 0.5) * 0.14;
        pts.push({
          x: c.x + Math.cos(a) * r * 1.25 * rj + J(idBase + k, 5) * 0.6,
          y: c.y + Math.sin(a) * r * rj + J(idBase + k, 6) * 0.6,
        });
      }
      return markerPath(pts);
    };
    // ジグザグ: u に沿って進み v が交互に振れる
    const zig = (
      u0: number,
      u1: number,
      vc: number,
      amp: number,
      n: number,
      idBase: number
    ): string => {
      const pts: Pt[] = [];
      for (let k = 0; k <= n; k++) {
        const u = u0 + ((u1 - u0) * k) / n;
        const sway = (rand(seed + k, idBase, 7) - 0.5) * 0.35;
        const v = vc + (k % 2 === 0 ? -1 : 1) * amp * (0.75 + sway);
        pts.push(mapPt(u, v, idBase + k));
      }
      return markerPath(pts);
    };
    // 二重シェブロン（apex が進行方向 u=1 側を向く）
    const chevron = (ua: number, va: number, idBase: number): string => {
      const pts = [
        mapPt(ua - 0.075, va - 0.14, idBase),
        mapPt(ua, va, idBase + 1),
        mapPt(ua - 0.075, va + 0.14, idBase + 2),
      ];
      return markerPath(pts);
    };

    if (isRight) {
      // 最重装: 青マーカーの短ジグザグ十数本＋囲みループを u 順に掃引描画。
      // 各本は太青→淡青→白芯の3階調パス。
      const inks: Array<[string, number]> = [
        ["#2c53b8", 26],
        ["#7fa8ef", 15],
        ["#eef4ff", 5],
      ];
      type Unit = { d: string; u: number };
      const units: Unit[] = [];
      for (let i = 0; i < 12; i++) {
        const uc = 0.03 + (i / 12) * 0.92 + (rand(seed, i, 8) - 0.5) * 0.05;
        const vc = 0.08 + rand(seed + 1, i, 9) * 0.84;
        const len = 0.09 + rand(seed + 2, i, 10) * 0.08;
        units.push({
          d: zig(uc - len / 2, uc + len / 2, vc, 0.1, 4 + (i % 3), 40 + i * 9),
          u: uc,
        });
      }
      units.push({ d: loop(0.42, 0.5, 165, 1.15, 200), u: 0.42 });
      units.push({ d: loop(0.78, 0.62, 120, 1.2, 230), u: 0.78 });
      units.sort((a, b) => a.u - b.u);
      units.forEach((unit, i) => {
        const s = (i / units.length) * 0.72;
        const e = Math.min(1, s + 0.3);
        inks.forEach(([color, w]) => {
          out.push({ d: unit.d, color, width: w, win: [s, e] });
        });
      });
    } else if (isDown) {
      // ピンク〜紫。screen 発光＋turbulence 歪みは描画側で掛ける
      out.push({
        d: zig(-0.04, 1.04, 0.44, 0.1, 9, 300),
        color: "#ff7ac2",
        width: 12,
        win: [0, 0.42],
      });
      out.push({
        d: zig(0.08, 0.92, 0.6, 0.09, 8, 330),
        color: "#b06cf0",
        width: 12,
        win: [0.22, 0.66],
      });
      out.push({
        d: chevron(0.66, 0.52, 360),
        color: "#ffd7ec",
        width: 14,
        win: [0.5, 0.78],
      });
      out.push({
        d: chevron(0.58, 0.52, 370),
        color: "#e39bf5",
        width: 14,
        win: [0.6, 0.88],
      });
      out.push({
        d: loop(0.8, 0.76, 62, 1.25, 380),
        color: "#ff4fa3",
        width: 10,
        win: [0.7, 1],
      });
    } else {
      // 家族標準形（left / up / forward / backward）:
      // 白の二重シェブロン＋赤の横断ジグザグ＋ピンクの走り書き
      out.push({
        d: zig(-0.05, 1.05, 0.52, 0.11, 9, 400),
        color: "#e82a4e",
        width: 10,
        win: [0, 0.5],
      });
      out.push({
        d: chevron(0.72, 0.44, 430),
        color: "#f4ead8",
        width: 16,
        win: [0.3, 0.62],
      });
      out.push({
        d: chevron(0.63, 0.44, 440),
        color: "#f4ead8",
        width: 16,
        win: [0.42, 0.74],
      });
      out.push({
        d: loop(0.22, 0.8, 58, 1.3, 460),
        color: "#ff4fa3",
        width: 11,
        win: [0.58, 0.92],
      });
      out.push({
        d: zig(0.16, 0.3, 0.82, 0.05, 4, 480),
        color: "#ff4fa3",
        width: 11,
        win: [0.72, 1],
      });
    }
    return out;
  }, [dir, isRight, isDown, seed, boilTick]);

  // スクリブル層全体の boil（微小 translate/rotate）と方向ドリフト
  const boilX = (rand(seed, boilTick, 31) - 0.5) * 9;
  const boilY = (rand(seed, boilTick, 32) - 0.5) * 9;
  const boilR = (rand(seed, boilTick, 33) - 0.5) * 0.9;
  const scribbleDriftPct = (ax !== 0 ? 6 : 8) * p; // 家族の方向へゆっくり流れる

  // right のみ: ダスト/ヘア傷（3フレームごとに位置更新）
  const dustTick = Math.floor(frame / 3);
  const dust = useMemo(() => {
    if (!isRight) return null;
    const specks = Array.from({ length: 6 }, (_, i) => ({
      cx: rand(seed, dustTick, 60 + i) * VW,
      cy: rand(seed + 1, dustTick, 61 + i) * VH,
      r: 1.2 + rand(seed + 2, dustTick, 62 + i) * 2.2,
      o: 0.25 + rand(seed + 3, dustTick, 63 + i) * 0.35,
    }));
    const hairs = Array.from({ length: 2 }, (_, i) => {
      const x0 = rand(seed, dustTick, 70 + i) * VW;
      const y0 = rand(seed + 1, dustTick, 71 + i) * VH * 0.5;
      const bend = (rand(seed + 2, dustTick, 72 + i) - 0.5) * 120;
      return `M ${x0.toFixed(0)} ${y0.toFixed(0)} q ${bend.toFixed(0)} ${(
        VH * 0.25
      ).toFixed(0)} ${(bend * 0.4).toFixed(0)} ${(VH * 0.45).toFixed(0)}`;
    });
    return { specks, hairs };
  }, [isRight, seed, dustTick]);

  // 光漏れの位置（方向の反対側の肩から差す）
  const leakX = ax !== 0 ? (ax < 0 ? 82 : 18) : 50 + (vv - 0.5) * 30;
  const leakY = ay !== 0 ? (ay < 0 ? 85 : 15) : 12;

  // 開始/終了の瞬間フェード（left / up のみ）
  const edgeFade = hasEdgeFade
    ? interpolate(p, [0, 0.04, 0.96, 1], [0.75, 0, 0, 0.75], {
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
      })
    : 0;

  const grainSeed = seed * 3 + frame * 7;

  return (
    <AbsoluteFill style={{ background: "#000", overflow: "hidden" }}>
      {/* フィルタ定義（チャンネル抽出 / 方向性ブラー / グレイン / 歪み） */}
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
          {blurOn && (
            <filter id={`${uid}-dirblur`}>
              <feGaussianBlur
                stdDeviation={`${blurSX.toFixed(2)} ${blurSY.toFixed(2)}`}
              />
            </filter>
          )}
          {isDown && (
            <filter id={`${uid}-wobble`} x="-10%" y="-10%" width="120%" height="120%">
              <feTurbulence
                type="turbulence"
                baseFrequency="0.012 0.02"
                numOctaves={1}
                seed={boilTick % 100}
                result="n"
              />
              <feDisplacementMap
                in="SourceGraphic"
                in2="n"
                scale={16}
                xChannelSelector="R"
                yChannelSelector="G"
              />
            </filter>
          )}
        </defs>
      </svg>

      {/* 1. フッテージ層（ズームパンチ・ドリフト・振動・脱色・色収差をまとめて） */}
      <AbsoluteFill
        style={{ transform: footageTransform, filter: grade }}
      >
        {caOn ? (
          <>
            <AbsoluteFill style={{ filter: `url(#${uid}-g)` }}>
              {footage}
            </AbsoluteFill>
            <AbsoluteFill
              style={{
                filter: `url(#${uid}-r)`,
                mixBlendMode: "screen",
                transform: `translate(${(-caX).toFixed(1)}px, ${(-caY).toFixed(
                  1
                )}px)`,
              }}
            >
              {footage}
            </AbsoluteFill>
            <AbsoluteFill
              style={{
                filter: `url(#${uid}-b)`,
                mixBlendMode: "screen",
                transform: `translate(${caX.toFixed(1)}px, ${caY.toFixed(
                  1
                )}px)`,
              }}
            >
              {footage}
            </AbsoluteFill>
          </>
        ) : (
          footage
        )}
      </AbsoluteFill>

      {/* 2. 光漏れ（暖色ラジアル screen、対角に薄い寒色でフィルムの二色構成） */}
      <AbsoluteFill
        style={{
          background: `radial-gradient(ellipse 62% 55% at ${leakX}% ${leakY}%, rgba(255,214,150,0.55) 0%, rgba(255,150,60,0.3) 42%, transparent 72%)`,
          mixBlendMode: "screen",
          opacity: 0.35 + 0.55 * leakEnv,
          pointerEvents: "none",
        }}
      />
      <AbsoluteFill
        style={{
          background: `radial-gradient(ellipse 55% 50% at ${100 - leakX}% ${
            100 - leakY
          }%, rgba(96,132,255,0.28) 0%, transparent 65%)`,
          mixBlendMode: "screen",
          opacity: 0.3 + 0.4 * leakEnv,
          pointerEvents: "none",
        }}
      />

      {/* 3. 中央ブルーム（中盤に膨らむ露出焼け） */}
      <AbsoluteFill
        style={{
          background:
            "radial-gradient(ellipse 46% 42% at 50% 47%, rgba(255,248,232,0.95) 0%, rgba(255,238,208,0.45) 45%, transparent 72%)",
          mixBlendMode: "screen",
          opacity: 0.85 * bloomEnv,
          pointerEvents: "none",
        }}
      />

      {/* 4. フィルムグレイン（フラクタルノイズ脱色→overlay。seed 毎フレーム更新） */}
      <AbsoluteFill
        style={{
          mixBlendMode: "overlay",
          opacity: 0.14 + 0.24 * g,
          pointerEvents: "none",
        }}
      >
        <svg width="100%" height="100%">
          <filter id={`${uid}-grain`}>
            <feTurbulence
              type="fractalNoise"
              baseFrequency="0.9"
              numOctaves={2}
              seed={grainSeed % 9973}
              stitchTiles="stitch"
            />
            <feColorMatrix type="saturate" values="0" />
          </filter>
          <rect width="100%" height="100%" filter={`url(#${uid}-grain)`} />
        </svg>
      </AbsoluteFill>

      {/* right のみ: ダスト/ヘア傷 */}
      {dust && (
        <AbsoluteFill style={{ pointerEvents: "none", opacity: 0.35 + 0.4 * g }}>
          <svg
            width="100%"
            height="100%"
            viewBox={`0 0 ${VW} ${VH}`}
            preserveAspectRatio="none"
          >
            {dust.specks.map((s, i) => (
              <circle
                key={`s${i}`}
                cx={s.cx.toFixed(0)}
                cy={s.cy.toFixed(0)}
                r={s.r.toFixed(1)}
                fill="#f2f0e8"
                opacity={s.o.toFixed(2)}
              />
            ))}
            {dust.hairs.map((d, i) => (
              <path
                key={`h${i}`}
                d={d}
                stroke="#141210"
                strokeWidth={2.4}
                fill="none"
                opacity={0.4}
                strokeLinecap="round"
              />
            ))}
          </svg>
        </AbsoluteFill>
      )}

      {/* 5. ビネット（周辺減光） */}
      <AbsoluteFill
        style={{
          background: `radial-gradient(ellipse at center, transparent 50%, rgba(0,0,0,${(
            0.42 +
            0.26 * g
          ).toFixed(3)}) 100%)`,
          pointerEvents: "none",
        }}
      />

      {/* 6. 手描きスクリブル（最前面。boil＋方向ドリフト＋掃引描画） */}
      {scribbleDraw > 0 && scribbleFade > 0 && (
        <AbsoluteFill
          style={{
            transform: `translate(${(ax * scribbleDriftPct).toFixed(2)}%, ${(
              ay * scribbleDriftPct
            ).toFixed(2)}%)`,
            opacity: scribbleFade,
            mixBlendMode: isDown ? "screen" : "normal",
            pointerEvents: "none",
          }}
        >
          <svg
            width="100%"
            height="100%"
            viewBox={`0 0 ${VW} ${VH}`}
            preserveAspectRatio="none"
            style={{ overflow: "visible", display: "block" }}
          >
            <g
              transform={`translate(${boilX.toFixed(1)} ${boilY.toFixed(
                1
              )}) rotate(${boilR.toFixed(2)} ${VW / 2} ${VH / 2})`}
              filter={isDown ? `url(#${uid}-wobble)` : undefined}
            >
              {strokes.map((s, i) => {
                const drawn = clamp01(
                  (scribbleDraw - s.win[0]) / Math.max(1e-4, s.win[1] - s.win[0])
                );
                if (drawn <= 0.01) return null;
                return (
                  <path
                    key={i}
                    d={s.d}
                    fill="none"
                    stroke={s.color}
                    strokeWidth={s.width}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    pathLength={1}
                    strokeDasharray={1}
                    strokeDashoffset={(1 - drawn).toFixed(4)}
                    opacity={s.opacity ?? 1}
                  />
                );
              })}
            </g>
          </svg>
        </AbsoluteFill>
      )}

      {/* 開始/終了の瞬間フェード（left / up のみ） */}
      {edgeFade > 0.01 && (
        <AbsoluteFill
          style={{ background: "#000", opacity: edgeFade, pointerEvents: "none" }}
        />
      )}
    </AbsoluteFill>
  );
};
