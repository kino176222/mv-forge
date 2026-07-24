import React, { useId, useMemo } from "react";
import {
  AbsoluteFill,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

/**
 * MvTransitionSmear — 水平スメア系カットトランジション（クリーンルーム実装）
 *
 * 機能: 旧カット→新カットの切り替えを「横方向の激しいブラー・残像・発光」で
 *       塗り潰しながら行う MV 用トランジション家族。variant で 6 つの個体に分岐する。
 *
 * 三幕構成（p = frame / (duration-1)）:
 * - 前半: 旧カットが崩れ始める（ブラー・揺れ・歪みが山型に立ち上がる）
 * - 頂点(中央): 破壊量が最大。最も汚れた瞬間の下で from→to を狭帯域クロスフェード
 *   （強化版はほぼハードカット）。ブラーとフラッシュで切れ目を隠すのが核心
 * - 後半: 新カットが同じ破壊を逆再生で解き、終端で素の映像に収束する
 *
 * variant → 個体の対応（0..1 を 6 等分。帯内の端数は微調整フレーバーに使う）:
 * - 0/6〜: whip        … 唯一カットが実際に横移動するホイップ型。フラッシュ無し・薄い白霞みと微ズームのみ
 * - 1/6〜: echo        … 残像クローン5枚を等間隔で尾引かせる型。露出2倍＋脱色スパイク、揺れは家族最速最強
 * - 2/6〜: echoFlash   … 豪華版。ノイズ変位の有機歪み＋固定オフセット残像3枚＋暖色グロー＋鋭い白フラッシュ
 * - 3/6〜: scrape      … from/to 別々の横優勢ブラー＋方向ドラッグ。台形フラッシュとオーバースキャン強め
 * - 4/6〜: scrapeChaos … 全部盛り強化版。RGB分離の色収差・膨張バンプ・粒状ノイズ・高速振動。白は控えめ
 * - 5/6〜: stretch     … ブラーでなく本当に scaleX を数倍に引き伸ばす型。寒色の光漏れ＋白い水平光帯
 *
 * 設計メモ:
 * - 乱数はすべて (seed, frame, channel) の決定的ハッシュ。同フレームは何度レンダしても同じ絵
 * - 水平スメアの正体は「横方向のみのガウスブラー」。SVG フィルタの stdDeviation を
 *   毎レンダ焼き込み、1920 幅基準の係数で解像度非依存化する
 * - ブラー縁の黒透け対策として、破壊量に連動したオーバースキャン拡大＋広いフィルタ領域を取る
 * - 緩急はイージング関数でなく折れ線（区分線形）の三角形／台形包絡で作る。
 *   ホイップの気持ちよさは「旧は加速して抜け、新は減速して着地」の非対称で出す
 * - テキスト・フォント・外部素材は一切使わない（CSS/SVG の手続き生成のみ）
 */

export interface MvTransitionSmearProps {
  /** 旧カット */
  from: React.ReactNode;
  /** 新カット */
  to: React.ReactNode;
  /** トランジション全体の長さ（フレーム） */
  durationInFrames: number;
  /** 抜けていく向き（whip/scrape 系で効く。up/down は軸ごと縦に転置） */
  direction?: "left" | "right" | "up" | "down" | "forward" | "backward";
  /** 0..1 で家族内の個体を選ぶ（帯内の端数は振幅の微調整に使う） */
  variant?: number;
}

/** (a,b,c) から 0..1 の決定的な擬似乱数を返す（GLSL の定番ハッシュ） */
const rand = (a: number, b: number, c: number): number => {
  const s = Math.sin(a * 127.1 + b * 311.7 + c * 74.7) * 43758.5453123;
  return s - Math.floor(s);
};

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

const CLAMP = {
  extrapolateLeft: "clamp",
  extrapolateRight: "clamp",
} as const;

type Mode = "whip" | "echo" | "echoFlash" | "scrape" | "scrapeChaos" | "stretch";

const MODES: Mode[] = ["whip", "echo", "echoFlash", "scrape", "scrapeChaos", "stretch"];

type Tuning = {
  /** 横ブラー最大値（px, 1920幅基準） */
  blur: number;
  /** 縦ブラー / 横ブラー の比 */
  ratio: number;
  /** オーバースキャン拡大の最大倍率 */
  over: number;
  /** シェイク最大振幅（px, 1920幅基準） */
  shake: number;
  /** from→to クロスフェード帯（進行度 0..1） */
  band: readonly [number, number];
};

const TUNING: Record<Mode, Tuning> = {
  whip: { blur: 150, ratio: 0, over: 1.06, shake: 9, band: [0.42, 0.58] },
  echo: { blur: 90, ratio: 0, over: 1.08, shake: 26, band: [0.44, 0.56] },
  echoFlash: { blur: 110, ratio: 0.1, over: 1.1, shake: 12, band: [0.36, 0.64] },
  scrape: { blur: 190, ratio: 1 / 6, over: 1.12, shake: 14, band: [0.44, 0.56] },
  scrapeChaos: { blur: 210, ratio: 1 / 6, over: 1.14, shake: 22, band: [0.475, 0.525] },
  stretch: { blur: 70, ratio: 0, over: 1.05, shake: 9, band: [0.45, 0.55] },
};

export const MvTransitionSmear: React.FC<MvTransitionSmearProps> = ({
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

  const v = clamp01(variant);
  const mode: Mode = MODES[Math.min(5, Math.floor(v * 6))];
  const t = TUNING[mode];
  /** 帯内の端数 0..1 → 振幅の微調整（同じ個体でも variant で表情が変わる） */
  const local = clamp01(v * 6 - Math.min(5, Math.floor(v * 6)));
  const ampMul = 0.85 + local * 0.3;
  const seed = 11 + Math.floor(v * 991);

  const last = Math.max(1, durationInFrames - 1);
  const p = clamp01(frame / last);
  /** 解像度非依存の px 係数（1920 幅基準） */
  const px = width / 1920;

  const vertical = direction === "up" || direction === "down";
  /** 旧カットが抜けていく向きの符号（left/up/forward = -1） */
  const dirSign =
    direction === "right" || direction === "down" || direction === "backward" ? 1 : -1;

  // ---- 包絡（すべて折れ線。0→頂点→0 の山型が基本） -----------------------
  const env = interpolate(p, [0, 0.12, 0.5, 0.88, 1], [0, 0.35, 1, 0.35, 0], CLAMP);
  /** 旧側の破壊量: 0→最大（頂点で最大のままフェードアウトする側） */
  const fromEnv = interpolate(p, [0.04, 0.5], [0, 1], CLAMP);
  /** 新側の破壊量: 最大→0（鏡写しの逆再生） */
  const toEnv = interpolate(p, [0.5, 0.96], [1, 0], CLAMP);
  const peakEnv = interpolate(p, [0.38, 0.5, 0.62], [0, 1, 0], CLAMP);

  const toOpacity = interpolate(p, [t.band[0], t.band[1]], [0, 1], CLAMP);

  // ---- 個体別の変形（移動・ドラッグ・引き伸ばし・ズーム） -------------------
  let fromShift = 0;
  let toShift = 0;
  let fromStretch = 1;
  let toStretch = 1;
  let zoom = 1;
  if (mode === "whip") {
    // 旧は加速しながら抜け（前半で 1/3、後半で残り全部）、新は減速しながら着地
    const exit = interpolate(p, [0, 0.32, 0.56], [0, 0.3, 1.15], CLAMP);
    const enter = interpolate(p, [0.44, 0.68, 1], [1.15, 0.3, 0], CLAMP);
    fromShift = dirSign * exit * 100;
    toShift = -dirSign * enter * 100;
    zoom = 1 + 0.09 * env;
  } else if (mode === "scrape" || mode === "scrapeChaos") {
    // 位置は保ったまま方向ドラッグ（擦れ→擦り戻り）
    fromShift = dirSign * fromEnv * 7 * ampMul;
    toShift = -dirSign * toEnv * 7 * ampMul;
    if (mode === "scrapeChaos") {
      zoom = 1 + 0.12 * env; // 膨張スケールバンプ
    }
  } else if (mode === "stretch") {
    // ブラーでなく本当に引き伸ばす。旧は 1→数倍（加速）、新は数倍→1（減速）
    fromStretch = 1 + 3.2 * fromEnv * fromEnv * ampMul;
    toStretch = 1 + 3.2 * toEnv * toEnv * ampMul;
  }

  // ---- ブラー量（旧は 0→最大、新は最大→0 の鏡写し2本立て） -----------------
  const fromBlur = t.blur * fromEnv * px * ampMul;
  const toBlur = t.blur * toEnv * px * ampMul;
  const blurStd = (amt: number): string => {
    const a = Math.max(0, amt);
    const b = Math.max(0, amt * t.ratio);
    return vertical
      ? `${b.toFixed(2)} ${a.toFixed(2)}`
      : `${a.toFixed(2)} ${b.toFixed(2)}`;
  };
  const warpOn = mode === "echoFlash" && env > 0.01;
  const needFromFilter = fromBlur > 0.05 || warpOn;
  const needToFilter = toBlur > 0.05 || warpOn;

  // ---- シェイク（正弦でなくフレームごとに引き直すガタつき） -----------------
  const fastShake = mode === "echo" || mode === "scrapeChaos";
  const tick = fastShake ? frame * 2 + (frame % 2) : frame;
  const shakeAmp = t.shake * px * env * ampMul;
  const shakeX = (rand(seed, tick, 1) - 0.5) * 2 * shakeAmp;
  const shakeY = (rand(seed, tick, 2) - 0.5) * 2 * shakeAmp * 0.7;

  // ---- 露出・色グレード -----------------------------------------------------
  // echo: 露出スパイクと同時に彩度を落として白へ飛ばす
  let grade: string | undefined;
  if (mode === "echo") {
    grade = `brightness(${(1 + peakEnv * 0.9).toFixed(3)}) saturate(${(1 - peakEnv * 0.55).toFixed(3)})`;
  } else if (mode === "echoFlash") {
    grade = `brightness(${(1 + env * 0.35).toFixed(3)}) contrast(${(1 + env * 0.18).toFixed(3)}) saturate(${(1 + env * 0.4).toFixed(3)})`;
  } else if (mode === "scrapeChaos") {
    grade = `brightness(${(1 + peakEnv * 0.22).toFixed(3)})`;
  }

  // ---- オーバースキャン（破壊量に連動。両端では 1 に戻り素の絵に収束） -------
  const overscan = 1 + (t.over - 1) * Math.min(1, env * 1.8);

  const layerTransform = (shiftPct: number, stretch: number): string => {
    const parts: string[] = [];
    if (shiftPct !== 0) {
      parts.push(
        vertical
          ? `translateY(${shiftPct.toFixed(3)}%)`
          : `translateX(${shiftPct.toFixed(3)}%)`
      );
    }
    parts.push(`scale(${(overscan * zoom).toFixed(4)})`);
    if (stretch !== 1) {
      parts.push(
        vertical ? `scaleY(${stretch.toFixed(4)})` : `scaleX(${stretch.toFixed(4)})`
      );
    }
    return parts.join(" ");
  };

  // ---- コンテンツ層（from 下・to 上。to の不透明度で入れ替え） ---------------
  const renderStack = (key: string): React.ReactNode => (
    <AbsoluteFill key={key}>
      <AbsoluteFill
        style={{
          filter: needFromFilter ? `url(#${uid}-f)` : undefined,
          transform: layerTransform(fromShift, fromStretch),
        }}
      >
        {from}
      </AbsoluteFill>
      <AbsoluteFill
        style={{
          filter: needToFilter ? `url(#${uid}-t)` : undefined,
          transform: layerTransform(toShift, toStretch),
          opacity: toOpacity,
        }}
      >
        {to}
      </AbsoluteFill>
    </AbsoluteFill>
  );

  // ---- 残像クローン（echo 系のみ。screen 合成で横に尾を引く） ----------------
  const activeIsTo = toOpacity >= 0.5;
  const activeNode = activeIsTo ? to : from;
  const activeFilterOn = activeIsTo ? needToFilter : needFromFilter;
  const activeFilter = activeIsTo ? `url(#${uid}-t)` : `url(#${uid}-f)`;
  const activeShift = activeIsTo ? toShift : fromShift;
  const activeStretch = activeIsTo ? toStretch : fromStretch;

  type Clone = { off: number; op: number };
  let clones: Clone[] = [];
  if (mode === "echo") {
    // 等間隔×5枚。オフセット自体を包絡連動させ「ピークで尾が最長」
    clones = Array.from({ length: 5 }, (_, i) => ({
      off: -dirSign * (i + 1) * 2.3 * env * ampMul,
      op: (0.42 - i * 0.07) * env,
    }));
  } else if (mode === "echoFlash") {
    // 固定オフセット3枚（画面幅の1〜2%級）。不透明度だけ包絡連動
    clones = [0.35, 0.24, 0.15].map((base, i) => ({
      off: -dirSign * (i + 1) * 1.7,
      op: base * env,
    }));
  }

  // ---- 色収差（強化版のみ。RGB を分離し R 左・B 右へずらして screen 再合成） --
  const chromaOn = mode === "scrapeChaos" && env > 0.02;
  const chromaOff = 14 * px * env * ampMul;

  // ---- 発光・フラッシュ（露出 n 倍 → 白オーバーレイ濃さ n-1 相当に翻訳） ------
  const sharpFlash = interpolate(p, [0.45, 0.5, 0.55], [0, 1, 0], CLAMP);
  const midFlash = interpolate(p, [0.42, 0.5, 0.58], [0, 1, 0], CLAMP);
  const trapFlash = interpolate(p, [0.3, 0.42, 0.58, 0.7], [0, 1, 1, 0], CLAMP);
  const whiteOp =
    mode === "whip"
      ? 0.14 * peakEnv // フラッシュ無し。ごく薄い白霞みだけ
      : mode === "echo"
        ? 0.55 * midFlash
        : mode === "echoFlash"
          ? 0.8 * sharpFlash
          : mode === "scrape"
            ? 0.5 * trapFlash // 台形（短いプラトー付き）
            : mode === "scrapeChaos"
              ? 0.3 * sharpFlash // 強化版は逆に控えめ
              : 0.7 * midFlash;

  // ---- 粒状ノイズ（強化版のみ。高周波ノイズを脱色して overlay、中盤だけ薄く） --
  const grainOp = mode === "scrapeChaos" ? 0.18 * env : 0;
  const grainSeed = Math.floor(rand(seed, frame, 77) * 997);

  return (
    <AbsoluteFill style={{ background: "#000", overflow: "hidden" }}>
      {/* 動的 SVG フィルタ定義（幅0×高さ0 の svg を absolute で置き、毎レンダ値を差し込む） */}
      <svg width={0} height={0} style={{ position: "absolute" }} aria-hidden>
        <defs>
          <filter
            id={`${uid}-f`}
            x="-40%"
            y="-40%"
            width="180%"
            height="180%"
            colorInterpolationFilters="sRGB"
          >
            {mode === "echoFlash" && (
              <>
                <feTurbulence
                  type="fractalNoise"
                  baseFrequency="0.0016 0.014"
                  numOctaves={2}
                  seed={seed % 89}
                  result="warp"
                />
                <feDisplacementMap
                  in="SourceGraphic"
                  in2="warp"
                  scale={(60 * px * env).toFixed(1)}
                  xChannelSelector="R"
                  yChannelSelector="G"
                />
              </>
            )}
            <feGaussianBlur stdDeviation={blurStd(fromBlur)} edgeMode="duplicate" />
          </filter>
          <filter
            id={`${uid}-t`}
            x="-40%"
            y="-40%"
            width="180%"
            height="180%"
            colorInterpolationFilters="sRGB"
          >
            {mode === "echoFlash" && (
              <>
                <feTurbulence
                  type="fractalNoise"
                  baseFrequency="0.0016 0.014"
                  numOctaves={2}
                  seed={(seed + 31) % 89}
                  result="warp"
                />
                <feDisplacementMap
                  in="SourceGraphic"
                  in2="warp"
                  scale={(60 * px * env).toFixed(1)}
                  xChannelSelector="R"
                  yChannelSelector="G"
                />
              </>
            )}
            <feGaussianBlur stdDeviation={blurStd(toBlur)} edgeMode="duplicate" />
          </filter>
          {chromaOn && (
            <>
              <filter id={`${uid}-cr`} colorInterpolationFilters="sRGB">
                <feColorMatrix
                  type="matrix"
                  values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0"
                />
              </filter>
              <filter id={`${uid}-cg`} colorInterpolationFilters="sRGB">
                <feColorMatrix
                  type="matrix"
                  values="0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0"
                />
              </filter>
              <filter id={`${uid}-cb`} colorInterpolationFilters="sRGB">
                <feColorMatrix
                  type="matrix"
                  values="0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0"
                />
              </filter>
            </>
          )}
          {grainOp > 0.01 && (
            <filter id={`${uid}-grain`} x="0" y="0" width="100%" height="100%">
              <feTurbulence
                type="fractalNoise"
                baseFrequency="0.9"
                numOctaves={2}
                seed={grainSeed}
                stitchTiles="stitch"
              />
              <feColorMatrix type="saturate" values="0" />
            </filter>
          )}
        </defs>
      </svg>

      {/* シェイクラッパー（決定論的ハッシュ乱数の微小変位。中盤で最大） */}
      <AbsoluteFill
        style={{
          transform: `translate(${shakeX.toFixed(1)}px, ${shakeY.toFixed(1)}px)`,
        }}
      >
        {/* コンテンツ層（＋露出グレード） */}
        <AbsoluteFill style={{ filter: grade }}>
          {chromaOn ? (
            <>
              {/* G を基準に、R を左・B を右へずらして screen 再合成。整列部は元の色に戻る */}
              <AbsoluteFill style={{ filter: `url(#${uid}-cg)` }}>
                {renderStack("g")}
              </AbsoluteFill>
              <AbsoluteFill
                style={{
                  filter: `url(#${uid}-cr)`,
                  mixBlendMode: "screen",
                  transform: `translateX(${(-chromaOff).toFixed(1)}px)`,
                }}
              >
                {renderStack("r")}
              </AbsoluteFill>
              <AbsoluteFill
                style={{
                  filter: `url(#${uid}-cb)`,
                  mixBlendMode: "screen",
                  transform: `translateX(${chromaOff.toFixed(1)}px)`,
                }}
              >
                {renderStack("b")}
              </AbsoluteFill>
            </>
          ) : (
            renderStack("base")
          )}

          {/* 残像クローン層（echo 系のみ。遠いほど淡い screen 合成） */}
          {clones.map((c, i) =>
            c.op > 0.01 ? (
              <AbsoluteFill
                key={`clone-${i}`}
                style={{
                  filter: activeFilterOn ? activeFilter : undefined,
                  transform: layerTransform(activeShift + c.off, activeStretch),
                  opacity: c.op,
                  mixBlendMode: "screen",
                }}
              >
                {activeNode}
              </AbsoluteFill>
            ) : null
          )}
        </AbsoluteFill>

        {/* 粒状ノイズ（強化版のみ、中盤だけ薄く overlay） */}
        {grainOp > 0.01 && (
          <svg
            width="100%"
            height="100%"
            style={{
              position: "absolute",
              inset: 0,
              mixBlendMode: "overlay",
              opacity: grainOp,
            }}
            aria-hidden
          >
            <rect width="100%" height="100%" filter={`url(#${uid}-grain)`} />
          </svg>
        )}

        {/* 暖色ラジアルグロー（豪華版。中心やや右上寄り、白→暖色→透明を screen） */}
        {mode === "echoFlash" && env > 0.02 && (
          <AbsoluteFill
            style={{
              background:
                "radial-gradient(circle at 62% 38%, rgba(255,255,255,0.95) 0%, rgba(255,166,60,0.8) 26%, rgba(255,84,20,0.42) 54%, rgba(255,84,20,0) 78%)",
              mixBlendMode: "screen",
              opacity: 0.85 * env,
            }}
          />
        )}

        {/* 青い光漏れ（stretch のみの寒色発光: 白芯→鮮青→透明のラジアル） */}
        {mode === "stretch" && env > 0.02 && (
          <>
            <AbsoluteFill
              style={{
                background:
                  "radial-gradient(circle at 50% 50%, rgba(255,255,255,0.95) 0%, rgba(120,180,255,0.75) 30%, rgba(40,90,255,0.35) 58%, rgba(40,90,255,0) 80%)",
                mixBlendMode: "screen",
                opacity: 0.9 * env,
              }}
            />
            {/* 画面中央を横切る細い白の水平光帯（縦方向指定時は縦帯に転置） */}
            <div
              style={{
                position: "absolute",
                ...(vertical
                  ? { top: "-5%", bottom: "-5%", left: "48%", width: "4%" }
                  : { left: "-5%", right: "-5%", top: "48%", height: "4%" }),
                background: "#fff",
                filter: `blur(${(14 * px).toFixed(1)}px)`,
                mixBlendMode: "screen",
                opacity: 0.85 * env,
              }}
            />
          </>
        )}
      </AbsoluteFill>

      {/* 白フラッシュ層（最上位の screen 白ベタ。個体ごとに山型／台形の包絡） */}
      {whiteOp > 0.005 && (
        <AbsoluteFill
          style={{
            background: "#fff",
            mixBlendMode: "screen",
            opacity: clamp01(whiteOp),
            pointerEvents: "none",
          }}
        />
      )}
    </AbsoluteFill>
  );
};
