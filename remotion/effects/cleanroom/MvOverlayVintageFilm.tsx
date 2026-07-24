import React, { useMemo } from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";

/**
 * MvOverlayVintageFilm — ヴィンテージフィルム調オーバーレイ家族（クリーンルーム実装）
 *
 * 下の映像(children)を全面に描画したまま、退色・暖色フェード・ハレーション・
 * グレイン・周辺減光などの「フィルムの質感」を上に積むラッパー。
 * 技法メモ（観察記録）のみを根拠に白紙から実装。
 *
 * 構造:
 *  - 生のchildrenを常に最下層に敷き、その上に「ルック一式」を1つの
 *    isolateグループとして重ね、グループ全体の不透明度でクロスフェードする。
 *    → intensity 0 / エンベロープ端では素の映像へ厳密に復元される。
 *  - 時間エンベロープは台形（入り約1秒・抜け約1秒。長尺プリセットは1.5秒）。
 *    入りは先頭からの経過、抜けは終端からの残りで読み、minを取るので任意尺で破綻しない。
 *    直線ではなくsmoothstepで緩急をつける。
 *  - 色収差はSVGカラー行列でR/G/B各1チャンネルの3クローンを作り、
 *    1枚を底に残り2枚をscreen合成（ずれ0で厳密復元）。ずれ幅はエンベロープ×強度に追従。
 *  - グレインはSVG乱流ノイズをdata URIタイル化し、50%グレー中心に整えてoverlay合成。
 *    ちらつきは24fps刻みtickをハッシュ乱数に食わせて背景位置を飛ばす（fps非依存・決定論的）。
 *  - ハレーションはchildrenの「明部だけ残して大きくぼかした」コピーをscreenで重ね、
 *    縁が見えないようわずかに拡大する。
 *  - px系の量はすべてフルHD幅(1920)比でスケール。Math.random不使用。
 *
 * variant(0..1) → 5プリセット:
 *   0.00 LONG DUST    長尺向け。斜め45度の色収差＋毎フレーム位置が変わる塵・毛＋固定レンズ汚れ。
 *                     黒浮きはリフトのフィルタ分解方式。
 *   0.25 WARM CLASSIC 家族標準の暖色版。大径ハレーション＋縦の暖色ウォッシュ(soft-light)
 *                     ＋画面端の温色光漏れ(screen放射グラデ)。
 *   0.50 DUOTONE      グレースケール基調のデュオトーン。漂流する色場ブロブ＋微回転する暖色
 *                     フラッシュ＋左端マロンのビネット。グレインは約2倍濃く、わずかに色付き。
 *   0.75 SOFT BLOOM   ソフトフォーカス強め＋ブルーム2段構え（広い柔＋締まったエッジ）。
 *                     黒浮きは暗い暖色ソリッドのscreen加算。
 *   1.00 VIOLET ECHO  紫系の異色版。右へ開く水平残像クローン＋ポスタライズ＋オフセンター
 *                     ゴッドレイ＋微細手ブレ＋カラー粒子。
 */
export interface MvOverlayVintageFilmProps {
  children: React.ReactNode; // 下の絵。全面に描画して上に質感を重ねる
  durationInFrames: number;
  intensity?: number; // 0..100
  variant?: number; // 0..1 同家族内の見た目分岐（決定論的に）
  tint?: string; // 任意: 基調色の差し替え（空/未指定=デザイン既定）
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
const smooth = (t: number) => {
  const c = clamp01(t);
  return c * c * (3 - 2 * c);
};
const frac = (x: number) => x - Math.floor(x);
// シード付き決定論ハッシュ（Math.random禁止のため）
const hash01 = (n: number, seed: number) =>
  frac(Math.sin(n * 12.9898 + seed * 78.233) * 43758.5453);

const hexToRgb = (hex: string): [number, number, number] | null => {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const v = parseInt(m[1], 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
};

// 50%グレー中心のグレースケール（微色）乱流ノイズタイルを手続き生成
const makeGrainTile = (seed: number, colorKeep: number): string => {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256">` +
    `<filter id="n" x="0" y="0" width="100%" height="100%">` +
    `<feTurbulence type="fractalNoise" baseFrequency="0.82" numOctaves="2" seed="${seed}" stitchTiles="stitch"/>` +
    `<feColorMatrix type="saturate" values="${colorKeep}"/>` +
    `<feComponentTransfer>` +
    `<feFuncR type="linear" slope="0.6" intercept="0.2"/>` +
    `<feFuncG type="linear" slope="0.6" intercept="0.2"/>` +
    `<feFuncB type="linear" slope="0.6" intercept="0.2"/>` +
    `<feFuncA type="linear" slope="0" intercept="1"/>` +
    `</feComponentTransfer></filter>` +
    `<rect width="256" height="256" filter="url(#n)"/></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
};

// プリセット既定の基調色（発光・被り用。tintで差し替え可能）
const ACCENTS: [number, number, number][] = [
  [255, 178, 122], // LONG DUST: 柔らかい橙
  [255, 154, 85], // WARM CLASSIC: 濃いめの橙
  [180, 135, 224], // DUOTONE: 紫がかったピンク
  [255, 192, 138], // SOFT BLOOM: 淡い暖白
  [166, 120, 255], // VIOLET ECHO: 紫
];

export const MvOverlayVintageFilm: React.FC<MvOverlayVintageFilmProps> = ({
  children,
  durationInFrames,
  intensity = 70,
  variant = 0,
  tint,
}) => {
  const frame = useCurrentFrame();
  const { width, fps } = useVideoConfig();

  const preset = Math.round(clamp01(variant) * 4); // 0..4
  const dur = Math.max(1, durationInFrames);
  const k = clamp01((intensity ?? 70) / 100);
  const s = width / 1920; // フルHD幅基準スケール
  const t = frame / fps; // 経過秒
  const seed = 7 + Math.round(clamp01(variant) * 96);
  const ph = (i: number) => hash01(i * 17.3 + 5, seed) * Math.PI * 2;
  const uid = `cr-vint-${preset}`;

  // ---- 台形エンベロープ（入り=先頭経過 / 抜け=終端残り の min、smoothstepで緩急）----
  const rampSec = preset === 0 ? 1.5 : 1.0;
  const ramp = Math.max(1, Math.min(Math.round(rampSec * fps), Math.floor(dur / 2)));
  const env = smooth(Math.min(clamp01(frame / ramp), clamp01((dur - 1 - frame) / ramp)));
  const lookOpacity = env * k;

  // ---- グレイン（24fps刻みtickで位置飛ばし・決定論的）----
  const grainUri = useMemo(
    () => makeGrainTile(11 + preset * 7, preset === 2 ? 0.35 : 0),
    [preset]
  );
  const tile = Math.max(64, Math.round(256 * s));
  const grainTick = Math.floor(t * 24);
  const gx = Math.round(hash01(grainTick + 3, seed) * tile);
  const gy = Math.round(hash01(grainTick + 101, seed) * tile);

  // ---- 基調色 ----
  const accent = (tint ? hexToRgb(tint) : null) ?? ACCENTS[preset];
  const acc = (a: number) => `rgba(${accent[0]},${accent[1]},${accent[2]},${a})`;
  const accDark = (a: number, m = 0.32) =>
    `rgba(${Math.round(accent[0] * m)},${Math.round(accent[1] * m * 0.7)},${Math.round(
      accent[2] * m * 0.5
    )},${a})`;

  // 発光の呼吸（低周波サイン・位相はシードから）
  const breath = 0.85 + 0.15 * Math.sin(t * 0.7 + ph(3));

  // ---- 共通レイヤー部品 ----
  const grainLayer = (opacity: number) => (
    <AbsoluteFill
      style={{
        backgroundImage: `url("${grainUri}")`,
        backgroundRepeat: "repeat",
        backgroundSize: `${tile}px ${tile}px`,
        backgroundPosition: `${gx}px ${gy}px`,
        mixBlendMode: "overlay",
        opacity,
      }}
    />
  );

  const solid = (
    backgroundStr: string,
    blend: React.CSSProperties["mixBlendMode"],
    opacity = 1,
    extra?: React.CSSProperties
  ) => (
    <AbsoluteFill
      style={{ background: backgroundStr, mixBlendMode: blend, opacity, ...extra }}
    />
  );

  // ハレーション: 明部だけ残して大きくぼかしたコピーをscreenで。縁隠しに拡大
  const halation = (blurPx: number, opacity: number, scaleAmt = 1.06) => (
    <AbsoluteFill
      style={{
        transform: `scale(${scaleAmt})`,
        filter: `brightness(1.45) contrast(2.8) saturate(1.15) blur(${blurPx}px)`,
        mixBlendMode: "screen",
        opacity,
      }}
    >
      {children}
    </AbsoluteFill>
  );

  // グレード済み本体。split時はR/G/B抽出3クローン（G底＋R/B screen）で色収差を再構成
  const footage = (grade: string, split: boolean, dxPx: number, dyPx: number) =>
    split ? (
      <>
        <AbsoluteFill style={{ filter: `${grade} url(#${uid}-g)` }}>{children}</AbsoluteFill>
        <AbsoluteFill
          style={{
            filter: `${grade} url(#${uid}-r)`,
            transform: `translate(${dxPx}px, ${dyPx}px)`,
            mixBlendMode: "screen",
          }}
        >
          {children}
        </AbsoluteFill>
        <AbsoluteFill
          style={{
            filter: `${grade} url(#${uid}-b)`,
            transform: `translate(${-dxPx}px, ${-dyPx}px)`,
            mixBlendMode: "screen",
          }}
        >
          {children}
        </AbsoluteFill>
      </>
    ) : (
      <AbsoluteFill style={{ filter: grade }}>{children}</AbsoluteFill>
    );

  const vignette = (color: string) =>
    solid(`radial-gradient(ellipse at 50% 50%, rgba(0,0,0,0) 52%, ${color} 100%)`, "multiply");

  // ---- プリセット別のルック ----
  let look: React.ReactNode = null;

  if (preset === 0) {
    // LONG DUST — 斜め45度の色収差＋塵・毛＋固定レンズ汚れ。黒浮きはリフトのフィルタ分解
    const shift = 2.2 * s * env * k;
    const d = shift * 0.7; // 斜め45度
    const driftX = 0.5 + 0.5 * Math.sin(t * 0.3 + ph(1));
    const dustTick = Math.floor(t * 12);
    const dust = Array.from({ length: 7 }, (_, i) => {
      const hx = hash01(dustTick * 13.1 + i * 7.7, seed);
      const hy = hash01(dustTick * 9.7 + i * 3.3 + 41, seed);
      const hs = hash01(dustTick * 5.3 + i * 11.9 + 83, seed);
      const isHair = hs > 0.78;
      const w = isHair ? 1.3 * s : (1.6 + 2.6 * hs) * s;
      const h = isHair ? (14 + 24 * hx) * s : w;
      return (
        <div
          key={i}
          style={{
            position: "absolute",
            left: `${4 + hx * 92}%`,
            top: `${4 + hy * 92}%`,
            width: w,
            height: h,
            borderRadius: isHair ? w : "50%",
            background: "rgba(238,232,222,0.8)",
            opacity: 0.2 + 0.35 * hy,
            transform: isHair ? `rotate(${hx * 180}deg)` : undefined,
            filter: `blur(${0.6 * s}px)`,
          }}
        />
      );
    });
    const smudges = [0, 1, 2].map((i) => (
      <div
        key={`sm${i}`}
        style={{
          position: "absolute",
          left: `${14 + 68 * hash01(i * 31 + 911, seed)}%`,
          top: `${12 + 66 * hash01(i * 57 + 417, seed)}%`,
          width: 90 * s,
          height: 62 * s,
          borderRadius: "50%",
          background: "radial-gradient(closest-side, rgba(212,202,186,0.10), rgba(0,0,0,0))",
          filter: `blur(${8 * s}px)`,
        }}
      />
    ));
    look = (
      <>
        {footage(
          // 黒浮き: 出力=入力×(1−lift)+lift をコントラスト＋明度の2フィルタに分解して近似
          "sepia(0.22) hue-rotate(-6deg) saturate(1.08) contrast(0.92) brightness(1.06)",
          shift > 0.35,
          d,
          d
        )}
        {halation(width * 0.025, 0.3 * breath, 1.05)}
        {solid(
          `radial-gradient(circle at ${100 - 3 * driftX}% 8%, ${acc(0.24)}, rgba(0,0,0,0) 42%)`,
          "screen"
        )}
        {grainLayer(0.22)}
        {smudges}
        {dust}
        {vignette("rgba(26,12,7,0.55)")}
      </>
    );
  } else if (preset === 1) {
    // WARM CLASSIC — 大径ハレーション＋縦の暖色ウォッシュ＋画面端の温色光漏れ
    const shift = 2.6 * s * env * k;
    const leakY = 12 + 4 * Math.sin(t * 0.35 + ph(1));
    const leakY2 = 86 + 4 * Math.cos(t * 0.28 + ph(2));
    look = (
      <>
        {footage("sepia(0.3) hue-rotate(-8deg) saturate(1.12) contrast(1.05)", shift > 0.35, shift, 0)}
        {solid(accDark(0.9), "screen") /* 黒浮き: ごく暗い暖色ソリッドのscreen加算 */}
        {halation(width * 0.04, 0.42 * breath, 1.07)}
        {solid(`linear-gradient(180deg, ${acc(0.28)}, rgba(112,42,26,0.3))`, "soft-light")}
        {solid(
          `radial-gradient(circle at 100% ${leakY}%, ${acc(0.4)}, rgba(0,0,0,0) 38%)`,
          "screen"
        )}
        {solid(
          `radial-gradient(circle at 0% ${leakY2}%, rgba(255,140,150,0.3), rgba(0,0,0,0) 34%)`,
          "screen"
        )}
        {grainLayer(0.24)}
        {vignette("rgba(30,12,6,0.6)")}
      </>
    );
  } else if (preset === 2) {
    // DUOTONE — グレースケール基調＋色被せ＋漂流ブロブ＋微回転フラッシュ＋左端マロン
    const shift = 2.0 * s * env * k;
    const cx1 = 28 + 14 * Math.sin(t * 0.22 + ph(2));
    const cy1 = 32 + 10 * Math.cos(t * 0.17 + ph(3));
    const cx2 = 74 + 12 * Math.sin(t * 0.19 + ph(4));
    const cy2 = 62 + 12 * Math.cos(t * 0.24 + ph(5));
    look = (
      <>
        {footage("grayscale(1) contrast(1.08) brightness(1.03)", shift > 0.35, shift * 0.8, 0)}
        {solid(
          `linear-gradient(180deg, ${acc(0.85)}, rgba(232,205,170,0.85))`,
          "color",
          0.85
        ) /* デュオトーン色被せ */}
        {solid(
          `radial-gradient(circle at ${cx1}% ${cy1}%, rgba(255,112,180,0.32), rgba(0,0,0,0) 46%)`,
          "soft-light"
        )}
        {solid(
          `radial-gradient(circle at ${cx2}% ${cy2}%, rgba(255,190,120,0.3), rgba(0,0,0,0) 42%)`,
          "soft-light"
        )}
        <AbsoluteFill
          style={{
            background: `linear-gradient(64deg, ${acc(0.2)}, rgba(0,0,0,0) 55%)`,
            mixBlendMode: "screen",
            opacity: 0.55 + 0.35 * Math.sin(t * 0.45 + ph(6)),
            transform: `rotate(${1.5 * Math.sin(t * 0.3 + ph(7))}deg) scale(1.12)`,
          }}
        />
        {halation(width * 0.02, 0.26 * breath, 1.05)}
        {solid("rgba(26,16,34,0.9)", "screen") /* 黒浮き（暗紫寄り） */}
        {solid("linear-gradient(90deg, rgba(84,26,30,0.55), rgba(0,0,0,0) 32%)", "multiply")}
        {grainLayer(0.42) /* 標準の約2倍・微色付き */}
        {vignette("rgba(22,10,12,0.55)")}
      </>
    );
  } else if (preset === 3) {
    // SOFT BLOOM — ソフトフォーカス＋ブルーム2段（広い柔＋締まったエッジ）
    look = (
      <>
        {footage(
          `sepia(0.14) saturate(0.92) contrast(1.02) brightness(1.03) blur(${1.3 * s}px)`,
          false,
          0,
          0
        )}
        {solid("rgba(36,18,7,0.9)", "screen") /* 黒浮き: 暗い暖色ソリッドのscreen加算 */}
        {halation(width * 0.035, 0.4 * breath, 1.07) /* 広い柔ブルーム */}
        <AbsoluteFill
          style={{
            transform: "scale(1.03)",
            filter: `brightness(1.35) contrast(4) blur(${width * 0.012}px)`,
            mixBlendMode: "screen",
            opacity: 0.3 * breath,
          }}
        >
          {children}
        </AbsoluteFill>
        {solid(
          `radial-gradient(circle at ${20 + 3 * Math.sin(t * 0.25 + ph(1))}% -8%, ${acc(
            0.22
          )}, rgba(0,0,0,0) 40%)`,
          "screen"
        )}
        {grainLayer(0.2)}
        {vignette("rgba(28,14,8,0.5)")}
      </>
    );
  } else {
    // VIOLET ECHO — 右へ開く水平残像＋ポスタライズ＋ゴッドレイ＋微細手ブレ＋カラー粒子
    const open = smooth(clamp01(frame / (dur * 0.75)));
    const offset = s * (3 + 24 * open);
    const shakeX = 1.5 * s * Math.sin(t * 3.1 + ph(6));
    const shakeY = 1.2 * s * Math.cos(t * 2.4 + ph(7));
    const rayRot = 4 * Math.sin(t * 0.18 + ph(5));
    const pTick = Math.floor(t * 6);
    const particles = Array.from({ length: 8 }, (_, i) => {
      const hx = hash01(pTick * 7.9 + i * 13.7, seed);
      const hy = hash01(pTick * 5.1 + i * 9.3 + 59, seed);
      const warm = i % 2 === 0;
      const sz = (2 + 3 * hash01(i * 3.7 + 17, seed)) * s;
      return (
        <div
          key={i}
          style={{
            position: "absolute",
            left: `${5 + hx * 90}%`,
            top: `${5 + hy * 90}%`,
            width: sz,
            height: sz,
            borderRadius: "50%",
            background: warm ? acc(0.85) : "rgba(255,154,213,0.85)",
            opacity: 0.25 + 0.4 * hy,
            filter: `blur(${1 * s}px)`,
            mixBlendMode: "screen",
          }}
        />
      );
    });
    look = (
      <>
        <AbsoluteFill style={{ transform: `translate(${shakeX}px, ${shakeY}px)` }}>
          <AbsoluteFill
            style={{
              filter: `saturate(0.85) contrast(1.06) brightness(1.02) url(#${uid}-post)`,
            }}
          >
            {children}
          </AbsoluteFill>
          {[1, 2, 3].map((i) => (
            <AbsoluteFill
              key={i}
              style={{
                // 圧縮→ぼかし→伸長の異方性ブラーを scaleX＋blur で近似した水平残像
                transform: `translateX(${offset * i}px) scaleX(${1 + 0.012 * i})`,
                filter: `blur(${1.5 * i * s}px) saturate(0.8)`,
                mixBlendMode: "screen",
                opacity: 0.26 / i,
              }}
            >
              {children}
            </AbsoluteFill>
          ))}
        </AbsoluteFill>
        {solid(`linear-gradient(200deg, ${acc(0.3)}, rgba(38,20,78,0.3))`, "soft-light")}
        {solid(acc(0.25), "color", 0.55)}
        <AbsoluteFill
          style={{
            background: `conic-gradient(from ${-30 + rayRot}deg at 62% 28%, rgba(0,0,0,0) 0deg, ${acc(
              0.16
            )} 7deg, rgba(0,0,0,0) 16deg, rgba(0,0,0,0) 40deg, ${acc(
              0.13
            )} 48deg, rgba(0,0,0,0) 58deg, rgba(0,0,0,0) 96deg, ${acc(
              0.15
            )} 104deg, rgba(0,0,0,0) 116deg, rgba(0,0,0,0) 360deg)`,
            filter: `blur(${14 * s}px)`,
            mixBlendMode: "screen",
            opacity: 0.8 * breath,
            transformOrigin: "62% 28%",
          }}
        />
        {halation(width * 0.025, 0.3 * breath, 1.05)}
        {solid("rgba(34,20,48,0.9)", "screen") /* 黒浮き（暗紫） */}
        {particles}
        {grainLayer(0.24)}
        {vignette("rgba(16,8,26,0.6)")}
      </>
    );
  }

  return (
    <AbsoluteFill style={{ background: "#000", isolation: "isolate", pointerEvents: "none" }}>
      {/* 生のchildrenは常時フル表示（オーバーレイの契約） */}
      <AbsoluteFill>{children}</AbsoluteFill>
      {lookOpacity > 0.002 ? (
        <AbsoluteFill style={{ opacity: lookOpacity, isolation: "isolate" }}>{look}</AbsoluteFill>
      ) : null}
      {/* チャンネル抽出＆ポスタライズのSVGフィルタ定義（描画されない0x0） */}
      <svg width={0} height={0} style={{ position: "absolute" }} aria-hidden>
        <defs>
          <filter id={`${uid}-r`} colorInterpolationFilters="sRGB">
            <feColorMatrix
              type="matrix"
              values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0"
            />
          </filter>
          <filter id={`${uid}-g`} colorInterpolationFilters="sRGB">
            <feColorMatrix
              type="matrix"
              values="0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0"
            />
          </filter>
          <filter id={`${uid}-b`} colorInterpolationFilters="sRGB">
            <feColorMatrix
              type="matrix"
              values="0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0"
            />
          </filter>
          <filter id={`${uid}-post`} colorInterpolationFilters="sRGB">
            <feComponentTransfer>
              <feFuncR type="discrete" tableValues="0 0.17 0.33 0.5 0.67 0.83 1" />
              <feFuncG type="discrete" tableValues="0 0.17 0.33 0.5 0.67 0.83 1" />
              <feFuncB type="discrete" tableValues="0 0.17 0.33 0.5 0.67 0.83 1" />
            </feComponentTransfer>
          </filter>
        </defs>
      </svg>
    </AbsoluteFill>
  );
};
