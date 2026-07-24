import React, { useMemo } from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";

/**
 * MvOverlayDoodleFrame — 実写(children)の上に「白マーカーの落書き枠」を重ねる
 * オーバーレイ。クリーンルーム実装（技法メモとポスターの雰囲気のみを根拠に白紙から作成）。
 *
 * 構成:
 *  - 下層: children を全面表示（無加工）
 *  - 上層: フルスクリーンSVG（1920x1080 基準座標系・解像度非依存・overflow可視）
 *      中央の手描き角丸フレーム 1本 ＋ アクセント房 5組（弧2本ペア）
 *
 * 時間: 頭で描き込み（フレーム→房をスタッガー）、末尾で同じ順に描き消し。
 * インは頭からの経過秒、アウトは末尾までの残り秒で計算し min を取るので尺可変。
 * 手描き感: 端点・制御点のseed付き揺らぎ（形は時間非依存で固定）＋
 * バリューノイズ2オクターブの「ふわふわ」カメラ級手ブレ＋房ごとの独立微ブレ。
 * 完全決定論（Math.random不使用）。
 */
export interface MvOverlayDoodleFrameProps {
  children: React.ReactNode; // 下の絵。全面に描画して上に質感を重ねる
  durationInFrames: number;
  intensity?: number; // 0..100
  variant?: number; // 0..1 同家族内の見た目分岐（決定論的に）
  tint?: string; // 任意: 基調色の差し替え（空/未指定=デザイン既定）
}

// ---- 基準座標系 ----
const VW = 1920;
const VH = 1080;
const CX = VW / 2;
const CY = VH / 2;

// ---- 決定的ハッシュ乱数（フレーム非依存・引数=座標とseed） ----
const hash01 = (n: number): number => {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453123;
  return s - Math.floor(s); // 0..1
};
const hash2 = (i: number, seed: number): number =>
  hash01(i * 157.31 + seed * 913.73);

// 符号付き揺らぎ（±amp）
const jit = (seed: number, amp: number): number =>
  (hash01(seed) * 2 - 1) * amp;

// ---- バリューノイズ（整数格子ハッシュをスムーズステップ補間）2オクターブ ----
const valueNoise = (t: number, seed: number): number => {
  const i = Math.floor(t);
  const f = t - i;
  const u = f * f * (3 - 2 * f);
  const a = hash2(i, seed);
  const b = hash2(i + 1, seed);
  return (a + (b - a) * u) * 2 - 1; // -1..1
};
const drift = (t: number, seed: number): number =>
  (valueNoise(t, seed) + 0.5 * valueNoise(t * 2, seed + 7.77)) / 1.5; // ±1に正規化

const clamp = (n: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, n));

// 描き込み/消しランプ用イージング（等速でなく僅かに緩急をつける）
const ease01 = (u: number): number => {
  const c = clamp(u, 0, 1);
  return c * c * (3 - 2 * c);
};

// ---- パス生成 ----

// 短い弧: 始点・終点・反り量 → 2次ベジェ1本。端点と制御点にseed揺らぎ±数px
const arcPath = (
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  bow: number,
  seed: number,
): string => {
  const a = 4; // 揺らぎ振幅
  const px1 = x1 + jit(seed + 1.1, a);
  const py1 = y1 + jit(seed + 2.2, a);
  const px2 = x2 + jit(seed + 3.3, a);
  const py2 = y2 + jit(seed + 4.4, a);
  const mx = (px1 + px2) / 2;
  const my = (py1 + py2) / 2;
  const dx = px2 - px1;
  const dy = py2 - py1;
  const len = Math.hypot(dx, dy) || 1;
  // 線分の法線方向へ反り量ぶん膨らませる
  const cx = mx + (-dy / len) * bow + jit(seed + 5.5, a);
  const cy = my + (dx / len) * bow + jit(seed + 6.6, a);
  const f = (n: number) => n.toFixed(1);
  return `M ${f(px1)} ${f(py1)} Q ${f(cx)} ${f(cy)} ${f(px2)} ${f(py2)}`;
};

// 角丸長方形を「直線4本＋角の2次ベジェ4個」で手組みし、全頂点・制御点を揺らす
const doodleRoundRect = (
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  r: number,
  seed: number,
): string => {
  const a = 3.5;
  const p = (x: number, y: number, s: number) => ({
    x: x + jit(seed + s, a),
    y: y + jit(seed + s + 0.53, a),
  });
  const a1 = p(x0 + r, y0, 1); // 上辺 左端（始点）
  const a2 = p(x1 - r, y0, 2); // 上辺 右端
  const c1 = p(x1, y0, 3); // 右上角 制御
  const a3 = p(x1, y0 + r, 4);
  const a4 = p(x1, y1 - r, 5);
  const c2 = p(x1, y1, 6); // 右下角 制御
  const a5 = p(x1 - r, y1, 7);
  const a6 = p(x0 + r, y1, 8);
  const c3 = p(x0, y1, 9); // 左下角 制御
  const a7 = p(x0, y1 - r, 10);
  const a8 = p(x0, y0 + r, 11);
  const c4 = p(x0, y0, 12); // 左上角 制御
  const f = (n: number) => n.toFixed(1);
  return (
    `M ${f(a1.x)} ${f(a1.y)}` +
    ` L ${f(a2.x)} ${f(a2.y)}` +
    ` Q ${f(c1.x)} ${f(c1.y)} ${f(a3.x)} ${f(a3.y)}` +
    ` L ${f(a4.x)} ${f(a4.y)}` +
    ` Q ${f(c2.x)} ${f(c2.y)} ${f(a5.x)} ${f(a5.y)}` +
    ` L ${f(a6.x)} ${f(a6.y)}` +
    ` Q ${f(c3.x)} ${f(c3.y)} ${f(a7.x)} ${f(a7.y)}` +
    ` L ${f(a8.x)} ${f(a8.y)}` +
    ` Q ${f(c4.x)} ${f(c4.y)} ${f(a1.x)} ${f(a1.y)}`
  );
};

// アクセント房の素性: 弧2本のペア × 5組（左上・右上・右下・左下・下中央）
type StrokeSpec = {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  bow: number;
};
type TuftSpec = { strokes: [StrokeSpec, StrokeSpec] };

export const MvOverlayDoodleFrame: React.FC<MvOverlayDoodleFrameProps> = ({
  children,
  durationInFrames,
  intensity = 60,
  variant = 0,
  tint,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const color = tint && tint.length > 0 ? tint : "#ffffff";
  // にじみ（マーカーのインクの柔らかさ程度。発光はさせない）
  const soft = /^#[0-9a-fA-F]{6}$/.test(color) ? `${color}40` : color;

  // intensity 0..100 → 0..1.5（60が既定=1.0）
  const k = clamp(intensity / 60, 0, 1.5);
  const seedBase = 17.3 + clamp(variant, 0, 1) * 89.7;

  // ---- 形状（seed固定・時間非依存。毎フレーム再抽選しない） ----
  const geo = useMemo(() => {
    // 中央やや広めの角丸フレーム（横55%・縦56%、角丸は画面高の6%弱）
    const fw = VW * 0.55;
    const fh = VH * 0.56;
    const x0 = CX - fw / 2;
    const y0 = CY - fh / 2;
    const x1 = CX + fw / 2;
    const y1 = CY + fh / 2;
    const r = VH * 0.057;

    const framePath = doodleRoundRect(x0, y0, x1, y1, r, seedBase);

    // 房: 上下はほぼ水平の弧、左右は短い縦線気味の弧（集中線・効果線のノリ）
    const tuftSpecs: TuftSpec[] = [
      {
        // 左上（水平ペア・フレーム上辺の外）
        strokes: [
          { x1: x0 - 45, y1: y0 - 130, x2: x0 + 290, y2: y0 - 145, bow: 20 },
          { x1: x0 - 25, y1: y0 - 88, x2: x0 + 230, y2: y0 - 100, bow: 15 },
        ],
      },
      {
        // 右上（短い縦線気味の斜めペア・角の外）
        strokes: [
          { x1: x1 + 120, y1: y0 - 40, x2: x1 + 170, y2: y0 + 62, bow: 11 },
          { x1: x1 + 178, y1: y0 - 52, x2: x1 + 226, y2: y0 + 48, bow: 11 },
        ],
      },
      {
        // 右下（縦の弧ペア・右辺の外の低め）
        strokes: [
          { x1: x1 + 132, y1: y1 - 250, x2: x1 + 162, y2: y1 - 78, bow: 16 },
          { x1: x1 + 192, y1: y1 - 228, x2: x1 + 218, y2: y1 - 62, bow: 14 },
        ],
      },
      {
        // 左下（短い縦線気味の斜めペア・角の外）
        strokes: [
          { x1: x0 - 108, y1: y1 - 125, x2: x0 - 40, y2: y1 + 40, bow: -16 },
          { x1: x0 - 48, y1: y1 - 100, x2: x0 + 16, y2: y1 + 55, bow: -13 },
        ],
      },
      {
        // 下中央（水平ペア・下辺の外）
        strokes: [
          { x1: CX - 85, y1: y1 + 112, x2: CX + 225, y2: y1 + 124, bow: -15 },
          { x1: CX - 62, y1: y1 + 162, x2: CX + 172, y2: y1 + 172, bow: -12 },
        ],
      },
    ];

    const tufts = tuftSpecs.map((tuft, ti) => ({
      paths: tuft.strokes.map((s, si) =>
        arcPath(
          s.x1,
          s.y1,
          s.x2,
          s.y2,
          s.bow,
          // seedはストロークごとに変える（同房内でも1本ずつずらす）
          seedBase + 31.7 * (ti + 1) + 11.3 * si,
        ),
      ),
    }));

    return { framePath, tufts };
  }, [seedBase]);

  // ---- 時間エンベロープ（イン=頭からの経過秒 / アウト=末尾までの残り秒、minを取る） ----
  const dur = Math.max(1, durationInFrames);
  const totalSec = dur / fps;
  const t = frame / fps;
  const DRAW = 1.5; // 1ストロークの描画/消去所要
  const OUT_LEAD = 2.6; // 末尾から消し始めるまでの逆算秒

  // offset: フレーム=0、房は0.3〜0.9秒で順に。房内2本目は+0.08秒
  const offsetOf = (tuftIndex: number, sub: number): number =>
    tuftIndex < 0 ? 0 : 0.3 + tuftIndex * 0.15 + sub * 0.08;

  const visibilityOf = (offset: number): number => {
    const vIn = ease01((t - offset) / DRAW);
    // 消える順序は描いた順序と同じ（フレームが先、房が後追い）
    const eraseEnd = totalSec - OUT_LEAD + offset + DRAW;
    const vOut = ease01((eraseEnd - t) / DRAW);
    return Math.max(0, Math.min(vIn, vOut));
  };

  // ---- 手ブレ（バリューノイズ・24fps刻み相当のティック・X/Y/回転は別seed） ----
  const tick = Math.floor(t * 24) / 24;
  const nt = tick * 1.5;
  const shakeX = drift(nt, seedBase + 3.1) * VW * 0.017 * k;
  const shakeY = drift(nt + 43.7, seedBase + 11.9) * VW * 0.02 * k; // 縦は僅かに大きめ
  const shakeR = drift(nt * 0.9 + 91.3, seedBase + 19.7) * 1.15 * k; // ±1度強

  const frameVis = visibilityOf(0);

  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      <AbsoluteFill>{children}</AbsoluteFill>
      <AbsoluteFill style={{ pointerEvents: "none" }}>
        <svg
          viewBox={`0 0 ${VW} ${VH}`}
          preserveAspectRatio="xMidYMid slice"
          style={{
            width: "100%",
            height: "100%",
            display: "block",
            overflow: "visible",
          }}
        >
          <g
            transform={`translate(${shakeX.toFixed(2)} ${shakeY.toFixed(2)}) rotate(${shakeR.toFixed(3)} ${CX} ${CY})`}
            style={{ filter: `drop-shadow(0 0 2px ${soft})` }}
          >
            {/* 中央フレーム（t=0から最初に描かれる。やや太め） */}
            <path
              d={geo.framePath}
              pathLength={1}
              fill="none"
              stroke={color}
              strokeWidth={7}
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeDasharray="1 1"
              strokeDashoffset={1 - frameVis}
              opacity={frameVis > 0.001 ? 1 : 0}
            />
            {/* アクセント房 5組（房ごとに独立微ブレ＝別々に貼られたステッカー質感） */}
            {geo.tufts.map((tuft, ti) => {
              const jx =
                drift(nt * 1.3 + ti * 7.7, seedBase + 51.3 + ti * 13.1) * 6 * k;
              const jy =
                drift(nt * 1.3 + ti * 5.1, seedBase + 67.9 + ti * 17.3) * 6 * k;
              return (
                <g
                  key={ti}
                  transform={`translate(${jx.toFixed(2)} ${jy.toFixed(2)})`}
                >
                  {tuft.paths.map((d, si) => {
                    const vis = visibilityOf(offsetOf(ti, si));
                    return (
                      <path
                        key={si}
                        d={d}
                        pathLength={1}
                        fill="none"
                        stroke={color}
                        strokeWidth={6.3}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeDasharray="1 1"
                        strokeDashoffset={1 - vis}
                        opacity={vis > 0.001 ? 1 : 0}
                      />
                    );
                  })}
                </g>
              );
            })}
          </g>
        </svg>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
