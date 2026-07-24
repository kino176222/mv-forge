import React, { useId, useMemo } from "react";
import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from "remotion";

/**
 * MvTransitionFilmArtifact — フィルム劣化トランジション家族（クリーンルーム実装）
 *
 * 古いフィルムの「事故」（感光ムラ・傷・光漏れ・退色）を短時間だけ全開にし、
 * 混乱の頂点の下でカットを差し替えるトランジション。
 *
 * 構造（下から上へ）:
 *   1. 黒背景 + overflow隠し（揺れ・ズームの縁は黒に落とす）
 *   2. 映像スタック = from の上に to を重ね、to の opacity だけでクロス。
 *      揺れ・ズーム・色補正は スタック全体に一括適用（両カットが同じ劣化を受ける）
 *   3. 質感オーバーレイ群（screenの光もの / multiplyの暗い傷 / overlayのグレイン）
 *   4. 最前面にクリーム色フラッシュとビネット
 *
 * 時間: 強度は 0→1→0 の三角パルス（立ち上がり急・終端手前で消灯）。
 *       カット差し替えは頂点を挟む狭い窓で行う。
 *       variant=0.8以降の個体のみ長尺の暗転プラトー型。
 *
 * variant による個体分岐（0..1 を5等分）:
 *   [0.0-0.2) 感光ムラ … 白ブロブが主役。拡大しながら横掃引 + プッシュ感
 *   [0.2-0.4) 色ステイン … 寒色へ hue 回転 + ティール全面被せ + 上端光漏れ帯
 *   [0.4-0.6) コマ飛び … 位置ジッター + 微回転 + 対称ゴースト + 傷・塵・毛が最多
 *   [0.6-0.8) 光漏れ … 縦方向ブラー + 暖色光帯4本が画面を横断（前2/3に凝縮）
 *   [0.8-1.0] 退色 … 暗転プラトー下でスワップ。ボケ + 横揺れ + RGB色ズレ二連ヒット
 *
 * 乱数はすべて (seed, frame, salt) の決定論ハッシュ。Math.random 不使用。
 * 質感は全部手続き生成（SVG fractalNoise / CSSグラデーション）。外部素材なし。
 */

export interface MvTransitionFilmArtifactProps {
  /** 出ていく側の絵 */
  from: React.ReactNode;
  /** 入ってくる側の絵 */
  to: React.ReactNode;
  /** トランジション全体の長さ（フレーム） */
  durationInFrames: number;
  /** 掃引・プッシュ・光帯の進行方向（既定 "left"） */
  direction?: "left" | "right" | "up" | "down" | "forward" | "backward";
  /** 0..1 家族内の見た目分岐（決定論的） */
  variant?: number;
}

/** (a,b,c) → [0,1) の決定論ハッシュ */
const rand = (a: number, b: number, c: number): number => {
  const s = Math.sin(a * 127.1 + b * 311.7 + c * 74.7) * 43758.5453123;
  return s - Math.floor(s);
};

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** ゆるい ease-in-out（角を丸める用。バウンスなし） */
const smooth = (t: number) => {
  const x = clamp01(t);
  return x * x * (3 - 2 * x);
};

type Mode = 0 | 1 | 2 | 3 | 4;

/** 光漏れ個体の光帯の暖色（オレンジ〜アンバー） */
const BAND_HUES = ["#ff9a3c", "#ffb95e", "#ff7a2e", "#ffd489"] as const;

export const MvTransitionFilmArtifact: React.FC<MvTransitionFilmArtifactProps> = ({
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

  const scale = width / 1920; // 解像度換算係数（px量はすべてこれを掛ける）
  const last = Math.max(1, durationInFrames - 1);
  const p = clamp01(frame / last);

  const v = clamp01(variant);
  const mode = Math.min(4, Math.floor(v * 5)) as Mode;
  // 同モード内でも variant の端数で崩れ方が変わるシード
  const seed = 31 + Math.floor(v * 1000);

  // ---- エンベロープ ---------------------------------------------------------
  // 三角パルス: 全長の1割で急立ち上がり → 頂点 → 終端手前(0.88)で消灯
  const peak = mode === 3 ? 0.33 : mode === 0 ? 0.42 : 0.45;
  const env =
    mode === 4
      ? // 退色個体のみ: 中盤の暗転プラトー（台地）
        interpolate(p, [0, 0.12, 0.28, 0.72, 0.9], [0, 0.5, 1, 1, 0], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        })
      : interpolate(p, [0, 0.1, peak, 0.88], [0, 0.55, 1, 0], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        });

  // 退色個体の「二連ヒット」: プラトー中に2回、ボケ・揺れ・色ズレが往復する
  const hitAt = (center: number, halfW: number) =>
    clamp01(1 - Math.abs(p - center) / halfW);
  const hit = mode === 4 ? Math.max(smooth(hitAt(0.34, 0.13)), smooth(hitAt(0.62, 0.13))) : 0;

  // ---- カット差し替え（頂点を挟む狭い窓でクロス） ---------------------------
  const swapCenter = mode === 4 ? 0.5 : peak;
  const swapHalf = mode === 4 ? 0.1 : 0.08;
  const toOpacity = smooth((p - (swapCenter - swapHalf)) / (swapHalf * 2));

  // ---- 方向 -----------------------------------------------------------------
  // 家族は基本横方向の演出。up/down は同符号の横掃引に読み替え、
  // forward/backward はプッシュのズーム向きにだけ効く。
  const sweep =
    direction === "right" || direction === "down" ? 1 : direction === "forward" ? 1 : -1;
  const zoomPush = direction === "forward" ? 1 : direction === "backward" ? -1 : 0;

  // ---- カメラ揺れ（離散ジャンプ。補間しないのがフィルムらしさ） --------------
  const shakeAmp = [6, 18, 14, 5, 0][mode] * scale;
  const shakeX = (rand(seed, frame, 11) - 0.5) * 2 * shakeAmp * env;
  const shakeY = (rand(seed, frame, 12) - 0.5) * 2 * shakeAmp * 0.6 * env;
  // 退色個体だけ滑らかな横揺れ（二連ヒットに同期して往復）
  const swayX = mode === 4 ? Math.sin(p * Math.PI * 4) * 12 * scale * hit : 0;
  // コマ飛び個体は微回転も
  const rot = mode === 2 ? (rand(seed, frame, 13) - 0.5) * 1.4 * env : 0;
  // 黒縁防止のズームイン（1割弱）
  const zoomBase = 1 + 0.07 * env;

  // ---- 輝度フリッカ ----------------------------------------------------------
  const flicker = 1 + (rand(seed, frame, 21) - 0.5) * 2 * 0.16 * env;

  // ---- モード別グレード（filterはスタック全体に一括適用） --------------------
  const coreEnv = Math.pow(env, 1.4); // 光漏れ個体の白飛びコア（急峻）
  let grade: string;
  switch (mode) {
    case 0: // 感光ムラ: 軽ぼかし + 脱色 + 強コントラスト
      grade = [
        `blur(${(2.6 * env * scale).toFixed(2)}px)`,
        `saturate(${(1 - 0.68 * env).toFixed(3)})`,
        `contrast(${(1 + 0.45 * env).toFixed(3)})`,
        `brightness(${(flicker * (1 + 0.12 * env)).toFixed(3)})`,
      ].join(" ");
      break;
    case 1: // 色ステイン: hue約140°回してシアン化 + 彩度露出ブースト（焼け）
      grade = [
        `hue-rotate(${Math.round(140 * env)}deg)`,
        `saturate(${(1 + 0.75 * env).toFixed(3)})`,
        `brightness(${(flicker * (1 + 0.32 * env)).toFixed(3)})`,
        `contrast(${(1 + 0.22 * env).toFixed(3)})`,
      ].join(" ");
      break;
    case 2: // コマ飛び: 脱色 + コントラスト。ボケは無し（ジッターで暴れる）
      grade = [
        `saturate(${(1 - 0.5 * env).toFixed(3)})`,
        `contrast(${(1 + 0.3 * env).toFixed(3)})`,
        `brightness(${flicker.toFixed(3)})`,
      ].join(" ");
      break;
    case 3: // 光漏れ: 縦方向だけの強ブラー（SVGフィルタ）+ 露出上げ
      grade = [
        `url(#${uid}-vblur)`,
        `saturate(${(1 - 0.3 * env).toFixed(3)})`,
        `brightness(${(flicker * (1 + 0.5 * coreEnv)).toFixed(3)})`,
      ].join(" ");
      break;
    default: // 退色: 明るさ4割弱・彩度1割強の台地 + ヒット時のボケ
      grade = [
        `blur(${(3 * hit * scale).toFixed(2)}px)`,
        `saturate(${(1 - 0.88 * env).toFixed(3)})`,
        `brightness(${(flicker * (1 - 0.62 * env)).toFixed(3)})`,
        `contrast(${(1 + 0.25 * env).toFixed(3)})`,
      ].join(" ");
      break;
  }

  // ---- 感光ムラ個体のプッシュ感（旧カット押し込み・新カット引き寄せ） --------
  const pushAmt = mode === 0 ? 7 : 0; // %
  const fromPush = pushAmt * smooth((p - 0.18) / (swapCenter + swapHalf - 0.18)) * env;
  const toPush = pushAmt * (1 - smooth((p - (swapCenter - swapHalf)) / (0.85 - (swapCenter - swapHalf))));
  const pushTransform = (amt: number, sign: number): string => {
    if (pushAmt === 0 || amt === 0) return "none";
    if (zoomPush !== 0) return `scale(${(1 + zoomPush * amt * 0.012 * sign).toFixed(4)})`;
    return `translateX(${(sweep * amt * sign).toFixed(3)}%)`;
  };

  // ---- 映像スタック（from の上に to。opacityクロスのみ） ---------------------
  const videoStack = (
    <AbsoluteFill>
      <AbsoluteFill style={{ transform: pushTransform(fromPush, 1) }}>{from}</AbsoluteFill>
      <AbsoluteFill
        style={{ opacity: toOpacity, transform: pushTransform(toPush, -1) }}
      >
        {to}
      </AbsoluteFill>
    </AbsoluteFill>
  );

  // ---- 退色個体の RGB 色ズレ（R右 / シアン左 の screen 再合成） --------------
  const rgbOff = mode === 4 ? 11 * scale * hit : 0;
  const splitOn = rgbOff > 0.4;

  // ---- コマ飛び個体の左右対称ゴースト残像 ------------------------------------
  const ghostOff = mode === 2 ? 24 * scale * env : 0;
  const ghostOn = ghostOff > 1;

  // ---- 塵・傷・毛（SVG手続き生成） -------------------------------------------
  const dustDensity = [0.5, 0.4, 1, 0.4, 0.35][mode];
  const dustCount = Math.round(22 * dustDensity * env);
  const dustItems = useMemo(() => {
    // frame依存の生成はレンダ毎に変わるため useMemo の依存に frame を含める
    const specks: Array<{ x: number; y: number; r: number; o: number }> = [];
    const darks: Array<
      | { kind: "dot"; x: number; y: number; r: number; o: number }
      | { kind: "scratch"; x: number; w: number; o: number }
      | { kind: "hair"; x: number; y: number; len: number; tilt: number; o: number }
    > = [];
    for (let i = 0; i < dustCount; i++) {
      const roll = rand(seed + 5, frame, 400 + i * 7);
      const rx = rand(seed + 6, frame, 401 + i * 7);
      const ry = rand(seed + 7, frame, 402 + i * 7);
      const rs = rand(seed + 8, frame, 403 + i * 7);
      if (roll < 0.45) {
        // 白点（screen）
        specks.push({ x: rx * 1920, y: ry * 1080, r: 1.5 + rs * 2.5, o: 0.45 + rs * 0.45 });
      } else if (roll < 0.62) {
        // 黒点（multiply）
        darks.push({ kind: "dot", x: rx * 1920, y: ry * 1080, r: 1.2 + rs * 2.2, o: 0.3 + rs * 0.4 });
      } else if (roll < 0.8) {
        // 縦傷: 数フレーム同じ位置に残る（slotでハッシュ）
        const slot = Math.floor(frame / 4);
        const sx = rand(seed + 9, slot, 500 + i) * 1920;
        darks.push({ kind: "scratch", x: sx, w: 1 + rs * 1.6, o: 0.16 + rs * 0.22 });
      } else {
        // 毛: ほぼ縦で少し傾いた短い線
        darks.push({
          kind: "hair",
          x: rx * 1920,
          y: ry * 980,
          len: 40 + rs * 90,
          tilt: (rand(seed + 10, frame, 404 + i * 7) - 0.5) * 30,
          o: 0.25 + rs * 0.3,
        });
      }
    }
    return { specks, darks };
  }, [dustCount, frame, seed]);

  // ---- 光漏れ個体の暖色光帯4本（画面外→画面外へ横断。前2/3に凝縮） ----------
  const bands = useMemo(() => {
    if (mode !== 3) return [];
    return BAND_HUES.map((hue, i) => {
      const stagger = i * 0.09;
      const travelP = smooth(clamp01((p - stagger) / 0.66));
      // sweep=-1: 右外(115%)→左外(-45%) / sweep=+1: 左外→右外
      const x = sweep > 0 ? -45 + travelP * 160 : 115 - travelP * 160;
      return {
        hue,
        x,
        w: 10 + i * 4,
        o: env * (0.55 + rand(seed, i, 77) * 0.35),
      };
    });
  }, [mode, p, env, sweep, seed]);

  // ---- フラッシュ（クリーム寄りのradial） ------------------------------------
  const flashAmt = [0.55, 0.5, 0.9, 0.75, 0.3][mode];
  const flashEnv =
    mode === 3
      ? coreEnv * smooth(hitAt(peak, 0.2))
      : smooth(hitAt(swapCenter, 0.13));
  const flashOpacity = clamp01(flashAmt * flashEnv);

  // ---- ビネット ---------------------------------------------------------------
  const vignetteOpacity = mode === 4 ? 0.55 : 0.3 * env;

  // ---- 感光ムラ個体の白ブロブ（拡大しつつ横掃引） ------------------------------
  const blobOn = mode === 0;
  const blobScale = 0.9 + 1.5 * p; // 小→2倍超へ
  const blobX = sweep * (p - 0.5) * 55; // %
  const blobSeed = seed % 97;

  // ---- グレイン（毎フレームseed更新でちらつく） --------------------------------
  const grainSeed = (frame * 7 + seed) % 9973;
  const grainOpacity = 0.1 + 0.1 * env;

  return (
    <AbsoluteFill style={{ background: "#000", overflow: "hidden" }}>
      {/* フィルタ定義 */}
      <svg width={0} height={0} style={{ position: "absolute" }} aria-hidden>
        <defs>
          {/* 縦方向だけの強ガウスブラー（光漏れ個体） */}
          <filter id={`${uid}-vblur`} x="-5%" y="-30%" width="110%" height="160%">
            <feGaussianBlur stdDeviation={`0 ${(16 * env * scale).toFixed(2)}`} />
          </filter>
          {/* Rチャンネルのみ / G+B（シアン）チャンネル（退色個体の色ズレ） */}
          <filter id={`${uid}-red`} colorInterpolationFilters="sRGB">
            <feColorMatrix
              type="matrix"
              values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0"
            />
          </filter>
          <filter id={`${uid}-cyan`} colorInterpolationFilters="sRGB">
            <feColorMatrix
              type="matrix"
              values="0 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 1 0"
            />
          </filter>
          {/* 白ブロブ: 低周波ノイズのalphaを急峻な線形写像でしきい値化→白固定→縁ぼかし */}
          <filter id={`${uid}-blob`} x="-15%" y="-15%" width="130%" height="130%">
            <feTurbulence
              type="fractalNoise"
              baseFrequency="0.0055 0.009"
              numOctaves={2}
              seed={blobSeed}
              result="n"
            />
            <feColorMatrix
              in="n"
              type="matrix"
              values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 10 -5.8"
            />
            <feGaussianBlur stdDeviation={(6 * scale).toFixed(2)} />
          </filter>
          {/* 高周波グレイン（彩度ゼロ化） */}
          <filter id={`${uid}-grain`}>
            <feTurbulence
              type="fractalNoise"
              baseFrequency="0.9"
              numOctaves={2}
              seed={grainSeed}
            />
            <feColorMatrix type="saturate" values="0" />
          </filter>
        </defs>
      </svg>

      {/* 映像スタック（揺れ・ズーム・グレードを一括適用） */}
      <AbsoluteFill
        style={{
          filter: grade,
          transform: `translate(${(shakeX + swayX).toFixed(1)}px, ${shakeY.toFixed(
            1
          )}px) rotate(${rot.toFixed(3)}deg) scale(${zoomBase.toFixed(4)})`,
        }}
      >
        {splitOn ? (
          <>
            {/* シアン(G+B)を左へ、R を右へ。整列部は screen で元の色に戻る */}
            <AbsoluteFill
              style={{
                filter: `url(#${uid}-cyan)`,
                transform: `translateX(${(-rgbOff).toFixed(1)}px)`,
              }}
            >
              {videoStack}
            </AbsoluteFill>
            <AbsoluteFill
              style={{
                filter: `url(#${uid}-red)`,
                mixBlendMode: "screen",
                transform: `translateX(${rgbOff.toFixed(1)}px)`,
              }}
            >
              {videoStack}
            </AbsoluteFill>
          </>
        ) : (
          videoStack
        )}

        {/* 左右対称ゴースト残像（コマ飛び個体・薄め3割） */}
        {ghostOn && (
          <>
            <AbsoluteFill
              style={{
                mixBlendMode: "screen",
                opacity: 0.28 * env,
                transform: `translateX(${ghostOff.toFixed(1)}px)`,
              }}
            >
              {videoStack}
            </AbsoluteFill>
            <AbsoluteFill
              style={{
                mixBlendMode: "screen",
                opacity: 0.28 * env,
                transform: `translateX(${(-ghostOff).toFixed(1)}px)`,
              }}
            >
              {videoStack}
            </AbsoluteFill>
          </>
        )}
      </AbsoluteFill>

      {/* 白ブロブ（感光ムラ個体の主役。screenで乗せ拡大しつつ掃引） */}
      {blobOn && env > 0.02 && (
        <AbsoluteFill
          style={{
            mixBlendMode: "screen",
            opacity: clamp01(env * 1.05),
            transform: `translateX(${blobX.toFixed(2)}%) scale(${blobScale.toFixed(3)})`,
          }}
        >
          <svg
            width="100%"
            height="100%"
            viewBox="0 0 1920 1080"
            preserveAspectRatio="none"
          >
            <rect width="1920" height="1080" filter={`url(#${uid}-blob)`} />
          </svg>
        </AbsoluteFill>
      )}

      {/* ティール全面被せ + 上端の白い光漏れ帯（色ステイン個体） */}
      {mode === 1 && env > 0.02 && (
        <>
          <AbsoluteFill
            style={{
              background:
                "linear-gradient(180deg, rgba(0,168,178,0.95) 0%, rgba(0,112,140,0.75) 55%, rgba(0,80,110,0.85) 100%)",
              mixBlendMode: "hard-light",
              opacity: 0.85 * env,
            }}
          />
          <div
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              right: 0,
              height: "16%",
              background:
                "linear-gradient(180deg, rgba(255,255,255,0.95) 0%, rgba(255,255,255,0) 100%)",
              mixBlendMode: "screen",
              opacity: env,
            }}
          />
        </>
      )}

      {/* 暖色の光帯4本（光漏れ個体。大きくblurしてscreen発光） */}
      {bands.map((b, i) => (
        <div
          key={i}
          style={{
            position: "absolute",
            top: "-12%",
            height: "124%",
            left: `${b.x.toFixed(2)}%`,
            width: `${b.w}%`,
            background: `linear-gradient(180deg, ${b.hue} 0%, rgba(255,236,200,0.9) 45%, ${b.hue} 100%)`,
            filter: `blur(${(46 * scale).toFixed(0)}px)`,
            mixBlendMode: "screen",
            opacity: clamp01(b.o),
          }}
        />
      ))}

      {/* 左下の暖色radial光漏れ（コマ飛び個体） */}
      {mode === 2 && env > 0.02 && (
        <AbsoluteFill
          style={{
            background:
              "radial-gradient(circle at 8% 92%, rgba(255,150,60,0.85) 0%, rgba(255,120,50,0.35) 30%, rgba(255,120,50,0) 60%)",
            mixBlendMode: "screen",
            opacity: env,
          }}
        />
      )}

      {/* 塵・傷・毛（白点=screen / 黒点・縦傷・毛=multiply） */}
      {dustCount > 0 && (
        <>
          <svg
            width="100%"
            height="100%"
            viewBox="0 0 1920 1080"
            preserveAspectRatio="none"
            style={{ position: "absolute", inset: 0, mixBlendMode: "screen" }}
          >
            {dustItems.specks.map((s, i) => (
              <circle
                key={i}
                cx={s.x.toFixed(1)}
                cy={s.y.toFixed(1)}
                r={s.r.toFixed(1)}
                fill="#fff"
                opacity={(s.o * env).toFixed(3)}
              />
            ))}
          </svg>
          <svg
            width="100%"
            height="100%"
            viewBox="0 0 1920 1080"
            preserveAspectRatio="none"
            style={{ position: "absolute", inset: 0, mixBlendMode: "multiply" }}
          >
            {dustItems.darks.map((d, i) => {
              if (d.kind === "dot") {
                return (
                  <circle
                    key={i}
                    cx={d.x.toFixed(1)}
                    cy={d.y.toFixed(1)}
                    r={d.r.toFixed(1)}
                    fill="#1a1512"
                    opacity={(d.o * env).toFixed(3)}
                  />
                );
              }
              if (d.kind === "scratch") {
                return (
                  <rect
                    key={i}
                    x={d.x.toFixed(1)}
                    y={0}
                    width={d.w.toFixed(1)}
                    height={1080}
                    fill="#221c17"
                    opacity={(d.o * env).toFixed(3)}
                  />
                );
              }
              return (
                <line
                  key={i}
                  x1={d.x.toFixed(1)}
                  y1={d.y.toFixed(1)}
                  x2={(d.x + Math.tan((d.tilt * Math.PI) / 180) * d.len).toFixed(1)}
                  y2={(d.y + d.len).toFixed(1)}
                  stroke="#1a1512"
                  strokeWidth={1.6}
                  strokeLinecap="round"
                  opacity={(d.o * env).toFixed(3)}
                />
              );
            })}
          </svg>
        </>
      )}

      {/* グレイン（overlayで薄く。seedを毎フレーム更新） */}
      {env > 0.02 && (
        <AbsoluteFill style={{ mixBlendMode: "overlay", opacity: grainOpacity }}>
          <svg
            width="100%"
            height="100%"
            viewBox="0 0 1920 1080"
            preserveAspectRatio="none"
          >
            <rect width="1920" height="1080" filter={`url(#${uid}-grain)`} />
          </svg>
        </AbsoluteFill>
      )}

      {/* ビネット（退色個体は常時、他は劣化中のみ） */}
      <AbsoluteFill
        style={{
          background:
            "radial-gradient(ellipse at 50% 50%, rgba(0,0,0,0) 52%, rgba(0,0,0,0.62) 100%)",
          opacity: vignetteOpacity,
          pointerEvents: "none",
        }}
      />

      {/* クリーム寄りの白フラッシュ（最前面） */}
      {flashOpacity > 0.01 && (
        <AbsoluteFill
          style={{
            background:
              "radial-gradient(circle at 50% 45%, rgba(255,249,235,1) 0%, rgba(255,244,220,0.88) 45%, rgba(250,234,204,0.55) 100%)",
            opacity: flashOpacity,
            pointerEvents: "none",
          }}
        />
      )}
    </AbsoluteFill>
  );
};
