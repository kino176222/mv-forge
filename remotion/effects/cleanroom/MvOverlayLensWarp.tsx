import React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from "remotion";

/**
 * MvOverlayLensWarp — 「レンズ越しに視界ごと歪む」lens-warp 家族のオーバーレイ部品。
 * クリーンルーム実装（技法メモとポスターの雰囲気のみを根拠に白紙から作成）。
 *
 * 骨格:
 *   最下層に children を常に素通しで敷き、その上に「効果スタック」を重ねる。
 *   スタック全体は1本のマスター不透明度エンベロープ（台形・直線的な出入り）で
 *   出し入れし、エンベロープ0なら完全に素の映像へ戻る安全設計。
 *   外部アセットは使わず、変位マップ・ノイズ雲・レンズ汚れは全て手続き生成。
 *
 * variant(0..1) → 3プリセット:
 *   0.0 RING BULGE  同心円リングの疑似バルジ。中心は鋭く、縁ほど放射スミアで溶ける。
 *                   全面ブルーム＋定番ビネットの最小構成。
 *   0.5 FISHEYE     変位マップ式の本物の魚眼＋円形の視界（外は黒）＋退色アンバー
 *                   グレード＋ノイズ雲/レンズ汚れ。頭と尻に素の映像が一瞬フラッシュ。
 *   1.0 DIZZY       乱流変位の水中揺れ＋位置/回転ワンダー＋明滅ゴースト＋放射エコー
 *                   ＋脈動ブラーで常時揺れ続ける酩酊系。縁は拡大ぼかし背景で埋める。
 *
 * intensity(0..100) は各エンベロープに乗算して線形にかかり具合を薄める。
 * 完全に決定論的（ハッシュ乱数のみ）。
 */
export interface MvOverlayLensWarpProps {
  children: React.ReactNode; // 下の絵。全面に描画して上に質感を重ねる
  durationInFrames: number;
  intensity?: number; // 0..100
  variant?: number; // 0..1 同家族内の見た目分岐（決定論的に）
  tint?: string; // 任意: 基調色の差し替え（空/未指定=デザイン既定）
}

const CL = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** 決定論的ハッシュ乱数 0..1 */
const hash = (n: number): number => {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453123;
  return s - Math.floor(s);
};

/** 整数ステップのハッシュ乱数を smoothstep 補間した滑らかな -1..1 ワンダー */
const wander = (seed: number, t: number): number => {
  const i = Math.floor(t);
  const f = t - i;
  const a = hash(seed * 57.31 + i) * 2 - 1;
  const b = hash(seed * 57.31 + i + 1) * 2 - 1;
  const s = f * f * (3 - 2 * f);
  return a + (b - a) * s;
};

/** frame=at を頂点とする三角スパイク（幅 w frames、0..1） */
const spike = (frame: number, at: number, w: number): number => {
  const d = Math.abs(frame - at);
  return d >= w ? 0 : 1 - d / w;
};

/**
 * 魚眼用の変位マップ（低解像度グリッドを数式で生成し data URI 化）。
 * 中心からの距離に「線形＋3乗項」を混ぜた放射写像。R=横変位 G=縦変位（128=ゼロ）。
 * フレーム端でクランプ。feGaussianBlur で補間を滑らかにしてから使う。
 */
const FISHEYE_MAP_URI: string = (() => {
  const cols = 48;
  const rows = 27;
  const rects: string[] = [];
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const u = (i + 0.5) / cols - 0.5;
      const v = (j + 0.5) / rows - 0.5;
      const len = Math.sqrt(u * u + v * v) || 1e-6;
      const r = Math.min(1, len / 0.5);
      const m = Math.min(1, 0.35 * r + 0.65 * r * r * r); // 線形＋3乗、端でクランプ
      const nx = u / len;
      const ny = v / len;
      const R = Math.round(clamp(128 + nx * m * 120, 0, 255));
      const G = Math.round(clamp(128 + ny * m * 120, 0, 255));
      rects.push(`<rect x="${i}" y="${j}" width="1" height="1" fill="rgb(${R},${G},128)"/>`);
    }
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${cols}" height="${rows}" shape-rendering="crispEdges">${rects.join("")}</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
})();

/** ノイズ雲タイル（フラクタルノイズ→脱色→ブラー）。screen でごく薄く敷く */
const NOISE_TILE_URI: string = (() => {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="420" height="420">` +
    `<filter id="n" x="0" y="0" width="100%" height="100%">` +
    `<feTurbulence type="fractalNoise" baseFrequency="0.011" numOctaves="3" seed="11" stitchTiles="stitch"/>` +
    `<feColorMatrix type="saturate" values="0"/>` +
    `<feGaussianBlur stdDeviation="1.6"/>` +
    `</filter>` +
    `<rect width="420" height="420" filter="url(%23n)"/>` +
    `</svg>`;
  // rect の filter 参照 (#n) は先に %23 でエンコード済みなので二重エンコードを避けて手組みする
  return `data:image/svg+xml;charset=utf-8,${svg
    .replace(/</g, "%3C")
    .replace(/>/g, "%3E")
    .replace(/"/g, "%22")
    .replace(/ /g, "%20")}`;
})();

/** レンズ汚れ: ハッシュ乱数で位置・半径・濃度を決めた暖白ボケ玉 */
const DIRT = Array.from({ length: 14 }, (_, i) => ({
  x: hash(i * 3.7 + 1.3) * 100,
  y: hash(i * 5.1 + 2.7) * 100,
  r: 18 + hash(i * 7.3 + 3.1) * 80, // 1920px 幅基準の半径
  o: 0.35 + hash(i * 9.7 + 4.9) * 0.65,
}));

/** 疑似バルジの同心円リング（外側ほど拡大とブラーが強い） */
const RINGS = [
  { s: 0.1, b: 5, from: 30, to: 56 },
  { s: 0.26, b: 12, from: 44, to: 70 },
  { s: 0.5, b: 22, from: 57, to: 84 },
];

export const MvOverlayLensWarp: React.FC<MvOverlayLensWarpProps> = ({
  children,
  durationInFrames,
  intensity = 100,
  variant = 0,
  tint,
}) => {
  const frame = useCurrentFrame();
  const { width, height, fps } = useVideoConfig();
  const rawId = React.useId();
  const uid = `lw${rawId.replace(/[^a-zA-Z0-9]/g, "")}`;

  const preset = Math.round(clamp(variant, 0, 1) * 2); // 0=RING 1=FISHEYE 2=DIZZY
  const k = clamp(intensity, 0, 100) / 100;
  const dur = Math.max(4, durationInFrames);
  const t = frame / fps;
  const u = width / 1920; // 解像度スケール（px 値の基準）

  // ---- 台形エンベロープ（直線的な立ち上がり→ホールド→直線的な抜き） ----
  // インは先頭基準、アウトは終端からの相対で読み、min を取る（尺可変対応）
  const inF = Math.max(2, Math.round(fps * (preset === 2 ? 0.5 : 0.4)));
  const outF = Math.max(2, Math.round(fps * 0.4));
  const outStart = Math.max(inF + 1, dur - outF);
  const rise = interpolate(frame, [0, inF], [0, 1], CL);
  const fall = interpolate(frame, [outStart, Math.max(outStart + 1, dur - 1)], [1, 0], CL);
  const env = Math.min(rise, fall) * k; // intensity を乗算

  // 入り際・抜け際のバースト（色収差・彩度が 0.25 秒だけ尖って戻る）
  const burst = spike(frame, inF, fps * 0.25) + spike(frame, outStart, fps * 0.25);

  // 色収差のずれ幅（画面幅の 1% 以下のごく小さい値、バーストで尖る）
  const abBase = preset === 1 ? 0.008 : preset === 2 ? 0.005 : 0.006;
  const ab = width * abBase * env * (1 + 2.2 * burst * k);

  // FISHEYE 用: 変位量エンベロープと、頭/尻の素材フラッシュ（一瞬素の映像に戻る）
  const dispScale = width * 0.14 * env;
  const dip =
    preset === 1
      ? 1 -
        0.9 *
          Math.max(
            spike(frame, inF + Math.round(fps * 0.18), 3),
            spike(frame, outStart - Math.round(fps * 0.18), 3),
          )
      : 1;
  const stackOpacity = env * dip;

  // DIZZY 用: 乱流変位のパラメータ（波長は画面幅の 1/6、種はゆっくり漂う）
  const turbBF = (6 / width) * (1 + 0.15 * wander(71, t * 0.4));
  const turbScale = width * 0.02 * env * (0.7 + 0.3 * wander(67, t * 0.7));

  const wash = tint && tint.length > 0 ? tint : "#e6b168"; // 退色アンバーの既定色

  let stack: React.ReactNode = null;

  if (preset === 0) {
    // ---- RING BULGE: 中心わずか拡大＋同心円リング3枚の放射スミア ----
    const centerT = `scale(${1 + 0.035 * env})`;
    stack = (
      <>
        <AbsoluteFill style={{ transform: centerT }}>{children}</AbsoluteFill>
        {RINGS.map((rg, i) => {
          const mask = `radial-gradient(circle at 50% 50%, rgba(0,0,0,0) ${rg.from}%, #000 ${rg.to}%)`;
          return (
            <AbsoluteFill
              key={i}
              style={{
                transform: `scale(${1 + rg.s * env})`,
                filter: `blur(${rg.b * u * (0.3 + 0.7 * env)}px)`,
                WebkitMaskImage: mask,
                maskImage: mask,
              }}
            >
              {children}
            </AbsoluteFill>
          );
        })}
        {/* 色収差: R と G/B を逆方向にずらして screen 再合成 */}
        <AbsoluteFill
          style={{
            transform: `translateX(${ab}px) ${centerT}`,
            filter: `url(#${uid}-red)`,
            mixBlendMode: "screen",
            opacity: 0.55 * env,
          }}
        >
          {children}
        </AbsoluteFill>
        <AbsoluteFill
          style={{
            transform: `translateX(${-ab}px) ${centerT}`,
            filter: `url(#${uid}-gb)`,
            mixBlendMode: "screen",
            opacity: 0.55 * env,
          }}
        >
          {children}
        </AbsoluteFill>
        {/* 全面ブルーム */}
        <AbsoluteFill
          style={{
            transform: "scale(1.04)",
            filter: `blur(${52 * u}px) saturate(${1.3 + 0.3 * burst * k})`,
            mixBlendMode: "screen",
            opacity: 0.38 * env,
          }}
        >
          {children}
        </AbsoluteFill>
        {tint ? (
          <AbsoluteFill style={{ background: tint, mixBlendMode: "soft-light", opacity: 0.3 * env }} />
        ) : null}
        {/* 定番ビネット */}
        <AbsoluteFill
          style={{
            background: "radial-gradient(ellipse at 50% 50%, rgba(0,0,0,0) 52%, rgba(0,0,0,0.6) 100%)",
          }}
        />
      </>
    );
  } else if (preset === 1) {
    // ---- FISHEYE: 変位マップ式の本物の魚眼＋円形の視界＋退色アンバーグレード ----
    const circleMask = `radial-gradient(circle at 50% 50%, #000 ${38 + 2 * wander(5, t * 0.5)}%, rgba(0,0,0,0) 66%)`;
    // ニュートラルからエンベロープで補間するグレード（途中経過も破綻しない）
    const grade =
      `url(#${uid}-fish) ` +
      `saturate(${1 - 0.62 * env}) contrast(${1 + 0.16 * env}) ` +
      `sepia(${0.42 * env}) hue-rotate(${-8 * env}deg) saturate(${1 + 0.3 * burst * k})`;
    stack = (
      <>
        {/* 円形イメージサークルの外は完全な黒 */}
        <AbsoluteFill style={{ background: "#000" }} />
        <AbsoluteFill
          style={{
            transform: "scale(1.06)", // 縁割れ対策のオーバースキャン
            filter: grade,
            WebkitMaskImage: circleMask,
            maskImage: circleMask,
          }}
        >
          <AbsoluteFill>{children}</AbsoluteFill>
          <AbsoluteFill
            style={{
              transform: `translateX(${ab}px)`,
              filter: `url(#${uid}-red)`,
              mixBlendMode: "screen",
              opacity: 0.6 * env,
            }}
          >
            {children}
          </AbsoluteFill>
          <AbsoluteFill
            style={{
              transform: `translateX(${-ab}px)`,
              filter: `url(#${uid}-gb)`,
              mixBlendMode: "screen",
              opacity: 0.6 * env,
            }}
          >
            {children}
          </AbsoluteFill>
        </AbsoluteFill>
        {/* 円内ブルーム */}
        <AbsoluteFill
          style={{
            filter: `blur(${46 * u}px) saturate(1.2)`,
            mixBlendMode: "screen",
            opacity: 0.3 * env,
            WebkitMaskImage: circleMask,
            maskImage: circleMask,
          }}
        >
          {children}
        </AbsoluteFill>
        {/* 純黄系の単色をソフトライトで薄く被せる色ワッシュ */}
        <AbsoluteFill style={{ background: wash, mixBlendMode: "soft-light", opacity: 0.5 * env }} />
        {/* ノイズ雲（screen ごく薄く） */}
        <AbsoluteFill
          style={{
            backgroundImage: `url("${NOISE_TILE_URI}")`,
            backgroundSize: `${420 * u}px ${420 * u}px`,
            mixBlendMode: "screen",
            opacity: 0.1 * env,
          }}
        />
        {/* レンズ汚れ（暖白ボケ玉、控えめ） */}
        <AbsoluteFill style={{ mixBlendMode: "screen", opacity: 0.13 * env }}>
          {DIRT.map((d, i) => (
            <div
              key={i}
              style={{
                position: "absolute",
                left: `${d.x}%`,
                top: `${d.y}%`,
                width: d.r * 2 * u,
                height: d.r * 2 * u,
                marginLeft: -d.r * u,
                marginTop: -d.r * u,
                borderRadius: "50%",
                background: `radial-gradient(circle, rgba(255,242,214,${0.8 * d.o}) 0%, rgba(255,242,214,${0.25 * d.o}) 45%, rgba(255,242,214,0) 70%)`,
              }}
            />
          ))}
        </AbsoluteFill>
        {/* 周辺減光（強め） */}
        <AbsoluteFill
          style={{
            background:
              "radial-gradient(circle at 50% 50%, rgba(0,0,0,0) 30%, rgba(0,0,0,0.55) 62%, rgba(0,0,0,0.92) 95%)",
          }}
        />
      </>
    );
  } else {
    // ---- DIZZY: 乱流変位＋ドリフト/回転ワンダー＋ゴースト＋放射エコーの酩酊系 ----
    const wobX = wander(11, t * 0.5) * width * 0.04 * env; // 位置ドリフト 0.5Hz
    const wobY = wander(23, t * 0.5) * height * 0.03 * env;
    const rot = wander(37, t) * 2 * env; // 回転 ±2度 1Hz
    const blurPulse = (0.5 + 0.5 * wander(53, t * 0.8)) * 5 * u * env; // 脈動ブラー
    const bodyT = `translate(${wobX}px, ${wobY}px) rotate(${rot}deg) scale(1.12)`;
    stack = (
      <>
        {/* 縁埋め: 背面に拡大した強ブラーコピー */}
        <AbsoluteFill style={{ transform: "scale(1.4)", filter: `blur(${30 * u}px)` }}>
          {children}
        </AbsoluteFill>
        {/* 本体: 乱流変位＋ワンダー */}
        <AbsoluteFill style={{ transform: bodyT, filter: `url(#${uid}-turb) blur(${blurPulse}px)` }}>
          <AbsoluteFill>{children}</AbsoluteFill>
          <AbsoluteFill
            style={{
              transform: `translateX(${ab}px)`,
              filter: `url(#${uid}-red)`,
              mixBlendMode: "screen",
              opacity: 0.5 * env,
            }}
          >
            {children}
          </AbsoluteFill>
          <AbsoluteFill
            style={{
              transform: `translateX(${-ab}px)`,
              filter: `url(#${uid}-gb)`,
              mixBlendMode: "screen",
              opacity: 0.5 * env,
            }}
          >
            {children}
          </AbsoluteFill>
        </AbsoluteFill>
        {/* 明滅ゴースト3枚（濃度をワンダーで揺らす） */}
        {[0, 1, 2].map((i) => {
          const gx = wander(101 + i * 17, t * 0.7) * width * 0.02;
          const gy = wander(131 + i * 19, t * 0.7) * height * 0.015;
          const go = (0.06 + 0.1 * (0.5 + 0.5 * wander(151 + i * 23, t * 1.3))) * env;
          return (
            <AbsoluteFill
              key={`g${i}`}
              style={{
                transform: `translate(${gx}px, ${gy}px) scale(1.12)`,
                filter: `blur(${3 * u}px)`,
                mixBlendMode: "screen",
                opacity: go,
              }}
            >
              {children}
            </AbsoluteFill>
          );
        })}
        {/* 放射エコー3枚（外側ほど薄く・ぼける） */}
        {[0, 1, 2].map((i) => (
          <AbsoluteFill
            key={`e${i}`}
            style={{
              transform: `scale(${1.16 + i * 0.07})`,
              filter: `blur(${(6 + i * 5) * u}px)`,
              mixBlendMode: "screen",
              opacity: (0.13 - i * 0.035) * env,
            }}
          >
            {children}
          </AbsoluteFill>
        ))}
        {tint ? (
          <AbsoluteFill style={{ background: tint, mixBlendMode: "soft-light", opacity: 0.25 * env }} />
        ) : null}
        {/* 軽めのビネット */}
        <AbsoluteFill
          style={{
            background: "radial-gradient(ellipse at 50% 50%, rgba(0,0,0,0) 55%, rgba(0,0,0,0.5) 100%)",
          }}
        />
      </>
    );
  }

  return (
    <AbsoluteFill style={{ pointerEvents: "none", overflow: "hidden" }}>
      {/* 最下層: 素通しの元映像（オーバーレイの契約） */}
      <AbsoluteFill>{children}</AbsoluteFill>
      {/* 効果スタック: マスター不透明度エンベロープで一括出し入れ */}
      <AbsoluteFill style={{ opacity: stackOpacity }}>{stack}</AbsoluteFill>
      {/* SVG フィルタ定義（色収差の行列分離・魚眼変位・乱流変位） */}
      <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden>
        <defs>
          <filter id={`${uid}-red`} x="-5%" y="-5%" width="110%" height="110%">
            <feColorMatrix
              type="matrix"
              values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0"
            />
          </filter>
          <filter id={`${uid}-gb`} x="-5%" y="-5%" width="110%" height="110%">
            <feColorMatrix
              type="matrix"
              values="0 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 1 0"
            />
            {/* G/B 側にだけ微ブラーで「にじみ」 */}
            <feGaussianBlur stdDeviation={1.4 * u} />
          </filter>
          {preset === 1 ? (
            <filter
              id={`${uid}-fish`}
              filterUnits="userSpaceOnUse"
              x={-width * 0.06}
              y={-height * 0.06}
              width={width * 1.12}
              height={height * 1.12}
            >
              <feImage
                href={FISHEYE_MAP_URI}
                x={0}
                y={0}
                width={width}
                height={height}
                preserveAspectRatio="none"
                result="map"
              />
              <feGaussianBlur in="map" stdDeviation={width * 0.02} result="mapBlur" />
              <feDisplacementMap
                in="SourceGraphic"
                in2="mapBlur"
                scale={dispScale}
                xChannelSelector="R"
                yChannelSelector="G"
              />
            </filter>
          ) : null}
          {preset === 2 ? (
            <filter id={`${uid}-turb`} x="-10%" y="-10%" width="120%" height="120%">
              <feTurbulence
                type="fractalNoise"
                baseFrequency={turbBF}
                numOctaves={2}
                seed={7}
                result="noise"
              />
              <feDisplacementMap
                in="SourceGraphic"
                in2="noise"
                scale={turbScale}
                xChannelSelector="R"
                yChannelSelector="G"
              />
            </filter>
          ) : null}
        </defs>
      </svg>
    </AbsoluteFill>
  );
};
