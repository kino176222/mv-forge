import React, { useId } from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";

/**
 * MvOverlayEdgeGlow — 「エッジ発光ルック」家族のクリーンルーム実装。
 * 輪郭だけを発光させ、ベースを沈める装飾オーバーレイ（遷移ではなくクリップ全体にかかる）。
 * 手本 MvOverlayFrameCR と同じ契約: children を必ず全面描画し、その上に効果を重ねる。
 *
 * 骨格は台形エンベロープ1本（区分線形・緩急なし）。イン側は先頭からの経過秒、
 * アウト側は終端までの残り秒でカーブを読み min 合成 → 任意尺で破綻しない。
 * env ≒ 0 のとき完全に恒等（素の映像）へ戻る。
 *
 * variant(0..1) → 4プリセット:
 *   0.00 WAVE-MONO   モノクロ沈め＋彩度2倍の素材色エッジ＋白熱グロウ＋暗部の暗青カラライズ
 *                    ＋シード固定の水平バンプ歪み＋中立グレイン
 *   0.33 RGB-DRIFT   ラプラシアン不使用。R/G/B単離3層を真下方向に段違いシフトしscreen合成、
 *                    無シフト複製をdifference(85%)で重ねフラット部を消し輪郭差分だけ虹色に残す。
 *                    常時ブラー＋中央ズーム往復(最大1.3倍強)が第2の時間軸
 *   0.66 PINK-GLEAM  エッジ層最多（コア/広域ハロー/水平ストリーク/±色相プリズム2枚の
 *                    plus-lighter加算）。エンベロープ2本: 発光は約1/3秒で速く、
 *                    ベース沈めは約1秒遅れて入る。ティントはホットピンク系
 *   1.00 FRINGE-FOG  ラプラシアン不使用のもう一系統。グレスケ画のG+Bだけ半分ブラーし
 *                    シャープなRと算術合成で足し直す「チャンネルブラー」→赤/シアンの色ずれ縁。
 *                    寒色トーンはフェード中のみ、仕上げは中＋大ブラー2枚の霧ブルーム。アウト約1秒
 *
 * 完全に決定論的（Math.random不使用）。外部素材なし・CSS/SVG/remotion標準のみ。
 * 罠対策: SVGフィルタはプリミティブごとに0..1へクランプされるため、
 * 強い輝度ゲインはフィルタ内でなく blur 後の CSS brightness() で掛けている。
 */
export interface MvOverlayEdgeGlowProps {
  children: React.ReactNode; // 下の絵。全面に描画して上に質感を重ねる
  durationInFrames: number;
  intensity?: number; // 0..100
  variant?: number; // 0..1 同家族内の見た目分岐（決定論的）
  tint?: string; // 任意: 基調色の差し替え（空/未指定=デザイン既定）
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

const hexToRgb = (hex?: string): [number, number, number] | null => {
  if (!hex) return null;
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!m) return null;
  const v = parseInt(m[1], 16);
  return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255];
};

/** 区分線形ランプ: 0秒→0, secs秒→1（secs<=0なら常に1） */
const ramp = (elapsedSec: number, secs: number) =>
  secs <= 0 ? 1 : clamp(elapsedSec / secs, 0, 1);

export const MvOverlayEdgeGlow: React.FC<MvOverlayEdgeGlowProps> = ({
  children,
  durationInFrames,
  intensity = 100,
  variant = 0,
  tint,
}) => {
  const frame = useCurrentFrame();
  const { width, height, fps } = useVideoConfig();
  const rawId = useId();
  const uid = `meg${rawId.replace(/[^a-zA-Z0-9_-]/g, "")}`;

  const v = clamp(variant, 0, 1);
  const preset = Math.round(v * 3); // 0..3
  const k = clamp(intensity, 0, 100) / 100;
  const dur = Math.max(1, durationInFrames);
  const s = width / 1920; // 解像度非依存: px系はFHD基準比でスケール

  const t = frame / fps; // 先頭からの経過秒
  const remain = (dur - 1 - frame) / fps; // 終端までの残り秒

  // プリセット別のイン/アウト秒（区分線形・バウンスなし）
  const inSec = [0.5, 0.6, 0.35, 0.5][preset];
  const outSec = [0.5, 0.6, 0.5, 1.0][preset]; // FRINGE-FOGはアウト長め
  const envRaw = Math.min(ramp(t, inSec), ramp(remain, outSec));
  const env = envRaw * k;

  // PINK-GLEAM専用: ベース沈めは約1秒遅れて入る第2エンベロープ
  const envBaseRaw = Math.min(ramp(t - 0.9, 1.0), ramp(remain, outSec));
  const envBase = envBaseRaw * k;

  // フェード中のみ効く量（ホールド中=0）: FRINGE-FOGの寒色トーン用
  const coolAmount = clamp(4 * envRaw * (1 - envRaw), 0, 1) * k;

  // 決定論シード
  const seedBase = Math.floor(11 + v * 53);
  // グレインの位相: 元フレームレート刻み(30fps tick)でジャンプ → fps非依存
  const tick = Math.floor(t * 30);
  const grainSeed = 101 + tick * 13 + Math.floor(v * 97);

  // 発光の呼吸（決定論的な緩急づけ。エンベロープ骨格は崩さない）
  const breath = 0.92 + 0.08 * Math.sin((t / 1.6) * Math.PI * 2 + v * 7);

  // ティント（未指定はプリセット既定）
  const tintRgb = hexToRgb(tint);
  const pink = tintRgb ?? [1.0, 0.55, 0.72]; // PINK-GLEAM既定
  const shadowLift = tint && tintRgb ? tint : "#0d1a33"; // WAVE-MONO暗部カラライズ既定
  const coolColor = tint && tintRgb ? tint : "#3a5a86"; // FRINGE-FOG寒色既定

  // 透明部を黒で埋めてscreen/加算合成を中立化するクローンの土台
  const cloneBase: React.CSSProperties = { background: "#000" };

  // ------- SVGフィルタ定義（全プリセット分。使用中のものだけ参照される） -------
  const dispScale = 26 * s * env; // 歪み量はエンベロープ連動
  const defs = (
    <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden>
      <defs>
        {/* 水平バンプ歪み: フラクタルノイズの縦変位チャンネルを50%固定して垂直変位を殺す */}
        <filter id={`${uid}-disp`} x="-5%" y="-5%" width="110%" height="110%" colorInterpolationFilters="sRGB">
          <feTurbulence
            type="fractalNoise"
            baseFrequency={`${(0.012 / s).toFixed(5)} ${(0.05 / s).toFixed(5)}`}
            numOctaves={2}
            seed={seedBase}
            stitchTiles="stitch"
            result="noise"
          />
          <feComponentTransfer in="noise" result="hNoise">
            <feFuncG type="linear" slope={0} intercept={0.5} />
          </feComponentTransfer>
          <feDisplacementMap
            in="SourceGraphic"
            in2="hNoise"
            scale={dispScale}
            xChannelSelector="R"
            yChannelSelector="G"
          />
        </filter>

        {/* エッジ抽出A（素材色系）: 前平滑→3x3ラプラシアン→彩度2倍→閾値+増幅の疑似2値化 */}
        <filter id={`${uid}-edgeColor`} x="-5%" y="-5%" width="110%" height="110%" colorInterpolationFilters="sRGB">
          <feGaussianBlur in="SourceGraphic" stdDeviation={1.2 * s} result="pre" />
          <feConvolveMatrix
            in="pre"
            order="3"
            kernelMatrix="-1 -1 -1 -1 8 -1 -1 -1 -1"
            divisor={1}
            preserveAlpha="true"
            result="lap"
          />
          <feColorMatrix in="lap" type="saturate" values="2" result="sat" />
          <feComponentTransfer in="sat">
            <feFuncR type="linear" slope={9} intercept={-0.35} />
            <feFuncG type="linear" slope={9} intercept={-0.35} />
            <feFuncB type="linear" slope={9} intercept={-0.35} />
          </feComponentTransfer>
        </filter>

        {/* エッジ抽出B（ティント系）: 前平滑→ラプラシアン→グレスケ→RGB係数行列でティント→閾値+増幅 */}
        <filter id={`${uid}-edgeTint`} x="-5%" y="-5%" width="110%" height="110%" colorInterpolationFilters="sRGB">
          <feGaussianBlur in="SourceGraphic" stdDeviation={1.2 * s} result="pre" />
          <feConvolveMatrix
            in="pre"
            order="3"
            kernelMatrix="-1 -1 -1 -1 8 -1 -1 -1 -1"
            divisor={1}
            preserveAlpha="true"
            result="lap"
          />
          <feColorMatrix in="lap" type="saturate" values="0" result="gray" />
          <feColorMatrix
            in="gray"
            type="matrix"
            values={`${pink[0]} 0 0 0 0  ${pink[1]} 0 0 0 0  ${pink[2]} 0 0 0 0  0 0 0 1 0`}
            result="tinted"
          />
          <feComponentTransfer in="tinted">
            <feFuncR type="linear" slope={8} intercept={-0.3} />
            <feFuncG type="linear" slope={8} intercept={-0.3} />
            <feFuncB type="linear" slope={8} intercept={-0.3} />
          </feComponentTransfer>
        </filter>

        {/* チャンネル単離（RGB-DRIFT用） */}
        <filter id={`${uid}-chR`} colorInterpolationFilters="sRGB">
          <feColorMatrix type="matrix" values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0" />
        </filter>
        <filter id={`${uid}-chG`} colorInterpolationFilters="sRGB">
          <feColorMatrix type="matrix" values="0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0" />
        </filter>
        <filter id={`${uid}-chB`} colorInterpolationFilters="sRGB">
          <feColorMatrix type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0" />
        </filter>

        {/* チャンネルブラー（FRINGE-FOG用）: グレスケ→G+Bのみブラー→シャープなRと算術加算で再合成。
            全パラメータがenv連動なので env=0 で恒等 */}
        <filter id={`${uid}-chanBlur`} x="-5%" y="-5%" width="110%" height="110%" colorInterpolationFilters="sRGB">
          <feColorMatrix in="SourceGraphic" type="saturate" values={String(1 - envRaw * k)} result="g" />
          <feColorMatrix in="g" type="matrix" values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0" result="rSharp" />
          <feColorMatrix in="g" type="matrix" values="0 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 1 0" result="gbOnly" />
          <feGaussianBlur in="gbOnly" stdDeviation={5.5 * s * env} result="gbBlur" />
          <feComposite in="rSharp" in2="gbBlur" operator="arithmetic" k1={0} k2={1} k3={1} k4={0} />
        </filter>

        {/* 中立フィルムグレイン: 50%グレー相当に圧縮したモノクロノイズ（overlayで±両方向の粒） */}
        <filter id={`${uid}-grain`} x="0%" y="0%" width="100%" height="100%" colorInterpolationFilters="sRGB">
          <feTurbulence type="fractalNoise" baseFrequency={0.9} numOctaves={2} seed={grainSeed} stitchTiles="stitch" />
          <feColorMatrix type="saturate" values="0" />
          <feComponentTransfer>
            <feFuncR type="linear" slope={0.5} intercept={0.25} />
            <feFuncG type="linear" slope={0.5} intercept={0.25} />
            <feFuncB type="linear" slope={0.5} intercept={0.25} />
            <feFuncA type="linear" slope={0} intercept={1} />
          </feComponentTransfer>
        </filter>
      </defs>
    </svg>
  );

  // ------- プリセット別レイヤー構成 -------
  let layers: React.ReactNode = null;

  if (preset === 0) {
    // WAVE-MONO: モノクロ沈め＋素材色エッジ＋白熱グロウ＋暗青カラライズ＋水平歪み＋グレイン
    // 歪みで出る画面端の透過を、変位量に応じた微ズームで画面外へ逃がす
    const wobble: React.CSSProperties = {
      transform: `scale(${1 + 0.025 * env})`,
    };
    layers = (
      <>
        {/* ベース層: グレースケール化＋軽いコントラスト増で沈める（歪みも共有） */}
        <AbsoluteFill style={cloneBase}>
          <AbsoluteFill
            style={{
              ...wobble,
              filter: `url(#${uid}-disp) grayscale(${0.92 * env}) contrast(${1 + 0.22 * env}) brightness(${1 - 0.14 * env})`,
            }}
          >
            {children}
          </AbsoluteFill>
        </AbsoluteFill>
        {/* 暗部を暗青に持ち上げるカラライズ */}
        <AbsoluteFill style={{ background: shadowLift, mixBlendMode: "lighten", opacity: 0.85 * env }} />
        {/* エッジ層: 彩度2倍の素材色エッジ */}
        <AbsoluteFill style={{ mixBlendMode: "screen", opacity: env }}>
          <AbsoluteFill style={cloneBase}>
            <AbsoluteFill style={{ ...wobble, filter: `url(#${uid}-disp) url(#${uid}-edgeColor) brightness(1.5)` }}>
              {children}
            </AbsoluteFill>
          </AbsoluteFill>
        </AbsoluteFill>
        {/* グロウ層: 白熱コア（小ブラー・輝度はblur後CSSで） */}
        <AbsoluteFill style={{ mixBlendMode: "screen", opacity: 0.75 * env * breath }}>
          <AbsoluteFill style={cloneBase}>
            <AbsoluteFill
              style={{ ...wobble, filter: `url(#${uid}-disp) url(#${uid}-edgeColor) blur(${9 * s}px) brightness(2.4)` }}
            >
              {children}
            </AbsoluteFill>
          </AbsoluteFill>
        </AbsoluteFill>
        {/* グロウ層: 広域ハロー（大ブラー・低不透明度） */}
        <AbsoluteFill style={{ mixBlendMode: "screen", opacity: 0.4 * env }}>
          <AbsoluteFill style={cloneBase}>
            <AbsoluteFill
              style={{ ...wobble, filter: `url(#${uid}-disp) url(#${uid}-edgeColor) blur(${36 * s}px) brightness(2)` }}
            >
              {children}
            </AbsoluteFill>
          </AbsoluteFill>
        </AbsoluteFill>
        {/* 質感層: 中立グレイン（tick刻みで位相ジャンプ） */}
        <svg
          width={width}
          height={height}
          style={{ position: "absolute", inset: 0, mixBlendMode: "overlay", opacity: 0.16 * env }}
          aria-hidden
        >
          <rect x={0} y={0} width={width} height={height} fill="#808080" filter={`url(#${uid}-grain)`} />
        </svg>
      </>
    );
  } else if (preset === 1) {
    // RGB-DRIFT: RGB単離3層の縦段違いシフト＋difference＋常時ブラー＋中央ズーム往復
    const shiftG = 7 * s * env;
    const shiftB = 14 * s * env;
    const zoomOsc = 0.5 - 0.5 * Math.cos((t / 2.4) * Math.PI * 2); // 滑らかな往復（第2の時間軸）
    const zoom = 1 + 0.32 * env * zoomOsc; // 最大1.3倍強
    layers = (
      <AbsoluteFill style={{ opacity: env, background: "#000" }}>
        <AbsoluteFill
          style={{
            transform: `scale(${zoom})`,
            filter: `blur(${5 * s * env}px)`, // 常時ブラー
          }}
        >
          {/* R層（土台・無シフト気味） */}
          <AbsoluteFill style={cloneBase}>
            <AbsoluteFill style={{ filter: `url(#${uid}-chR)` }}>{children}</AbsoluteFill>
          </AbsoluteFill>
          {/* G層: ほぼ真下に段違いシフト、screen合成 */}
          <AbsoluteFill style={{ mixBlendMode: "screen" }}>
            <AbsoluteFill style={cloneBase}>
              <AbsoluteFill style={{ filter: `url(#${uid}-chG)`, transform: `translate(${1 * s * env}px, ${shiftG}px)` }}>
                {children}
              </AbsoluteFill>
            </AbsoluteFill>
          </AbsoluteFill>
          {/* B層: さらに下へ */}
          <AbsoluteFill style={{ mixBlendMode: "screen" }}>
            <AbsoluteFill style={cloneBase}>
              <AbsoluteFill style={{ filter: `url(#${uid}-chB)`, transform: `translate(${-1 * s * env}px, ${shiftB}px)` }}>
                {children}
              </AbsoluteFill>
            </AbsoluteFill>
          </AbsoluteFill>
          {/* 無シフトのクローンをdifference(85%)で重ね、フラット部を消して輪郭差分だけ虹色に残す */}
          <AbsoluteFill style={{ mixBlendMode: "difference", opacity: 0.85 }}>
            <AbsoluteFill style={cloneBase}>{children}</AbsoluteFill>
          </AbsoluteFill>
        </AbsoluteFill>
      </AbsoluteFill>
    );
  } else if (preset === 2) {
    // PINK-GLEAM: コア/ハロー/水平ストリーク/±色相プリズム2枚の5枚plus-lighter加算。
    // 発光(env)は速く、ベース沈め(envBase)は約1秒遅れて入る
    const streakCompress = 3.5;
    layers = (
      <>
        {/* ベース層: レベル補正相当（黒を切り・白を抑え・持ち上げ）を遅れて適用 */}
        <AbsoluteFill style={cloneBase}>
          <AbsoluteFill
            style={{
              filter: `grayscale(${0.85 * envBase}) contrast(${1 + 0.28 * envBase}) brightness(${1 - 0.2 * envBase})`,
            }}
          >
            {children}
          </AbsoluteFill>
        </AbsoluteFill>
        {/* 1. エッジコア */}
        <AbsoluteFill style={{ mixBlendMode: "plus-lighter", opacity: env }}>
          <AbsoluteFill style={cloneBase}>
            <AbsoluteFill style={{ filter: `url(#${uid}-edgeTint) blur(${2.5 * s}px) brightness(1.6)` }}>
              {children}
            </AbsoluteFill>
          </AbsoluteFill>
        </AbsoluteFill>
        {/* 2. 広域ハロー */}
        <AbsoluteFill style={{ mixBlendMode: "plus-lighter", opacity: 0.5 * env * breath }}>
          <AbsoluteFill style={cloneBase}>
            <AbsoluteFill style={{ filter: `url(#${uid}-edgeTint) blur(${42 * s}px) brightness(2.2)` }}>
              {children}
            </AbsoluteFill>
          </AbsoluteFill>
        </AbsoluteFill>
        {/* 3. 水平ストリーク: 横圧縮空間でブラー→伸長で戻す異方性ブラー */}
        <AbsoluteFill style={{ mixBlendMode: "plus-lighter", opacity: 0.5 * env, transform: `scaleX(${streakCompress})` }}>
          <AbsoluteFill style={{ filter: `blur(${9 * s}px) brightness(1.9)` }}>
            <AbsoluteFill style={{ transform: `scaleX(${1 / streakCompress})` }}>
              <AbsoluteFill style={cloneBase}>
                <AbsoluteFill style={{ filter: `url(#${uid}-edgeTint)` }}>{children}</AbsoluteFill>
              </AbsoluteFill>
            </AbsoluteFill>
          </AbsoluteFill>
        </AbsoluteFill>
        {/* 4-5. ±色相プリズム: 左右に数pxずらし色相を±25度回した薄い複製 → 縁に虹のにじみ */}
        {[1, -1].map((dir) => (
          <AbsoluteFill key={dir} style={{ mixBlendMode: "plus-lighter", opacity: 0.28 * env }}>
            <AbsoluteFill style={cloneBase}>
              <AbsoluteFill
                style={{
                  filter: `url(#${uid}-edgeTint) blur(${14 * s}px) brightness(1.8) hue-rotate(${dir * 25}deg)`,
                  transform: `translateX(${dir * 5 * s}px)`,
                }}
              >
                {children}
              </AbsoluteFill>
            </AbsoluteFill>
          </AbsoluteFill>
        ))}
      </>
    );
  } else {
    // FRINGE-FOG: チャンネルブラーで赤/シアンの色ずれ縁＋中・大ブラー2枚の霧ブルーム。
    // 寒色トーンはフェード中のみ効く
    layers = (
      <>
        {/* ベース層: チャンネルブラー本体（env=0で恒等） */}
        <AbsoluteFill style={cloneBase}>
          <AbsoluteFill style={{ filter: `url(#${uid}-chanBlur)` }}>{children}</AbsoluteFill>
        </AbsoluteFill>
        {/* 霧ブルーム: 中ブラー */}
        <AbsoluteFill style={{ mixBlendMode: "screen", opacity: 0.35 * env * breath }}>
          <AbsoluteFill style={cloneBase}>
            <AbsoluteFill style={{ filter: `url(#${uid}-chanBlur) blur(${18 * s}px) brightness(1.55)` }}>
              {children}
            </AbsoluteFill>
          </AbsoluteFill>
        </AbsoluteFill>
        {/* 霧ブルーム: 大ブラー */}
        <AbsoluteFill style={{ mixBlendMode: "screen", opacity: 0.28 * env }}>
          <AbsoluteFill style={cloneBase}>
            <AbsoluteFill style={{ filter: `url(#${uid}-chanBlur) blur(${60 * s}px) brightness(1.45)` }}>
              {children}
            </AbsoluteFill>
          </AbsoluteFill>
        </AbsoluteFill>
        {/* 寒色トーン: フェード中のみ（ホールドでは0に戻る） */}
        <AbsoluteFill style={{ background: coolColor, mixBlendMode: "color", opacity: 0.55 * coolAmount }} />
      </>
    );
  }

  return (
    <AbsoluteFill style={{ pointerEvents: "none", background: "#000", isolation: "isolate", overflow: "hidden" }}>
      {defs}
      {/* childrenは常に全面描画（プリセット0/2/3はベース層として、1は素の下敷きとして） */}
      {preset === 1 ? <AbsoluteFill>{children}</AbsoluteFill> : null}
      {layers}
    </AbsoluteFill>
  );
};
