import React, { useId, useMemo } from "react";
import {
  AbsoluteFill,
  Easing,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

/**
 * BackgroundTorn09 — クリーンルーム再実装
 *
 * 「破れた枠のミニマルな白黒背景」。
 * 紙のようなオフホワイトの下地に、手描きの震えを持つ黒い外枠が
 * ところどころ千切れた（ギャップのある）状態で走る。
 * 左には破れた輪郭のモノクロ・ドロップゾーン（放射グラデーションのパネル）、
 * 右上には太い＋記号、右中段には丸・四角・黒バー・下線の落書きが並ぶ
 * エディトリアルなミニマル背景。線は数フレームごとに揺れ（ボイル）、
 * 時折短いグリッチ（水平スライスのずれ）が走る。
 *
 * 導入は「枠と落書きがポップ → パネルが左から鉛筆下書きのまま滑り込み →
 * 墨入れ（黒輪郭＋グラデーション定着）→ ＋記号がポップ」の段取り。
 *
 * 機能記述「破れた枠のミニマルな白黒背景。」を出発点に、
 * 旧レンダリング（見た目のものさし）と同等以上の質感を白紙から構成したもの。
 * 文字を一切使わないためフォント依存なし（配布可能）。
 */

export interface BackgroundTorn09Props {
  /** 尺（フレーム, 24fps想定） */
  durationInFrames: number;
  /** 紙の下地色 */
  paperColor?: string;
  /** インク（線・記号）の色 */
  inkColor?: string;
  /** パネル放射グラデーションのハイライト色 */
  panelHighlight?: string;
  /** パネル放射グラデーションの中間色 */
  panelMid?: string;
  /** パネル放射グラデーションの端の色 */
  panelShadow?: string;
  /** パネル矩形（1920x1080基準のpx） */
  panelRect?: { x: number; y: number; w: number; h: number };
  /** 外枠の画面端からの内側距離(px, 1920x1080基準) */
  frameInset?: number;
  /** 外枠の線の太さ(px) */
  frameStroke?: number;
  /** 手描き線の揺れ幅(px) */
  wobble?: number;
  /** 線の揺れを引き直す間隔（フレーム）。小さいほど激しくボイルする */
  boilFrames?: number;
  /** パネルを表示するか */
  showPanel?: boolean;
  /** ＋記号を表示するか */
  showPlus?: boolean;
  /** 丸・四角・バー・下線の落書きを表示するか */
  showDoodles?: boolean;
  /** グリッチ発作の間隔（フレーム）。0以下で無効 */
  glitchInterval?: number;
  /** グリッチ発作の長さ（フレーム） */
  glitchDuration?: number;
  /** グリッチの水平ずれ量(px) */
  glitchStrength?: number;
  /** 周辺減光の強さ 0..1 */
  vignette?: number;
  /** 紙の粒状ノイズの強さ 0..1 */
  grain?: number;
  /** 終端の退場にかけるフレーム数（逆順に消えて白紙へ戻る） */
  outroFrames?: number;
  /** 乱数シード（同じ値なら同じ揺れを再現） */
  seed?: number;
}

/* ---------- 決定論的な乱数（mulberry32系, フレーム間で再現可能） ---------- */
const makeRng = (seed: number): (() => number) => {
  let s = (seed * 1_000_003 + 12_345) >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
};

/* ---------- 手描き風パスの生成 ---------- */

type Pt = readonly [number, number];

/** 2点間を小刻みに分割し、法線方向に揺らした点列を返す */
const wobblePoints = (
  a: Pt,
  b: Pt,
  amp: number,
  rng: () => number,
  step = 30
): Pt[] => {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = Math.hypot(dx, dy);
  const n = Math.max(2, Math.ceil(len / step));
  const nx = len === 0 ? 0 : -dy / len;
  const ny = len === 0 ? 0 : dx / len;
  const pts: Pt[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    // 端点はわずかに、中間は最大まで揺らす（線の端が繋がって見えるように）
    const w = amp * (0.35 + 0.65 * Math.sin(Math.PI * t));
    const off = (rng() * 2 - 1) * w;
    const along = (rng() * 2 - 1) * amp * 0.4;
    pts.push([
      a[0] + dx * t + nx * off + (dx / (len || 1)) * along,
      a[1] + dy * t + ny * off + (dy / (len || 1)) * along,
    ]);
  }
  return pts;
};

const toPath = (pts: Pt[], close = false): string =>
  `M ${pts.map((p) => `${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(" L ")}${
    close ? " Z" : ""
  }`;

/** 折れ線（複数頂点）を辺ごとに揺らした閉路/開路パスにする */
const wobblePolyPath = (
  corners: Pt[],
  amp: number,
  rng: () => number,
  close: boolean,
  step = 30
): string => {
  const pts: Pt[] = [];
  const last = close ? corners.length : corners.length - 1;
  for (let i = 0; i < last; i++) {
    const a = corners[i];
    const b = corners[(i + 1) % corners.length];
    const seg = wobblePoints(a, b, amp, rng, step);
    if (i > 0) seg.shift();
    pts.push(...seg);
  }
  return toPath(pts, close);
};

/** 揺れた円（開始角もランダム）のパス */
const wobbleCirclePath = (
  cx: number,
  cy: number,
  r: number,
  amp: number,
  rng: () => number
): string => {
  const n = 44;
  const start = rng() * Math.PI * 2;
  // 低周波のうねり（手描きの歪み）＋微細なノイズで滑らかに揺らす
  const ph1 = rng() * Math.PI * 2;
  const ph2 = rng() * Math.PI * 2;
  const a1 = amp * (0.6 + rng() * 0.5);
  const a2 = amp * (0.4 + rng() * 0.4);
  const pts: Pt[] = [];
  for (let i = 0; i <= n; i++) {
    const th = start + (i / n) * Math.PI * 2;
    const rr =
      r +
      a1 * Math.sin(th * 2 + ph1) +
      a2 * Math.sin(th * 3 + ph2) +
      (rng() * 2 - 1) * amp * 0.25;
    pts.push([cx + Math.cos(th) * rr, cy + Math.sin(th) * rr]);
  }
  return toPath(pts, true);
};

/* ---------- 本体 ---------- */

export const BackgroundTorn09: React.FC<BackgroundTorn09Props> = ({
  durationInFrames,
  paperColor = "#f1efeb",
  inkColor = "#141414",
  panelHighlight = "#d7d7d5",
  panelMid = "#9a9a98",
  panelShadow = "#5d5d5b",
  panelRect = { x: 135, y: 145, w: 830, h: 775 },
  frameInset = 48,
  frameStroke = 10,
  wobble = 4,
  boilFrames = 5,
  showPanel = true,
  showPlus = true,
  showDoodles = true,
  glitchInterval = 55,
  glitchDuration = 3,
  glitchStrength = 24,
  vignette = 0.55,
  grain = 0.05,
  outroFrames = 14,
  seed = 9,
}) => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const rawId = useId();
  const uid = useMemo(() => rawId.replace(/[^a-zA-Z0-9_-]/g, ""), [rawId]);

  // 1920x1080 の設計座標系に描き、viewBox で実解像度へ引き伸ばす
  const W = 1920;
  const H = 1080;

  /* ---- 導入の段取り（フレーム） ---- */
  const frameAt = 3; // 外枠ポップ
  const doodlesAt = 5; // 落書きポップ
  const slideStart = 9; // パネル滑り込み開始
  const slideEnd = 19; // パネル到着
  const inkStart = 18; // パネル墨入れ開始
  const inkEnd = 25; // 墨入れ完了
  const plusAt = 19; // ＋記号ポップ

  /* ---- 終端の退場（導入の逆順で白紙へ戻る） ---- */
  const outStart = durationInFrames - outroFrames;
  const plusVisible = frame >= plusAt && frame < outStart + 2;
  const doodlesVisible = frame >= doodlesAt && frame < outStart + 7;
  const frameVisible = frame >= frameAt && frame < outStart + 11;

  /* ---- ボイル（数フレームごとに線を引き直す） ---- */
  const boilStep = Math.floor(frame / Math.max(1, boilFrames));

  /* ---- パネルの滑り込み ---- */
  const slideT = interpolate(frame, [slideStart, slideEnd], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.bezier(0.16, 1, 0.3, 1),
  });
  const outSlideT = interpolate(frame, [outStart, outStart + 9], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.bezier(0.55, 0, 1, 0.45),
  });
  const panelTx =
    Math.max(1 - slideT, outSlideT) * -(panelRect.x + panelRect.w + 40);
  const inkT = interpolate(frame, [inkStart, inkEnd], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.bezier(0.33, 0, 0.67, 1),
  });

  /* ---- ＋記号のポップ（わずかなオーバーシュート） ---- */
  const plusScale = interpolate(frame, [plusAt, plusAt + 2, plusAt + 5], [0, 1.12, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  /* ---- 幾何（ボイルステップごとに引き直し） ---- */
  const geo = useMemo(() => {
    const rng = makeRng(seed * 7919 + boilStep);

    // 外枠：各辺を「千切れ」ギャップ入りのセグメントに分ける
    const inset = frameInset;
    const sides: { a: Pt; b: Pt; spans: readonly [number, number][] }[] = [
      // 上辺（右寄りにギャップ）
      {
        a: [inset, inset],
        b: [W - inset, inset],
        spans: [
          [0, 0.755],
          [0.775, 1],
        ],
      },
      // 右辺（上1/3にギャップ）
      {
        a: [W - inset, inset],
        b: [W - inset, H - inset],
        spans: [
          [0, 0.3],
          [0.345, 1],
        ],
      },
      // 下辺（左端近くと右寄りにギャップ）
      {
        a: [inset, H - inset],
        b: [W - inset, H - inset],
        spans: [
          [0, 0.05],
          [0.08, 0.795],
          [0.825, 1],
        ],
      },
      // 左辺（中央上寄りにギャップ）
      {
        a: [inset, inset],
        b: [inset, H - inset],
        spans: [
          [0, 0.355],
          [0.395, 1],
        ],
      },
    ];
    const frameSegs = sides.flatMap((side) =>
      side.spans.map((sp) => {
        const lerp = (t: number): Pt => [
          side.a[0] + (side.b[0] - side.a[0]) * t,
          side.a[1] + (side.b[1] - side.a[1]) * t,
        ];
        return {
          d: toPath(wobblePoints(lerp(sp[0]), lerp(sp[1]), wobble, rng, 34)),
          w: frameStroke * (0.85 + rng() * 0.35),
        };
      })
    );

    // パネル（破れた輪郭の矩形）
    const p = panelRect;
    const panelCorners: Pt[] = [
      [p.x, p.y],
      [p.x + p.w, p.y],
      [p.x + p.w, p.y + p.h],
      [p.x, p.y + p.h],
    ];
    const panelPath = wobblePolyPath(panelCorners, wobble * 1.4, rng, true, 40);

    // ＋記号（塗りつぶしの十字。輪郭を揺らす）
    const pc: Pt = [1688, 265];
    const L = 103; // 腕の半分
    const T = 29; // 太さの半分
    const crossCorners: Pt[] = [
      [pc[0] - T, pc[1] - L],
      [pc[0] + T, pc[1] - L],
      [pc[0] + T, pc[1] - T],
      [pc[0] + L, pc[1] - T],
      [pc[0] + L, pc[1] + T],
      [pc[0] + T, pc[1] + T],
      [pc[0] + T, pc[1] + L],
      [pc[0] - T, pc[1] + L],
      [pc[0] - T, pc[1] + T],
      [pc[0] - L, pc[1] + T],
      [pc[0] - L, pc[1] - T],
      [pc[0] - T, pc[1] - T],
    ];
    const plusPath = wobblePolyPath(crossCorners, wobble * 1.1, rng, true, 26);
    const plusCenter = pc;

    // 落書き：丸・四角・黒バー2本・下線
    const circlePath = wobbleCirclePath(1251, 561, 48, wobble * 0.8, rng);
    const squareCorners: Pt[] = [
      [1548, 628],
      [1648, 628],
      [1648, 728],
      [1548, 728],
    ];
    const squarePath = wobblePolyPath(squareCorners, wobble * 0.9, rng, true, 26);
    const barPath = (x: number, y: number, w: number, h: number): string =>
      wobblePolyPath(
        [
          [x, y],
          [x + w, y],
          [x + w, y + h],
          [x, y + h],
        ],
        wobble * 0.7,
        rng,
        true,
        22
      );
    // 長バーはボイルごとに切れ目の入り方が変わる（手描きの掠れ）
    const longBarSplit = 0.45 + rng() * 0.3;
    const longBarGap = rng() < 0.5 ? 6 + rng() * 10 : 2;
    const bars = [
      barPath(1150, 731, 215 * longBarSplit - longBarGap / 2, 24),
      barPath(
        1150 + 215 * longBarSplit + longBarGap / 2,
        731,
        215 * (1 - longBarSplit) - longBarGap / 2,
        24
      ),
      barPath(1408, 731, 62, 24),
    ];
    const underlinePath = toPath(
      wobblePoints([1150, 799], [1640, 799], wobble * 0.6, rng, 40)
    );

    return {
      frameSegs,
      panelPath,
      plusPath,
      plusCenter,
      circlePath,
      squarePath,
      bars,
      underlinePath,
    };
  }, [seed, boilStep, frameInset, frameStroke, wobble, panelRect]);

  /* ---- グリッチ（時折、水平スライスがずれる） ---- */
  const glitch = useMemo(() => {
    if (glitchInterval <= 0 || frame < inkEnd + 8) return null;
    const local = (frame - (inkEnd + 8)) % glitchInterval;
    if (local >= glitchDuration) return null;
    const rng = makeRng(seed * 104729 + frame);
    const bands = [0, 1, 2].map(() => {
      const y = rng() * H;
      const bh = 40 + rng() * 130;
      const dx = (rng() * 2 - 1) * glitchStrength;
      return { y, h: bh, dx };
    });
    return { bands, jitter: (rng() * 2 - 1) * 3 };
  }, [frame, glitchInterval, glitchDuration, glitchStrength, seed]);

  const gradId = `bgtorn09-grad-${uid}`;
  const grainId = `bgtorn09-grain-${uid}`;
  const sceneId = `bgtorn09-scene-${uid}`;

  /* ---- シーン本体（グリッチ時は <use> で複製してスライスをずらす） ---- */
  const scene = (
    <g>
      {/* 外枠 */}
      {frameVisible &&
        geo.frameSegs.map((s, i) => (
          <path
            key={`f${i}`}
            d={s.d}
            fill="none"
            stroke={inkColor}
            strokeWidth={s.w}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ))}

      {/* ドロップゾーンのパネル（滑り込み→墨入れ） */}
      {showPanel && frame >= slideStart && (
        <g transform={`translate(${panelTx.toFixed(1)} 0)`}>
          {/* 下書き（フラットな薄灰） → 定着（放射グラデーション） */}
          <path d={geo.panelPath} fill="#dcdbd7" opacity={1 - inkT} />
          <path d={geo.panelPath} fill={`url(#${gradId})`} opacity={inkT} />
          {/* 輪郭：鉛筆（薄灰）から黒インクへ */}
          <path
            d={geo.panelPath}
            fill="none"
            stroke="#b4b3af"
            strokeWidth={7}
            strokeLinejoin="round"
            opacity={1 - inkT}
          />
          <path
            d={geo.panelPath}
            fill="none"
            stroke={inkColor}
            strokeWidth={9}
            strokeLinejoin="round"
            opacity={inkT}
          />
        </g>
      )}

      {/* ＋記号 */}
      {showPlus && plusVisible && (
        <path
          d={geo.plusPath}
          fill={inkColor}
          transform={`translate(${geo.plusCenter[0]} ${geo.plusCenter[1]}) scale(${plusScale.toFixed(3)}) translate(${-geo.plusCenter[0]} ${-geo.plusCenter[1]})`}
        />
      )}

      {/* 落書き（丸・四角・バー・下線） */}
      {showDoodles && doodlesVisible && (
        <g>
          <path
            d={geo.circlePath}
            fill="none"
            stroke={inkColor}
            strokeWidth={7}
            strokeLinejoin="round"
          />
          <path
            d={geo.squarePath}
            fill="none"
            stroke={inkColor}
            strokeWidth={5.5}
            strokeLinejoin="round"
          />
          {geo.bars.map((d, i) => (
            <path key={`b${i}`} d={d} fill={inkColor} />
          ))}
          <path
            d={geo.underlinePath}
            fill="none"
            stroke={inkColor}
            strokeWidth={3.5}
            strokeLinecap="round"
          />
        </g>
      )}
    </g>
  );

  return (
    <AbsoluteFill style={{ backgroundColor: paperColor }}>
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        style={{ position: "absolute", inset: 0 }}
      >
        <defs>
          <radialGradient id={gradId} cx="0.38" cy="0.30" r="0.95">
            <stop offset="0" stopColor={panelHighlight} />
            <stop offset="0.4" stopColor={panelMid} />
            <stop offset="1" stopColor={panelShadow} />
          </radialGradient>
          <filter id={grainId} x="0" y="0" width="100%" height="100%">
            <feTurbulence
              type="fractalNoise"
              baseFrequency="0.9"
              numOctaves={2}
              seed={boilStep + seed}
              stitchTiles="stitch"
            />
            <feColorMatrix type="saturate" values="0" />
            <feComponentTransfer>
              <feFuncA type="linear" slope={grain} intercept={0} />
            </feComponentTransfer>
            <feComposite operator="over" in2="SourceGraphic" />
          </filter>
          <g id={sceneId}>{scene}</g>
          {glitch &&
            glitch.bands.map((b, i) => (
              <clipPath key={`c${i}`} id={`bgtorn09-clip-${uid}-${i}`}>
                <rect x={-80} y={b.y} width={W + 160} height={b.h} />
              </clipPath>
            ))}
        </defs>

        {glitch ? (
          <g transform={`translate(${glitch.jitter.toFixed(1)} 0)`}>
            <use href={`#${sceneId}`} />
            {glitch.bands.map((b, i) => (
              <g key={`gb${i}`} clipPath={`url(#bgtorn09-clip-${uid}-${i})`}>
                <rect x={0} y={b.y} width={W} height={b.h} fill={paperColor} />
                <use
                  href={`#${sceneId}`}
                  transform={`translate(${b.dx.toFixed(1)} 0)`}
                />
              </g>
            ))}
          </g>
        ) : (
          <use href={`#${sceneId}`} />
        )}

        {/* 紙の粒状ノイズ */}
        {grain > 0 && (
          <rect
            x={0}
            y={0}
            width={W}
            height={H}
            fill="transparent"
            filter={`url(#${grainId})`}
            opacity={0.9}
          />
        )}
      </svg>

      {/* 周辺減光（紙の丸み） */}
      {vignette > 0 && (
        <AbsoluteFill
          style={{
            background: `radial-gradient(130% 125% at 50% 44%, rgba(0,0,0,0) 55%, rgba(0,0,0,${(
              0.22 * vignette
            ).toFixed(3)}) 100%)`,
            pointerEvents: "none",
          }}
        />
      )}
    </AbsoluteFill>
  );
};
