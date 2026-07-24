import React, { useId, useMemo } from "react";
import {
  AbsoluteFill,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

/**
 * MvTransitionXRay — X線写真調ネガ反転ストロボ・トランジション（クリーンルーム実装）
 *
 * 機能: 脱色＋黒潰しのレントゲン質感の中で、ネガ反転ストロボとプリズム分光
 *       （モノクロ世界に色フリンジだけ走る）が明滅する約1秒のカット切替。
 *       方向つき4兄弟（left / right / up / down）を direction で切替。
 *
 * 設計メモ:
 * - 背骨は台形包絡1本（0 → 45%で最大 → 55%手前までプラトー → 終端0）。
 *   分光量・ズーム・膨張・脱色・コントラスト・シェイク・グレイン増強が全部これに連動。
 * - ネガ反転は 0/1 のハードストロボ（down のみ連続値で滑らか）。ON窓は3回、
 *   カット点をまたいで配置。反転時は contrast 追加＋brightness 減で締める。
 * - フィルタ順が肝: グレー化 → コントラスト/明度 → プリズム分光 → 着色 → ネガ反転。
 *   分光はグレー化の後に置くことで「モノクロなのに色ズレだけカラー」になる。
 * - 乱数はすべて (seed, a, b) の決定的ハッシュ。シェイクはフレーム番号×3を
 *   キーにして1フレーム内でも位相が飛ぶ痙攣にする。Math.random 不使用。
 * - px系の量は全部 幅÷1920 / 高さ÷1080 の係数でスケール（解像度非依存）。
 * - 個体差:
 *   left  = 緑ティール着色＋緑グロー＋左スライド切替＋放射マスクのバルジ複製＋ダスト/縦傷
 *   right = 無彩色白基調＋clip-path右ワイプ＋ネガ窓境目の白ストロボ＋レンズハイライト＋強め走査線/水平ストリーク
 *   up    = 白飛びブローアウト最強＋白ベタdifferenceでネガ反転＋脱色6割止まり＋上向きシェブロン＋上へ流れる縞レイ＋縦揺れ優勢
 *   down  = カラーベタmultiply×screen再合成の分光＋縦スライド＋連続値ネガ＋バルジ同期の縦ストレッチ＋白い下向きシェブロン線画
 */

export interface MvTransitionXRayProps {
  /** 旧カット */
  from: React.ReactNode;
  /** 新カット */
  to: React.ReactNode;
  /** トランジション全体の長さ（フレーム） */
  durationInFrames: number;
  /** 方向（forward→right / backward→left に丸める） */
  direction?: "left" | "right" | "up" | "down" | "forward" | "backward";
  /** 0..1 同家族内の見た目分岐（決定論的） */
  variant?: number;
}

/** (a,b,c) から 0..1 の決定的な擬似乱数を返す（GLSL の定番ハッシュ） */
const rand = (a: number, b: number, c: number): number => {
  const s = Math.sin(a * 127.1 + b * 311.7 + c * 74.7) * 43758.5453123;
  return s - Math.floor(s);
};

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

type Dir4 = "left" | "right" | "up" | "down";

const CLAMP = {
  extrapolateLeft: "clamp",
  extrapolateRight: "clamp",
} as const;

export const MvTransitionXRay: React.FC<MvTransitionXRayProps> = ({
  from,
  to,
  durationInFrames,
  direction = "left",
  variant = 0,
}) => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const rawId = useId();
  const uid = useMemo(() => rawId.replace(/[^a-zA-Z0-9_-]/g, ""), [rawId]);

  const dir: Dir4 =
    direction === "forward"
      ? "right"
      : direction === "backward"
        ? "left"
        : direction;
  const vr = clamp01(variant);
  const seed = 11 + Math.round(vr * 997);

  const sw = width / 1920; // 幅スケール
  const sh = height / 1080; // 高さスケール

  const last = Math.max(1, durationInFrames - 1);
  const p = clamp01(frame / last);

  // ---- 台形包絡（背骨） ----------------------------------------------------
  // 0 → 45%で最大 → 55%手前までプラトー → 終端でほぼ0。ほぼ線形の折れ線。
  const env = interpolate(p, [0, 0.45, 0.54, 1], [0, 1, 1, 0], CLAMP);
  // 発光包絡: 前半1/4で立ち上がり、後半までゆっくり減衰（残光）
  const glowEnv = interpolate(p, [0, 0.24, 0.78, 1], [0, 1, 0.3, 0], CLAMP);
  // 端フレームを完全クリーンにするためのフェード
  const fade = interpolate(p, [0, 0.06, 0.94, 1], [0, 1, 1, 0], CLAMP);

  // ---- カット点（嵐の頂点、中央±数%） --------------------------------------
  const sAt = 0.5 + (rand(seed, 1, 3) - 0.5) * 0.06;

  // ---- ネガ反転ストロボ（3窓、カット点をまたぐ） ---------------------------
  const winCenters = [
    0.36 + (rand(seed, 31, 5) - 0.5) * 0.04,
    sAt + (rand(seed, 32, 5) - 0.5) * 0.02,
    0.63 + (rand(seed, 33, 5) - 0.5) * 0.04,
  ];
  const winWidths = [0, 1, 2].map((i) => 0.055 + rand(seed, 41 + i, 9) * 0.035);
  let inv = 0;
  if (dir === "down") {
    // down だけ連続値で滑らか（三角パルスの重ね）
    for (let i = 0; i < 3; i++) {
      const d = Math.abs(p - winCenters[i]) / winWidths[i];
      inv = Math.max(inv, clamp01(1 - d));
    }
    inv *= 0.92;
  } else {
    // ハード 0/1（中途半端な灰色を避ける）
    for (let i = 0; i < 3; i++) {
      if (Math.abs(p - winCenters[i]) < winWidths[i] * 0.5) inv = 1;
    }
  }

  // right: ネガ窓の境目に白ストロボ閃光（三角パルス）
  let edgeFlash = 0;
  if (dir === "right") {
    for (let i = 0; i < 3; i++) {
      const eA = winCenters[i] - winWidths[i] * 0.5;
      const eB = winCenters[i] + winWidths[i] * 0.5;
      edgeFlash = Math.max(
        edgeFlash,
        clamp01(1 - Math.abs(p - eA) / 0.02),
        clamp01(1 - Math.abs(p - eB) / 0.02)
      );
    }
    edgeFlash *= env;
  }

  // ---- シェイク（フレームより速い痙攣、決定論ハッシュ） ---------------------
  const vertical = dir === "up" || dir === "down";
  const shakeAmp = width * 0.011 * env;
  const shakeX =
    (rand(seed, frame * 3, 21) - 0.5) * 2 * shakeAmp * (vertical ? 0.65 : 1);
  const shakeY =
    (rand(seed, frame * 3 + 1, 22) - 0.5) *
    2 *
    shakeAmp *
    (vertical ? 1 : 0.65) *
    (dir === "up" ? 1.15 : 1);

  // ---- ズーム＋（down のみ）バルジ同期の縦ストレッチ ------------------------
  const zoomX = 1 + 0.055 * env;
  const zoomY = zoomX * (dir === "down" ? 1 + 0.05 * env : 1);

  // ---- レントゲン質感（脱色・黒潰し） --------------------------------------
  // up は脱色6割止まりで色フチを残す
  const desatMax = dir === "up" ? 0.6 : 0.96;
  const gs = desatMax * env;
  const ct = 1 + env * 1.0; // コントラストおよそ2倍まで
  const br = 1 + env * 0.05;

  // left だけ緑ティール着色（グレー化→sepia→色相回転→彩度増の一本鎖）
  const tint =
    dir === "left"
      ? ` sepia(${(0.65 * env).toFixed(3)}) hue-rotate(115deg) saturate(${(
          1 + 1.6 * env
        ).toFixed(3)})`
      : "";

  const baseFilter =
    `grayscale(${gs.toFixed(3)}) contrast(${ct.toFixed(3)}) ` +
    `brightness(${br.toFixed(3)})${tint}`;

  // ネガ反転はステージ最上流（分光・着色の後）で掛ける。
  // up は白ベタ difference レイヤーで代替するので filter 反転しない。
  const invertFilter =
    dir !== "up" && inv > 0.001
      ? `invert(${inv.toFixed(3)}) contrast(${(1 + 0.35 * inv).toFixed(
          3
        )}) brightness(${(1 - 0.1 * inv).toFixed(3)})`
      : undefined;

  // ---- from / to の入替（方向スライド or ワイプ、カット点に集中） -----------
  const slide = 13; // 移動量（%）
  const axis = vertical ? "Y" : "X";
  const exitSign = dir === "left" || dir === "up" ? -1 : 1;
  const fromShift = interpolate(
    p,
    [sAt - 0.22, sAt + 0.06],
    [0, exitSign * slide],
    CLAMP
  );
  const toShift = interpolate(
    p,
    [sAt - 0.06, sAt + 0.22],
    [-exitSign * slide, 0],
    CLAMP
  );
  const toFade = interpolate(p, [sAt - 0.045, sAt + 0.045], [0, 1], CLAMP);

  // right はワイプ（エッジが左→右へ進行）
  const wipeEdge = interpolate(p, [sAt - 0.12, sAt + 0.12], [0, 100], CLAMP);

  const fromStyle: React.CSSProperties =
    dir === "right"
      ? {}
      : { transform: `translate${axis}(${fromShift.toFixed(3)}%)` };
  const toStyle: React.CSSProperties =
    dir === "right"
      ? { clipPath: `inset(0 ${(100 - wipeEdge).toFixed(3)}% 0 0)` }
      : {
          transform: `translate${axis}(${toShift.toFixed(3)}%)`,
          opacity: toFade,
        };

  // グレード済みコンテンツ（from の上に to が乗る）
  const graded = (
    <AbsoluteFill style={{ filter: baseFilter }}>
      <AbsoluteFill style={fromStyle}>{from}</AbsoluteFill>
      <AbsoluteFill style={toStyle}>{to}</AbsoluteFill>
    </AbsoluteFill>
  );

  // ---- プリズム分光（家族の看板芸） -----------------------------------------
  // R を左へ・B を右へ水平オフセット、G 中央固定。screen 再合成。
  const prismOff =
    env * width * 0.014 * (0.7 + 0.6 * rand(seed, 3, 3));
  const prismOn = prismOff > 0.5;

  let prismComposite: React.ReactNode;
  if (!prismOn) {
    prismComposite = graded;
  } else if (dir === "down") {
    // down: SVGフィルタでなくカラーベタ multiply マスク＋screen 再合成
    const chan = (color: string, shift: number, screenBlend: boolean) => (
      <AbsoluteFill
        style={{
          mixBlendMode: screenBlend ? "screen" : undefined,
          transform: shift === 0 ? undefined : `translateX(${shift.toFixed(1)}px)`,
        }}
      >
        <AbsoluteFill style={{ isolation: "isolate" }}>
          {graded}
          <AbsoluteFill style={{ background: color, mixBlendMode: "multiply" }} />
        </AbsoluteFill>
      </AbsoluteFill>
    );
    prismComposite = (
      <>
        {chan("#f00", -prismOff, false)}
        {chan("#0f0", 0, true)}
        {chan("#00f", prismOff, true)}
      </>
    );
  } else {
    // left/right/up: feColorMatrix の単チャンネル分離
    prismComposite = (
      <>
        <AbsoluteFill
          style={{
            filter: `url(#${uid}-r)`,
            transform: `translateX(${(-prismOff).toFixed(1)}px)`,
          }}
        >
          {graded}
        </AbsoluteFill>
        <AbsoluteFill style={{ filter: `url(#${uid}-g)`, mixBlendMode: "screen" }}>
          {graded}
        </AbsoluteFill>
        <AbsoluteFill
          style={{
            filter: `url(#${uid}-b)`,
            mixBlendMode: "screen",
            transform: `translateX(${prismOff.toFixed(1)}px)`,
          }}
        >
          {graded}
        </AbsoluteFill>
      </>
    );
  }

  // ---- 膨張（バルジ） --------------------------------------------------------
  // left/down: 中央だけ拡大した複製を放射グラデのマスクで重ねる
  // right/up : レンズ状ハイライト（中央白→周辺暗）の overlay で近似
  const bulgeDup = dir === "left" || dir === "down";
  const bulgeScale = 1 + 0.28 * env;
  const bulgeMask =
    "radial-gradient(circle at 50% 50%, #000 0%, #000 22%, transparent 52%)";

  // ---- 発光（グロー・ストリーク） --------------------------------------------
  const glowColor =
    dir === "left" ? "rgba(120,255,215,0.85)" : "rgba(255,255,255,0.85)";
  const glowOpacity = glowEnv * (dir === "up" ? 0.95 : dir === "left" ? 0.7 : 0.6);

  // 水平ストリーク（right 強め / up は上へ流れる）
  const streakOn = dir === "right" || dir === "up";
  const streakPeriod = Math.max(4, 8 * sh);
  const streakFlow = dir === "up" ? -frame * 5 * sh : 0;

  // ---- 走査線 ----------------------------------------------------------------
  const scanPeriod = Math.max(2, 3.2 * sh);
  const scanOpacity =
    (0.1 + 0.16 * env) * (dir === "right" ? 1.5 : 1) * fade;

  // ---- グレイン --------------------------------------------------------------
  const grainSeed = 100 + frame * 7;
  const grainOpacity = (0.13 + 0.15 * env) * fade;

  // ---- up: 白飛びブローアウト（中盤ほぼ全面白） -------------------------------
  const blowout = dir === "up" ? Math.pow(env, 1.4) * 0.82 : 0;

  // ---- 装飾: シェブロン（up/down） -------------------------------------------
  const chevronOn = dir === "up" || dir === "down";
  const chevOpacity = interpolate(p, [0.14, 0.3, 0.72, 0.86], [0, 1, 1, 0], CLAMP);
  const chevDrift = env * 34 * sh * (dir === "up" ? -1 : 1);
  const chevColor = dir === "down" ? "#ffffff" : "rgba(24,28,30,0.8)";
  const chevW = 120 * sw;

  const chevron = (flipDown: boolean) => (
    <svg
      viewBox="0 0 100 52"
      width={chevW}
      height={(chevW * 52) / 100}
      style={{ display: "block" }}
    >
      <polyline
        points={flipDown ? "12,14 50,40 88,14" : "12,40 50,14 88,40"}
        fill="none"
        stroke={chevColor}
        strokeWidth={13}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );

  // ---- 装飾: フィルムダスト粒・縦傷（left） -----------------------------------
  const dustOn = dir === "left";
  const dustT = Math.floor(frame / 2); // 2フレーム保持でチラつかせる
  const dusts = dustOn
    ? Array.from({ length: 12 }, (_, i) => ({
        x: rand(seed, dustT, 500 + i) * 100,
        y: rand(seed, dustT, 540 + i) * 100,
        r: (1.5 + rand(seed, dustT, 580 + i) * 3.5) * sw,
        o: 0.15 + rand(seed, dustT, 620 + i) * 0.4,
        i,
      }))
    : [];
  const scratches = dustOn
    ? Array.from({ length: 3 }, (_, i) => ({
        x: rand(seed, Math.floor(frame / 3), 700 + i) * 100,
        o: 0.1 + rand(seed, Math.floor(frame / 3), 730 + i) * 0.2,
        i,
      }))
    : [];

  // ---- ビネット ---------------------------------------------------------------
  const vignetteOpacity =
    (dir === "up" ? 0.18 : 0.32) * (0.5 + 0.5 * env) * fade;

  return (
    <AbsoluteFill style={{ background: "#000", overflow: "hidden" }}>
      {/* フィルタ定義（チャンネル分離＋グレイン） */}
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

      {/* ステージ（シェイク＋ズーム。ネガ反転は分光の後＝ここで掛ける） */}
      <AbsoluteFill
        style={{
          transform: `translate(${shakeX.toFixed(1)}px, ${shakeY.toFixed(
            1
          )}px) scale(${zoomX.toFixed(4)}, ${zoomY.toFixed(4)})`,
          filter: invertFilter,
        }}
      >
        {prismComposite}

        {/* バルジ: 中央拡大複製＋放射マスク（left/down） */}
        {bulgeDup && env > 0.02 && (
          <AbsoluteFill
            style={{
              transform: `scale(${bulgeScale.toFixed(4)})`,
              WebkitMaskImage: bulgeMask,
              maskImage: bulgeMask,
            }}
          >
            {graded}
          </AbsoluteFill>
        )}

        {/* バルジ近似: レンズ状ハイライト overlay（right/up） */}
        {!bulgeDup && (
          <AbsoluteFill
            style={{
              background:
                "radial-gradient(ellipse 46% 34% at 50% 50%, rgba(255,255,255,0.5) 0%, rgba(255,255,255,0.1) 55%, rgba(0,0,0,0.2) 100%)",
              mixBlendMode: "overlay",
              opacity: env,
            }}
          />
        )}

        {/* up: 白ベタ difference 合成によるネガ反転 */}
        {dir === "up" && inv > 0.001 && (
          <AbsoluteFill
            style={{ background: "#fff", mixBlendMode: "difference", opacity: inv }}
          />
        )}
      </AbsoluteFill>

      {/* 発光: 中央の放射グロー（screen） */}
      <AbsoluteFill
        style={{
          background: `radial-gradient(ellipse 55% 42% at 50% 50%, ${glowColor} 0%, transparent 70%)`,
          mixBlendMode: "screen",
          opacity: glowOpacity,
        }}
      />

      {/* 水平ストリーク（right / up は上へ流れる） */}
      {streakOn && (
        <AbsoluteFill
          style={{
            background: `repeating-linear-gradient(180deg, transparent 0px, transparent ${(
              streakPeriod - 1.4 * sh
            ).toFixed(1)}px, rgba(255,255,255,0.55) ${(
              streakPeriod - 1.4 * sh
            ).toFixed(1)}px, rgba(255,255,255,0.55) ${streakPeriod.toFixed(1)}px)`,
            backgroundPositionY: `${streakFlow.toFixed(1)}px`,
            WebkitMaskImage:
              "radial-gradient(ellipse 60% 55% at 50% 50%, #000 0%, transparent 75%)",
            maskImage:
              "radial-gradient(ellipse 60% 55% at 50% 50%, #000 0%, transparent 75%)",
            mixBlendMode: "screen",
            opacity: glowEnv * (dir === "right" ? 0.55 : 0.4),
          }}
        />
      )}

      {/* up: 白飛びブローアウト */}
      {blowout > 0.01 && (
        <AbsoluteFill style={{ background: "#fff", opacity: blowout }} />
      )}

      {/* right: ネガ窓境目の白ストロボ閃光 */}
      {edgeFlash > 0.01 && (
        <AbsoluteFill style={{ background: "#fff", opacity: edgeFlash * 0.85 }} />
      )}

      {/* 走査線（multiply の暗縞） */}
      <AbsoluteFill
        style={{
          background: `repeating-linear-gradient(180deg, rgba(0,0,0,0.5) 0px, rgba(0,0,0,0.5) ${(
            1 * sh
          ).toFixed(1)}px, transparent ${(1 * sh).toFixed(
            1
          )}px, transparent ${scanPeriod.toFixed(1)}px)`,
          mixBlendMode: "multiply",
          opacity: scanOpacity,
          pointerEvents: "none",
        }}
      />

      {/* フィルムグレイン（毎フレーム seed 変更、overlay） */}
      <AbsoluteFill
        style={{
          filter: `url(#${uid}-grain)`,
          mixBlendMode: "overlay",
          opacity: grainOpacity,
        }}
      />

      {/* 装飾: シェブロン2連（up/down） */}
      {chevronOn && chevOpacity > 0.01 && (
        <AbsoluteFill
          style={{
            alignItems: "center",
            justifyContent: "center",
            opacity: chevOpacity,
            transform: `translateY(${chevDrift.toFixed(1)}px)`,
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 26 * sh }}>
            {chevron(dir === "down")}
            {chevron(dir === "down")}
          </div>
        </AbsoluteFill>
      )}

      {/* 装飾: フィルムダスト粒・縦傷（left） */}
      {dusts.map((d) => (
        <div
          key={d.i}
          style={{
            position: "absolute",
            left: `${d.x.toFixed(2)}%`,
            top: `${d.y.toFixed(2)}%`,
            width: d.r,
            height: d.r,
            borderRadius: "50%",
            background: "#fff",
            opacity: d.o * env,
          }}
        />
      ))}
      {scratches.map((sc) => (
        <div
          key={sc.i}
          style={{
            position: "absolute",
            top: 0,
            bottom: 0,
            left: `${sc.x.toFixed(2)}%`,
            width: Math.max(1, 1.2 * sw),
            background: "rgba(10,12,12,0.9)",
            opacity: sc.o * env,
          }}
        />
      ))}

      {/* ビネット */}
      <AbsoluteFill
        style={{
          background:
            "radial-gradient(ellipse at 50% 50%, transparent 55%, rgba(0,0,0,0.55) 100%)",
          opacity: vignetteOpacity,
          pointerEvents: "none",
        }}
      />
    </AbsoluteFill>
  );
};
