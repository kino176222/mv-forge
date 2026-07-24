import React, { useMemo } from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";

/**
 * MvOverlayPaperFrame — 「破れた紙とヴィンテージ質感」のオーバーレイ家族。
 * クリーンルーム実装（技法メモとポスターの雰囲気のみを根拠に白紙から作成）。
 *
 * variant(0..1) で家族内の2性格に分岐:
 *   variant < 0.5 … 静置型: 元映像を退色グレーディングし、破れた黒枠・紙粒・
 *                    周辺減光・光漏れを台形フェードで重ねる。茶系の水彩シミと
 *                    ブルームだけ約1.5秒遅れて滲み出し、終端まで残る。
 *   variant >= 0.5 … 運動型: クリーム紙地の上に、右辺が下ほど深く食い込む
 *                    破れ縁で切り抜いた映像カードが横スライド+振り子揺れで
 *                    入退場。ビビッド寄りグレード+色収差+埃/毛くず+強ビネット。
 *
 * 作法:
 *  - 尺可変: 6秒基準のカーブを「イン=先頭基準 / アウト=終端基準」で写像。
 *    中間は保持され、尺が伸びても入退場だけ端に張り付く。
 *  - 粒・埃の位相は再生fpsに依存させず、テンプレの24fps刻みの整数チックで更新。
 *  - 完全決定論（Math.random不使用。variant由来のシードとハッシュのみ）。
 *  - 質感はすべて手続き生成（feTurbulence / clip-path / グラデ）。外部素材なし。
 */
export interface MvOverlayPaperFrameProps {
  children: React.ReactNode; // 下の絵。全面に描画して上に質感を重ねる
  durationInFrames: number;
  intensity?: number; // 0..100
  variant?: number; // 0..1 同家族内の見た目分岐（決定論的）
  tint?: string; // 任意: 基調色の差し替え（空/未指定=デザイン既定）
}

const TEMPLATE_FPS = 24;

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

/** 決定論ハッシュ乱数（同じ入力なら常に同じ値） */
const hash01 = (n: number) => {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453123;
  return x - Math.floor(x);
};

const easeOutCubic = (u: number) => 1 - Math.pow(1 - clamp01(u), 3);

/** 粒/紙目タイル: フラクタルノイズを彩度0にし50%グレー中心へ寄せた小タイルSVG */
const makeGrainTile = (seed: number) => {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="240">` +
    `<filter id="g"><feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" seed="${seed}" stitchTiles="stitch"/>` +
    `<feColorMatrix type="saturate" values="0"/>` +
    `<feComponentTransfer>` +
    `<feFuncR type="linear" slope="0.4" intercept="0.3"/>` +
    `<feFuncG type="linear" slope="0.4" intercept="0.3"/>` +
    `<feFuncB type="linear" slope="0.4" intercept="0.3"/>` +
    `<feFuncA type="linear" slope="0" intercept="1"/>` +
    `</feComponentTransfer></filter>` +
    `<rect width="240" height="240" filter="url(#g)"/></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
};

/** 埃・毛くずタイル: 白い小円+曲線ヘアを乱数配置した大きめスプライト */
const makeDustTile = (seed: number) => {
  const S = 480;
  let parts = "";
  for (let i = 0; i < 14; i++) {
    const cx = (hash01(seed + i * 3.7) * S).toFixed(1);
    const cy = (hash01(seed + i * 9.1 + 40) * S).toFixed(1);
    const r = (0.7 + hash01(seed + i * 5.3 + 80) * 2.1).toFixed(2);
    const o = (0.35 + hash01(seed + i * 7.9 + 120) * 0.5).toFixed(2);
    parts += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="#fff" opacity="${o}"/>`;
  }
  for (let i = 0; i < 3; i++) {
    const x = (hash01(seed + i * 11.3 + 200) * S).toFixed(1);
    const y = (hash01(seed + i * 13.7 + 240) * S).toFixed(1);
    const dx = ((hash01(seed + i * 17.1 + 280) - 0.5) * 90).toFixed(1);
    const dy = ((hash01(seed + i * 19.3 + 320) - 0.5) * 90).toFixed(1);
    const mx = ((hash01(seed + i * 23.9 + 360) - 0.5) * 60).toFixed(1);
    const my = ((hash01(seed + i * 29.1 + 400) - 0.5) * 60).toFixed(1);
    parts += `<path d="M ${x} ${y} q ${mx} ${my} ${dx} ${dy}" stroke="#fff" stroke-width="1.3" fill="none" opacity="0.55"/>`;
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${S}" height="${S}">${parts}</svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
};

/** 茶系シミの決定論配置（四隅+上下縁+右中） */
const STAIN_ANCHORS: ReadonlyArray<readonly [number, number]> = [
  [0.06, 0.1],
  [0.93, 0.07],
  [0.05, 0.88],
  [0.94, 0.9],
  [0.5, 0.05],
  [0.42, 0.96],
  [0.9, 0.5],
];

export const MvOverlayPaperFrame: React.FC<MvOverlayPaperFrameProps> = ({
  children,
  durationInFrames,
  intensity = 100,
  variant = 0,
  tint,
}) => {
  const frame = useCurrentFrame();
  const { width, height, fps } = useVideoConfig();
  const dur = Math.max(1, durationInFrames);
  const s = width / 1920;

  // intensity は 0..100 契約。0..1 で渡されても破綻しないよう正規化してクランプ
  const k = clamp01(intensity <= 1 ? intensity : intensity / 100);
  const v = clamp01(variant);
  const isMotion = v >= 0.5; // 前半=静置型 / 後半=運動型
  const seed = Math.floor(v * 997) + 11;

  // イン=先頭基準 / アウト=終端基準の秒（尺可変の作法）
  const tIn = frame / fps;
  const tOut = Math.max(0, (dur - 1 - frame) / fps);
  // 粒・埃の位相はテンプレ24fps刻みの整数チック
  const tick = Math.floor(tIn * TEMPLATE_FPS);

  const grainTile = useMemo(() => makeGrainTile(seed), [seed]);
  const dustTile = useMemo(() => makeDustTile(seed + 500), [seed]);

  // 破れ縁 clip-path（運動型）: 右辺が下ほど深く食い込む。辺ごとにギザ深さ可変
  const tornClip = useMemo(() => {
    const pts: string[] = ["0% 0%"];
    const N = 16;
    for (let i = 0; i <= N; i++) {
      const yy = (i / N) * 100;
      const base = 89 - 13 * (yy / 100); // 下ほど左へ食い込む
      const amp = 1.5 + 4.5 * (yy / 100); // ギザの深さも下ほど大きく
      const jag =
        (i % 2 === 0 ? -1 : 1) *
        (0.35 + 0.65 * hash01(seed * 131 + i * 17.3)) *
        amp;
      pts.push(`${(base + jag).toFixed(2)}% ${yy.toFixed(2)}%`);
    }
    pts.push("0% 100%");
    return `polygon(${pts.join(",")})`;
  }, [seed]);

  const uid = `mvppf-${seed}-${isMotion ? 1 : 0}`;
  const bleedFid = `${uid}-bleed`;
  const frameFid = `${uid}-frame`;
  const redFid = `${uid}-red`;
  const blueFid = `${uid}-blue`;

  const grainTileSize = Math.max(120, Math.round(width * 0.13));
  const grainPos = `${(hash01(tick * 7.7 + seed) * grainTileSize).toFixed(1)}px ${(hash01(tick * 5.1 + seed + 99) * grainTileSize).toFixed(1)}px`;

  // ============================================================
  // 静置型（フェード系）
  // ============================================================
  if (!isMotion) {
    const baseTint = tint && tint.length > 0 ? tint : "#f2e7c7"; // 退色クリーム

    // 台形包絡: 立ち上がり約1秒・消え際約1秒、中間は保持
    const envIn = clamp01(tIn / 1.0);
    const envOut = clamp01(tOut / 1.0);
    const env = Math.min(envIn, envOut);
    const d = env * k;

    // 手ブレ: 周波数の違う正弦2軸+フレームハッシュの微ジッタ（数px）
    const shakeX =
      d *
      s *
      (2.0 * Math.sin(tIn * 1.9) +
        1.3 * Math.sin(tIn * 4.7 + 2.1) +
        (hash01(tick * 7 + seed) - 0.5) * 1.6);
    const shakeY =
      d *
      s *
      (1.7 * Math.sin(tIn * 1.4 + 0.8) +
        1.1 * Math.sin(tIn * 5.3 + 4.0) +
        (hash01(tick * 13 + seed + 50) - 0.5) * 1.6);
    const mediaTransform = `translate(${shakeX.toFixed(2)}px, ${shakeY.toFixed(2)}px) scale(${(1 + 0.05 * d).toFixed(4)})`;

    // シミ・ブルームは約1.5秒遅れて滲み出し、終端まで残る（消え際はアウト包絡）
    const bloomEnv = easeOutCubic((tIn - 1.5) / 1.8) * envOut * k;
    // 滲み変位: 画面幅の1/200程度 × 包絡
    const bleedScale = (width / 200) * env;

    return (
      <AbsoluteFill style={{ isolation: "isolate", backgroundColor: "#050403", pointerEvents: "none" }}>
        {/* SVGフィルタ定義（滲み変位） */}
        {d > 0.004 && (
          <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden="true">
            <defs>
              <filter id={bleedFid} x="-10%" y="-10%" width="120%" height="120%">
                <feTurbulence
                  type="fractalNoise"
                  baseFrequency="0.006 0.01"
                  numOctaves="2"
                  seed={seed + 9}
                  result="n"
                />
                <feDisplacementMap
                  in="SourceGraphic"
                  in2="n"
                  scale={bleedScale}
                  xChannelSelector="R"
                  yChannelSelector="G"
                />
              </filter>
            </defs>
          </svg>
        )}

        {/* 1. 元映像（グレーディング直掛け + 手ブレ + 縁隠しの微ズーム） */}
        <AbsoluteFill
          style={{
            transform: mediaTransform,
            filter:
              d > 0.004
                ? `sepia(${(0.38 * d).toFixed(3)}) saturate(${(1 - 0.32 * d).toFixed(3)}) contrast(${(1 - 0.06 * d).toFixed(3)}) brightness(${(1 - 0.05 * d).toFixed(3)})`
                : undefined,
          }}
        >
          {children}
        </AbsoluteFill>

        {d > 0.004 && (
          <>
            {/* 2. 色調オーバーレイ: 影側に青緑multiply / ハイライト側にクリームsoft-light */}
            <AbsoluteFill style={{ backgroundColor: "#274b46", mixBlendMode: "multiply", opacity: 0.22 * d }} />
            <AbsoluteFill style={{ backgroundColor: baseTint, mixBlendMode: "soft-light", opacity: 0.5 * d }} />

            {/* 茶系の水彩シミ×7（遅れて滲み出し、滲み変位フィルタ越し） */}
            {bloomEnv > 0.004 && (
              <AbsoluteFill style={{ filter: `url(#${bleedFid})` }}>
                {STAIN_ANCHORS.map(([ax, ay], i) => {
                  const grow = easeOutCubic((tIn - 1.5 - i * 0.3) / 2.2) * envOut * k;
                  if (grow <= 0.004) return null;
                  const size = width * (0.12 + 0.1 * hash01(seed + i * 17));
                  return (
                    <div
                      key={i}
                      style={{
                        position: "absolute",
                        left: ax * width - size / 2,
                        top: ay * height - size / 2,
                        width: size,
                        height: size,
                        borderRadius: "50%",
                        background:
                          "radial-gradient(circle, rgba(96,64,28,0.12) 52%, rgba(84,52,20,0.42) 68%, rgba(84,52,20,0) 74%)",
                        mixBlendMode: "multiply",
                        filter: `blur(${(6 * s).toFixed(1)}px)`,
                        opacity: grow,
                        transform: `scale(${(0.6 + 0.4 * grow).toFixed(3)}) rotate(${(hash01(seed + i * 31) * 360).toFixed(0)}deg)`,
                      }}
                    />
                  );
                })}
              </AbsoluteFill>
            )}

            {/* 3. 紙・粒の質感タイル（overlay合成、24fps刻みで位相更新） */}
            <AbsoluteFill
              style={{
                backgroundImage: `url("${grainTile}")`,
                backgroundSize: `${grainTileSize}px ${grainTileSize}px`,
                backgroundPosition: grainPos,
                mixBlendMode: "overlay",
                opacity: 0.5 * d,
              }}
            />

            {/* 4. 破れた紙の縁: 太い矩形ストロークを低周波ノイズで大きく歪ませた黒枠 */}
            <svg
              viewBox="0 0 1920 1080"
              preserveAspectRatio="none"
              style={{ position: "absolute", inset: 0, width: "100%", height: "100%", opacity: d }}
            >
              <defs>
                <filter id={frameFid} x="-20%" y="-20%" width="140%" height="140%">
                  <feTurbulence
                    type="fractalNoise"
                    baseFrequency="0.012 0.02"
                    numOctaves="3"
                    seed={seed + 5}
                    result="n"
                  />
                  <feDisplacementMap in="SourceGraphic" in2="n" scale={65} xChannelSelector="R" yChannelSelector="G" />
                </filter>
              </defs>
              <rect
                x={-30}
                y={-30}
                width={1980}
                height={1140}
                fill="none"
                stroke="#0b0703"
                strokeWidth={150}
                filter={`url(#${frameFid})`}
              />
            </svg>

            {/* 5. 周辺減光（放射グラデをmultiply） */}
            <AbsoluteFill
              style={{
                background: "radial-gradient(ellipse at center, rgba(20,15,8,0) 52%, rgba(20,15,8,0.85) 100%)",
                mixBlendMode: "multiply",
                opacity: 0.75 * d,
              }}
            />

            {/* 6-a. ブルーム: 明部だけ残して大ブラー→screenの白い後光（遅れて滲む） */}
            {bloomEnv > 0.01 && (
              <AbsoluteFill
                style={{
                  transform: mediaTransform,
                  filter: `grayscale(1) brightness(1.05) contrast(2.6) blur(${Math.round(width / 22)}px)`,
                  mixBlendMode: "screen",
                  opacity: 0.4 * bloomEnv,
                }}
              >
                {children}
              </AbsoluteFill>
            )}

            {/* 6-b. 光漏れの珠: 左上でゆっくりドリフト（screen） */}
            <div
              style={{
                position: "absolute",
                left: width * (0.05 + 0.03 * Math.sin(tIn * 0.5)),
                top: height * (0.06 + 0.04 * Math.sin(tIn * 0.33 + 1.2)),
                width: width * 0.34,
                height: width * 0.34,
                borderRadius: "50%",
                background:
                  "radial-gradient(circle, rgba(255,250,235,0.95) 0%, rgba(255,220,170,0.4) 32%, rgba(255,220,170,0) 68%)",
                mixBlendMode: "screen",
                opacity: (0.5 + 0.08 * Math.sin(tIn * 2.1)) * d,
              }}
            />
          </>
        )}
      </AbsoluteFill>
    );
  }

  // ============================================================
  // 運動型
  // ============================================================
  const paperColor = tint && tint.length > 0 ? tint : "#e9e0c9"; // クリーム紙地

  // 装飾（粒・埃・ビネット）の短い台形包絡
  const d2 = Math.min(clamp01(tIn / 0.4), clamp01(tOut / 0.4)) * k;

  // 入退場: 0.35〜0.4秒で画面外→定位置に二段減速（強いease-out）
  const SLIDE_T = 0.38;
  const slideAt = (tt: number) => {
    const p = clamp01(tt / SLIDE_T);
    if (p >= 1) return 0;
    if (p < 0.55) return -1.18 + 1.06 * easeOutCubic(p / 0.55); // 一段目: 画面外→手前まで急減速
    return -0.12 + 0.12 * easeOutCubic((p - 0.55) / 0.45); // 二段目: 残りをそっと収める
  };
  // 振り子: 到着後に±12度から減衰しつつ3〜4往復
  const swingAt = (tt: number) => {
    const tp = tt - SLIDE_T * 0.7;
    if (tp <= 0) return -12; // スライド中は傾けたまま進入
    return -12 * Math.cos(tp * Math.PI * 2 * 2.4) * Math.exp(-tp * 2.4);
  };
  // イン=先頭読み、アウト=終端読みの対称合成（中間は両者ほぼ0で保持）
  const xOff = (slideAt(tIn) + slideAt(tOut)) * k;
  const rot = (swingAt(tIn) + swingAt(tOut)) * k;

  // 埃タイルの背景位置は毎秒5回程度の頻度で飛ばす
  const dustIdx = Math.floor(tIn * 5);
  const dustPos = `${(hash01(dustIdx * 3.1 + seed) * 480).toFixed(1)}px ${(hash01(dustIdx * 4.7 + seed + 30) * 480).toFixed(1)}px`;

  // フィルム傷: たまに現れる細い縦線
  const scratchIdx = Math.floor(tIn * 3);
  const scratchOn = hash01(scratchIdx * 9.3 + seed + 70) > 0.45;
  const scratchX = hash01(scratchIdx * 6.7 + seed + 90) * width;

  // ビビッド寄りグレード（コントラスト・彩度2〜4割増）
  const cardGrade = `contrast(${(1 + 0.28 * k).toFixed(3)}) saturate(${(1 + 0.35 * k).toFixed(3)}) brightness(1.02)`;
  const caShift = 3.2 * s * k; // 色収差のずらし量

  return (
    <AbsoluteFill style={{ isolation: "isolate", backgroundColor: "#0a0906", pointerEvents: "none" }}>
      {/* 色収差用フィルタ定義（赤のみ/青のみ抽出） */}
      {k > 0.05 && (
        <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden="true">
          <defs>
            <filter id={redFid}>
              <feColorMatrix type="matrix" values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0" />
            </filter>
            <filter id={blueFid}>
              <feColorMatrix type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0" />
            </filter>
          </defs>
        </svg>
      )}

      {/* クリーム紙地（薄い陰影 + 紙目） */}
      <AbsoluteFill style={{ backgroundColor: paperColor }} />
      <AbsoluteFill
        style={{
          background: "linear-gradient(115deg, rgba(120,100,60,0.12) 0%, rgba(255,255,255,0.1) 45%, rgba(110,90,55,0.16) 100%)",
        }}
      />
      <AbsoluteFill
        style={{
          backgroundImage: `url("${grainTile}")`,
          backgroundSize: `${grainTileSize}px ${grainTileSize}px`,
          mixBlendMode: "overlay",
          opacity: 0.4 * k,
        }}
      />

      {/* 映像カード: 破れ縁clip-pathで切り抜き、横スライド+振り子揺れで入退場 */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          transform: `translateX(${(xOff * 100).toFixed(3)}%) rotate(${rot.toFixed(3)}deg)`,
          transformOrigin: "35% 30%",
          filter: `drop-shadow(${(6 * s).toFixed(1)}px ${(10 * s).toFixed(1)}px ${(18 * s).toFixed(1)}px rgba(40,30,10,0.45))`,
        }}
      >
        <div style={{ position: "absolute", inset: 0, clipPath: tornClip, overflow: "hidden", backgroundColor: "#141210" }}>
          {/* 本体（ビビッドグレード + 縁隠しの微ズーム） */}
          <AbsoluteFill style={{ filter: cardGrade, transform: "scale(1.03)" }}>{children}</AbsoluteFill>

          {/* 色収差: 赤ゴースト右 / 青ゴースト左に数pxずらしてscreenで半分弱 */}
          {k > 0.05 && (
            <>
              <AbsoluteFill
                style={{
                  filter: `url(#${redFid})`,
                  transform: `translateX(${caShift.toFixed(2)}px) scale(1.03)`,
                  mixBlendMode: "screen",
                  opacity: 0.38 * k,
                }}
              >
                {children}
              </AbsoluteFill>
              <AbsoluteFill
                style={{
                  filter: `url(#${blueFid})`,
                  transform: `translateX(${(-caShift).toFixed(2)}px) scale(1.03)`,
                  mixBlendMode: "screen",
                  opacity: 0.38 * k,
                }}
              >
                {children}
              </AbsoluteFill>
            </>
          )}

          {/* カード内の強めビネット */}
          <AbsoluteFill
            style={{
              background: "radial-gradient(ellipse at center, rgba(15,10,20,0) 45%, rgba(15,10,20,0.8) 100%)",
              mixBlendMode: "multiply",
              opacity: 0.55 * d2,
            }}
          />

          {/* フィルム傷: 細い縦線がたまに走る */}
          {scratchOn && d2 > 0.01 && (
            <div
              style={{
                position: "absolute",
                left: scratchX,
                top: 0,
                width: Math.max(1, 1.5 * s),
                height: "100%",
                background: "rgba(255,255,255,0.5)",
                opacity: 0.16 * d2,
              }}
            />
          )}

          {/* 埃・毛くず（screen、背景位置を毎秒5回飛ばす） */}
          {d2 > 0.01 && (
            <AbsoluteFill
              style={{
                backgroundImage: `url("${dustTile}")`,
                backgroundSize: `${Math.round(480 * s)}px ${Math.round(480 * s)}px`,
                backgroundPosition: dustPos,
                mixBlendMode: "screen",
                opacity: 0.45 * d2,
              }}
            />
          )}

          {/* 粒（カード上にも薄く） */}
          <AbsoluteFill
            style={{
              backgroundImage: `url("${grainTile}")`,
              backgroundSize: `${grainTileSize}px ${grainTileSize}px`,
              backgroundPosition: grainPos,
              mixBlendMode: "overlay",
              opacity: 0.35 * d2,
            }}
          />
        </div>
      </div>
    </AbsoluteFill>
  );
};
