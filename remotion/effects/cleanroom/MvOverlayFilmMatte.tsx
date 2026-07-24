import React from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig, interpolate } from "remotion";

/**
 * MvOverlayFilmMatte — 「黒いマット（遮光板）に窓を開け、その中に映像を収める」
 * フィルム上映風オーバーレイ家族。クリーンルーム実装（技法メモとポスターの
 * 雰囲気のみを根拠に白紙から作成）。
 *
 * レイヤーは下から: 1)全面の黒地 2)素の映像（点滅の消灯コマや intensity<1 で透ける）
 * 3)マット一式（黒地→窓→色収差→グレイン→縁の軟化）を不透明度エンベロープで出し入れ。
 * 冒頭は1コマ単位の矩形波点滅で立ち上がり、末尾は逆順で黒へ落ちる。頭と尻だけ
 * ジッターバースト（縦コマ飛び＋輝度ブレ）。乱数はすべて tick×seed の決定論ハッシュ。
 *
 * variant(0..1) → 8プリセット:
 *   0/7 CENTER-SHRINK  中央窓に縮小映像＋映像内色収差ミックス＋マット雲テクスチャ
 *   1/7 SQUARE-GHOST   正方形窓＋窓ユニット丸ごと赤/青ゴースト（消灯コマは完全黒）
 *   2/7 SLIT-REVEAL    点滅なし・縦スリットが cos イーズで開閉＋ラフ縁
 *   3/7 BARREL-GLOW    樽型に膨らむ窓＋縁外へ滲むハレーション＋彩度増し
 *   4/7 SCAN-SLIVER    上下に前後コマのスリバー＋灰/シアングレード＋正弦ウィーブ
 *   5/7 SPROCKET       右寄せ窓＋左マージンに橙グロウのスプロケット穴
 *   6/7 MINIMAL-BAR    全高中央窓＋左右黒バー＋細い赤/青フリンジ線（約8Hzジッター）
 *   7/7 TORN-FRAME     台形エンベロープ＋ラフ縁＋45°色収差再構成＋ブルーム＋パンチイン
 *
 * intensity(0..100) で揺れ・色収差・グレインを一括減衰、0 で素の映像に完全復帰。
 * px 値は 1920 幅基準で width/1920 スケール。完全決定論（Math.random 不使用）。
 */
export interface MvOverlayFilmMatteProps {
  children: React.ReactNode;
  durationInFrames: number;
  intensity?: number; // 0..100
  variant?: number; // 0..1 家族内の見た目分岐
  tint?: string; // 任意: 基調アクセント色の差し替え
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const cosEase = (t: number) => (1 - Math.cos(Math.PI * clamp(t, 0, 1))) / 2;

/** 決定論ハッシュ: tick とシードから 0..1 を引く（レンダー決定的） */
const hash01 = (n: number, seed: number) => {
  let x = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(seed + 0x165667b1, 0xc2b2ae35);
  x = Math.imul(x ^ (x >>> 13), 0x27d4eb2f);
  x ^= x >>> 15;
  return (x >>> 0) / 4294967296;
};

/** モノクロ・フラクタルノイズのタイル（SVG手続き生成、外部素材なし） */
const GRAIN_TILE = `data:image/svg+xml;utf8,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="240"><filter id="g"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" stitchTiles="stitch" seed="7"/><feColorMatrix type="saturate" values="0"/><feComponentTransfer><feFuncA type="linear" slope="0" intercept="1"/></feComponentTransfer></filter><rect width="240" height="240" filter="url(#g)"/></svg>',
)}`;

/** 低周波の雲状ノイズ（マット面の紙質感用） */
const CLOUD_TILE = `data:image/svg+xml;utf8,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="480" height="480"><filter id="c"><feTurbulence type="fractalNoise" baseFrequency="0.008" numOctaves="3" stitchTiles="stitch" seed="3"/><feColorMatrix type="saturate" values="0"/><feComponentTransfer><feFuncA type="linear" slope="0" intercept="1"/></feComponentTransfer></filter><rect width="480" height="480" filter="url(#c)"/></svg>',
)}`;

const RED = "#ff3040";
const CYAN = "#2bd0ff";
const BLUE = "#3b7bff";

type Win = { x: number; y: number; w: number; h: number };

export const MvOverlayFilmMatte: React.FC<MvOverlayFilmMatteProps> = ({
  children,
  durationInFrames,
  intensity = 100,
  variant = 0,
  tint,
}) => {
  const frame = useCurrentFrame();
  const { width, height, fps } = useVideoConfig();

  const W = width;
  const H = height;
  const s = width / 1920;
  const preset = Math.round(clamp(variant, 0, 1) * 7); // 0..7
  const seed = 101 + preset * 37;
  const k = clamp(intensity, 0, 100) / 100;

  // ── テンプレ時間軸: 24fps相当の tick（出力fpsに依らず同じ見え方） ──
  const tickF = (frame / fps) * 24;
  const tick = Math.floor(tickF);
  const durTicksF = Math.max(1, (durationInFrames / fps) * 24);
  const durTicks = Math.max(1, Math.round(durTicksF));

  // ── 出入りエンベロープ（1コマ矩形波点滅。イン=先頭基準/アウト=終端相対、min合成） ──
  const IN_TICKS = 6; // 約1/4秒
  const OUT_TICKS = 7; // 約0.3秒
  const u = durTicks - 1 - tick;
  const gateIn = tick >= IN_TICKS ? 1 : tick % 2;
  const gateOut = u >= OUT_TICKS ? 1 : u % 2;
  const gate = Math.min(gateIn, gateOut);

  // ── ジッターバースト（頭と尻のみ。0ホールドの max 合成） ──
  const jitterEnv = Math.max(tick < IN_TICKS ? 1 : 0, u < OUT_TICKS ? 1 : 0);
  const hasFlicker = preset !== 2 && preset !== 7;
  const jEnv = hasFlicker ? jitterEnv : 0;
  const jTick = preset === 6 ? Math.floor(tick / 3) : tick; // 6番は約8Hzで点滅と同期感
  const jumpY = jEnv * (hash01(jTick, seed + 5) - 0.5) * 2 * 0.035 * H * k;
  const jBright = 1 + jEnv * (hash01(jTick, seed + 6) - 0.5) * 0.9 * k;

  // ── ゲートウィーブ（常時、縦優位の微振動。2tick刻み乱数の線形補間） ──
  const wi = Math.floor(tickF / 2);
  const wf = tickF / 2 - wi;
  let weaveX = (lerp(hash01(wi, seed + 11), hash01(wi + 1, seed + 11), wf) - 0.5) * 2 * 2.5 * s * k;
  let weaveY = (lerp(hash01(wi, seed + 12), hash01(wi + 1, seed + 12), wf) - 0.5) * 2 * 5 * s * k;
  if (preset === 4) {
    // 周波数の違う正弦波を複数合成したゆっくり揺れ
    weaveY = ((Math.sin(tickF * 0.55) + 0.6 * Math.sin(tickF * 1.35 + 1.7) + 0.35 * Math.sin(tickF * 2.9 + 0.6)) / 1.95) * 4.5 * s * k;
    weaveX = Math.sin(tickF * 0.42 + 2.2) * 1.2 * s * k;
  }

  // ── マット一式の不透明度 ──
  let matteOpacity: number;
  if (preset === 2) {
    matteOpacity = k; // 点滅なし
  } else if (preset === 7) {
    // 台形エンベロープ（点滅なしのフェード）
    const fadeIn = cosEase(interpolate(tickF, [0, 9], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }));
    const fadeOut = cosEase(interpolate(durTicksF - tickF, [0, 9], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }));
    matteOpacity = Math.min(fadeIn, fadeOut) * k;
  } else {
    matteOpacity = gate * k;
  }

  // ── 窓の中身（フル解像度の映像を窓中心に置く。縮小型は scale 指定） ──
  const content = (
    win: Win,
    opts: {
      scale?: number;
      filter?: string;
      blend?: React.CSSProperties["mixBlendMode"];
      opacity?: number;
      dx?: number;
      dy?: number;
    } = {},
  ) => {
    const { scale = 1, filter, blend, opacity = 1, dx = 0, dy = 0 } = opts;
    return (
      <div
        style={{
          position: "absolute",
          left: -win.x,
          top: -win.y,
          width: W,
          height: H,
          transform: `translate(${weaveX + dx}px, ${weaveY + jumpY + dy}px) scale(${scale})`,
          transformOrigin: `${win.x + win.w / 2}px ${win.y + win.h / 2}px`,
          filter,
          mixBlendMode: blend,
          opacity,
        }}
      >
        <AbsoluteFill>{children}</AbsoluteFill>
      </div>
    );
  };

  const windowBox = (win: Win, style: React.CSSProperties, kids: React.ReactNode) => (
    <div
      style={{
        position: "absolute",
        left: win.x,
        top: win.y,
        width: win.w,
        height: win.h,
        overflow: "hidden",
        ...style,
      }}
    >
      {kids}
    </div>
  );

  /** 窓の縁の軟化＋内周の弱いビネット */
  const soften = (strength = 1, radius?: number) => (
    <div
      style={{
        position: "absolute",
        inset: 0,
        borderRadius: radius,
        boxShadow: `inset 0 0 ${22 * s * strength}px rgba(0,0,0,0.55), inset 0 0 ${90 * s * strength}px rgba(0,0,0,0.3)`,
        pointerEvents: "none",
      }}
    />
  );

  /** 全面グレイン（粒は毎テンプレフレームで飛ばす） */
  const grain = (opacity: number, blend: React.CSSProperties["mixBlendMode"] = "overlay") => (
    <AbsoluteFill
      style={{
        backgroundImage: `url("${GRAIN_TILE}")`,
        backgroundRepeat: "repeat",
        backgroundPosition: `${Math.floor(hash01(tick, seed + 21) * 240)}px ${Math.floor(hash01(tick, seed + 22) * 240)}px`,
        mixBlendMode: blend,
        opacity: opacity * k,
      }}
    />
  );

  // マット面は真っ黒ではなく僅かに持ち上げた黒
  const matteGround = <AbsoluteFill style={{ backgroundColor: "#070707" }} />;

  const accent = tint && tint.length > 0 ? tint : "#ff8a3c"; // 暖色（橙）が既定

  // ── プリセット別のマット一式 ──
  let assembly: React.ReactNode = null;

  if (preset === 0) {
    // CENTER-SHRINK: 中央窓（幅1/2×高さ5/8）に約0.63倍で収める。映像内色収差ミックス＋雲テクスチャ
    const win: Win = { x: 0.25 * W, y: 0.1875 * H, w: 0.5 * W, h: 0.625 * H };
    const r = 10 * s;
    const d = 3.5 * s * k;
    assembly = (
      <>
        {matteGround}
        <AbsoluteFill
          style={{
            backgroundImage: `url("${CLOUD_TILE}")`,
            backgroundRepeat: "repeat",
            mixBlendMode: "screen",
            opacity: 0.055,
          }}
        />
        {windowBox(win, { borderRadius: r, backgroundColor: "#000" }, (
          <>
            {content(win, { scale: 0.63, filter: "saturate(0.72)" })}
            {content(win, { scale: 0.63, filter: "url(#fmRedCh) saturate(0.72)", blend: "screen", opacity: 0.4 * k, dx: d, dy: 0 })}
            {content(win, { scale: 0.63, filter: "url(#fmCyanCh) saturate(0.72)", blend: "screen", opacity: 0.4 * k, dx: -d, dy: 0 })}
            {soften(1, r)}
          </>
        ))}
        {grain(0.16)}
      </>
    );
  } else if (preset === 1) {
    // SQUARE-GHOST: 高さほぼいっぱいの正方形窓＋窓ユニット丸ごと赤/青ゴースト（斜めずらし＋ぼかし）
    const side = 0.92 * H;
    const win: Win = { x: (W - side) / 2, y: (H - side) / 2, w: side, h: side };
    const r = 14 * s;
    const gx = 7 * s * k;
    const gy = 5 * s * k;
    assembly = (
      <>
        {matteGround}
        {windowBox({ ...win, x: win.x + gx, y: win.y - gy }, { borderRadius: r }, content(win, { filter: `url(#fmRedCh) blur(${6 * s}px)`, opacity: 0.55 * k }))}
        {windowBox({ ...win, x: win.x - gx, y: win.y + gy }, { borderRadius: r }, content(win, { filter: `url(#fmCyanCh) blur(${6 * s}px)`, opacity: 0.55 * k }))}
        {windowBox(win, { borderRadius: r, backgroundColor: "#000" }, (
          <>
            {content(win, { filter: "saturate(0.78)" })}
            {soften(1, r)}
          </>
        ))}
        {grain(0.15)}
      </>
    );
  } else if (preset === 2) {
    // SLIT-REVEAL: 点滅なし。幅1/3の縦スリットが前半で開き後半で閉じる（cosイーズ）。縁はラフ化
    const prog = clamp(tickF / durTicksF, 0, 1);
    const open = cosEase(clamp(Math.min(prog, 1 - prog) * 2, 0, 1));
    const slitW = open * 0.34 * W;
    const win: Win = { x: (W - slitW) / 2, y: 0, w: slitW, h: H };
    assembly = (
      <>
        {matteGround}
        {slitW > 2 &&
          windowBox(win, { filter: "url(#fmRoughA)" }, (
            <>
              {content(win, { filter: "saturate(0.8)" })}
              <div style={{ position: "absolute", top: 0, bottom: 0, left: 0, width: 1.5 * s, background: RED, opacity: 0.45 * k }} />
              <div style={{ position: "absolute", top: 0, bottom: 0, right: 0, width: 1.5 * s, background: CYAN, opacity: 0.45 * k }} />
              {soften(0.9)}
            </>
          ))}
        {grain(0.12)}
      </>
    );
  } else if (preset === 3) {
    // BARREL-GLOW: 四辺が樽型に膨らむ窓＋縁の外へ滲むハレーション。彩度は増し方向
    const win: Win = { x: 0.14 * W, y: 0.11 * H, w: 0.72 * W, h: 0.78 * H };
    assembly = (
      <>
        {matteGround}
        <div
          style={{
            position: "absolute",
            inset: 0,
            WebkitMaskImage: `radial-gradient(ellipse ${win.w * 0.62}px ${win.h * 0.62}px at 50% 50%, #000 52%, transparent 80%)`,
            maskImage: `radial-gradient(ellipse ${win.w * 0.62}px ${win.h * 0.62}px at 50% 50%, #000 52%, transparent 80%)`,
            mixBlendMode: "screen",
            opacity: 0.45 * k,
          }}
        >
          {content({ x: 0, y: 0, w: W, h: H }, { filter: `blur(${22 * s}px) brightness(1.5) saturate(1.5)` })}
        </div>
        {windowBox(win, { clipPath: "url(#fmBarrel)" }, (
          <>
            {content(win, { filter: "saturate(1.35) contrast(1.05)" })}
            {soften(1.1)}
          </>
        ))}
        {grain(0.14)}
      </>
    );
  } else if (preset === 4) {
    // SCAN-SLIVER: 上下に前後コマのスリバーが覗く本格スキャン。灰saturation＋シアンsoft-lightのグレード
    const gap = 10 * s;
    const sliverH = 0.045 * H;
    const win: Win = { x: 0.065 * W, y: sliverH + gap, w: 0.87 * W, h: H - 2 * (sliverH + gap) };
    const top: Win = { x: win.x, y: 0, w: win.w, h: sliverH };
    const bot: Win = { x: win.x, y: H - sliverH, w: win.w, h: sliverH };
    const grade = "saturate(0.82)";
    const coolTint = tint && tint.length > 0 ? tint : CYAN;
    assembly = (
      <>
        {matteGround}
        {windowBox(top, {}, content(top, { filter: grade, dy: -0.9 * H }))}
        {windowBox(bot, {}, content(bot, { filter: grade, dy: 0.9 * H }))}
        {windowBox(win, { borderRadius: 8 * s, backgroundColor: "#000" }, (
          <>
            {content(win, { filter: grade })}
            {soften(1, 8 * s)}
          </>
        ))}
        <div style={{ position: "absolute", top: 0, bottom: 0, left: win.x - 4 * s, width: 3 * s, background: RED, opacity: 0.5 * k, filter: `blur(${1.5 * s}px)` }} />
        <div style={{ position: "absolute", top: 0, bottom: 0, left: win.x + win.w + 1 * s, width: 3 * s, background: BLUE, opacity: 0.5 * k, filter: `blur(${1.5 * s}px)` }} />
        <AbsoluteFill style={{ backgroundColor: "#9a9a9a", mixBlendMode: "saturation", opacity: 0.5 * k }} />
        <AbsoluteFill style={{ backgroundColor: coolTint, mixBlendMode: "soft-light", opacity: 0.26 * k }} />
        {grain(0.2)}
        {grain(0.08, "screen")}
      </>
    );
  } else if (preset === 5) {
    // SPROCKET: 窓を右寄せし、左マージンに橙アウトライン＋二重グロウのスプロケット穴2個
    const win: Win = { x: 0.145 * W, y: 0.05 * H, w: 0.825 * W, h: 0.9 * H };
    const r = 16 * s;
    const hole = (y: number) => (
      <div
        style={{
          position: "absolute",
          left: 0.035 * W,
          top: y,
          width: 0.075 * W,
          height: 0.09 * H,
          borderRadius: 10 * s,
          border: `${3 * s}px solid ${accent}`,
          boxShadow: `0 0 ${10 * s}px ${accent}, 0 0 ${30 * s}px ${accent}, inset 0 0 ${8 * s}px ${accent}`,
          opacity: 0.85 * k,
        }}
      />
    );
    assembly = (
      <>
        {matteGround}
        {hole(0.06 * H)}
        {hole(0.85 * H)}
        {windowBox(win, { borderRadius: r, backgroundColor: "#000", boxShadow: `0 0 0 ${1.5 * s}px rgba(80,130,255,0.3)` }, (
          <>
            {content(win, { filter: "saturate(0.85)" })}
            {soften(1, r)}
          </>
        ))}
        {grain(0.14)}
        {grain(0.1, "screen")}
      </>
    );
  } else if (preset === 6) {
    // MINIMAL-BAR: 全高の中央窓＋巨大inset影で左右黒バー。色収差は細い赤/青ボーダー線のみ
    const win: Win = { x: 0.16 * W, y: 0, w: 0.68 * W, h: H };
    assembly = (
      <>
        {matteGround}
        {windowBox(win, { backgroundColor: "#000" }, (
          <>
            {content(win, { filter: "saturate(0.8)" })}
            <div style={{ position: "absolute", inset: 0, boxShadow: `inset 0 0 ${140 * s}px rgba(0,0,0,0.9)` }} />
          </>
        ))}
        <div style={{ position: "absolute", top: 0, bottom: 0, left: win.x - 2 * s, width: 2 * s, background: RED, opacity: 0.7 * k }} />
        <div style={{ position: "absolute", top: 0, bottom: 0, left: win.x + win.w, width: 2 * s, background: BLUE, opacity: 0.7 * k }} />
        {grain(0.13)}
      </>
    );
  } else {
    // TORN-FRAME: ラフ縁マスク＋45°色収差の2複製再構成＋ブルーム＋強ビネット＋リビール時パンチイン
    const win: Win = { x: 0.045 * W, y: 0.075 * H, w: 0.91 * W, h: 0.85 * H };
    const introEase = cosEase(clamp(tickF / 9, 0, 1));
    const punch = 1 + 0.04 * (1 - introEase); // 数%のパンチインからの戻し
    const d = 3.2 * s * k;
    assembly = (
      <>
        {matteGround}
        {windowBox(win, { filter: "url(#fmRoughB)" }, (
          <>
            {content(win, { scale: punch, filter: "url(#fmCyanCh)", dx: -d, dy: -d })}
            {content(win, { scale: punch, filter: "url(#fmRedCh)", blend: "screen", dx: d, dy: d })}
            {content(win, { scale: punch, filter: `blur(${18 * s}px) brightness(1.4)`, blend: "screen", opacity: 0.3 * k })}
            <div style={{ position: "absolute", inset: 0, boxShadow: `inset 0 0 ${160 * s}px rgba(0,0,0,0.75)` }} />
          </>
        ))}
        {grain(0.16)}
      </>
    );
  }

  return (
    <AbsoluteFill style={{ backgroundColor: "#000", pointerEvents: "none" }}>
      {/* SVGフィルタ定義（チャンネル分離・ラフ縁変位・樽型クリップ。すべて手続き生成） */}
      <svg width={0} height={0} style={{ position: "absolute" }} aria-hidden>
        <defs>
          <filter id="fmRedCh">
            <feColorMatrix type="matrix" values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0" />
          </filter>
          <filter id="fmCyanCh">
            <feColorMatrix type="matrix" values="0 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 1 0" />
          </filter>
          <filter id="fmRoughA" x="-10%" y="-10%" width="120%" height="120%">
            <feTurbulence type="fractalNoise" baseFrequency="0.045" numOctaves="3" seed="11" result="n" />
            <feDisplacementMap in="SourceGraphic" in2="n" scale={9 * s} xChannelSelector="R" yChannelSelector="G" />
          </filter>
          <filter id="fmRoughB" x="-10%" y="-10%" width="120%" height="120%">
            <feTurbulence type="fractalNoise" baseFrequency="0.02" numOctaves="3" seed="5" result="n" />
            <feDisplacementMap in="SourceGraphic" in2="n" scale={18 * s} xChannelSelector="R" yChannelSelector="G" />
          </filter>
          <clipPath id="fmBarrel" clipPathUnits="objectBoundingBox">
            <path d="M0.06,0.07 Q0.5,0.02 0.94,0.07 Q0.99,0.5 0.94,0.93 Q0.5,0.98 0.06,0.93 Q0.01,0.5 0.06,0.07 Z" />
          </clipPath>
        </defs>
      </svg>

      {/* 素の映像（マットが透けた瞬間・intensity減衰時の下地。常時フル描画） */}
      <AbsoluteFill>{children}</AbsoluteFill>

      {/* マット一式（不透明度エンベロープで丸ごと出入り。バースト中は輝度ブレ） */}
      <AbsoluteFill style={{ opacity: matteOpacity, filter: jBright !== 1 ? `brightness(${jBright})` : undefined }}>
        {assembly}
      </AbsoluteFill>

      {/* SQUARE-GHOST のみ: 消灯コマは完全な黒を返す */}
      {preset === 1 && gate < 1 && <AbsoluteFill style={{ backgroundColor: "#000", opacity: (1 - gate) * k }} />}
    </AbsoluteFill>
  );
};
