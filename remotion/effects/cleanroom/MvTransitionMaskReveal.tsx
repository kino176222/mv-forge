import React, { useId, useMemo } from "react";
import {
  AbsoluteFill,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

/**
 * MvTransitionMaskReveal — 不定形マスクリビール（クリーンルーム実装）
 *
 * 機能: 画面中央から手描き風の不定形マスクが成長し、次カットを抜き出す
 *       超短尺（0.4秒弱想定）のリビール系トランジション。
 * 進行: 冒頭の白フラッシュで目をくらませる → 縦優勢ブラー＋微振動の嵐の中で
 *       マスクが爆発的に成長 → 末尾3割で彩度が戻り新カット確定。
 *
 * 設計メモ:
 * - ブラーと揺れはステージコンテナ（from + マスク済み to の親）に一括で掛け、
 *   切替の境界を流れの中に溶かして一体化させる。
 * - マスクは頂点10個の閉多角形を決定論ハッシュで±2〜3割ばらつかせた1本のパス。
 *   data URI の SVG として mask-image に渡し、縁は常時ぼかす（固定分＋嵐連動分）。
 * - 成長は中央固定スケール（translate→scale→translate の合成）。強い ease-in で
 *   末尾は8倍超まで拡張して画面外へ抜け、新カットが全面主役になる。
 * - 乱数はすべて (seed, index, salt) の決定論ハッシュ。Math.random 不使用。
 */

export interface MvTransitionMaskRevealProps {
  /** 旧カット */
  from: React.ReactNode;
  /** 新カット */
  to: React.ReactNode;
  /** トランジション全体の長さ（フレーム） */
  durationInFrames: number;
  /** ブラー・マスクの主軸方向（left/right=横、それ以外=縦） */
  direction?: "left" | "right" | "up" | "down" | "forward" | "backward";
  /** 0..1 同家族内の見た目分岐（決定論的） */
  variant?: number;
}

/** (a,b,c) から 0..1 の決定的な擬似乱数（sin ハッシュ） */
const hash = (a: number, b: number, c: number): number => {
  const s = Math.sin(a * 127.1 + b * 311.7 + c * 74.7) * 43758.5453123;
  return s - Math.floor(s);
};

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

const CLAMP = {
  extrapolateLeft: "clamp",
  extrapolateRight: "clamp",
} as const;

const DIRECTION_INDEX: Record<
  NonNullable<MvTransitionMaskRevealProps["direction"]>,
  number
> = { left: 0, right: 1, up: 2, down: 3, forward: 4, backward: 5 };

export const MvTransitionMaskReveal: React.FC<MvTransitionMaskRevealProps> = ({
  from,
  to,
  durationInFrames,
  direction = "down",
  variant = 0.5,
}) => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const rawId = useId();
  const uid = useMemo(() => rawId.replace(/[^a-zA-Z0-9_-]/g, ""), [rawId]);

  // 超短尺なので末尾ちょうど 1.0 に到達させる（1フレームのずれが見える）
  const last = Math.max(1, durationInFrames - 1);
  const p = clamp01(frame / last);

  const seed =
    13 + Math.floor(clamp01(variant) * 997) + DIRECTION_INDEX[direction] * 131;
  const horizontal = direction === "left" || direction === "right";
  const res = height / 1080;

  // ---- フラッシュ: 1フレームで立ち上がり → 三角波でやや長めに減衰 -----------
  const flashOpacity =
    0.9 *
    interpolate(frame, [0, 1], [0.55, 1], CLAMP) *
    interpolate(p, [0.125, 0.48], [1, 0], CLAMP);

  // ---- 嵐: ブラーと揺れが共有する山形包絡線（頂点は後ろ寄り 0.62） ----------
  const storm = interpolate(p, [0.36, 0.62, 0.9], [0, 1, 0], CLAMP);

  // 異方性ブラー（主軸を直交軸の20倍優勢に。最大は画面高の約5.5%）
  const blurMain = height * 0.055 * storm;
  const blurCross = blurMain / 20;
  const stdX = horizontal ? blurMain : blurCross;
  const stdY = horizontal ? blurCross : blurMain;

  // 微振動（嵐が強いときだけ揺れる。最大変位は画面高の1%弱）
  const shakeAmp = height * 0.009 * storm;
  const mainShake = (hash(seed, frame, 41) - 0.5) * 2 * shakeAmp;
  const crossShake = (hash(seed, frame, 42) - 0.5) * 2 * shakeAmp * 0.3;
  const shakeX = horizontal ? mainShake : crossShake;
  const shakeY = horizontal ? crossShake : mainShake;

  // ---- 脱色: p=0.7 までフルB&W → 残り3割で線形に彩度復帰（到着の合図） ------
  const gray = interpolate(p, [0.7, 1], [1, 0], CLAMP);

  // ---- マスク成長: 強い ease-in（前半ゆっくり→後半爆発、末尾は画面外へ） ----
  const maskScale = interpolate(
    p,
    [0, 0.28, 0.5, 0.625, 0.8, 1],
    [0.14, 0.3, 0.55, 2.9, 5.5, 8.5],
    CLAMP
  );

  // ---- 不定形マスクの閉曲線（頂点10個、半径±2〜3割の決定論ジッタ） ----------
  const blobPath = useMemo(() => {
    const N = 10;
    const bx = width / 2;
    const by = height / 2;
    const long = Math.min(width, height) * 0.4;
    const short = long / 2;
    const rx = horizontal ? long : short;
    const ry = horizontal ? short : long;
    const parts: string[] = [];
    for (let i = 0; i < N; i++) {
      const ang = (i / N) * Math.PI * 2;
      const j = 0.75 + 0.55 * hash(seed, i, 7);
      const x = bx + Math.cos(ang) * rx * j;
      const y = by + Math.sin(ang) * ry * j;
      parts.push(`${i === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`);
    }
    return `${parts.join(" ")} Z`;
  }, [width, height, horizontal, seed]);

  // 縁ぼかし: 固定分＋嵐連動分の二段構え。スクリーンpx固定にするため
  // スケール変形の「外側」の g に filter を掛ける（data URI 内はID衝突なし）
  const edgeBlur = (6 + 44 * storm) * res;
  const cx = width / 2;
  const cy = height / 2;
  const maskSvg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" ` +
    `viewBox="0 0 ${width} ${height}">` +
    `<filter id="e" x="-60%" y="-60%" width="220%" height="220%">` +
    `<feGaussianBlur stdDeviation="${edgeBlur.toFixed(1)}"/></filter>` +
    `<g filter="url(#e)">` +
    `<g transform="translate(${cx} ${cy}) scale(${maskScale.toFixed(4)}) ` +
    `translate(${-cx} ${-cy})">` +
    `<path d="${blobPath}" fill="#fff"/></g></g></svg>`;
  const maskUrl = `url("data:image/svg+xml,${encodeURIComponent(maskSvg)}")`;

  // 嵐が事実上ゼロの区間は全画面filterを外してレンダ負荷を抑える
  const stageBlurOn = storm > 0.02;

  return (
    <AbsoluteFill style={{ backgroundColor: "#000", overflow: "hidden" }}>
      {/* 異方性ブラーのフィルタ定義 */}
      <svg width={0} height={0} style={{ position: "absolute" }} aria-hidden>
        <defs>
          <filter
            id={`${uid}-axisblur`}
            x="-20%"
            y="-20%"
            width="140%"
            height="140%"
            colorInterpolationFilters="sRGB"
          >
            <feGaussianBlur
              stdDeviation={`${stdX.toFixed(2)} ${stdY.toFixed(2)}`}
            />
          </filter>
        </defs>
      </svg>

      {/* ステージ: 揺れ＋ブラーを from / マスク済み to に一括で掛ける */}
      <AbsoluteFill
        style={{
          transform: `translate(${shakeX.toFixed(1)}px, ${shakeY.toFixed(1)}px)`,
          filter: stageBlurOn ? `url(#${uid}-axisblur)` : undefined,
        }}
      >
        <AbsoluteFill>{from}</AbsoluteFill>
        <AbsoluteFill
          style={{
            WebkitMaskImage: maskUrl,
            maskImage: maskUrl,
            WebkitMaskRepeat: "no-repeat",
            maskRepeat: "no-repeat",
            WebkitMaskSize: "100% 100%",
            maskSize: "100% 100%",
            filter: gray > 0.01 ? `grayscale(${gray.toFixed(3)})` : undefined,
          }}
        >
          {to}
        </AbsoluteFill>
      </AbsoluteFill>

      {/* 白フラッシュ（screen合成・最大0.9で完全な白ベタを避ける） */}
      <AbsoluteFill
        style={{
          backgroundColor: "#ffffff",
          mixBlendMode: "screen",
          opacity: clamp01(flashOpacity),
          pointerEvents: "none",
        }}
      />
    </AbsoluteFill>
  );
};
