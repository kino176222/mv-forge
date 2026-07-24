import React, { useId } from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";

/**
 * MvOverlayDreamBlur — 下の映像(children)を柔らかいブラーとグロウで包む
 * ドリーミー系オーバーレイ家族（クリーンルーム実装）。トランジションではなく
 * 単一カットの上に掛ける装飾。素材は破壊せず、同じ映像の加工クローンを重ねる。
 *
 * variant(0..1) → 5プリセット:
 *   0.00 BLUR      全面ぼかしが主役。二段半径の多層ボケ＋グレイン
 *   0.25 DREAMY    元映像は無加工。白い無彩色グロウ2層（ブルーム＋水平ストリーク）
 *   0.50 MILKY     減彩ぼかしクローンのscreen＋ティール系デュオトーン＋乳白リフト
 *   0.75 SOFTFOCUS 退色クリーム＋135°色収差＋縦長ソフトフォーカス＋暖色ヴェール＋周辺減光
 *   1.00 LUMA      明部抽出→十字ストリーク＋ブルーム＋20Hz微振動＋常時グレイン
 *
 * 台形エンベロープ（イン=先頭からの経過秒／アウト=終端からの残り秒、smoothstepで緩急）
 * を env(0..1) 一本にまとめ、全パラメータを一括駆動。env=0 で完全素通し。
 * 完全決定論（Math.random不使用、ハッシュ乱数のみ）。外部素材なし（CSS/SVGで手続き生成）。
 */
export interface MvOverlayDreamBlurProps {
  children: React.ReactNode;
  durationInFrames: number;
  intensity?: number; // 0..100
  variant?: number; // 0..1
  tint?: string; // 基調色の差し替え（未指定=デザイン既定）
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const smooth = (u: number) => {
  const t = clamp(u, 0, 1);
  return t * t * (3 - 2 * t);
};
// 決定論的ハッシュ乱数（レンダ再現性のため Math.random は使わない）
const hash = (n: number) => {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453123;
  return s - Math.floor(s);
};
const hexToRgb01 = (hex: string): [number, number, number] => {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!m) return [0.31, 0.49, 0.48];
  const v = parseInt(m[1], 16);
  return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255];
};

// プリセット別イン/アウト秒（LUMAのみ急峻イン、SOFTFOCUSは最長でゆったり）
const IN_SEC = [1.0, 0.8, 1.2, 1.5, 0.4];
const OUT_SEC = [1.0, 0.9, 1.4, 1.8, 0.9];

export const MvOverlayDreamBlur: React.FC<MvOverlayDreamBlurProps> = ({
  children,
  durationInFrames,
  intensity = 100,
  variant = 0,
  tint,
}) => {
  const frame = useCurrentFrame();
  const { width, fps } = useVideoConfig();
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const dur = Math.max(1, durationInFrames);
  const preset = Math.round(clamp(variant, 0, 1) * 4); // 0..4
  const k = clamp(intensity / 100, 0, 1);
  const rs = width / 1920; // 解像度係数（ぼけ量の解像度非依存）

  // ── 台形エンベロープ：インは経過秒、アウトは残り秒で同じカーブを読み min を取る
  const sec = frame / fps;
  const remain = (dur - 1 - frame) / fps; // 最終フレームで0 → env=0（素通し契約）
  let env = Math.min(smooth(sec / IN_SEC[preset]), smooth(remain / OUT_SEC[preset]));
  if (preset === 4) {
    // LUMAのみ中盤ピーク型
    const prog = clamp(frame / Math.max(1, dur - 1), 0, 1);
    env *= 0.55 + 0.45 * Math.sin(Math.PI * prog);
  }
  const amp = env * k;

  // ── SVGフィルタ id（useIdで衝突回避）
  const duoId = `dbduo-${uid}`;
  const caId = `dbca-${uid}`;
  const softId = `dbsoft-${uid}`;
  const crossId = `dbcross-${uid}`;
  const grainId = `dbgrain-${uid}`;

  // グレイン位相：毎秒24回の分周で決定論的にジャンプ（走るノイズ）
  const grainSeed = Math.floor(sec * 24);

  // デュオトーン色（tintで暗側ティールを差し替え可能）
  const duoDark = hexToRgb01(tint && preset === 2 ? tint : "#4e7d7a");
  const duoLight: [number, number, number] = [0.91, 0.91, 0.9];

  // 色収差オフセット：135°方向へ画面幅の0.2%級（斜め成分に分解）
  const caD = width * 0.002 * 0.707;

  // クローン（素材非破壊：同じ children を加工して重ねる）
  const Clone: React.FC<{ style?: React.CSSProperties }> = ({ style }) => (
    <AbsoluteFill style={style}>{children}</AbsoluteFill>
  );

  const Grain: React.FC<{ opacity: number }> = ({ opacity }) =>
    opacity <= 0.001 ? null : (
      <svg
        width="100%"
        height="100%"
        style={{ position: "absolute", inset: 0, mixBlendMode: "overlay", opacity }}
      >
        <filter id={grainId} x="0%" y="0%" width="100%" height="100%">
          <feTurbulence
            type="fractalNoise"
            baseFrequency={0.9}
            numOctaves={2}
            seed={grainSeed}
            stitchTiles="stitch"
          />
          <feColorMatrix type="saturate" values="0" />
        </filter>
        <rect x="0" y="0" width="100%" height="100%" filter={`url(#${grainId})`} />
      </svg>
    );

  // ── 下敷き（LUMAのみ元映像自体もぼかし、20Hz微振動を全体に掛ける）
  let baseFilter: string | undefined;
  let stackTransform: string | undefined;
  if (preset === 4) {
    baseFilter = amp > 0.001 ? `blur(${5 * rs * amp}px)` : undefined;
    const stepN = Math.floor(sec * 20);
    const A = width * 0.004 * amp;
    const dx = (hash(stepN * 7 + 13) - 0.5) * 2 * A;
    const dy = (hash(stepN * 7 + 57) - 0.5) * 2 * A * 0.7; // 縦は横の7割
    stackTransform = `translate(${dx}px, ${dy}px) scale(1.02)`; // scaleで振動の縁を隠す
  }

  // ── プリセット別レイヤー
  let layers: React.ReactNode = null;
  if (preset === 0) {
    // BLUR：全面ぼかしが主役（最大で画面幅2%級）＋半分弱半径の薄い重ねで多層ボケ
    const r1 = 0.02 * width * amp;
    const r2 = r1 * 0.45;
    layers = (
      <>
        <Clone style={{ transform: "scale(1.07)", filter: `blur(${r1}px)`, opacity: amp }} />
        <Clone style={{ transform: "scale(1.04)", filter: `blur(${r2}px)`, opacity: 0.35 * amp }} />
        <Grain opacity={0.08 * amp} />
      </>
    );
  } else if (preset === 1) {
    // DREAMY：元映像は無加工のまま、白い無彩色グロウ2層をscreenで乗せるだけ
    const rb = 26 * rs;
    layers = (
      <>
        <Clone
          style={{
            transform: "scale(1.06)",
            filter: `grayscale(1) brightness(1.25) contrast(1.5) blur(${rb}px)`,
            mixBlendMode: "screen",
            opacity: 0.58 * amp,
          }}
        />
        {/* 横方向に圧縮→等方blur→伸長のサンドイッチで水平6倍ストリーク */}
        <AbsoluteFill
          style={{ transform: "scaleX(6)", mixBlendMode: "screen", opacity: 0.38 * amp }}
        >
          <AbsoluteFill
            style={{ filter: `grayscale(1) brightness(1.35) contrast(1.8) blur(${8 * rs}px)` }}
          >
            <AbsoluteFill style={{ transform: `scaleX(${1 / 6})` }}>{children}</AbsoluteFill>
          </AbsoluteFill>
        </AbsoluteFill>
      </>
    );
  } else if (preset === 2) {
    // MILKY：デュオトーンLUT3割ミックス＋減彩強ぼかしクローンscreen＋乳白の黒持ち上げ近似
    layers = (
      <>
        <Clone style={{ filter: `url(#${duoId})`, opacity: 0.3 * amp }} />
        <Clone
          style={{
            transform: "scale(1.08)",
            filter: `saturate(0.5) brightness(1.12) blur(${34 * rs}px)`,
            mixBlendMode: "screen",
            opacity: 0.62 * amp,
          }}
        />
        <AbsoluteFill
          style={{ background: "#f6f2ea", mixBlendMode: "screen", opacity: 0.1 * amp }}
        />
      </>
    );
  } else if (preset === 3) {
    // SOFTFOCUS：静的ルック一式を isolation コンテナに入れ、opacity=amp で丸ごとクロスフェード
    const cream = tint || "#f5e6cf";
    layers = (
      <AbsoluteFill style={{ isolation: "isolate", opacity: amp }}>
        <Clone
          style={{
            filter: `sepia(0.28) saturate(0.7) contrast(0.86) brightness(1.06) url(#${caId})`,
          }}
        />
        <Clone
          style={{
            transform: "scale(1.05)",
            filter: `url(#${softId})`,
            mixBlendMode: "screen",
            opacity: 0.45,
          }}
        />
        <AbsoluteFill style={{ background: "#4a2e1c", mixBlendMode: "screen", opacity: 0.1 }} />
        <AbsoluteFill style={{ background: cream, mixBlendMode: "soft-light", opacity: 0.28 }} />
        <AbsoluteFill
          style={{
            background:
              "radial-gradient(ellipse at center, rgba(0,0,0,0) 55%, rgba(20,14,10,0.5) 100%)",
            mixBlendMode: "multiply",
          }}
        />
      </AbsoluteFill>
    );
  } else {
    // LUMA：輝度ブルーム＋明部抽出→十字ストリーク＋常時グレイン
    layers = (
      <>
        <Clone
          style={{
            transform: "scale(1.06)",
            filter: `grayscale(1) brightness(1.35) contrast(2) blur(${24 * rs}px)`,
            mixBlendMode: "screen",
            opacity: 0.5 * amp,
          }}
        />
        <Clone
          style={{
            transform: "scale(1.06)",
            filter: `url(#${crossId})`,
            mixBlendMode: "screen",
            opacity: 0.8 * amp,
          }}
        />
        <Grain opacity={0.06 + 0.08 * amp} />
      </>
    );
  }

  return (
    <AbsoluteFill style={{ pointerEvents: "none", overflow: "hidden" }}>
      {/* 不可視のフィルタ定義 */}
      <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden>
        <defs>
          <filter id={duoId}>
            {/* 輝度→2色補間LUT（くすみティール→ライトグレー） */}
            <feColorMatrix type="saturate" values="0" />
            <feComponentTransfer>
              <feFuncR type="table" tableValues={`${duoDark[0]} ${duoLight[0]}`} />
              <feFuncG type="table" tableValues={`${duoDark[1]} ${duoLight[1]}`} />
              <feFuncB type="table" tableValues={`${duoDark[2]} ${duoLight[2]}`} />
            </feComponentTransfer>
          </filter>
          <filter id={caId} x="-5%" y="-5%" width="110%" height="110%">
            {/* R/G/B分離→RとBを135°方向へ逆向きに微オフセット→screen再結合 */}
            <feColorMatrix
              in="SourceGraphic"
              type="matrix"
              values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0"
              result="cr"
            />
            <feOffset in="cr" dx={-caD} dy={caD} result="cro" />
            <feColorMatrix
              in="SourceGraphic"
              type="matrix"
              values="0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0"
              result="cg"
            />
            <feColorMatrix
              in="SourceGraphic"
              type="matrix"
              values="0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0"
              result="cb"
            />
            <feOffset in="cb" dx={caD} dy={-caD} result="cbo" />
            <feBlend in="cro" in2="cg" mode="screen" result="crg" />
            <feBlend in="crg" in2="cbo" mode="screen" />
          </filter>
          <filter id={softId} x="-10%" y="-15%" width="120%" height="130%">
            {/* 縦2倍の異方性ソフトフォーカス */}
            <feGaussianBlur stdDeviation={`${6 * rs} ${12 * rs}`} />
          </filter>
          <filter id={crossId} x="-30%" y="-30%" width="160%" height="160%">
            {/* 明部抽出（急な傾き＋負の切片）→縦横ストリークをscreenで束ね十字光条 */}
            <feColorMatrix type="saturate" values="0" result="mono" />
            <feComponentTransfer in="mono" result="hi">
              <feFuncR type="linear" slope="3" intercept="-1.6" />
              <feFuncG type="linear" slope="3" intercept="-1.6" />
              <feFuncB type="linear" slope="3" intercept="-1.6" />
            </feComponentTransfer>
            <feGaussianBlur in="hi" stdDeviation={`${50 * rs} ${5 * rs}`} result="hz" />
            <feGaussianBlur in="hi" stdDeviation={`${5 * rs} ${50 * rs}`} result="vt" />
            <feBlend in="hz" in2="vt" mode="screen" />
          </filter>
        </defs>
      </svg>

      <AbsoluteFill style={{ transform: stackTransform }}>
        {/* 下の絵は常に全面描画（オーバーレイの契約） */}
        <AbsoluteFill style={{ filter: baseFilter }}>{children}</AbsoluteFill>
        {layers}
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
