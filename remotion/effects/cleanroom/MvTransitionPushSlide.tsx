import React, { useId, useMemo } from "react";
import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from "remotion";

/**
 * MvTransitionPushSlide — 押し出しスライドトランジション家族（クリーンルーム実装）
 *
 * 機能: 旧カットを画面外へ押し出し、新カットが同方向から押し入る超短尺プッシュ遷移
 *       （実尺 0.4 秒前後）。速さそのものは「進行方向に伸びるモーションブラー」で見せる。
 *
 * 設計メモ:
 * - 進行度 p = frame/(duration-1) を軸に、移動 / ブラー / フラッシュ / グレード / 粒子を
 *   独立エンベロープで計算して合成する。中央頂点の三角形包絡（0→1→0）が家族の基本形。
 * - 一軸ブラーは SVG feGaussianBlur の stdDeviation を "X Y" 軸別指定で毎フレーム
 *   差し替えて実現。フィルタ領域はブラー方向へ大きく広げ、端切れは edgeMode と
 *   微スケールで隠す。ピーク値は 1080p 基準で画面高の 4〜12% 相当、解像度比でスケール。
 * - variant(0..1) から家族内 3 モードとシードを決定論的に導出:
 *   0: ハイブリッド縦スライド（半画面ずらし＋ディゾルブ、冒頭白パルス＋色収差＋
 *      グレイン＋微膨張のフル装備）
 *   1: 縦一気引き（完全シームレス押し出し、装飾なし、前のめりブラー包絡の最小構成）
 *   2: 水平シームレス押し出し（線形移動＋家族最強の純水平ブラー、頂点で
 *      コントラスト増し・脱色・青白リフト・カラーノイズのスパイク集中）
 * - 色収差は RGB をチャンネル分離した 3 層の screen 合成。赤を移動方向へ・青を逆方向へ
 *   数 px オフセットし、整列部は元の色を正確に再構成する。
 * - グレインは feTurbulence（フラクタルノイズ）を overlay 合成。シードはフレームから
 *   決定的に更新（Math.random 不使用）。外部素材・追加依存なし。
 */

export interface MvTransitionPushSlideProps {
  /** 旧カット */
  from: React.ReactNode;
  /** 新カット */
  to: React.ReactNode;
  /** トランジション全体の長さ（フレーム） */
  durationInFrames: number;
  /** 押し出し方向（旧カットが退出する向き）。forward/backward はズーム押し込み */
  direction?: "left" | "right" | "up" | "down" | "forward" | "backward";
  /** 0..1 同家族内の見た目分岐（決定論的にモードとシードへ変換） */
  variant?: number;
}

// ---- イージング・包絡ヘルパー（乱数はシードからの整数ハッシュのみ使用） ------

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
/** ease-in-out（3次）。中央で最速＝押し出しの基準イージング */
const easeInOutCubic = (t: number) => {
  const x = clamp01(t);
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
};
const easeInCubic = (t: number) => {
  const x = clamp01(t);
  return x * x * x;
};
const easeOutCubic = (t: number) => 1 - Math.pow(1 - clamp01(t), 3);
/** 中心 c・半幅 w の山（0→1→0） */
const bump = (t: number, c: number, w: number) =>
  Math.max(0, 1 - Math.abs((t - c) / w));

// ---- 個体（モード）設定 ------------------------------------------------------

type ModeCfg = {
  /** 完全シームレス押し出し（true）か、半端ずらし＋ディゾルブのハイブリッド（false） */
  seamless: boolean;
  /** 旧カットの移動量（画面比 0..1） */
  travel: number;
  /** 移動イージング */
  moveEase: (t: number) => number;
  /** ブラー包絡 0..1 */
  blurEnv: (p: number) => number;
  /** ブラー最大 stdDeviation（1080p 基準 px・画面高 4〜12% 相当） */
  blurMax: number;
  /** 直交軸の stdDeviation 比（進行軸に対する割合） */
  blurCross: number;
  /** フラッシュ包絡と強度・色（screen 合成、最大 3 割前後の控えめパルス） */
  flashEnv: (p: number) => number;
  flashPeak: number;
  flashColor: string;
  /** 色収差の最大オフセット（1080p 基準 px、0 で無効） */
  aberrationPx: number;
  /** 頂点の微膨張量（レンズの息継ぎ風、0..0.06 程度） */
  scalePulse: number;
  /** 頂点グレード（コントラスト増し＋脱色＋明度リフト）の強さ 0..1 */
  gradeAmt: number;
  /** グレード包絡 */
  gradeEnv: (p: number) => number;
  /** グレイン量 0..1（overlay 合成の不透明度係数） */
  grainAmt: number;
  /** カラーノイズのまま使う（false で無彩色化） */
  grainColor: boolean;
  /** グレイン包絡 */
  grainEnv: (p: number) => number;
};

/** 三角形包絡: 序盤2割で立ち上がり中央頂点、8割で収束 */
const triMid = (p: number) =>
  interpolate(p, [0, 0.2, 0.5, 0.8, 1], [0, 0.6, 1, 0.12, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

/** 前のめり包絡: 開始直後に即ピーク→残り全部で漸減 */
const frontLoad = (p: number) =>
  Math.min(1, p * 9) * Math.pow(1 - clamp01(p), 0.85);

const buildCfg = (mode: number): ModeCfg => {
  switch (mode) {
    case 0:
      // ハイブリッド縦スライド: 半画面弱ずらし＋ディゾルブ、フル装備の最も盛った個体
      return {
        seamless: false,
        travel: 0.45,
        moveEase: easeInOutCubic,
        blurEnv: triMid,
        blurMax: 66, // 画面高の約6%
        blurCross: 0.7,
        flashEnv: (p) => Math.pow(bump(p, 0.1, 0.2), 1.2), // 冒頭の白露出パルス
        flashPeak: 0.28,
        flashColor: "#ffffff",
        aberrationPx: 8,
        scalePulse: 0.035,
        gradeAmt: 0.55,
        gradeEnv: triMid,
        grainAmt: 0.24,
        grainColor: false,
        grainEnv: triMid,
      };
    case 1:
      // 縦一気引き: 装飾なし・縦優勢ブラーのみの最小構成。ブラーは前のめり包絡
      return {
        seamless: true,
        travel: 1,
        moveEase: easeInOutCubic,
        blurEnv: frontLoad,
        blurMax: 88, // 画面高の約8%
        blurCross: 0.65,
        flashEnv: () => 0,
        flashPeak: 0,
        flashColor: "#ffffff",
        aberrationPx: 0,
        scalePulse: 0,
        gradeAmt: 0,
        gradeEnv: () => 0,
        grainAmt: 0,
        grainColor: false,
        grainEnv: () => 0,
      };
    case 2:
    default:
      // 水平シームレス: 線形移動＋家族最強の純水平ブラー、演出は頂点に集中
      return {
        seamless: true,
        travel: 1,
        moveEase: clamp01, // 線形。速度感は頂点の演出集中で補う
        blurEnv: (p) => Math.pow(bump(p, 0.5, 0.5), 1.25),
        blurMax: 126, // 画面高の約12%・家族最強クラス
        blurCross: 0.1, // ほぼ純水平
        flashEnv: (p) => Math.pow(bump(p, 0.5, 0.22), 1.3), // 頂点の青白い露出リフト
        flashPeak: 0.24,
        flashColor: "#e8f1ff",
        aberrationPx: 0,
        scalePulse: 0.015,
        gradeAmt: 0.75,
        gradeEnv: (p) => Math.pow(bump(p, 0.5, 0.24), 1.2),
        grainAmt: 0.3,
        grainColor: true,
        grainEnv: (p) => Math.pow(bump(p, 0.5, 0.2), 1.2), // カラーノイズのスパイク
      };
  }
};

// ---- 本体 --------------------------------------------------------------------

export const MvTransitionPushSlide: React.FC<MvTransitionPushSlideProps> = ({
  from,
  to,
  durationInFrames,
  direction = "up",
  variant = 0,
}) => {
  const frame = useCurrentFrame();
  const { height } = useVideoConfig();
  const rawId = useId();
  const uid = useMemo(() => rawId.replace(/[^a-zA-Z0-9_-]/g, ""), [rawId]);

  const k = height / 1080; // 解像度スケール（1080p 基準）
  const v = clamp01(variant);
  const mode = Math.min(2, Math.floor(v * 3));
  const seed = 17 + Math.floor(v * 991);
  const cfg = useMemo(() => buildCfg(mode), [mode]);

  const last = Math.max(1, durationInFrames - 1);
  const p = clamp01(frame / last);

  // ---- 方向ベクトル（旧カットの退出方向） -----------------------------------
  const zoomMode = direction === "forward" || direction === "backward";
  let ax = 0;
  let ay = 0;
  switch (direction) {
    case "left":
      ax = -1;
      break;
    case "right":
      ax = 1;
      break;
    case "down":
      ay = 1;
      break;
    case "up":
    default:
      ay = -1;
      break;
  }

  // ---- エンベロープ ------------------------------------------------------------
  const bEnv = cfg.blurEnv(p);
  const gEnv = cfg.gradeAmt * cfg.gradeEnv(p);
  const flashVal = cfg.flashPeak * cfg.flashEnv(p);
  const grainOp = cfg.grainAmt * cfg.grainEnv(p);

  // ---- 一軸ブラー量（進行軸に伸ばし、直交軸は控えめ） -------------------------
  const blurPx = cfg.blurMax * k * bEnv;
  let sx: number;
  let sy: number;
  if (zoomMode) {
    // ズーム押し込みは等方ブラーで速度感を代用
    sx = blurPx * 0.5;
    sy = blurPx * 0.5;
  } else if (Math.abs(ax) > 0) {
    // 水平スライド: 横を大きく、縦は控えめ
    sx = blurPx;
    sy = blurPx * cfg.blurCross;
  } else {
    // 縦スライド: 縦を大きく、横はその6〜8割程度
    sx = blurPx * cfg.blurCross;
    sy = blurPx;
  }
  const blurOn = blurPx > 0.3;

  // ---- 移動量 ------------------------------------------------------------------
  const move = cfg.moveEase(p); // 0..1
  const travelPct = cfg.travel * 100;

  // ---- 微膨張（レンズの息継ぎ風・隙間防止兼用） --------------------------------
  const pulseEnv = mode === 1 ? bEnv : triMid(p);
  const scale = 1 + cfg.scalePulse * pulseEnv + (blurOn ? 0.015 * bEnv : 0);

  // ---- 頂点グレード: コントラスト増し＋脱色＋わずかな明度リフト -----------------
  const grade = [
    `contrast(${(1 + 0.28 * gEnv).toFixed(3)})`,
    `saturate(${(1 - 0.5 * gEnv).toFixed(3)})`,
    `brightness(${(1 + 0.08 * gEnv).toFixed(3)})`,
  ].join(" ");

  // ---- 色収差オフセット（赤=移動方向 / 青=逆方向） -----------------------------
  const abPx = cfg.aberrationPx * k * bEnv;
  const splitOn = abPx > 0.4 && !zoomMode;

  // ---- グレインのシード（フレーム毎に決定的に更新） ----------------------------
  const grainSeed = 1 + ((seed * 7 + frame * 13) % 997);

  // ---- クリップレイヤー --------------------------------------------------------
  let clips: React.ReactNode;
  if (zoomMode) {
    // ズーム押し込み: 旧が手前へ（forward）/ 奥へ（backward）抜け、新が入れ替わる
    const fromProg = easeInCubic(p / 0.62);
    const toProg = easeOutCubic((p - 0.38) / 0.62);
    const toOp = interpolate(p, [0.42, 0.58], [0, 1], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    });
    const fromScale =
      direction === "backward" ? 1 - 0.4 * fromProg : 1 + 0.45 * fromProg;
    const toScale =
      direction === "backward" ? 1 + 0.18 * (1 - toProg) : 1 - 0.16 * (1 - toProg);
    clips = (
      <AbsoluteFill>
        {toOp < 0.999 && (
          <AbsoluteFill style={{ transform: `scale(${fromScale.toFixed(4)})` }}>
            {from}
          </AbsoluteFill>
        )}
        {toOp > 0.001 && (
          <AbsoluteFill
            style={{
              transform: `scale(${toScale.toFixed(4)})`,
              opacity: toOp,
            }}
          >
            {to}
          </AbsoluteFill>
        )}
      </AbsoluteFill>
    );
  } else if (cfg.seamless) {
    // 完全シームレス: 旧新を 1 本の帯として連結し、1 画面ぶんフル移動
    // 継ぎ目のヘアライン対策に新カットを 0.15% だけ重ねる
    const shift = travelPct * move;
    clips = (
      <AbsoluteFill
        style={{
          transform: `translate(${(ax * shift).toFixed(3)}%, ${(
            ay * shift
          ).toFixed(3)}%)`,
        }}
      >
        {move < 1 && <AbsoluteFill>{from}</AbsoluteFill>}
        <AbsoluteFill
          style={{
            transform: `translate(${(-ax * (travelPct - 0.15)).toFixed(
              3
            )}%, ${(-ay * (travelPct - 0.15)).toFixed(3)}%)`,
          }}
        >
          {to}
        </AbsoluteFill>
      </AbsoluteFill>
    );
  } else {
    // ハイブリッド: 旧は半画面弱ずらし、新は逆側から寄りつつ不透明度 0→1 で乗る
    const fromShift = travelPct * move;
    const toShift = 25 * (1 - easeOutCubic(clamp01((p - 0.1) / 0.65)));
    const toOp = interpolate(p, [0.18, 0.72], [0, 1], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    });
    clips = (
      <AbsoluteFill>
        {toOp < 0.999 && (
          <AbsoluteFill
            style={{
              transform: `translate(${(ax * fromShift).toFixed(3)}%, ${(
                ay * fromShift
              ).toFixed(3)}%)`,
            }}
          >
            {from}
          </AbsoluteFill>
        )}
        {toOp > 0.001 && (
          <AbsoluteFill
            style={{
              transform: `translate(${(-ax * toShift).toFixed(3)}%, ${(
                -ay * toShift
              ).toFixed(3)}%)`,
              opacity: toOp,
            }}
          >
            {to}
          </AbsoluteFill>
        )}
      </AbsoluteFill>
    );
  }

  // ---- チャンネル分離（色収差）。整列部は screen 合成で元の色に戻る -------------
  const body = splitOn ? (
    <>
      <AbsoluteFill style={{ filter: `url(#${uid}-cg)` }}>{clips}</AbsoluteFill>
      <AbsoluteFill
        style={{
          filter: `url(#${uid}-cr)`,
          mixBlendMode: "screen",
          transform: `translate(${(ax * abPx).toFixed(2)}px, ${(
            ay * abPx
          ).toFixed(2)}px)`,
        }}
      >
        {clips}
      </AbsoluteFill>
      <AbsoluteFill
        style={{
          filter: `url(#${uid}-cb)`,
          mixBlendMode: "screen",
          transform: `translate(${(-ax * abPx).toFixed(2)}px, ${(
            -ay * abPx
          ).toFixed(2)}px)`,
        }}
      >
        {clips}
      </AbsoluteFill>
    </>
  ) : (
    clips
  );

  return (
    <AbsoluteFill style={{ background: "#000", overflow: "hidden" }}>
      {/* フィルタ定義（一軸ブラーは領域をブラー方向へ大きく拡張して端切れ防止） */}
      <svg width={0} height={0} style={{ position: "absolute" }} aria-hidden>
        <defs>
          <filter
            id={`${uid}-blur`}
            x="-50%"
            y="-50%"
            width="200%"
            height="200%"
            colorInterpolationFilters="sRGB"
          >
            <feGaussianBlur
              stdDeviation={`${sx.toFixed(2)} ${sy.toFixed(2)}`}
              edgeMode="duplicate"
            />
          </filter>
          {splitOn && (
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
            <filter id={`${uid}-grain`} colorInterpolationFilters="sRGB">
              <feTurbulence
                type="fractalNoise"
                baseFrequency="0.82"
                numOctaves={2}
                seed={grainSeed}
                stitchTiles="stitch"
              />
              {!cfg.grainColor && <feColorMatrix type="saturate" values="0" />}
              <feComponentTransfer>
                <feFuncA type="linear" slope={0.9} intercept={0.1} />
              </feComponentTransfer>
            </filter>
          )}
        </defs>
      </svg>

      {/* 本体（一軸ブラー＋頂点グレード＋微膨張） */}
      <AbsoluteFill
        style={{
          filter: blurOn ? `url(#${uid}-blur)` : undefined,
          transform: `scale(${scale.toFixed(4)})`,
        }}
      >
        <AbsoluteFill style={{ filter: gEnv > 0.01 ? grade : undefined }}>
          {body}
        </AbsoluteFill>
      </AbsoluteFill>

      {/* 質感オーバーレイ（手続きグレイン・overlay 合成・毎フレームちらつき） */}
      {grainOp > 0.01 && (
        <AbsoluteFill
          style={{
            filter: `url(#${uid}-grain)`,
            mixBlendMode: "overlay",
            opacity: clamp01(grainOp),
            pointerEvents: "none",
          }}
        />
      )}

      {/* フラッシュ（純白〜青白の控えめパルス・screen 合成） */}
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
