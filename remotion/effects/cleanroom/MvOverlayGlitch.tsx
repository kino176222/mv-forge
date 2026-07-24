import React from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";

/**
 * MvOverlayGlitch — デジタルグリッチ家族のオーバーレイ部品（クリーンルーム実装）。
 * 技法メモとポスターの雰囲気のみを根拠に白紙から作成。children を必ず全面描画し、
 * その上に「行スライス／RGBフリンジ／走査線・粒ノイズ」を重ねる。
 *
 * variant(0..1) → 4プリセット:
 *   0.00 SHAKE   9分割スライス＋粗グリッドスナップ＋軽ズーム＋減彩。手ブレ寄りの荒れ
 *   0.33 MONO    完全モノクロ＋白飛ばしベースに虹色エッジゴーストと水平グレア
 *   0.67 MELT    行/列ノイズ二段変位→モザイク化の一本鎖。冒頭に歪み軸の垂直⇔水平フリック
 *   1.00 PSYCH   輝度→5ストップのサイケ着色＋細行コーム＋大チャンク帯＋高密度走査線
 *
 * 動きの本体はイージングではなく「量子化とホールド」: 約0.1秒刻みのtickごとに
 * 決定論ハッシュで姿勢を確定して保持し、カクッと切り替える。全体は台形エンベロープ
 * （先頭基準の立ち上げ×終端相対の抜きをmin合成、短尺は比例圧縮）で包む。
 * Math.random 不使用・外部素材ゼロ・SVGフィルタidはインスタンスごとに一意化。
 */
export interface MvOverlayGlitchProps {
  children: React.ReactNode; // 下の絵。全面に描画して上に質感を重ねる
  durationInFrames: number;
  intensity?: number; // 0..100
  variant?: number; // 0..1 同家族内の見た目分岐（決定論的に）
  tint?: string; // 任意: 基調色の差し替え（空/未指定=デザイン既定）
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const smooth = (t: number) => {
  const x = clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
};
// 決定論ハッシュ乱数（フレーム再現可能）
const hash01 = (a: number, b: number, c: number) => {
  const s = Math.sin(a * 127.1 + b * 311.7 + c * 74.7 + 13.37) * 43758.5453123;
  return s - Math.floor(s);
};
// 小さい値が出やすい二乗バイアス付きの符号つき乱数 (-1..1)
const biased = (r: number) => {
  const t = r * 2 - 1;
  return Math.sign(t) * t * t;
};
const snap = (v: number, grid: number) => Math.round(v / grid) * grid;

// 粒ノイズタイル（50%グレー中心 → overlay合成で無効時に中立）
const GRAIN_URI = `data:image/svg+xml;utf8,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="140" height="140">' +
    '<filter id="g"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="7" stitchTiles="stitch"/>' +
    '<feColorMatrix type="matrix" values="0.33 0.33 0.33 0 0.17 0.33 0.33 0.33 0 0.17 0.33 0.33 0.33 0 0.17 0 0 0 0 1"/></filter>' +
    '<rect width="140" height="140" filter="url(#g)"/></svg>',
)}`;

export const MvOverlayGlitch: React.FC<MvOverlayGlitchProps> = ({
  children,
  durationInFrames,
  intensity = 100,
  variant = 0,
  tint,
}) => {
  const frame = useCurrentFrame();
  const { width, height, fps } = useVideoConfig();
  const rawId = React.useId();
  const uid = `movg${rawId.replace(/[^a-zA-Z0-9]/g, "")}`;

  const dur = Math.max(1, durationInFrames);
  const preset = Math.round(clamp(variant, 0, 1) * 3); // 0..3
  const k = clamp(intensity, 0, 100) / 100;
  const sw = width / 1920; // フルHD基準のpxスケール

  // ── 台形エンベロープ（イン=先頭基準 / アウト=終端相対、min合成。短尺は比例圧縮）
  const ramp = Math.min(fps, Math.max(2, Math.floor(dur / 6)));
  const env = Math.min(smooth(frame / ramp), smooth((dur - 1 - frame) / ramp));
  const amp = env * k; // マスター強度

  // ── 量子化tick（約0.1〜0.12秒ホールド）
  const hold = Math.max(2, Math.round(fps * 0.12));
  const tick = Math.floor(frame / hold);
  const vSeed = preset * 131 + Math.floor(clamp(variant, 0, 1) * 97);

  // ── 全画面ウィグルだけは乱数キー間をsmoothstep補間して滑らかに
  const wHold = 6;
  const wk = Math.floor(frame / wHold);
  const wf = smooth((frame % wHold) / wHold);
  const wigAmp = preset === 0 ? 0.008 : 0.0025;
  const wx =
    (biased(hash01(wk, 1, vSeed)) + (biased(hash01(wk + 1, 1, vSeed)) - biased(hash01(wk, 1, vSeed))) * wf) *
    width *
    wigAmp *
    amp;
  const wy =
    (biased(hash01(wk, 2, vSeed)) + (biased(hash01(wk + 1, 2, vSeed)) - biased(hash01(wk, 2, vSeed))) * wf) *
    height *
    wigAmp *
    amp;
  const zoom = 1 + (preset === 0 ? 0.05 : 0.012) * amp;

  // ── フリンジ位置（tickで確定＋毎フレームの高速ジッタを少量）
  const fj = (hash01(frame, 9, vSeed) - 0.5) * 4 * sw;
  const fShift = (5 + 9 * hash01(tick, 17, vSeed)) * sw * amp + fj * amp;

  // ── 入り/抜けの一瞬だけ画面をグレー化する「色のまばたき」
  const blinkOn =
    (frame >= ramp - 2 && frame <= ramp) || (frame >= dur - 1 - ramp && frame <= dur - 1 - ramp + 2);

  // ── ベース色調（intensity<1でニュートラルへブレンド）
  let baseFilter = "";
  if (preset === 0) baseFilter = `saturate(${1 - 0.5 * amp}) brightness(${1 + 0.14 * amp}) contrast(${1 + 0.06 * amp})`;
  else if (preset === 1) baseFilter = `grayscale(${amp}) brightness(${1 + 0.32 * amp}) contrast(${1 + 0.2 * amp})`;
  else if (preset === 2) baseFilter = `saturate(${1 - 0.25 * amp})`;

  const baseTransform = `translate(${wx}px, ${wy}px) scale(${zoom})`;

  // ── 帯スライス描画（隙間には黒が覗く）
  const band = (key: string, y: number, bh: number, shift: number, filterStr: string, opacity = 1) => (
    <div
      key={key}
      style={{ position: "absolute", left: 0, top: y, width: "100%", height: bh, overflow: "hidden", background: "#000", opacity }}
    >
      <div
        style={{
          position: "absolute",
          left: 0,
          top: -y,
          width: "100%",
          height,
          transform: `translate(${wx + shift}px, ${wy}px) scale(${zoom})`,
          filter: filterStr || undefined,
        }}
      >
        <AbsoluteFill>{children}</AbsoluteFill>
      </div>
    </div>
  );

  // ── 細い帯＋太いチャンク帯を決定論生成（半数前後だけ活性）
  const grid = width * 0.03;
  const bands: React.ReactNode[] = [];
  if (amp > 0.02) {
    const thinN = preset === 0 ? 9 : preset === 1 ? 12 : preset === 3 ? 6 : 0;
    const doSnap = preset === 0 || preset === 1;
    const sliceGrade = preset === 3 ? `url(#${uid}-psy)` : baseFilter;
    for (let i = 0; i < thinN; i++) {
      if (hash01(tick, i, vSeed + 11) > 0.55) continue;
      const y = hash01(tick, i, vSeed + 23) * height * 0.95;
      const bh = (0.008 + hash01(tick, i, vSeed + 37) * 0.03) * height;
      let shift = biased(hash01(tick, i, vSeed + 53)) * width * 0.09 * amp;
      if (doSnap) shift = snap(shift, grid);
      if (Math.abs(shift) < 3 * sw) continue; // 変位が小さすぎる帯は描画しない
      let f = sliceGrade;
      if (preset === 0) {
        const tier = Math.floor(hash01(tick, i, vSeed + 61) * 3); // 強/弱/なしの3段階水平スメア
        if (tier === 1) f = `${f} url(#${uid}-hbw)`;
        else if (tier === 2) f = `${f} url(#${uid}-hbs)`;
      }
      bands.push(band(`t${i}`, y, bh, shift, f));
    }
    const chunkN = preset === 2 ? 0 : 3;
    for (let i = 0; i < chunkN; i++) {
      if (hash01(tick, i, vSeed + 211) > 0.6) continue;
      const y = hash01(tick, i, vSeed + 223) * height * 0.88;
      const bh = (0.05 + hash01(tick, i, vSeed + 237) * 0.1) * height;
      let shift = biased(hash01(tick, i, vSeed + 253)) * width * 0.12 * amp;
      shift = snap(shift, grid);
      if (Math.abs(shift) < 3 * sw) continue;
      bands.push(band(`c${i}`, y, bh, shift, sliceGrade));
    }
    if (preset === 0) {
      // 極細ストリーク帯（別枠で走る）
      for (let i = 0; i < 3; i++) {
        if (hash01(tick, i, vSeed + 401) > 0.4) continue;
        const y = hash01(tick, i, vSeed + 411) * height * 0.97;
        const shift = biased(hash01(tick, i, vSeed + 421)) * width * 0.18 * amp;
        if (Math.abs(shift) < 4 * sw) continue;
        bands.push(band(`s${i}`, y, Math.max(2, 3 * sw), shift, `${baseFilter} brightness(1.5) url(#${uid}-hbs)`, 0.9));
      }
    }
  }

  // ── MELT用: 歪み軸フリック（冒頭〜1.5秒で垂直⇔水平を2回）
  const tSec = frame / fps;
  const axisH = !((tSec >= 0.35 && tSec < 0.55) || (tSec >= 0.95 && tSec < 1.15));
  const rowScale = (axisH ? 70 : 14) * sw * amp * (0.6 + 0.8 * hash01(tick, 71, vSeed));
  const colScale = (axisH ? 12 : 60) * sw * amp * (0.6 + 0.8 * hash01(tick, 73, vSeed));
  const cell = Math.max(6, Math.round(10 * sw));
  const dot = 2;
  const dil = Math.round(cell / 2);

  // ── SVGフィルタ定義（idはインスタンス一意）
  const defs = (
    <svg width="0" height="0" style={{ position: "absolute" }}>
      <defs>
        {/* 単チャンネル抽出（screen合成で暗部は自然に消える） */}
        <filter id={`${uid}-red`} x="0%" y="0%" width="100%" height="100%">
          <feColorMatrix type="matrix" values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0" />
        </filter>
        <filter id={`${uid}-cyan`} x="0%" y="0%" width="100%" height="100%">
          <feColorMatrix type="matrix" values="0 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 1 0" />
        </filter>
        {/* 水平限定ブラー（弱/強） */}
        <filter id={`${uid}-hbw`} x="-5%" y="0%" width="110%" height="100%">
          <feGaussianBlur stdDeviation={`${5 * sw} 0`} />
        </filter>
        <filter id={`${uid}-hbs`} x="-8%" y="0%" width="116%" height="100%">
          <feGaussianBlur stdDeviation={`${14 * sw} 0`} />
        </filter>
        <filter id={`${uid}-vbw`} x="0%" y="-5%" width="100%" height="110%">
          <feGaussianBlur stdDeviation={`0 ${5 * sw}`} />
        </filter>
        {/* MONO用エッジゴースト: ハイライト抽出→水平ストリーク→単色化（黒地隔離のため領域を100%にクリップ） */}
        <filter id={`${uid}-gr`} x="0%" y="0%" width="100%" height="100%">
          <feColorMatrix type="matrix" values="0.7 0.7 0.7 0 -0.6  0.7 0.7 0.7 0 -0.6  0.7 0.7 0.7 0 -0.6  0 0 0 1 0" />
          <feGaussianBlur stdDeviation={`${16 * sw} 0`} />
          <feColorMatrix type="matrix" values="1.4 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0" />
        </filter>
        <filter id={`${uid}-gc`} x="0%" y="0%" width="100%" height="100%">
          <feColorMatrix type="matrix" values="0.7 0.7 0.7 0 -0.6  0.7 0.7 0.7 0 -0.6  0.7 0.7 0.7 0 -0.6  0 0 0 1 0" />
          <feGaussianBlur stdDeviation={`${16 * sw} 0`} />
          <feColorMatrix type="matrix" values="0 0 0 0 0  0 1.2 0 0 0  0 0 1.2 0 0  0 0 0 1 0" />
        </filter>
        <filter id={`${uid}-gg`} x="0%" y="0%" width="100%" height="100%">
          <feColorMatrix type="matrix" values="0.7 0.7 0.7 0 -0.6  0.7 0.7 0.7 0 -0.6  0.7 0.7 0.7 0 -0.6  0 0 0 1 0" />
          <feGaussianBlur stdDeviation={`${24 * sw} 0`} />
          <feColorMatrix type="matrix" values="0 0 0 0 0  0 1.3 0 0 0  0 0 0 0 0  0 0 0 1 0" />
        </filter>
        {/* MELT用: 行/列ノイズ二段変位マップ→モザイク（0.5中心ゲイン増幅、他軸は0.5固定＝不動） */}
        <filter id={`${uid}-mlk`} x="0%" y="0%" width="100%" height="100%">
          <feTurbulence type="fractalNoise" baseFrequency="0.0016 0.14" numOctaves="2" seed="19" result="rn" />
          <feColorMatrix in="rn" type="matrix" values="1.5 0 0 0 -0.25  0 0 0 0 0.5  0 0 0 0 0.5  0 0 0 0 1" result="rng" />
          <feDisplacementMap in="SourceGraphic" in2="rng" scale={rowScale} xChannelSelector="R" yChannelSelector="G" result="d1" />
          <feTurbulence type="fractalNoise" baseFrequency="0.12 0.0018" numOctaves="2" seed="31" result="cn" />
          <feColorMatrix in="cn" type="matrix" values="0 0 0 0 0.5  0 1.5 0 0 -0.25  0 0 0 0 0.5  0 0 0 0 1" result="cng" />
          <feDisplacementMap in="d1" in2="cng" scale={colScale} xChannelSelector="R" yChannelSelector="G" result="d2" />
          <feFlood x={Math.floor(cell * 0.4)} y={Math.floor(cell * 0.4)} width={dot} height={dot} floodColor="#ffffff" result="dotp" />
          <feComposite in="dotp" in2="dotp" operator="in" x="0" y="0" width={cell} height={cell} result="cellp" />
          <feTile in="cellp" result="gridp" />
          <feComposite in="d2" in2="gridp" operator="in" result="sparse" />
          <feMorphology in="sparse" operator="dilate" radius={dil} />
        </filter>
        {/* PSYCH用: 輝度→5ストップ着色（紺→青→ピンク→橙→クリーム） */}
        <filter id={`${uid}-psy`} x="0%" y="0%" width="100%" height="100%">
          <feColorMatrix type="matrix" values="0.2126 0.7152 0.0722 0 0  0.2126 0.7152 0.0722 0 0  0.2126 0.7152 0.0722 0 0  0 0 0 1 0" />
          <feComponentTransfer>
            <feFuncR type="table" tableValues="0.04 0.13 0.93 1 1" />
            <feFuncG type="table" tableValues="0.06 0.27 0.27 0.6 0.91" />
            <feFuncB type="table" tableValues="0.19 0.87 0.67 0.2 0.75" />
          </feComponentTransfer>
        </filter>
      </defs>
    </svg>
  );

  // ── ほぼ無効時は素通し（childrenの契約は常に守る）
  if (amp <= 0.01) {
    return (
      <AbsoluteFill style={{ background: "#000" }}>
        <AbsoluteFill>{children}</AbsoluteFill>
      </AbsoluteFill>
    );
  }

  // ── プリセットごとの重ね
  let layers: React.ReactNode = null;

  if (preset === 0) {
    // SHAKE: スナップされた9分割スライス＋軽ズーム＋減彩・増明の手ブレ寄り
    layers = (
      <>
        <AbsoluteFill style={{ filter: baseFilter, transform: baseTransform }}>
          <AbsoluteFill>{children}</AbsoluteFill>
        </AbsoluteFill>
        {bands}
        <AbsoluteFill
          style={{ filter: `url(#${uid}-red)`, transform: `translate(${wx + fShift}px, ${wy}px) scale(${zoom})`, mixBlendMode: "screen", opacity: 0.75 * amp }}
        >
          <AbsoluteFill>{children}</AbsoluteFill>
        </AbsoluteFill>
        <AbsoluteFill
          style={{ filter: `url(#${uid}-cyan)`, transform: `translate(${wx - fShift}px, ${wy}px) scale(${zoom})`, mixBlendMode: "screen", opacity: 0.75 * amp }}
        >
          <AbsoluteFill>{children}</AbsoluteFill>
        </AbsoluteFill>
        <AbsoluteFill
          style={{
            backgroundImage: "repeating-linear-gradient(0deg, rgba(0,0,0,0.16) 0px, rgba(0,0,0,0.16) 1px, transparent 2px, transparent 4px)",
            opacity: 0.5 * amp,
          }}
        />
      </>
    );
  } else if (preset === 1) {
    // MONO: 完全モノクロ＋白飛ばし。多段ゴーストで虹色フリンジ、白グレアと毎フレームジッタ
    const gy = hash01(tick, 5, vSeed) * height * 0.85;
    const g1 = 18 * sw * amp + fj;
    layers = (
      <>
        <AbsoluteFill style={{ filter: baseFilter, transform: baseTransform }}>
          <AbsoluteFill>{children}</AbsoluteFill>
        </AbsoluteFill>
        {bands}
        <AbsoluteFill style={{ filter: `url(#${uid}-gr)`, transform: `translateX(${g1}px)`, mixBlendMode: "screen", opacity: 0.7 * amp }}>
          <AbsoluteFill>{children}</AbsoluteFill>
        </AbsoluteFill>
        <AbsoluteFill style={{ filter: `url(#${uid}-gc)`, transform: `translateX(${-g1}px)`, mixBlendMode: "screen", opacity: 0.7 * amp }}>
          <AbsoluteFill>{children}</AbsoluteFill>
        </AbsoluteFill>
        <AbsoluteFill style={{ filter: `url(#${uid}-gg)`, transform: `translateX(${g1 * 1.9}px)`, mixBlendMode: "screen", opacity: 0.4 * amp }}>
          <AbsoluteFill>{children}</AbsoluteFill>
        </AbsoluteFill>
        <div
          style={{
            position: "absolute",
            left: 0,
            top: gy,
            width: "100%",
            height: height * 0.08,
            background: "linear-gradient(180deg, transparent, rgba(255,255,255,0.55), transparent)",
            filter: `blur(${6 * sw}px)`,
            mixBlendMode: "screen",
            opacity: 0.5 * amp,
          }}
        />
        <AbsoluteFill
          style={{
            backgroundImage: "repeating-linear-gradient(0deg, rgba(0,0,0,0.14) 0px, rgba(0,0,0,0.14) 1px, transparent 2px, transparent 3px)",
            opacity: 0.55 * amp,
          }}
        />
      </>
    );
  } else if (preset === 2) {
    // MELT: 一本のフィルタ鎖（二段変位→モザイク）＋上下RGB分離＋進行方向ブラー
    const splitY = 6 * sw * amp;
    const dirBlur = axisH ? `url(#${uid}-hbw)` : `url(#${uid}-vbw)`;
    layers = (
      <>
        <AbsoluteFill style={{ filter: baseFilter, transform: baseTransform }}>
          <AbsoluteFill>{children}</AbsoluteFill>
        </AbsoluteFill>
        <AbsoluteFill style={{ filter: `url(#${uid}-mlk)`, transform: baseTransform, opacity: Math.min(1, amp * 1.6) }}>
          <AbsoluteFill>{children}</AbsoluteFill>
        </AbsoluteFill>
        <AbsoluteFill
          style={{ filter: `url(#${uid}-red) ${dirBlur}`, transform: `translate(${fShift}px, ${-splitY}px)`, mixBlendMode: "screen", opacity: 0.6 * amp }}
        >
          <AbsoluteFill>{children}</AbsoluteFill>
        </AbsoluteFill>
        <AbsoluteFill
          style={{ filter: `url(#${uid}-cyan) ${dirBlur}`, transform: `translate(${-fShift}px, ${splitY}px)`, mixBlendMode: "screen", opacity: 0.6 * amp }}
        >
          <AbsoluteFill>{children}</AbsoluteFill>
        </AbsoluteFill>
      </>
    );
  } else {
    // PSYCH: 5ストップ着色＋左右逆方向の細行コーム（片方だけ縞マスク）＋大チャンク帯＋高密度走査線
    const comb = width * 0.02 * amp * (0.5 + 0.5 * hash01(tick, 5, vSeed));
    const combMask = "repeating-linear-gradient(180deg, #000 0px, #000 2px, transparent 2px, transparent 4px)";
    layers = (
      <>
        <AbsoluteFill style={{ transform: baseTransform }}>
          <AbsoluteFill>{children}</AbsoluteFill>
        </AbsoluteFill>
        <AbsoluteFill style={{ filter: `url(#${uid}-psy)`, transform: `translate(${wx - comb}px, ${wy}px) scale(${zoom})`, opacity: Math.min(1, amp * 1.4) }}>
          <AbsoluteFill>{children}</AbsoluteFill>
        </AbsoluteFill>
        <AbsoluteFill
          style={{
            filter: `url(#${uid}-psy)`,
            transform: `translate(${wx + comb}px, ${wy}px) scale(${zoom})`,
            opacity: Math.min(1, amp * 1.4),
            WebkitMaskImage: combMask,
            maskImage: combMask,
          }}
        >
          <AbsoluteFill>{children}</AbsoluteFill>
        </AbsoluteFill>
        {bands}
        <AbsoluteFill
          style={{ filter: `url(#${uid}-red)`, transform: `translateX(${fShift}px)`, mixBlendMode: "screen", opacity: 0.5 * amp }}
        >
          <AbsoluteFill>{children}</AbsoluteFill>
        </AbsoluteFill>
        {/* 600本級の走査線＋赤/シアンの周期違い干渉縞 */}
        <AbsoluteFill
          style={{
            backgroundImage: "repeating-linear-gradient(0deg, rgba(0,0,0,0.32) 0px, rgba(0,0,0,0.32) 1px, transparent 1px, transparent 2px)",
            opacity: 0.85 * amp,
          }}
        />
        <AbsoluteFill
          style={{
            backgroundImage:
              "repeating-linear-gradient(0deg, rgba(255,45,45,0.25) 0px, rgba(255,45,45,0.25) 1px, transparent 1px, transparent 3px), repeating-linear-gradient(0deg, rgba(45,220,255,0.25) 0px, rgba(45,220,255,0.25) 1px, transparent 1px, transparent 3.4px)",
            mixBlendMode: "overlay",
            opacity: 0.7 * amp,
          }}
        />
      </>
    );
  }

  return (
    <AbsoluteFill style={{ background: "#000", pointerEvents: "none", overflow: "hidden" }}>
      {defs}
      {layers}
      {/* 基調色の差し替え（任意） */}
      {tint ? <AbsoluteFill style={{ background: tint, mixBlendMode: "color", opacity: 0.35 * amp }} /> : null}
      {/* 粒ノイズ（50%グレー中心タイル、overlay合成） */}
      <AbsoluteFill style={{ backgroundImage: `url("${GRAIN_URI}")`, mixBlendMode: "overlay", opacity: 0.5 * amp }} />
      {/* 入り/抜けの一瞬グレー化（切り替えの合図） */}
      {blinkOn ? <AbsoluteFill style={{ backdropFilter: "grayscale(1)", WebkitBackdropFilter: "grayscale(1)" }} /> : null}
    </AbsoluteFill>
  );
};
