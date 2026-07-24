import React, { useId, useMemo } from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";

/**
 * MvTransitionShift — 一方向シフト系トランジション家族（クリーンルーム実装）
 *
 * 機能: 約1秒で旧カット→新カットを繋ぐ方向スライド型トランジション。
 *       「中盤の閃光グリッチの頂点の下に、方向スライドとカット入替を隠す」のが設計思想。
 *       閃光・色収差・方向ブラー・ズームパンチが最大になる短いプラトーの真下で、
 *       (a) 旧カットの退場＋新カットの入場スライド（中窓）
 *       (b) 不透明度の入替（かなり狭い窓）
 *       が同時に進み、視聴者にはワープのように見える。
 *
 * 設計メモ:
 * - イージング曲線は使わない。clamp付き折れ線補間で作る
 *   「プラトー付き山型エンベロープ（0→1→1→0）」を全効果が共有する。
 *   緩急は曲線ではなく「窓幅の違い」（光は広く、スライドは中間、入替は狭い）で作る。
 * - 色収差は feColorMatrix でチャンネル分離→feOffset→screen 再合成。
 *   オフセット0なら元の色を正確に再構成する（分離チャンネルの screen は加算に一致）。
 * - 方向ブラーは feGaussianBlur の "X Y" 軸別 stdDeviation（軸方向優勢の異方性）。
 * - 波状歪みは低周波 feTurbulence → feDisplacementMap（left / up のみ、強度は山型連動）。
 * - 乱数はすべて種付きハッシュ（Math.random 不使用）。フレーム整数＋シードから決定論的。
 * - 全ピクセル量は基準幅 1920 比の係数 k でスケールし解像度非依存。
 * - ブラー/スライド/歪みで縁が透けるため、各レイヤーをピーク時に 8〜10% 微拡大して隠す。
 * - 外部素材・フォント・追加依存なし（CSS/SVG/remotion 標準のみ）。
 *
 * 個体差（direction で決まる家族内の性格）:
 * - left : 家族一の飾り屋。波状歪み＋赤/青デュオトーン＋左寄り赤リーク＋中央ピンクブルーム。
 *          フィルタは両レイヤー共通1個。減衰の尾が終端まで長く、スライドは from/to 別窓。
 * - right: 横 2 割強のストレッチが加わる疾走感重視。歪みなし。暖色光焼けで左右フチ強調、
 *          スクラッチは横線。
 * - up   : 波状歪みあり（from/to で別シードのノイズ＝フィルタ2個）。光は冷色系＋
 *          細い縦光条ビーム、グレインは脱色。フチ隠し拡大がやや大きめ。
 * - down : 家族標準の最小構成。縦色収差＋下方向ブラー＋暖色光焼け（上下フチ）のみ。
 * - forward / backward: 契約互換のズーム押し込み系（スライドなし・等方ブラー・斜め色収差）。
 */

export interface MvTransitionShiftProps {
  /** 旧カット */
  from: React.ReactNode;
  /** 新カット */
  to: React.ReactNode;
  /** トランジション全体の長さ（フレーム） */
  durationInFrames: number;
  /** シフト方向（旧カットの退場方向）。forward/backward はズーム押し込み系 */
  direction?: "left" | "right" | "up" | "down" | "forward" | "backward";
  /** 0..1 同家族内の見た目分岐（シードと振幅ジッタへ決定論的に変換） */
  variant?: number;
}

// ---- 決定的乱数・折れ線補間 --------------------------------------------------

/** (a,b,c) から 0..1 の決定的な擬似乱数（sin ハッシュ） */
const rand = (a: number, b: number, c: number): number => {
  const s = Math.sin(a * 127.1 + b * 311.7 + c * 74.7) * 43758.5453123;
  return s - Math.floor(s);
};

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** clamp付き線形ランプ: p が a→b で 0→1 */
const ramp01 = (p: number, a: number, b: number) =>
  clamp01((p - a) / Math.max(1e-6, b - a));

/** プラトー付き山型エンベロープ（全区間linear）: riseStart→riseEnd で立ち上がり、
 *  fallStart→fallEnd で立ち下がる。バウンス・オーバーシュートなし */
const mesa = (
  p: number,
  riseStart: number,
  riseEnd: number,
  fallStart: number,
  fallEnd: number
) => Math.min(ramp01(p, riseStart, riseEnd), 1 - ramp01(p, fallStart, fallEnd));

// ---- 方向別の個体設定 --------------------------------------------------------

type DirCfg = {
  /** 退場方向の単位ベクトル（zoom系は 0,0） */
  ax: number;
  ay: number;
  /** ズーム押し込み系（forward/backward） */
  zoomMode: boolean;
  backward: boolean;
  /** 波状歪み（低周波ノイズ変位）を使うか */
  distort: boolean;
  /** from/to で別シードのノイズ（フィルタ2個）にするか */
  dualNoise: boolean;
  /** 軸方向ストレッチの最大量（right のみ > 0） */
  stretch: number;
  /** 赤/青デュオトーン被せ（left） */
  duotone: boolean;
  /** 冷色光（up）。false なら暖色 */
  cool: boolean;
  /** 縦光条ビームの本数（up） */
  beams: number;
  /** 追加グロウ（left: 赤リーク＋ピンクブルーム） */
  extraGlow: boolean;
  /** スクラッチ線の向き */
  scratchHorizontal: boolean;
  /** フチ隠しの微拡大量 */
  edgeHide: number;
  /** 減衰終端（left は尾が終端まで長い） */
  fallEnd: number;
  /** ズームパンチ最大量 */
  zoomAmt: number;
  /** スライド窓 [start, end]（from / to 別） */
  fromWin: [number, number];
  toWin: [number, number];
  /** グレインの彩度（up は脱色） */
  grainSat: number;
};

const buildCfg = (
  direction: NonNullable<MvTransitionShiftProps["direction"]>
): DirCfg => {
  const base: DirCfg = {
    ax: -1,
    ay: 0,
    zoomMode: false,
    backward: false,
    distort: false,
    dualNoise: false,
    stretch: 0,
    duotone: false,
    cool: false,
    beams: 0,
    extraGlow: false,
    scratchHorizontal: false,
    edgeHide: 0.09,
    fallEnd: 0.94,
    zoomAmt: 0.26,
    fromWin: [0.3, 0.7],
    toWin: [0.3, 0.7],
    grainSat: 0.25,
  };
  switch (direction) {
    case "left":
      // RGB分離＋波状歪み＋ライトリーク。減衰の尾が長く、スライドは from/to 別窓
      return {
        ...base,
        distort: true,
        duotone: true,
        extraGlow: true,
        fallEnd: 1,
        fromWin: [0.28, 0.66],
        toWin: [0.34, 0.72],
      };
    case "right":
      // 横ブラー＋球面ズーム近似＋光焼け。ストレッチで疾走感
      return {
        ...base,
        ax: 1,
        ay: 0,
        stretch: 0.22,
        scratchHorizontal: true,
        zoomAmt: 0.24,
      };
    case "up":
      // 縦RGBズレ＋冷色の光焼け。歪みは from/to 別シード、フチ隠し大きめ
      return {
        ...base,
        ax: 0,
        ay: -1,
        distort: true,
        dualNoise: true,
        cool: true,
        beams: 4,
        edgeHide: 0.1,
        grainSat: 0,
      };
    case "down":
      // 家族標準の最小構成。ズームパンチ＋光の焼き込み
      return { ...base, ax: 0, ay: 1, zoomAmt: 0.3 };
    case "forward":
      return { ...base, ax: 0, ay: 0, zoomMode: true, zoomAmt: 0.34 };
    case "backward":
      return {
        ...base,
        ax: 0,
        ay: 0,
        zoomMode: true,
        backward: true,
        zoomAmt: 0.34,
      };
    default:
      return base;
  }
};

// ---- チャンネル分離＋方向ブラー（＋波状歪み）の SVG フィルタ -----------------

const R_ONLY = "1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0";
const G_ONLY = "0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0";
const B_ONLY = "0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0";

type ShiftFilterProps = {
  id: string;
  /** R を +、B を − 方向へずらすオフセット（px） */
  dx: number;
  dy: number;
  /** 異方性ブラーの stdDeviation（px） */
  sx: number;
  sy: number;
  /** 波状歪みの変位量（px）。0 で無効 */
  warp: number;
  /** ノイズシード（歪み用） */
  noiseSeed: number;
};

const ShiftFilter: React.FC<ShiftFilterProps> = ({
  id,
  dx,
  dy,
  sx,
  sy,
  warp,
  noiseSeed,
}) => {
  const useWarp = warp > 0.25;
  const srcName = useWarp ? "warped" : "SourceGraphic";
  return (
    <filter
      id={id}
      x="-30%"
      y="-30%"
      width="160%"
      height="160%"
      colorInterpolationFilters="sRGB"
    >
      {useWarp && (
        <>
          <feTurbulence
            type="fractalNoise"
            baseFrequency="0.005 0.011"
            numOctaves={2}
            seed={noiseSeed}
            result="warpNoise"
          />
          <feDisplacementMap
            in="SourceGraphic"
            in2="warpNoise"
            scale={warp.toFixed(1)}
            xChannelSelector="R"
            yChannelSelector="G"
            result="warped"
          />
        </>
      )}
      <feColorMatrix in={srcName} type="matrix" values={R_ONLY} result="chR" />
      <feOffset
        in="chR"
        dx={dx.toFixed(2)}
        dy={dy.toFixed(2)}
        result="chRo"
      />
      <feColorMatrix in={srcName} type="matrix" values={G_ONLY} result="chG" />
      <feColorMatrix in={srcName} type="matrix" values={B_ONLY} result="chB" />
      <feOffset
        in="chB"
        dx={(-dx).toFixed(2)}
        dy={(-dy).toFixed(2)}
        result="chBo"
      />
      <feBlend in="chRo" in2="chG" mode="screen" result="chRG" />
      <feBlend in="chRG" in2="chBo" mode="screen" result="chRGB" />
      <feGaussianBlur
        in="chRGB"
        stdDeviation={`${sx.toFixed(2)} ${sy.toFixed(2)}`}
        edgeMode="duplicate"
      />
    </filter>
  );
};

// ---- 本体 --------------------------------------------------------------------

export const MvTransitionShift: React.FC<MvTransitionShiftProps> = ({
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

  const k = width / 1920; // 解像度スケール（FullHD幅基準）
  const v = clamp01(variant);
  const seed = 31 + Math.floor(v * 997);
  // 振幅ジッタ（±10%）: variant で家族内の個体差を微妙に振る
  const jit = 0.9 + 0.2 * rand(seed, 1, 2);
  const cfg = useMemo(() => buildCfg(direction), [direction]);

  const last = Math.max(1, durationInFrames - 1);
  const p = clamp01(frame / last);

  // ---- 共有エンベロープ（プラトー付き山型・全区間linear） --------------------
  // 主エンベロープ: 前半4割強で立ち上がり → 中央の短いプラトー → 終端へ線形減衰
  const g = mesa(p, 0, 0.44, 0.53, cfg.fallEnd);
  // 光焼け: 1割強経過から先行してじわり点き → 9割弱経過で消灯（窓が一番広い）
  const light = mesa(p, 0.12, 0.44, 0.53, 0.88);
  // left のみ: 閃光の一部をエンベロープ二乗で中央に尖らせる
  const lightSharp = cfg.extraGlow ? light * light : light;

  // ---- スライド（中窓・ほぼ線形）＋不透明度入替（狭窓） ----------------------
  const fromProg = ramp01(p, cfg.fromWin[0], cfg.fromWin[1]);
  const toProg = ramp01(p, cfg.toWin[0], cfg.toWin[1]);
  // 入替窓は中央 ± 6.5% とかなり狭い（実カット点を閃光の頂点に埋め込む）
  const toOp = ramp01(p, 0.435, 0.565);

  // スライド変位: 画面幅の 1/8〜1/6 弱。横切らせず、ブラーと閃光で「流れた」錯覚を作る
  const dispPx = 0.145 * width * jit;
  const fromOffX = cfg.ax * dispPx * fromProg;
  const fromOffY = cfg.ay * dispPx * fromProg;
  const toOffX = -cfg.ax * dispPx * (1 - toProg);
  const toOffY = -cfg.ay * dispPx * (1 - toProg);

  // ズーム押し込み系（forward/backward）: スライドの代わりにスケールで出入り
  const fromPush = cfg.zoomMode
    ? cfg.backward
      ? 1 - 0.24 * fromProg
      : 1 + 0.3 * fromProg
    : 1;
  const toPush = cfg.zoomMode
    ? cfg.backward
      ? 1 + 0.14 * (1 - toProg)
      : 1 - 0.16 * (1 - toProg)
    : 1;

  // ---- フィルタ量（すべて主エンベロープ共有・基準幅比で解像度非依存） --------
  // 色収差: R/B をシフト軸に沿って逆向きに片側 1% 強ずつ
  const chroma = 0.013 * width * g * jit;
  const cdx = cfg.zoomMode ? chroma * 0.7 : cfg.ax * chroma;
  const cdy = cfg.zoomMode ? chroma * 0.7 : cfg.ay * chroma;
  // 方向ブラー: 軸方向は幅の 2%強、直交方向はその 1/6
  const blurAxis = 0.023 * width * g * jit;
  const blurOrtho = blurAxis / 6;
  const bsx = cfg.zoomMode
    ? blurAxis * 0.45
    : Math.abs(cfg.ax) * blurAxis + Math.abs(cfg.ay) * blurOrtho;
  const bsy = cfg.zoomMode
    ? blurAxis * 0.45
    : Math.abs(cfg.ay) * blurAxis + Math.abs(cfg.ax) * blurOrtho;
  // 波状歪み（left/up のみ・山型連動）
  const warp = cfg.distort ? 48 * k * g * jit : 0;

  // ---- 微振動（幅1%弱・軸方向やや強め・フレーム由来の決定的ハッシュ） --------
  // 時間刻みはフレーム毎（レンダの最小刻み）に更新
  const shakeAmp = 0.008 * width * g;
  const axisBiasX = cfg.zoomMode ? 1 : Math.abs(cfg.ax) * 0.6 + 0.7;
  const axisBiasY = cfg.zoomMode ? 1 : Math.abs(cfg.ay) * 0.6 + 0.7;
  const shakeX = (rand(seed, frame, 11) - 0.5) * 2 * shakeAmp * axisBiasX;
  const shakeY = (rand(seed, frame, 12) - 0.5) * 2 * shakeAmp * axisBiasY;

  // ---- ズームパンチ（最大3割増・中央膨張レンズの近似も兼ねる）＋ストレッチ ----
  const zoom = 1 + cfg.zoomAmt * g;
  const zoomX = zoom * (1 + cfg.stretch * g);
  const zoomY = zoom;
  // フチ隠し: 各レイヤーをピーク時に 8〜10% 微拡大
  const hide = 1 + cfg.edgeHide * g;

  // ---- グレード（露出は光焼けに連動して軽く持ち上げる） ----------------------
  const grade = [
    `brightness(${(1 + 0.16 * light).toFixed(3)})`,
    `contrast(${(1 + 0.05 * g).toFixed(3)})`,
    `saturate(${(1 - 0.07 * g).toFixed(3)})`,
  ].join(" ");

  const filterOn = g > 0.004;

  // ---- レイヤー ---------------------------------------------------------------
  const fromLayer = (
    <AbsoluteFill
      style={{
        transform: `translate(${fromOffX.toFixed(1)}px, ${fromOffY.toFixed(
          1
        )}px) scale(${(hide * fromPush).toFixed(4)})`,
      }}
    >
      {from}
    </AbsoluteFill>
  );
  const toLayer = (
    <AbsoluteFill
      style={{
        transform: `translate(${toOffX.toFixed(1)}px, ${toOffY.toFixed(
          1
        )}px) scale(${(hide * toPush).toFixed(4)})`,
      }}
    >
      {to}
    </AbsoluteFill>
  );

  let stack: React.ReactNode;
  if (cfg.dualNoise) {
    // up: from/to で別シードのノイズ → レイヤー毎に別フィルタ
    stack = (
      <>
        {toOp < 0.999 && (
          <AbsoluteFill
            style={{ filter: filterOn ? `url(#${uid}-fa)` : undefined }}
          >
            {fromLayer}
          </AbsoluteFill>
        )}
        {toOp > 0.001 && (
          <AbsoluteFill
            style={{
              filter: filterOn ? `url(#${uid}-fb)` : undefined,
              opacity: toOp,
            }}
          >
            {toLayer}
          </AbsoluteFill>
        )}
      </>
    );
  } else {
    // 標準: 両レイヤー共通のフィルタ1個（入替の継ぎ目も一緒に溶ける）
    stack = (
      <AbsoluteFill style={{ filter: filterOn ? `url(#${uid}-fa)` : undefined }}>
        {toOp < 0.999 && fromLayer}
        {toOp > 0.001 && (
          <AbsoluteFill style={{ opacity: toOp }}>{toLayer}</AbsoluteFill>
        )}
      </AbsoluteFill>
    );
  }

  // ---- 光焼け（screen合成: 中央ホット放射 ＋ シフト軸フチ焼き直線） -----------
  const horizontalAxis = Math.abs(cfg.ax) > 0 || cfg.zoomMode;
  const edgeAngle = horizontalAxis ? 90 : 180;
  const coreColor = cfg.cool
    ? "rgba(232, 250, 255, 0.85)"
    : "rgba(255, 240, 218, 0.85)";
  const coreMid = cfg.cool
    ? "rgba(130, 218, 255, 0.32)"
    : "rgba(255, 196, 122, 0.32)";
  const edgeColor = cfg.cool
    ? "rgba(126, 214, 255, 0.75)"
    : "rgba(255, 178, 98, 0.75)";

  // ---- スクラッチ（6本・位置/太さ/明暗はシード・2コマ周期で確率的に明滅） ----
  const scratches = useMemo(
    () =>
      Array.from({ length: 6 }, (_, i) => ({
        pos: 4 + rand(seed, i, 21) * 92, // %（縦線なら left、横線なら top）
        w: (0.9 + rand(seed, i, 22) * 1.6) * k, // px
        bright: rand(seed, i, 23) < 0.5,
        alpha: 0.25 + rand(seed, i, 24) * 0.35,
      })),
    [seed, k]
  );
  const blinkIdx = Math.floor(frame / 2);

  // ---- 縦光条ビーム（up のみ・冷色） ------------------------------------------
  const beams = useMemo(
    () =>
      Array.from({ length: cfg.beams }, (_, i) => ({
        left: 8 + rand(seed, i, 31) * 84,
        w: (26 + rand(seed, i, 32) * 46) * k,
        bri: 0.35 + rand(seed, i, 33) * 0.45,
      })),
    [cfg.beams, seed, k]
  );

  // グレイン: フレーム毎にシード更新（高周波・overlay・1割前後で常時、ピークで微増）
  const grainSeed = ((seed * 7 + frame * 13) % 9973) + 1;
  const grainOpacity = 0.08 + 0.05 * g;

  return (
    <AbsoluteFill style={{ background: "#000", overflow: "hidden" }}>
      {/* フィルタ定義 */}
      <svg width={0} height={0} style={{ position: "absolute" }} aria-hidden>
        <defs>
          <ShiftFilter
            id={`${uid}-fa`}
            dx={cdx}
            dy={cdy}
            sx={bsx}
            sy={bsy}
            warp={warp}
            noiseSeed={seed % 100}
          />
          {cfg.dualNoise && (
            <ShiftFilter
              id={`${uid}-fb`}
              dx={cdx}
              dy={cdy}
              sx={bsx}
              sy={bsy}
              warp={warp}
              noiseSeed={(seed + 47) % 100}
            />
          )}
        </defs>
      </svg>

      {/* 本体スタック（ズームパンチ＋微振動＋グレード） */}
      <AbsoluteFill
        style={{
          transform: `translate(${shakeX.toFixed(1)}px, ${shakeY.toFixed(
            1
          )}px) scale(${zoomX.toFixed(4)}, ${zoomY.toFixed(4)})`,
          filter: grade,
        }}
      >
        {stack}
      </AbsoluteFill>

      {/* 赤/青デュオトーン被せ（left: 左右を色分け） */}
      {cfg.duotone && g > 0.02 && (
        <AbsoluteFill
          style={{
            background: `linear-gradient(90deg, rgba(255, 62, 76, 0.55) 0%, rgba(255, 62, 76, 0) 46%, rgba(64, 92, 255, 0) 56%, rgba(64, 92, 255, 0.5) 100%)`,
            mixBlendMode: "overlay",
            opacity: 0.8 * g,
            pointerEvents: "none",
          }}
        />
      )}

      {/* 光焼け1: 中央ホットスポットの放射グラデ */}
      {light > 0.02 && (
        <AbsoluteFill
          style={{
            background: `radial-gradient(ellipse at 50% 50%, ${coreColor} 0%, ${coreMid} 34%, rgba(0,0,0,0) 62%)`,
            mixBlendMode: "screen",
            opacity: 0.85 * light,
            pointerEvents: "none",
          }}
        />
      )}

      {/* 光焼け2: シフト軸両端のフチを焼く直線グラデ */}
      {light > 0.02 && (
        <AbsoluteFill
          style={{
            background: `linear-gradient(${edgeAngle}deg, ${edgeColor} 0%, rgba(0,0,0,0) 24%, rgba(0,0,0,0) 76%, ${edgeColor} 100%)`,
            mixBlendMode: "screen",
            opacity: 0.75 * light,
            pointerEvents: "none",
          }}
        />
      )}

      {/* up: マゼンタ差し色（冷色に一滴だけ暖の対比） */}
      {cfg.cool && light > 0.02 && (
        <AbsoluteFill
          style={{
            background:
              "radial-gradient(ellipse at 30% 62%, rgba(255, 132, 224, 0.4) 0%, rgba(0,0,0,0) 48%)",
            mixBlendMode: "screen",
            opacity: 0.55 * light,
            pointerEvents: "none",
          }}
        />
      )}

      {/* left: 左寄り赤リーク */}
      {cfg.extraGlow && light > 0.02 && (
        <AbsoluteFill
          style={{
            background:
              "linear-gradient(90deg, rgba(255, 84, 72, 0.8) 0%, rgba(255, 84, 72, 0) 34%)",
            filter: `blur(${(30 * k).toFixed(1)}px)`,
            mixBlendMode: "screen",
            opacity: 0.7 * light,
            pointerEvents: "none",
          }}
        />
      )}

      {/* left: 中央ピンクブルーム（エンベロープ二乗で中央に尖る閃光） */}
      {cfg.extraGlow && lightSharp > 0.02 && (
        <AbsoluteFill
          style={{
            background:
              "radial-gradient(circle at 50% 48%, rgba(255, 208, 230, 0.9) 0%, rgba(255, 148, 202, 0.4) 30%, rgba(0,0,0,0) 58%)",
            mixBlendMode: "screen",
            opacity: 0.8 * lightSharp,
            pointerEvents: "none",
          }}
        />
      )}

      {/* up: 細い縦光条ビーム */}
      {cfg.beams > 0 && light > 0.02 && (
        <AbsoluteFill style={{ mixBlendMode: "screen", pointerEvents: "none" }}>
          {beams.map((b, i) => (
            <div
              key={i}
              style={{
                position: "absolute",
                top: "-5%",
                left: `${b.left.toFixed(2)}%`,
                width: `${b.w.toFixed(1)}px`,
                height: "110%",
                background:
                  "linear-gradient(90deg, rgba(178, 238, 255, 0) 0%, rgba(236, 252, 255, 0.9) 50%, rgba(178, 238, 255, 0) 100%)",
                filter: `blur(${(6 * k).toFixed(1)}px)`,
                opacity: clamp01(b.bri * light),
              }}
            />
          ))}
        </AbsoluteFill>
      )}

      {/* フィルムグレイン（高周波ノイズ・overlay・フレーム毎シード更新） */}
      {grainOpacity > 0.01 && (
        <svg
          width="100%"
          height="100%"
          style={{
            position: "absolute",
            inset: 0,
            mixBlendMode: "overlay",
            opacity: grainOpacity,
            pointerEvents: "none",
          }}
          aria-hidden
        >
          <filter id={`${uid}-grain`} x="0%" y="0%" width="100%" height="100%">
            <feTurbulence
              type="fractalNoise"
              baseFrequency="0.9"
              numOctaves={2}
              seed={grainSeed}
              stitchTiles="stitch"
            />
            <feColorMatrix type="saturate" values={`${cfg.grainSat}`} />
          </filter>
          <rect
            width="100%"
            height="100%"
            filter={`url(#${uid}-grain)`}
          />
        </svg>
      )}

      {/* スクラッチ（細い明暗ライン・2コマ周期の確率明滅） */}
      {g > 0.05 && (
        <AbsoluteFill style={{ pointerEvents: "none" }}>
          {scratches.map((s, i) => {
            const on = rand(seed, blinkIdx, 61 + i) < 0.55;
            if (!on) return null;
            const color = s.bright
              ? `rgba(255,255,255,${s.alpha.toFixed(2)})`
              : `rgba(0,0,0,${(s.alpha * 1.2).toFixed(2)})`;
            return (
              <div
                key={i}
                style={
                  cfg.scratchHorizontal
                    ? {
                        position: "absolute",
                        left: 0,
                        right: 0,
                        top: `${s.pos.toFixed(2)}%`,
                        height: `${s.w.toFixed(1)}px`,
                        background: color,
                        opacity: clamp01(g * 1.5),
                      }
                    : {
                        position: "absolute",
                        top: 0,
                        bottom: 0,
                        left: `${s.pos.toFixed(2)}%`,
                        width: `${s.w.toFixed(1)}px`,
                        background: color,
                        opacity: clamp01(g * 1.5),
                      }
                }
              />
            );
          })}
        </AbsoluteFill>
      )}
    </AbsoluteFill>
  );
};
