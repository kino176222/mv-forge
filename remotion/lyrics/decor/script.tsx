import React from "react";
import { interpolate, Easing } from "remotion";
import { hashRand } from "../../effects/rand";
import { DecorBox } from "./common";
import { ElectricLineGL } from "./ElectricLineGL";
import type { DecorContext, DecorRenderer } from "./types";

/**
 * 電撃ライン: 画面幅いっぱいの光の線が「平坦な波」から「大きなループの走り書き」へ
 * うねりながら変形していく。参考動画のトレース座標（0.05秒刻み）に基づく。
 *
 * 「単なる線」にしないための筆圧レンダリング:
 * - 線を細かいサンプルに分割し、区間ごとに太さ（筆圧）と明るさを変える
 * - 明るい区間は白熱、暗い区間は紫がかって沈む。両端は細く薄く消え入る
 * - 白熱ホットスポットが線上をゆっくり流れる
 * - 線の周りに微細なキラ（瞬く光の粒）
 * - 全体を screen 合成＋ぼかしグローで発光させる（発光ストロークの定石）
 *
 * 幾何は擬似px空間（行ボックスの実寸推定）で計算するので、太さが縦横で歪まない。
 */

type Pt = [number, number];

/** 平坦な波（開始形）。x等間隔・ベースラインy≈66を軽くうねる（0-100設計空間） */
const FLAT: Pt[] = Array.from({ length: 30 }, (_, i) => [
  (i * 100) / 29,
  66 + Math.sin(i * 1.7) * 2,
]);

/**
 * wire（針金の一筆書き）の設計図。スプライン補間ではなく「折れ線＋角丸」で描く。
 * - スプラインは方向転換のたびに制御点の外へ膨らみ（オーバーシュート）、
 *   意図しないハネを生む。手で曲げた針金にはそれが無い → 折れ線が正しいモデル
 * - 座標は [x=ボックス幅に対する割合0-1, y=文字中心からのオフセット(文字サイズsz単位)]。
 *   縦の振幅が文字サイズ基準の絶対値なので、行の長さやキャンバス拡大で暴れない
 * 参考動画「愛情それとも Ah...」の画像処理トレース（scratchpad/trace_line.py で
 * 実フレームから細線を抽出→骨格化→順序付けしたトレース座標。目分量ではない）:
 * 左下のフック先端 → 左の長い縦を上る → 丸い頂点 → 中央を降下 →
 * 文字下の波 → Ahの位置で上昇 → 右下へ長い尻尾（尻尾のみ画面外へ手動延長）
 */
const WIRE_PATH: Pt[] = [
  [0.242, 1.81], [0.238, 1.98], [0.262, 2.07], [0.295, 2.04], [0.325, 1.87], [0.334, 1.69],
  [0.306, 0.28], [0.301, -0.24], [0.297, -0.92], [0.299, -1.61], [0.317, -2.09], [0.36, -2.59],
  [0.412, -2.92], [0.429, -2.7], [0.436, -1.87], [0.44, -1.15], [0.448, -0.63], [0.468, -0.14],
  [0.487, 0.18], [0.51, 0.79], [0.528, 1.35], [0.55, 1.08], [0.575, 0.82], [0.6, 0.76],
  [0.626, 0.73], [0.64, 0.5], [0.648, 0.24], [0.68, 0.36], [0.74, 0.86], [0.82, 1.51],
  [0.91, 2.16], [1.0, 2.81],
];

/** 折れ線の角を半径rの丸みに置き換えて密にサンプリング（オーバーシュートなし） */
const roundedPolyline = (pts: Pt[], r: number, step: number): Pt[] => {
  const fine: Pt[] = [];
  let cursor: Pt = pts[0];
  fine.push(cursor);
  const pushLine = (to: Pt) => {
    const d = Math.hypot(to[0] - cursor[0], to[1] - cursor[1]);
    const n = Math.max(1, Math.round(d / step));
    for (let s = 1; s <= n; s++) {
      fine.push([
        cursor[0] + ((to[0] - cursor[0]) * s) / n,
        cursor[1] + ((to[1] - cursor[1]) * s) / n,
      ]);
    }
    cursor = to;
  };
  for (let i = 1; i < pts.length - 1; i++) {
    const a = cursor;
    const p = pts[i];
    const b = pts[i + 1];
    const la = Math.hypot(p[0] - a[0], p[1] - a[1]) || 1;
    const lb = Math.hypot(b[0] - p[0], b[1] - p[1]) || 1;
    const ra = Math.min(r, la * 0.45);
    const rb = Math.min(r, lb * 0.45);
    const pa: Pt = [p[0] - ((p[0] - a[0]) / la) * ra, p[1] - ((p[1] - a[1]) / la) * ra];
    const pb: Pt = [p[0] + ((b[0] - p[0]) / lb) * rb, p[1] + ((b[1] - p[1]) / lb) * rb];
    pushLine(pa);
    // 角の丸み: 頂点pを制御点とする2次ベジェ（制御点の内側しか通らない＝膨らまない）
    const arcN = Math.max(3, Math.round((ra + rb) / step) * 2);
    for (let s = 1; s <= arcN; s++) {
      const u = s / arcN;
      const v = 1 - u;
      fine.push([
        v * v * pa[0] + 2 * v * u * p[0] + u * u * pb[0],
        v * v * pa[1] + 2 * v * u * p[1] + u * u * pb[1],
      ]);
    }
    cursor = pb;
  }
  pushLine(pts[pts.length - 1]);
  return fine;
};

/** 弧長で等間隔に再サンプリング（太さ・明るさプロファイルのu座標を距離基準にする） */
const resampleByLength = (pts: Pt[], count: number): Pt[] => {
  const cum: number[] = [0];
  for (let i = 1; i < pts.length; i++) {
    cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  }
  const total = cum[cum.length - 1] || 1;
  const out: Pt[] = [];
  let k = 0;
  for (let j = 0; j < count; j++) {
    const target = (j / (count - 1)) * total;
    while (k < cum.length - 2 && cum[k + 1] < target) k++;
    const seg = cum[k + 1] - cum[k] || 1;
    const f = (target - cum[k]) / seg;
    out.push([
      pts[k][0] + (pts[k + 1][0] - pts[k][0]) * f,
      pts[k][1] + (pts[k + 1][1] - pts[k][1]) * f,
    ]);
  }
  return out;
};

/** 最終形（0-100設計空間・文字帯はy≈58-66を通る前提） */
const TARGETS: Record<string, Pt[]> = {
  // ふたつの大きなループ＋右下へ抜ける（参考動画の形）
  storm: [
    [0, 70], [6, 68], [12, 66], [18, 64], [24, 60], [27, 48], [26, 30], [30, 16],
    [38, 12], [44, 20], [43, 34], [37, 46], [31, 56], [33, 64], [41, 66], [50, 62],
    [57, 56], [60, 42], [62, 26], [68, 16], [75, 18], [78, 30], [75, 44], [68, 56],
    [64, 66], [70, 72], [80, 72], [88, 68], [94, 64], [100, 62],
  ],
  // 中央右に大きなひとつのループ
  loop: [
    [0, 64], [8, 62], [16, 60], [24, 58], [32, 56], [40, 54], [46, 50], [50, 44],
    [52, 32], [54, 20], [60, 12], [68, 10], [74, 16], [76, 28], [72, 40], [64, 50],
    [56, 56], [50, 60], [48, 66], [54, 70], [62, 70], [70, 66], [76, 60], [80, 52],
    [84, 46], [88, 44], [92, 46], [95, 52], [98, 58], [100, 62],
  ],
  // 折れ角多め・ギザギザ寄り
  jagged: [
    [0, 68], [8, 66], [14, 60], [18, 48], [20, 32], [24, 20], [30, 14], [36, 18],
    [38, 30], [36, 44], [32, 56], [30, 66], [36, 70], [44, 68], [52, 62], [58, 52],
    [62, 38], [66, 26], [72, 20], [78, 24], [80, 36], [76, 48], [70, 58], [66, 66],
    [70, 72], [78, 74], [86, 70], [92, 64], [96, 60], [100, 58],
  ],
};

/** Catmull-Rom を各セグメントsubdiv分割でサンプリング（tension小=角張る） */
const sampleCurve = (pts: Pt[], tension: number, subdiv: number): Pt[] => {
  const out: Pt[] = [pts[0]];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[Math.min(pts.length - 1, i + 2)];
    const c1: Pt = [
      p1[0] + ((p2[0] - p0[0]) / 6) * tension,
      p1[1] + ((p2[1] - p0[1]) / 6) * tension,
    ];
    const c2: Pt = [
      p2[0] - ((p3[0] - p1[0]) / 6) * tension,
      p2[1] - ((p3[1] - p1[1]) / 6) * tension,
    ];
    for (let s = 1; s <= subdiv; s++) {
      const u = s / subdiv;
      const v = 1 - u;
      out.push([
        v * v * v * p1[0] + 3 * v * v * u * c1[0] + 3 * v * u * u * c2[0] + u * u * u * p2[0],
        v * v * v * p1[1] + 3 * v * v * u * c1[1] + 3 * v * u * u * c2[1] + u * u * u * p2[1],
      ]);
    }
  }
  return out;
};

/** 明るさ→色（暗=紫がかり / 中=象牙 / 明=白熱）。RGB線形補間 */
const VIOLET = [178, 158, 222];
const IVORY = [244, 238, 214];
const WHITE = [255, 255, 255];
const mix = (a: number[], b: number[], k: number) =>
  a.map((v, i) => Math.round(v + (b[i] - v) * k));
const colorFor = (b: number, alpha: number): string => {
  const rgb =
    b < 0.55 ? mix(VIOLET, IVORY, b / 0.55) : mix(IVORY, WHITE, (b - 0.55) / 0.45);
  return `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${alpha.toFixed(3)})`;
};

/** hsl(0-360, 0-1, 0-1) → rgb 各0-1（GPUハロー色用） */
const hslToRgb = (h: number, s: number, l: number): [number, number, number] => {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = (((h % 360) + 360) % 360) / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r = 0;
  let g = 0;
  let b = 0;
  if (hp < 1) [r, g, b] = [c, x, 0];
  else if (hp < 2) [r, g, b] = [x, c, 0];
  else if (hp < 3) [r, g, b] = [0, c, x];
  else if (hp < 4) [r, g, b] = [0, x, c];
  else if (hp < 5) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const m = l - c / 2;
  return [r + m, g + m, b + m];
};

export const decorNeonScript: DecorRenderer = {
  layer: (ctx: DecorContext) => {
    const shape = String(ctx.params.shape ?? "storm");
    const colorMode = String(ctx.params.color ?? "white");
    const hue = Number(ctx.params.hue ?? 45);
    const morphTime = Number(ctx.params.drawTime ?? 1.2);
    const thickness = Number(ctx.params.thickness ?? 2.5);
    const glow = Number(ctx.params.glow ?? 0.8);
    const wobble = Number(ctx.params.wobble ?? 0);
    const delay = Number(ctx.params.delay ?? 0.2);
    const engine = String(ctx.params.engine ?? "gpu");

    const sz = ctx.textStyle.size;
    const t = ctx.frame / ctx.fps;
    const wireish = shape.startsWith("wire");

    // ---- 行ボックスの実寸推定（擬似px空間。太さの縦横歪みを防ぐ） ----
    // wire系は「文字の2〜3倍の高さで画面を泳ぐ」参考動画のスケール感が本質なので、
    // キャンバスを大きく取り文字の周りに余白を作る。他形状は従来の箱
    const textW =
      [...ctx.text].reduce((a, ch) => a + (/[ -~]/.test(ch) ? 0.55 : 1.12), 0) * sz;
    const padX = (wireish ? 4.8 : 2.8) * sz;
    const padTop = (wireish ? 8 : 4.5) * sz;
    const padBot = (wireish ? 4.5 : 2.5) * sz;
    const spanH = padTop + padBot + 1.5 * sz;
    const boxW = ctx.vertical ? spanH : textW + padX * 2;
    const boxH = ctx.vertical ? textW + padX * 2 : spanH;

    // ---- モーフ進行（波→ループ）と出現 ----
    const delayF = Math.round(delay * ctx.fps);
    const morphF = Math.max(3, Math.round(morphTime * ctx.fps));
    const m = interpolate(ctx.frame, [delayF, delayF + morphF], [0, 1], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
      easing: Easing.bezier(0.4, 0.1, 0.3, 1),
    });
    const appear = interpolate(
      ctx.frame,
      [delayF, delayF + Math.round(0.35 * ctx.fps)],
      [0, 1],
      {
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
        easing: Easing.out(Easing.cubic),
      },
    );
    if (appear <= 0) return null;

    // ---- 幾何の生成 ----
    const und = wobble * (m < 1 ? 2.4 - m : 1.1);
    const q = Math.floor(ctx.frame / 3); // 3フレーム毎に引き直すボイル
    let ctrl: Pt[];
    let P: Pt[];
    if (wireish) {
      // 手曲げ針金: 折れ線＋角丸（スプラインのオーバーシュート＝勝手なハネが出ない）。
      // 縦の振幅は文字サイズ基準の絶対値（WIRE_PATHのdyはsz単位）
      const LW = ctx.vertical ? boxH : boxW;
      const textCY = padTop + 0.75 * sz;
      const raw: Pt[] = WIRE_PATH.map(([ux, dy], i) => {
        const wobY = Math.sin(t * 2.2 + i * 0.55) * und * 0.14 * sz;
        const wobX = Math.cos(t * 1.7 + i * 0.9) * und * 0.07 * sz;
        // ボイル（毎3フレームの震え）はうねりつまみでゲート。wobble=0なら形は完全静止
        const boilY = (hashRand(i * 7 + q * 31, 13) - 0.5) * 0.18 * sz * wobble;
        const boilX = (hashRand(i * 11 + q * 29, 17) - 0.5) * 0.12 * sz * wobble;
        // 手描きの不揃い（フレームに依存しない静的ジッター）
        const jx = (hashRand(i * 5, 23) - 0.5) * 0.14 * sz;
        const jy = (hashRand(i * 3, 29) - 0.5) * 0.14 * sz;
        const flatY = textCY + (1.25 + 0.15 * Math.sin(i * 1.7)) * sz; // 出発形: 文字下の平坦な波
        const y = flatY + (textCY + dy * sz - flatY) * m + (jy + wobY + boilY) * m;
        const x = ux * LW + (jx + wobX + boilX) * m;
        // 縦書きは x/y を入れ替えて縦に走らせる
        return (ctx.vertical ? [y, x] : [x, y]) as Pt;
      });
      ctrl = raw; // グリント（曲がり角検出）は折れ線の頂点で判定
      P = resampleByLength(roundedPolyline(raw, 0.55 * sz, 0.3 * sz), 180);
    } else {
      const target = TARGETS[shape] ?? TARGETS.storm;
      ctrl = FLAT.map((a, i) => {
        const b = target[i];
        const wobY = Math.sin(t * 2.2 + i * 0.55) * und;
        const wobX = Math.cos(t * 1.7 + i * 0.9) * und * 0.5;
        const boilY = (hashRand(i * 7 + q * 31, 13) - 0.5) * 1.3 * wobble;
        const boilX = (hashRand(i * 11 + q * 29, 17) - 0.5) * 0.9 * wobble;
        const x100 = a[0] + (b[0] - a[0]) * m + wobX + boilX;
        const y100 = a[1] + (b[1] - a[1]) * m + wobY + boilY;
        return ctx.vertical
          ? [(y100 / 100) * boxW, (x100 / 100) * boxH]
          : [(x100 / 100) * boxW, (y100 / 100) * boxH];
      });
      P = sampleCurve(ctrl, shape === "jagged" ? 0.45 : 1, 6);
    }
    const N = P.length;
    const scale = sz / 64; // 文字サイズ基準のスケール
    // wire は針金質感: 細めの基準幅で太さ変化も控えめ
    const baseW = thickness * (wireish ? 1.0 : 1.5) * scale;

    // ホットスポット（線上をゆっくり流れる白熱）
    const hotC = [0.25 + 0.18 * Math.sin(t * 0.45), 0.68 + 0.15 * Math.sin(t * 0.32 + 2)];
    const prof = Array.from({ length: N }, (_, j) => {
      const u = j / (N - 1);
      // 両端は消え入る（wire は尻尾を長く引いて消す。参考動画準拠）
      const tp = 0.1;
      const tailTp = wireish ? 0.3 : 0.1;
      const taper =
        u < tp
          ? Math.pow(u / tp, 0.8)
          : u > 1 - tailTp
            ? Math.pow((1 - u) / tailTp, 0.8)
            : 1;
      let press: number;
      let b: number;
      if (wireish) {
        // 太さと明るさは位置依存の山（箱=髪の毛の細線 / 中央の波=太い白熱 / 尻尾=消え入る）
        // 線はほぼ均一に細く保つ（白熱は太さではなくグローで表現。参考動画準拠）
        const env = Math.exp(-(((u - 0.55) / 0.2) ** 2));
        press = 0.7 + 0.45 * env;
        b = taper * (0.5 + 0.45 * env);
        for (const c of hotC) {
          const d = (u - c) / 0.06;
          b += 0.22 * Math.exp(-d * d) * taper;
        }
      } else {
        // 筆圧（太さのゆらぎ）
        const wn =
          0.5 + 0.35 * Math.sin(u * 11 + t * 1.1 + 1.7) + 0.15 * Math.sin(u * 23 - t * 0.7);
        press = 0.45 + 0.75 * Math.max(0.12, wn);
        b =
          taper *
          (0.48 + 0.3 * Math.sin(u * 7.3 - t * 0.8 + 0.9) + 0.18 * Math.sin(u * 17 + t * 0.5));
        for (const c of hotC) {
          const d = (u - c) / 0.06;
          b += 0.6 * Math.exp(-d * d) * taper;
        }
      }
      const w = Math.max(0.12, baseW * taper * press);
      b = Math.min(1, Math.max(0.05, b));
      return { w, b };
    });

    // 法線
    const normal = (j: number): Pt => {
      const a = P[Math.max(0, j - 1)];
      const b = P[Math.min(N - 1, j + 1)];
      const dx = b[0] - a[0];
      const dy = b[1] - a[1];
      const l = Math.hypot(dx, dy) || 1;
      return [-dy / l, dx / l];
    };

    // ---- チャンク（制御セグメント単位）ごとのリボンを生成 ----
    const chunkRibbon = (j0: number, j1: number, widthMul: number): string => {
      const top: string[] = [];
      const bot: string[] = [];
      for (let j = j0; j <= j1; j++) {
        const [nx, ny] = normal(j);
        const hw = (prof[j].w * widthMul) / 2;
        top.push(`${(P[j][0] + nx * hw).toFixed(2)},${(P[j][1] + ny * hw).toFixed(2)}`);
        bot.push(`${(P[j][0] - nx * hw).toFixed(2)},${(P[j][1] - ny * hw).toFixed(2)}`);
      }
      return `M${top.join(" L")} L${bot.reverse().join(" L")} Z`;
    };
    const CHUNK = 6; // 太さ・明るさを変える区間の粒度
    const chunks: { d: string; dGlow: string; b: number }[] = [];
    for (let j0 = 0; j0 < N - 1; j0 += CHUNK) {
      const j1 = Math.min(N - 1, j0 + CHUNK);
      const bMid = prof[Math.floor((j0 + j1) / 2)].b;
      chunks.push({
        d: chunkRibbon(j0, j1, 1),
        dGlow: chunkRibbon(j0, j1, 3.4),
        b: bMid,
      });
    }

    // ---- グリント: 曲がり角に乗る輝点（曲がりが鋭いほど明るい） ----
    const glints: { x: number; y: number; s: number }[] = [];
    for (let i = 1; i < ctrl.length - 1; i++) {
      const v1x = ctrl[i][0] - ctrl[i - 1][0];
      const v1y = ctrl[i][1] - ctrl[i - 1][1];
      const v2x = ctrl[i + 1][0] - ctrl[i][0];
      const v2y = ctrl[i + 1][1] - ctrl[i][1];
      const dot =
        (v1x * v2x + v1y * v2y) /
        ((Math.hypot(v1x, v1y) || 1) * (Math.hypot(v2x, v2y) || 1));
      // 50度以上の折れで点灯（モーフ前の平坦な波では自然に消えている）
      if (dot < 0.64) {
        glints.push({
          x: ctrl[i][0],
          y: ctrl[i][1],
          s: Math.min(1, (0.64 - dot) * 1.6),
        });
      }
    }

    // ---- キラ（線の周りで瞬く微細な光の粒） ----
    const sparkles = Array.from({ length: 10 }, (_, k) => {
      const j = Math.floor(hashRand(k, 91) * (N - 1));
      const [nx, ny] = normal(j);
      const off = (hashRand(k, 93) - 0.5) * 36 * scale;
      const tw = 0.5 + 0.5 * Math.sin(t * 9 + hashRand(k, 97) * Math.PI * 2);
      return {
        x: P[j][0] + nx * off,
        y: P[j][1] + ny * off,
        r: (0.8 + hashRand(k, 99) * 1.3) * scale,
        o: tw * (0.25 + 0.75 * hashRand(k, 101)),
      };
    });

    // カラーモード: color 指定時は色相を全体に薄く乗せる
    const tint =
      colorMode === "color" ? `hsla(${hue}, 90%, 65%, 0.35)` : null;

    // 完成後はゆるく明滅（ネオンの呼吸）
    const pulse = m >= 1 ? 0.86 + 0.14 * (0.5 + 0.5 * Math.sin(t * 2.6)) : 1;

    const boxStyle: React.CSSProperties = ctx.vertical
      ? { position: "absolute", top: -padX, bottom: -padX, left: -padTop, right: -padBot }
      : { position: "absolute", left: -padX, right: -padX, top: -padTop, bottom: -padBot };

    // 光のこぼれ: 線の背後の「壁」にうっすら光が落ちる（単一平面の回避。ごく薄く）
    const spillA = 0.1 * (0.5 + glow * 0.5) * appear * pulse;
    const spill = (
      <span
        aria-hidden
        style={{
          ...boxStyle,
          background: `radial-gradient(ellipse 55% 45% at 50% 55%, ${
            colorMode === "color"
              ? `hsla(${hue}, 85%, 62%, ${spillA.toFixed(3)})`
              : `rgba(240,226,196,${spillA.toFixed(3)})`
          }, transparent 70%)`,
          filter: "blur(20px)",
        }}
      />
    );

    // 旧SVGレンダラ。engine="svg" 指定時の本体＋GPU不可時の自動フォールバックに使う。
    const svgNode = (
          <svg
            width="100%"
            height="100%"
            style={{ display: "block", overflow: "visible" }}
            viewBox={`0 0 ${boxW.toFixed(0)} ${boxH.toFixed(0)}`}
            preserveAspectRatio="none"
          >
            <defs>
              <filter id="nsGlow" x="-60%" y="-60%" width="220%" height="220%">
                <feGaussianBlur stdDeviation={4.5 * scale * (0.5 + glow)} />
              </filter>
            </defs>
            {/* 暗い縁取り（明るい背景の上でも線が読めるコントラスト。参考動画準拠） */}
            <g filter="url(#nsGlow)">
              {chunks.map((c, i) => (
                <path
                  key={`u${i}`}
                  d={c.dGlow}
                  fill={`rgba(18,14,30,${(0.3 * c.b + 0.12).toFixed(3)})`}
                />
              ))}
            </g>
            {/* 外周グロー（ぼかした色付きリボン） */}
            <g filter="url(#nsGlow)">
              {chunks.map((c, i) => (
                <path
                  key={`g${i}`}
                  d={c.dGlow}
                  fill={colorFor(c.b, (0.14 + 0.4 * c.b) * glow)}
                />
              ))}
            </g>
            {/* 芯（筆圧リボン。明るさで白熱↔紫沈み） */}
            {chunks.map((c, i) => (
              <path key={`c${i}`} d={c.d} fill={colorFor(c.b, 0.5 + 0.5 * c.b)} />
            ))}
            {/* 白熱ハイライト（明るい区間だけ浮かぶ細芯） */}
            {chunks.map((c, i) =>
              c.b > 0.55 ? (
                <path
                  key={`h${i}`}
                  d={chunkRibbon(
                    Math.min(N - 1, i * CHUNK),
                    Math.min(N - 1, i * CHUNK + CHUNK),
                    0.4,
                  )}
                  fill={`rgba(255,255,255,${(((c.b - 0.55) / 0.45) ** 1.5).toFixed(3)})`}
                />
              ) : null,
            )}
            {/* 色相ティント（カラー指定時のみ全体に薄く） */}
            {tint &&
              chunks.map((c, i) => (
                <path key={`t${i}`} d={c.dGlow} fill={tint} opacity={0.5} />
              ))}
            {/* グリント（曲がり角の輝点: 芯＋十字の光条） */}
            {glints.map((gl, k) => {
              const tw = 0.75 + 0.25 * Math.sin(t * 6.5 + k * 2.1);
              const o = gl.s * tw * appear;
              const ray = (5 + 5 * gl.s) * scale;
              return (
                <g key={`gl${k}`} opacity={o.toFixed(3)}>
                  <circle cx={gl.x} cy={gl.y} r={(1.7 * scale).toFixed(2)} fill="#fff" />
                  <path
                    d={`M${(gl.x - ray).toFixed(1)},${gl.y.toFixed(1)} L${(gl.x + ray).toFixed(1)},${gl.y.toFixed(1)} M${gl.x.toFixed(1)},${(gl.y - ray).toFixed(1)} L${gl.x.toFixed(1)},${(gl.y + ray).toFixed(1)}`}
                    stroke="rgba(255,252,240,0.75)"
                    strokeWidth={(0.7 * scale).toFixed(2)}
                    strokeLinecap="round"
                  />
                </g>
              );
            })}
            {/* キラ */}
            {sparkles.map((s, k) => (
              <circle
                key={`s${k}`}
                cx={s.x.toFixed(1)}
                cy={s.y.toFixed(1)}
                r={s.r.toFixed(2)}
                fill={`rgba(255,252,240,${(s.o * appear).toFixed(3)})`}
              />
            ))}
          </svg>
    );

    if (engine === "svg") {
      return (
        <DecorBox ctx={ctx} opacity={appear * pulse}>
          {spill}
          <span aria-hidden style={boxStyle}>
            {svgNode}
          </span>
        </DecorBox>
      );
    }

    // ---- GPU発光レンダラ（既定）: 距離フィールド＋加算グロー＋フリッカーで「本物の光」 ----
    // 形(P)と明るさ(prof.b)は上のトレース由来のロジックをそのまま使う。
    // WebGLが使えない環境（headlessのSwiftShader等）では svgNode に自動フォールバック。
    const brightArr = prof.map((p) => p.b);
    const glowWidth = (thickness * 2.4 + glow * 22) * scale;
    const brightness = 0.85 + glow * 0.7;
    const flick = Math.min(1, 0.5 + wobble * 0.5);
    const rgb: [number, number, number] =
      colorMode === "color" ? hslToRgb(hue, 0.9, 0.65) : [1.0, 0.9, 0.66];
    return (
      <DecorBox ctx={ctx} opacity={appear * pulse}>
        {spill}
        <span aria-hidden style={boxStyle}>
          <ElectricLineGL
            points={P as [number, number][]}
            bright={brightArr}
            bufW={boxW}
            bufH={boxH}
            glowWidth={glowWidth}
            color={rgb}
            brightness={brightness}
            flicker={flick}
            fallback={svgNode}
          />
        </span>
      </DecorBox>
    );
  },
};
