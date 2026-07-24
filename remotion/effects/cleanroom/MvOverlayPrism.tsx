import React, { useId } from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";

/**
 * MvOverlayPrism — RGB分離／ガラス屈折による虹色の色収差ルック（prism家族）。
 * クリーンルーム実装：技法メモとポスターの雰囲気のみを根拠に白紙から作成。
 *
 * 家族の背骨は「三色に分解 → 個別に幾何変形 → screenで再構成」。
 * 映像をR/G/Bの単色成分3枚に分け、各チャンネルにだけ少し違う変形を与えて
 * 黒地の上でscreen合成する。ズレていない領域は元の色に復元され、ズレた分
 * だけ輪郭に虹のフリンジが出る（虹は分解の副産物）。
 *
 * variant(0..1) → 3プリセット:
 *   0.0  SPLIT   常時掛けの水平RGB分離。ズレ量3段のクローンを重ねて尾を引く
 *   0.5  EDGE    中央シャープ・縁だけ収差ボケ。拡縮差によるレンズ的収差
 *   1.0  REFRACT ノイズ変位マップの屈折＋ブルーム。最もドリーミー
 * すべて children を全面描画した上に重ねる。決定論的（乱数不使用）。
 */
export interface MvOverlayPrismProps {
  children: React.ReactNode; // 下の絵。全面に描画して上に質感を重ねる
  durationInFrames: number;
  intensity?: number; // 0..100
  variant?: number; // 0..1 同家族内の見た目分岐（決定論的に）
  tint?: string; // 任意: 基調色の差し替え（空/未指定=デザイン既定）
}

const clamp = (n: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, n));

/**
 * 台形エンベロープ（家族共通の時間フェーズ）。
 * イン側は先頭からの経過秒、アウト側は終端からの残り秒で同じ直線カーブを
 * 読み、両者のminを採る。尺が伸びてもイン・アウトの秒数感覚が保たれる。
 * 折れ線のまま（バウンス・オーバーシュートなし）が家族の性格。
 */
const trapezoid = (
  frame: number,
  fps: number,
  durationInFrames: number,
  inSec: number,
  outSec: number,
): number => {
  const t = frame / fps;
  const tEnd = Math.max(1, durationInFrames) / fps;
  const rise = clamp(t / Math.max(0.01, inSec), 0, 1);
  const fall = clamp((tEnd - t) / Math.max(0.01, outSec), 0, 1);
  return Math.min(rise, fall);
};

/** チャンネル単色化の係数行列（アルファは素通し） */
const R_ONLY = "1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0";
const G_ONLY = "0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0";
const B_ONLY = "0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0";

/**
 * CSSのみのRGB分解＋screen再構成グループ。
 * isolationを効かせた黒地コンテナ内で、映像の上に純色ベタをmultiplyで重ねて
 * 該当チャンネルだけを残す。2枚目以降はscreenで重ねる（単色チャンネル同士の
 * screenは加算と同値なので、ズレのない領域は元の色に完全復元される）。
 * screen合成はこのコンテナ内に閉じ込める（外に漏れると白飛び事故になる）。
 */
const RgbSplit: React.FC<{
  children: React.ReactNode;
  rTransform: string;
  gTransform: string;
  bTransform: string;
}> = ({ children, rTransform, gTransform, bTransform }) => {
  const channels: Array<[string, string, "normal" | "screen"]> = [
    ["#ff0000", rTransform, "normal"],
    ["#00ff00", gTransform, "screen"],
    ["#0000ff", bTransform, "screen"],
  ];
  return (
    <AbsoluteFill style={{ background: "#000", isolation: "isolate" }}>
      {channels.map(([solid, transform, blend], i) => (
        <AbsoluteFill
          key={i}
          style={{ mixBlendMode: blend, isolation: "isolate", transform }}
        >
          <AbsoluteFill>{children}</AbsoluteFill>
          <AbsoluteFill
            style={{ background: solid, mixBlendMode: "multiply" }}
          />
        </AbsoluteFill>
      ))}
    </AbsoluteFill>
  );
};

export const MvOverlayPrism: React.FC<MvOverlayPrismProps> = ({
  children,
  durationInFrames,
  intensity = 60,
  variant = 0,
  tint,
}) => {
  const frame = useCurrentFrame();
  const { width, height, fps } = useVideoConfig();
  const rawId = useId();
  const filterId = `prismRefr${rawId.replace(/[^a-zA-Z0-9]/g, "")}`;

  const v = clamp(variant, 0, 1);
  const preset = Math.round(v * 2); // 0..2
  const k = clamp(intensity, 0, 100) / 100;
  const t = frame / fps;

  // 色被りグラデ（青緑→くすみ→琥珀、上が寒色・下が暖色）。tintで寒色側を差し替え
  const coolCast = tint && tint.length > 0 ? tint : "rgb(96, 176, 186)";
  const warmCast = "rgb(198, 158, 104)";
  const castGradient = `linear-gradient(170deg, ${coolCast} 0%, rgba(120,120,130,0.35) 48%, ${warmCast} 100%)`;

  // 青黒い周辺減光（multiply）。視線を中央に寄せる
  const vignette = (strength: number): React.CSSProperties => ({
    background: `radial-gradient(ellipse 90% 85% at 50% 48%, rgba(255,255,255,1) 52%, rgba(150,158,190,1) 78%, rgba(72,80,118,1) 100%)`,
    mixBlendMode: "multiply",
    opacity: strength,
  });

  // 退色グレード：彩度を半分ほどに落とし、コントラストを1割強持ち上げる
  const fadeGrade = "saturate(0.55) contrast(1.13)";

  let overlay: React.ReactNode = null;

  if (preset === 0) {
    // ── SPLIT: 常時掛けの水平RGB分離（エンベロープなし）──
    // ズレ量 約1/6・約2/3・フル のクローン3枚を不透明度 1・1/2・1/3 で重ねて
    // 等ウェイト平均にし、フリンジを3段グラデで尾引かせる。赤が右・青が左。
    const maxShift = width * 0.025 * k; // intensity=60でおよそ画面幅の1.5%
    const layers: Array<[number, number]> = [
      [1 / 6, 1],
      [2 / 3, 1 / 2],
      [1, 1 / 3],
    ];
    overlay = (
      <>
        {layers.map(([frac, op], i) => {
          const s = maxShift * frac;
          return (
            <AbsoluteFill
              key={i}
              style={{ opacity: op, filter: "saturate(0.8) contrast(1.06)" }}
            >
              <RgbSplit
                rTransform={`translateX(${s.toFixed(2)}px)`}
                gTransform="none"
                bTransform={`translateX(${(-s).toFixed(2)}px)`}
              >
                {children}
              </RgbSplit>
            </AbsoluteFill>
          );
        })}
        <AbsoluteFill
          style={{
            background: castGradient,
            mixBlendMode: "screen",
            opacity: 0.12 * k,
          }}
        />
        <AbsoluteFill style={vignette(0.5 * k)} />
      </>
    );
  } else if (preset === 1) {
    // ── EDGE: 中央シャープ・縁だけ虹収差＋ボケ ──
    // 収差の主成分は平行移動でなく中心基準の拡縮差（赤を数%拡大・青を同率縮小）。
    // 縁ほどズレるレンズ的収差になる。円形マスクで縁限定、台形でクロスフェード。
    const env = trapezoid(frame, fps, durationInFrames, 0.6, 0.6);
    const d = 0.045 * k * env; // 拡縮差（intensity=60で約2.7%）
    const blurPx = width * 0.009 * k * env; // ボケ半径もエンベロープ連動
    const edgeMask =
      "radial-gradient(ellipse 72% 72% at 50% 50%, transparent 0%, transparent 37%, rgba(0,0,0,1) 70%)";
    overlay = (
      <>
        <AbsoluteFill
          style={{
            opacity: env,
            // ぼかす層は事前に少し拡大し、ボケで縁が暗く抜ける問題を画面外へ
            transform: "scale(1.05)",
            filter: `${fadeGrade} blur(${blurPx.toFixed(2)}px)`,
            WebkitMaskImage: edgeMask,
            maskImage: edgeMask,
          }}
        >
          <RgbSplit
            rTransform={`scale(${(1 + d).toFixed(4)})`}
            gTransform="none"
            bTransform={`scale(${(1 - d).toFixed(4)})`}
          >
            {children}
          </RgbSplit>
        </AbsoluteFill>
        <AbsoluteFill
          style={{
            background: castGradient,
            mixBlendMode: "screen",
            opacity: 0.1 * k * env,
          }}
        />
        <AbsoluteFill style={vignette(0.4 * k * env)} />
      </>
    );
  } else {
    // ── REFRACT: ノイズ変位マップの屈折＋ブルーム（家族唯一の屈折個体）──
    // fractalノイズを変位マップにし、R/G/Bで変位スケールを変えて（赤+・青−）
    // 屈折そのものに色収差を織り込む。立ち上がりやや遅め。
    const env = trapezoid(frame, fps, durationInFrames, 0.8, 0.8);

    // 変位量に低振幅（1割強）の二重正弦の明滅。周期の違う正弦2つの積で
    // 機械的な脈動を避ける（「息づき」）
    const breathe = 1 + 0.12 * Math.sin(t * 1.7) * Math.sin(t * 0.63 + 1.2);
    const disp = width * 0.028 * k * env * breathe;
    const scaleR = disp;
    const scaleG = disp * 0.18;
    const scaleB = -disp;

    // ノイズを時間で斜めにゆっくり平行移動 →「ガラス模様が流れる」生き感。
    // 無限に流すと領域外に出るので、ゆったりした有界の漂いにする
    const driftX = width * 0.06 * Math.sin(t * 0.14);
    const driftY = width * 0.04 * Math.sin(t * 0.09 + 2.1);

    // 決定論的なseed（variantの端数から算出。乱数不使用）
    const seed = 7 + Math.floor(v * 97);

    // 低周波・縦をやや細かめ・オクターブ2のfractalノイズ
    const bfx = (5.5 / width).toFixed(6);
    const bfy = (9.5 / width).toFixed(6);

    const baseBlur = width * 0.0022 * k; // ベースにも常時薄いボケ
    const bloomBlur = width * 0.009 * 4 * k * env; // 縁ボケの4倍くらいの半径

    overlay = (
      <>
        <svg width="0" height="0" style={{ position: "absolute" }}>
          <defs>
            <filter
              id={filterId}
              x="-15%"
              y="-15%"
              width="130%"
              height="130%"
              colorInterpolationFilters="sRGB"
            >
              <feTurbulence
                type="fractalNoise"
                baseFrequency={`${bfx} ${bfy}`}
                numOctaves={2}
                seed={seed}
                stitchTiles="stitch"
                x="-40%"
                y="-40%"
                width="180%"
                height="180%"
                result="noise"
              />
              <feOffset
                in="noise"
                dx={driftX.toFixed(2)}
                dy={driftY.toFixed(2)}
                result="flow"
              />
              <feColorMatrix
                in="SourceGraphic"
                type="matrix"
                values={R_ONLY}
                result="chR"
              />
              <feDisplacementMap
                in="chR"
                in2="flow"
                scale={scaleR.toFixed(2)}
                xChannelSelector="R"
                yChannelSelector="G"
                result="dispR"
              />
              <feColorMatrix
                in="SourceGraphic"
                type="matrix"
                values={G_ONLY}
                result="chG"
              />
              <feDisplacementMap
                in="chG"
                in2="flow"
                scale={scaleG.toFixed(2)}
                xChannelSelector="R"
                yChannelSelector="G"
                result="dispG"
              />
              <feColorMatrix
                in="SourceGraphic"
                type="matrix"
                values={B_ONLY}
                result="chB"
              />
              <feDisplacementMap
                in="chB"
                in2="flow"
                scale={scaleB.toFixed(2)}
                xChannelSelector="R"
                yChannelSelector="G"
                result="dispB"
              />
              {/* 黒地の上のscreen再構成（単色チャンネル同士は加算と同値） */}
              <feBlend mode="screen" in="dispR" in2="dispG" result="mixRG" />
              <feBlend mode="screen" in="mixRG" in2="dispB" />
            </filter>
          </defs>
        </svg>
        {/* 屈折＋色収差レイヤー（isolationで閉じ、退色→ベースボケをグループ掛け） */}
        <AbsoluteFill
          style={{
            background: "#000",
            isolation: "isolate",
            opacity: env,
          }}
        >
          <AbsoluteFill
            style={{
              transform: "scale(1.05)",
              filter: `url(#${filterId}) ${fadeGrade} blur(${baseBlur.toFixed(2)}px)`,
            }}
          >
            {children}
          </AbsoluteFill>
        </AbsoluteFill>
        {/* ブルーム：明部を持ち上げて大きくぼかし、screen＋半分程度で重ねる */}
        <AbsoluteFill
          style={{
            transform: "scale(1.06)",
            filter: `brightness(1.35) contrast(1.3) saturate(0.6) blur(${bloomBlur.toFixed(2)}px)`,
            mixBlendMode: "screen",
            opacity: 0.45 * env,
          }}
        >
          {children}
        </AbsoluteFill>
        {/* 色被りグラデ：黒を持ち上げてフィルムの色被りを作る */}
        <AbsoluteFill
          style={{
            background: castGradient,
            mixBlendMode: "screen",
            opacity: 0.22 * env,
          }}
        />
        <AbsoluteFill style={vignette(0.55 * k * env)} />
      </>
    );
  }

  return (
    <AbsoluteFill style={{ pointerEvents: "none", background: "#000" }}>
      {/* 素の映像（envelope=0のときやマスク中央部でそのまま見える保険） */}
      <AbsoluteFill>{children}</AbsoluteFill>
      {overlay}
    </AbsoluteFill>
  );
};
