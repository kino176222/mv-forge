import React, { useId, useMemo } from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";

/**
 * MvTransitionStillFrame — 一時停止トランジション（クリーンルーム実装）
 *
 * 機能: 「動画を一瞬ポーズして、再生を再開したら次のカットになっていた」錯覚。
 * 進行: 前クリップが白黒の静止フィルムカードへ勢いよくスナップイン（急ブレーキ）→
 *       凍結保持しながら白フラッシュが直線的に高まる → 頂点で from/to を短い窓で
 *       クロス（フラッシュ＋モノクロに隠れて切替は見えない）→ フラッシュ減衰 →
 *       終端で静止から加速して全画面へ解凍し、素の to で終わる。
 *
 * 設計メモ:
 * - すべての寸法は基準幅 1920 に対する比率で持ち、実解像度へ比例スケール。
 * - 乱数は (seed, frame, k) の決定的ハッシュのみ（Math.random 不使用）。
 *   同フレームは何度レンダしても同じ絵。
 * - フィルタ（白黒化/粒子/傷/ビネット/アイコン/フラッシュ）はすべてカードの
 *   子として持ち、カードと一緒に縮む。フラッシュはカード内に留め黒縁を焼かない。
 * - 入り＝強い ease-out（3次）、出＝静止から加速の ease-in（3次）。対称形だが
 *   曲線の向きを逆にして「ガチッと止まる／再生再開」の緩急を出す。
 * - この家族は非方向性のため direction は受け取るが見た目には使わない。
 */

export interface MvTransitionStillFrameProps {
  /** 出ていく側の絵 */
  from: React.ReactNode;
  /** 入ってくる側の絵 */
  to: React.ReactNode;
  /** トランジション全体の長さ（フレーム） */
  durationInFrames: number;
  /** 方向族のみ有効（この家族は非方向性のため未使用） */
  direction?: "left" | "right" | "up" | "down" | "forward" | "backward";
  /** 0..1 家族内の微差（シード・寸法の揺らぎ、決定論的） */
  variant?: number;
}

const clamp01 = (t: number): number => Math.min(1, Math.max(0, t));

/** 急ブレーキ: 強い ease-out（3次） */
const easeOutCubic = (t: number): number => {
  const x = clamp01(t);
  return 1 - (1 - x) * (1 - x) * (1 - x);
};

/** 再生再開: 静止から加速する ease-in（3次） */
const easeInCubic = (t: number): number => {
  const x = clamp01(t);
  return x * x * x;
};

/** (a,b,c) から 0..1 の決定的な擬似乱数（sin ハッシュ） */
const rand = (a: number, b: number, c: number): number => {
  const s = Math.sin(a * 127.1 + b * 311.7 + c * 74.7) * 43758.5453123;
  return s - Math.floor(s);
};

export const MvTransitionStillFrame: React.FC<MvTransitionStillFrameProps> = ({
  from,
  to,
  durationInFrames,
  variant = 0.5,
}) => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const rawId = useId();
  const uid = useMemo(() => rawId.replace(/[^a-zA-Z0-9_-]/g, ""), [rawId]);

  // ゼロ除算ガード（総フレーム1以下は p=1 に倒れる）
  const last = Math.max(1, durationInFrames - 1);
  const p = clamp01(frame / last);

  const sc = width / 1920; // フルHD横幅基準の解像度倍率
  const minDim = Math.min(width, height);

  // ---- variant → 個体差（決定論的） ----------------------------------------
  const v = clamp01(variant);
  const seed = 17 + Math.floor(v * 883);
  // 凍結時のカードサイズ（6割弱を中心に揺らす）
  const cardScaleMin = 0.55 + v * 0.05; // 0.55..0.60
  // フラッシュ頂点（約5/8を中心に微調整）
  const apex = 0.625 + (v - 0.5) * 0.03;

  // ---- 時間フェーズ ---------------------------------------------------------
  const snapEnd = 0.125; // 序盤約1/8でスナップイン完了
  const releaseStart = 0.875; // 約7/8から解凍開始
  const crossHalf = 0.09; // 頂点±1/10弱のクロス窓

  // カード存在度: 入りは急ブレーキ ease-out、出は静止から加速 ease-in
  let presence: number;
  if (p < snapEnd) {
    presence = easeOutCubic(p / snapEnd);
  } else if (p < releaseStart) {
    presence = 1;
  } else {
    presence = 1 - easeInCubic((p - releaseStart) / (1 - releaseStart));
  }

  // カードスケール: 全画面(1) ↔ 6割弱(cardScaleMin)
  const cardScale = 1 - (1 - cardScaleMin) * presence;

  // ---- 白フラッシュ（三角パルス: 直線上昇 → 頂点 → 1/5 かけて直線減衰） ------
  const flashRiseStart = snapEnd;
  const flashDecayEnd = Math.min(0.99, apex + 0.2);
  let flashEnv = 0;
  if (p > flashRiseStart && p < flashDecayEnd) {
    flashEnv =
      p < apex
        ? (p - flashRiseStart) / (apex - flashRiseStart)
        : 1 - (p - apex) / (flashDecayEnd - apex);
  }
  // 最大でも不透明度7割ほど。完全な白飛びにはしない
  const flashOpacity = clamp01(flashEnv) * (0.66 + v * 0.06);

  // ---- from/to クロスフェード（頂点を挟む狭い窓で線形） ---------------------
  const toOpacity = clamp01((p - (apex - crossHalf)) / (crossHalf * 2));

  // ---- カメラ微振動（0 → 頂点で最大 → 保持終了で 0 の山形） -----------------
  let shakeEnv = 0;
  if (p < apex) {
    shakeEnv = clamp01(p / apex);
  } else if (p < releaseStart) {
    shakeEnv = 1 - clamp01((p - apex) / (releaseStart - apex));
  }
  const shakeAmpPx = 2.6 * (height / 1080) * shakeEnv; // 1080p基準で数px
  const shakeX = (rand(seed, frame, 21) - 0.5) * 2 * shakeAmpPx;
  const shakeY = (rand(seed, frame, 22) - 0.5) * 2 * shakeAmpPx;

  // ---- カードのフィルタ一式（存在度に比例） ---------------------------------
  // 完全モノクロ＋コントラスト2割弱＋明度2割強＋微ブラー（露出過多の古写真）
  const cardFilter = [
    `grayscale(${(presence * 100).toFixed(1)}%)`,
    `contrast(${(1 + 0.18 * presence).toFixed(3)})`,
    `brightness(${(1 + 0.22 * presence).toFixed(3)})`,
    presence > 0.01 ? `blur(${(1.2 * sc * presence).toFixed(2)}px)` : "",
  ]
    .filter(Boolean)
    .join(" ");

  // 角丸: 凍結時に画面幅の2%弱（縮小後の見た目基準）。存在度に比例
  const radiusPx = (0.019 * width * presence) / Math.max(0.4, cardScale);

  // ---- フィルムグレイン（毎フレームシード更新・小さい剰余で周期化） ---------
  const grainSeed = seed + ((frame * 7) % 13);
  const grainOpacity = presence * 0.5;

  // ---- ダスト（1フレームあたり10個弱・毎フレーム再抽選で明滅） --------------
  const dustCount = 9;
  const dust = Array.from({ length: dustCount }, (_, i) => {
    const rx = rand(seed, frame, 100 + i * 4);
    const ry = rand(seed, frame, 101 + i * 4);
    const rr = rand(seed, frame, 102 + i * 4);
    const rk = rand(seed, frame, 103 + i * 4);
    return {
      cx: rx * width,
      cy: ry * height,
      r: (0.002 + rr * 0.005) * minDim, // 画面比 0.2〜0.7%
      fill: rk < 0.5 ? "rgba(0,0,0,0.6)" : "rgba(255,255,255,0.7)",
      i,
    };
  });

  // ---- ヘア（縦傷2本・わずかに揺れる2次ベジェ・毎フレーム乱数） -------------
  const hairs = Array.from({ length: 2 }, (_, i) => {
    const hx = rand(seed + 3, frame, 200 + i * 5) * width;
    const hy0 = rand(seed + 3, frame, 201 + i * 5) * height * 0.15;
    const len = (0.25 + rand(seed + 3, frame, 202 + i * 5) * 0.45) * height;
    const sway = (rand(seed + 3, frame, 203 + i * 5) - 0.5) * 14 * sc;
    const endX = hx + (rand(seed + 3, frame, 204 + i * 5) - 0.5) * 8 * sc;
    return {
      d: `M ${hx.toFixed(1)} ${hy0.toFixed(1)} Q ${(hx + sway).toFixed(1)} ${(
        hy0 +
        len * 0.5
      ).toFixed(1)} ${endX.toFixed(1)} ${(hy0 + len).toFixed(1)}`,
      i,
    };
  });

  // ---- ポーズアイコン寸法 ---------------------------------------------------
  const barW = 0.05 * width;
  const barH = 0.2 * height;
  const barGap = 0.035 * width;
  const iconOpacity = presence * 0.9;

  return (
    <AbsoluteFill style={{ background: "#000", overflow: "hidden" }}>
      {/* グレイン用フィルタ定義（fractalNoise → 彩度ゼロ化） */}
      <svg width={0} height={0} style={{ position: "absolute" }} aria-hidden>
        <defs>
          <filter id={`${uid}-grain`}>
            <feTurbulence
              type="fractalNoise"
              baseFrequency="0.9"
              numOctaves={2}
              seed={grainSeed}
              stitchTiles="stitch"
            />
            <feColorMatrix type="saturate" values="0" />
          </filter>
        </defs>
      </svg>

      {/* カメラ微振動レイヤー（全体を px 単位で平行移動） */}
      <AbsoluteFill
        style={{
          transform: `translate(${shakeX.toFixed(2)}px, ${shakeY.toFixed(2)}px)`,
        }}
      >
        {/* 静止カード本体（縮小・角丸・overflow隠し・フィルタ一式） */}
        <AbsoluteFill
          style={{
            transform: `scale(${cardScale.toFixed(4)})`,
            borderRadius: `${radiusPx.toFixed(1)}px`,
            overflow: "hidden",
            filter: cardFilter || undefined,
          }}
        >
          {/* from クリップ（常時） */}
          <AbsoluteFill>{from}</AbsoluteFill>

          {/* to クリップ（頂点を挟む狭い窓で線形クロス） */}
          <AbsoluteFill style={{ opacity: toOpacity }}>{to}</AbsoluteFill>

          {/* ビネット（中心4割透明 → 縁で黒0.55）＋ inset シャドウ */}
          {presence > 0.01 && (
            <>
              <AbsoluteFill
                style={{
                  background:
                    "radial-gradient(ellipse at center, rgba(0,0,0,0) 0%, rgba(0,0,0,0) 40%, rgba(0,0,0,0.55) 100%)",
                  opacity: presence,
                  pointerEvents: "none",
                }}
              />
              <AbsoluteFill
                style={{
                  boxShadow: `inset 0 0 ${(0.05 * width).toFixed(0)}px rgba(0,0,0,0.45)`,
                  borderRadius: `${radiusPx.toFixed(1)}px`,
                  opacity: presence,
                  pointerEvents: "none",
                }}
              />
            </>
          )}

          {/* フィルムグレイン（overlay 合成・存在度の半分の濃さ） */}
          {grainOpacity > 0.01 && (
            <AbsoluteFill
              style={{
                mixBlendMode: "overlay",
                opacity: grainOpacity,
                pointerEvents: "none",
              }}
            >
              <svg width="100%" height="100%">
                <rect width="100%" height="100%" filter={`url(#${uid}-grain)`} />
              </svg>
            </AbsoluteFill>
          )}

          {/* ダスト＆ヘア（手続き生成SVG・毎フレーム再抽選） */}
          {presence > 0.05 && (
            <AbsoluteFill style={{ opacity: presence, pointerEvents: "none" }}>
              <svg
                width="100%"
                height="100%"
                viewBox={`0 0 ${width} ${height}`}
                preserveAspectRatio="none"
              >
                {dust.map((d) => (
                  <circle
                    key={d.i}
                    cx={d.cx.toFixed(1)}
                    cy={d.cy.toFixed(1)}
                    r={d.r.toFixed(2)}
                    fill={d.fill}
                  />
                ))}
                {hairs.map((h) => (
                  <path
                    key={h.i}
                    d={h.d}
                    fill="none"
                    stroke="rgba(255,255,255,0.35)"
                    strokeWidth={(0.9 * sc).toFixed(2)}
                  />
                ))}
              </svg>
            </AbsoluteFill>
          )}

          {/* 白フラッシュ（screen 合成・カード内に留め黒縁は焼かない） */}
          {flashOpacity > 0.003 && (
            <AbsoluteFill
              style={{
                background: "#ffffff",
                mixBlendMode: "screen",
                opacity: flashOpacity,
                pointerEvents: "none",
              }}
            />
          )}

          {/* ポーズアイコン「II」（暗い縁の芯＋白のにじみ光輪の2層シャドウ） */}
          {iconOpacity > 0.01 && (
            <AbsoluteFill
              style={{
                justifyContent: "center",
                alignItems: "center",
                flexDirection: "row",
                gap: `${barGap.toFixed(1)}px`,
                opacity: iconOpacity,
                pointerEvents: "none",
              }}
            >
              {[0, 1].map((i) => (
                <div
                  key={i}
                  style={{
                    width: barW,
                    height: barH,
                    flexShrink: 0,
                    background: "#ffffff",
                    borderRadius: `${(0.008 * width).toFixed(1)}px`,
                    boxShadow: `0 0 ${(2 * sc).toFixed(1)}px rgba(0,0,0,0.55), 0 0 ${(
                      16 * sc
                    ).toFixed(1)}px rgba(255,255,255,0.75)`,
                  }}
                />
              ))}
            </AbsoluteFill>
          )}
        </AbsoluteFill>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
