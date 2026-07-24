import React from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";

/**
 * MvOverlayHandheldCam — 手持ちカメラ風の演出家族。
 * クリーンルーム実装（技法メモとポスターの雰囲気のみを根拠に白紙から作成）。
 *
 * 素材(children)には一切手を入れず、外側の仮想カメラ（translate＋scale＋微回転）
 * だけで「人が構えたカメラ」の質感を作るラッパー型オーバーレイ。
 *
 * variant(0..1) → 3プリセット:
 *   0.0 CAMERA   ズーム余白型。台形エンベロープで約10%ズームイン＋滑らかな
 *                値ノイズパン（幅2%弱）＋ズーム微ジッタ。パン量をズーム余白の
 *                内側に収めるので縁埋め不要。薄い色収差（SVGカラー行列で
 *                R/G/Bを分解し、赤を左・青を右へ1px弱ずらしてscreen再合成）。
 *   0.5 HANDHELD 揺れ主体型。ズームは5%と控えめ、2オクターブ値ノイズ＋
 *                低周波正弦スウェイの大きめ揺れを3×3ミラータイルで受ける。
 *                色エフェクト無し。
 *   1.0 WALKING  一方通行型。等速で1.0→1.4倍までズームインし続け、全軸
 *                同位相の歩きバウンス（縦は1-cosの片側、横は1/4スウェイ、
 *                1度未満の同期回転）。終盤は縦長デフォーカス。縁埋めは
 *                十字ミラー4枚。
 *
 * 完全決定論（Math.random不使用）。外部素材なし・CSS/SVG/remotion標準のみ。
 * 解像度非依存: ピクセル量はフルHD幅基準の比率で持ち width/1920 でスケール。
 */
export interface MvOverlayHandheldCamProps {
  children: React.ReactNode;
  durationInFrames: number;
  intensity?: number; // 0..100
  variant?: number; // 0..1 家族内の見た目分岐（決定論的）
  tint?: string; // 任意: 基調色。未指定=無着色（この家族は色をほぼ使わない）
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const smoothstep = (t: number) => {
  const u = clamp(t, 0, 1);
  return u * u * (3 - 2 * u);
};

// シード付きハッシュ乱数（決定論・同フレーム=同結果）
const hash01 = (n: number) => {
  const s = Math.sin(n * 91.17 + 47.13) * 43758.5453123;
  return s - Math.floor(s);
};
const hashSigned = (n: number) => hash01(n) * 2 - 1;

// 格子状の値ノイズ: 隣接格子点の乱数目標をsmoothstep補間した滑らかチャンネル
const vnoise = (sec: number, hz: number, seed: number) => {
  const x = sec * hz;
  const i = Math.floor(x);
  const f = x - i;
  const a = hashSigned(i * 2.236 + seed * 71.3);
  const b = hashSigned((i + 1) * 2.236 + seed * 71.3);
  return a + (b - a) * smoothstep(f);
};

// 2オクターブ合成: ゆっくりした主揺れ＋4倍速の細かい揺れを3割弱
const wobble2 = (sec: number, hz: number, seed: number) =>
  vnoise(sec, hz, seed) * 0.75 + vnoise(sec, hz * 4, seed + 5.5) * 0.28;

type Cam = { x: number; y: number; rot: number; z: number };
const camCss = (c: Cam) =>
  `translate(${c.x.toFixed(2)}px, ${c.y.toFixed(2)}px) rotate(${c.rot.toFixed(3)}deg) scale(${c.z.toFixed(4)})`;

// 3×3ミラータイル: 中央だけ素、周囲8枚は共有辺で鏡像連続。
// 継ぎ目の1px隙間対策に全タイルをごく僅か拡大しておく。
const MirrorTiles3x3: React.FC<{ w: number; h: number; children: React.ReactNode }> = ({ w, h, children }) => (
  <div style={{ position: "absolute", left: -w, top: -h, width: w * 3, height: h * 3 }}>
    {[0, 1, 2].map((r) =>
      [0, 1, 2].map((c) => (
        <div
          key={`${r}-${c}`}
          style={{
            position: "absolute",
            left: c * w,
            top: r * h,
            width: w,
            height: h,
            overflow: "hidden",
            transform: `scale(${(c === 1 ? 1 : -1) * 1.004}, ${(r === 1 ? 1 : -1) * 1.004})`,
            zIndex: r === 1 && c === 1 ? 1 : 0,
          }}
        >
          {children}
        </div>
      ))
    )}
  </div>
);

// 十字ミラー: 上下左右4方向だけ反転クローンを背後に敷き、中央に素を最前面で重ねる
const MirrorCross: React.FC<{ w: number; h: number; children: React.ReactNode }> = ({ w, h, children }) => (
  <>
    {([
      [`translateY(${-h}px) scaleY(-1.004)`], // 上
      [`translateY(${h}px) scaleY(-1.004)`], // 下
      [`translateX(${-w}px) scaleX(-1.004)`], // 左
      [`translateX(${w}px) scaleX(-1.004)`], // 右
    ] as string[][]).map(([t], i) => (
      <AbsoluteFill key={i} style={{ transform: t }}>
        {children}
      </AbsoluteFill>
    ))}
    <AbsoluteFill>{children}</AbsoluteFill>
  </>
);

export const MvOverlayHandheldCam: React.FC<MvOverlayHandheldCamProps> = ({
  children,
  durationInFrames,
  intensity = 60,
  variant = 0,
  tint,
}) => {
  const frame = useCurrentFrame();
  const { width, height, fps } = useVideoConfig();
  const dur = Math.max(1, durationInFrames);
  const k = clamp(intensity, 0, 100) / 100;
  const preset = Math.round(clamp(variant, 0, 1) * 2); // 0..2
  const rs = width / 1920; // 解像度スケール（フルHD幅基準）
  const sec = frame / fps;
  const seed = 3.7 + preset * 17.9;

  // 台形エンベロープ: 立ち上がりは先頭基準・収束は終端基準で読みmin合成。
  // 中間は1が保たれ、任意の尺に伸縮する。最終フレーム直前でちょうど無効果。
  const trapezoid = (attackSec: number, releaseSec: number) => {
    const a = Math.max(2, Math.min(Math.round(fps * attackSec), Math.floor(dur * 0.45)));
    const r = Math.max(2, Math.min(Math.round(fps * releaseSec), Math.floor(dur * 0.4)));
    return smoothstep(Math.min(clamp(frame / a, 0, 1), clamp((dur - 1 - frame) / r, 0, 1)));
  };

  let cam: Cam = { x: 0, y: 0, rot: 0, z: 1 };
  let caShiftPx = 0; // 色収差の片側ずれ幅
  let blurPx = 0; // 終盤デフォーカス量
  let fill: "none" | "tiles" | "cross" = "none";
  let envNow = 0;

  if (preset === 0) {
    // ---- CAMERA: ズーム余白型。パン量<ズーム余白を常に保ち縁埋め不要 ----
    const env = trapezoid(1.8, 1.3);
    const e = env * k;
    envNow = env;

    // 滑らかなWriggle風パン（幅の2%弱）。X/Y/ズームでシードを変え無相関に
    const pan = width * 0.018 * e;
    const x = wobble2(sec, 0.55, seed + 1) * pan;
    const y = wobble2(sec, 0.47, seed + 2) * pan * 0.8;
    // 約10%ズームイン＋ズーム自体の微ジッタ
    const z = 1 + 0.1 * e + vnoise(sec, 1.3, seed + 3) * 0.007 * e;
    cam = { x, y, rot: 0, z };

    // 薄い色収差: ずれ幅はエンベロープ比例、1/4px未満は分岐でスキップ
    caShiftPx = 0.9 * rs * e;
    if (caShiftPx < 0.25) caShiftPx = 0;
  } else if (preset === 1) {
    // ---- HANDHELD: 揺れ主体型。ノイズ2オクターブ＋正弦スウェイをタイルで受ける ----
    const env = trapezoid(1.5, 1.1);
    const e = env * k;
    envNow = env;

    const amp = width * 0.026 * e; // 振幅上限は画面幅の2〜3%
    // 大きなドリフト（値ノイズ2オクターブ）＋体の重心が揺れる低周波正弦スウェイ
    const x = wobble2(sec, 1.7, seed + 11) * amp + Math.sin((sec * Math.PI * 2) / 2.1 + 0.7) * amp * 0.35;
    const y = wobble2(sec, 1.45, seed + 12) * amp * 0.85 + Math.sin((sec * Math.PI * 2) / 1.7 + 2.9) * amp * 0.3;
    const rot = vnoise(sec, 1.1, seed + 13) * 0.6 * e;
    const z = 1 + 0.05 * e; // ズームは控えめ、揺れはタイルが受ける
    cam = { x, y, rot, z };
    fill = "tiles";
  } else {
    // ---- WALKING: 一方通行型。等速ズームイン＋同位相の歩きバウンス ----
    const p = clamp(frame / dur, 0, 1);
    const attack = smoothstep(frame / Math.max(2, Math.round(fps * 0.45))); // 歩き出しだけ短く立ち上げ
    envNow = attack;

    const phase = sec * Math.PI * 2 * 1.15; // 周期1秒弱の歩調
    const bounce = height * 0.013 * k * attack;
    const y = (1 - Math.cos(phase)) * 0.5 * bounce; // 片側バウンス（下方向のみ）
    const x = Math.sin(phase) * bounce * 0.25; // 横はその1/4の±スウェイ
    const rot = Math.sin(phase - 0.6) * 0.55 * k * attack; // 1度未満の同期回転ブレ
    const z = 1 + 0.4 * p; // 尺全体で1.0→1.4へ等速ズームイン（intensity非依存で完遂）
    cam = { x, y, rot, z };
    fill = "cross";

    // 終盤デフォーカス: 進行度比例の控えめなガウス。極小のうちは素通し
    blurPx = 4.5 * rs * k * smoothstep((p - 0.62) / 0.38);
    if (blurPx < 0.35) blurPx = 0;
  }

  const inner =
    fill === "tiles" ? (
      <MirrorTiles3x3 w={width} h={height}>
        {children}
      </MirrorTiles3x3>
    ) : fill === "cross" ? (
      <MirrorCross w={width} h={height}>
        {children}
      </MirrorCross>
    ) : (
      <AbsoluteFill>{children}</AbsoluteFill>
    );

  // 縦長ボケ近似: Xを2〜3割縮めた空間で等方ブラー→元に戻すサンドイッチ。
  // 内側で1/0.75倍に広げた絵をブラー後0.75倍へ潰すので、X方向のボケだけ縮む。
  const camLayer = (
    <AbsoluteFill style={{ transform: camCss(cam) }}>
      {blurPx > 0 ? (
        <AbsoluteFill style={{ transform: "scaleX(0.75)", filter: `blur(${blurPx.toFixed(2)}px)` }}>
          <AbsoluteFill style={{ transform: "scaleX(1.3334)" }}>{inner}</AbsoluteFill>
        </AbsoluteFill>
      ) : (
        inner
      )}
    </AbsoluteFill>
  );

  // 薄い色収差: R/G/B単独抽出の3枚を赤=左/青=右へずらし黒背景上でscreen再合成
  const body =
    caShiftPx > 0 ? (
      <>
        <svg width="0" height="0" style={{ position: "absolute" }}>
          <defs>
            <filter id="mvhcChR" colorInterpolationFilters="sRGB">
              <feColorMatrix type="matrix" values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0" />
            </filter>
            <filter id="mvhcChG" colorInterpolationFilters="sRGB">
              <feColorMatrix type="matrix" values="0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0" />
            </filter>
            <filter id="mvhcChB" colorInterpolationFilters="sRGB">
              <feColorMatrix type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0" />
            </filter>
          </defs>
        </svg>
        {([
          ["url(#mvhcChR)", -caShiftPx],
          ["url(#mvhcChG)", 0],
          ["url(#mvhcChB)", caShiftPx],
        ] as Array<[string, number]>).map(([f, dx], i) => (
          <AbsoluteFill
            key={i}
            style={{ filter: f, transform: `translateX(${dx.toFixed(2)}px)`, mixBlendMode: "screen" }}
          >
            {camLayer}
          </AbsoluteFill>
        ))}
      </>
    ) : (
      camLayer
    );

  // 任意の基調色: ごく薄いoverlayで色味を差すのみ（既定は無着色）
  const tintLayer =
    tint && envNow * k > 0.02 ? (
      <AbsoluteFill
        style={{
          background: `radial-gradient(circle at 50% 50%, ${tint} 0%, transparent 70%)`,
          mixBlendMode: "overlay",
          opacity: 0.14 * envNow * k,
        }}
      />
    ) : null;

  return (
    <AbsoluteFill style={{ background: "#000", overflow: "hidden", pointerEvents: "none" }}>
      {body}
      {tintLayer}
    </AbsoluteFill>
  );
};
