import React from "react";
import { AbsoluteFill, Freeze, useCurrentFrame, useVideoConfig } from "remotion";

/**
 * MvOverlayStrobe — 「ビートに合う周期的な断続」を作るストロボ家族のクリーンルーム実装。
 * 技法メモのみを根拠に白紙から作成。children（下の絵）は必ず全面に描画し、
 * その上に時間操作 or 光の振動を重ねる非破壊オーバーレイ。
 *
 * variant(0..1) で家族内の 2 個体を分岐:
 *   variant < 0.5 … STUTTER: 時間軸の量子化。フリーズ2枚＋1コマ極短クロスフェードの
 *                   コマ送り。強度は3段階の離散切替（強のみグリッド起点オフセット）。
 *   variant >= 0.5 … STROBE LIGHT: 明部だけ抽出した寒色ライト層を screen 合成し、
 *                   約2Hzの滑らか値ノイズで不規則点滅＋縦微揺れ。台形エンベロープ。
 *
 * 完全決定論（Math.random 不使用）。位相は設計時 24 コマ/秒の時間軸で進めるので
 * 実レンダ fps が 60 でもリズムは変わらない。
 */
export interface MvOverlayStrobeProps {
  children: React.ReactNode;
  durationInFrames: number;
  intensity?: number; // 0..100
  variant?: number; // 0..1 家族内分岐（決定論的）
  tint?: string; // 基調色の差し替え（未指定=デザイン既定の寒色）
}

// ---- 決定論ユーティリティ -------------------------------------------------

const DESIGN_FPS = 24; // 設計時のフレーム刻み（位相はこの時間軸で進める）

const clamp = (n: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, n));

/** 整数インデックス＋シード → 0..1 の決定論ハッシュ乱数 */
const hash01 = (i: number, seed: number): number => {
  let h = (Math.imul(i | 0, 374761393) + Math.imul(seed | 0, 668265263)) >>> 0;
  h = (h ^ (h >>> 13)) >>> 0;
  h = Math.imul(h, 1274126177) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  return h / 4294967296;
};

/** smoothstep(3t^2 - 2t^3) 補間の滑らか値ノイズ（時間×周波数、シード付き） */
const valueNoise = (t: number, freq: number, seed: number): number => {
  const x = t * freq;
  const i = Math.floor(x);
  const f = x - i;
  const s = f * f * (3 - 2 * f);
  const a = hash01(i, seed);
  const b = hash01(i + 1, seed);
  return a + (b - a) * s;
};

// ---- 個体1: 時間量子化型（コマ送り／ストップモーション風） -----------------

const StutterBody: React.FC<{
  children: React.ReactNode;
  norm: number; // 0..1
  fps: number;
}> = ({ children, norm, fps }) => {
  const frame = useCurrentFrame();
  const t = frame / fps; // 実時間（秒）

  // 強度は連続値でなく3段階の離散切替
  const level = Math.min(2, Math.floor(norm * 3)); // 0,1,2
  const HOLD = [1 / 12, 1 / 6, 0.45][level]; // 保持長（秒）
  const anchor = level === 2 ? 1 / 3 : 0; // 強のみグリッド起点をオフセット
  const designFrameSec = 1 / DESIGN_FPS;

  // 冒頭（アンカー前）はほぼ先頭のコマで止める
  if (t < anchor) {
    const headFrame = Math.max(0, Math.round(designFrameSec * fps));
    return (
      <AbsoluteFill>
        <Freeze frame={headFrame}>
          <AbsoluteFill>{children}</AbsoluteFill>
        </Freeze>
      </AbsoluteFill>
    );
  }

  // 時刻→直近ゲート（floor 除算）。保持コマは「ゲート直後の1コマ」
  const gateIndex = Math.max(0, Math.floor((t - anchor) / HOLD));
  const gateTime = anchor + gateIndex * HOLD;
  const heldSec = gateTime + designFrameSec;
  const prevHeldSec = Math.max(designFrameSec, gateTime - HOLD + designFrameSec);

  const heldFrame = Math.round(heldSec * fps);
  const prevHeldFrame = Math.round(prevHeldSec * fps);

  // 切替直後の約1コマ（1/24秒）だけ上の面を線形0→1。完了後は下の面を描画しない
  const fade = clamp((t - gateTime) / designFrameSec, 0, 1);
  const showPrev = fade < 1 && gateIndex > 0;

  return (
    <AbsoluteFill>
      {showPrev && (
        <AbsoluteFill>
          <Freeze frame={prevHeldFrame}>
            <AbsoluteFill>{children}</AbsoluteFill>
          </Freeze>
        </AbsoluteFill>
      )}
      <AbsoluteFill style={{ opacity: showPrev ? fade : 1 }}>
        <Freeze frame={heldFrame}>
          <AbsoluteFill>{children}</AbsoluteFill>
        </Freeze>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

// ---- 個体2: 明滅ライト型（ストロボ照明風） --------------------------------

const DEFAULT_TINT = "#a8e6e2"; // 氷っぽい寒色（青緑系の淡いシアン）。暖色にしない

const StrobeLightBody: React.FC<{
  children: React.ReactNode;
  norm: number; // 0..1
  fps: number;
  durationInFrames: number;
  tint: string;
  seed: number;
}> = ({ children, norm, fps, durationInFrames, tint, seed }) => {
  const frame = useCurrentFrame();
  const { height } = useVideoConfig();
  const t = frame / fps;
  const remain = Math.max(0, durationInFrames - 1 - frame) / fps;

  // 台形エンベロープ: イン=先頭からの経過 / アウト=終端からの残り を別読みして min 合成
  const fadeIn = clamp(t / 0.5, 0, 1);
  const fadeOut = clamp(remain / 0.45, 0, 1);
  const envelope = Math.min(fadeIn, fadeOut) * 0.75;

  // 位相は設計フレーム刻みに量子化した時刻で進める（fps非依存）
  const tq = Math.floor(t * DESIGN_FPS) / DESIGN_FPS;

  // 約2Hzの滑らか値ノイズで不規則点滅（深さ7割: 明るさ 30%〜100% を往復）
  const flicker = 0.3 + 0.7 * valueNoise(tq, 2, seed);

  // 同ノイズの別チャンネルで縦に±10px（フルHD基準・解像度比スケール）漂わせる
  const bob = (valueNoise(tq, 2, seed + 7919) * 2 - 1) * 10 * (height / 1080);

  const lightOpacity = envelope * flicker * norm;

  return (
    <AbsoluteFill style={{ isolation: "isolate" }}>
      {/* 基層＝元映像そのまま。絶対に隠し切らない */}
      <AbsoluteFill>{children}</AbsoluteFill>
      {lightOpacity > 0.004 && (
        <AbsoluteFill
          style={{
            mixBlendMode: "screen", // 光を「足すだけ」なので破綻しない
            opacity: lightOpacity,
            transform: `translateY(${bob.toFixed(2)}px)`,
            isolation: "isolate", // 内側の multiply が外に漏れないように
          }}
        >
          {/* ライト・クローン: 脱色→強コントラストで明部を隔離→明度持ち上げ */}
          <AbsoluteFill
            style={{ filter: "grayscale(1) contrast(2.6) brightness(1.2)" }}
          >
            {children}
          </AbsoluteFill>
          {/* 単色面を乗算で被せ、白部分を寒色に染める */}
          <AbsoluteFill
            style={{ backgroundColor: tint, mixBlendMode: "multiply" }}
          />
        </AbsoluteFill>
      )}
    </AbsoluteFill>
  );
};

// ---- エクスポート本体 ------------------------------------------------------

export const MvOverlayStrobe: React.FC<MvOverlayStrobeProps> = ({
  children,
  durationInFrames,
  intensity = 100,
  variant = 0,
  tint,
}) => {
  const { fps } = useVideoConfig();
  const norm = clamp(intensity, 0, 100) / 100;
  const v = clamp(variant, 0, 1);
  const seed = 1 + Math.floor(v * 997); // variant から決定論的にシード生成

  // intensity ほぼゼロなら完全素通し（非破壊の契約）
  if (norm < 0.02) {
    return <AbsoluteFill>{children}</AbsoluteFill>;
  }

  if (v < 0.5) {
    return (
      <StutterBody norm={norm} fps={fps}>
        {children}
      </StutterBody>
    );
  }

  return (
    <StrobeLightBody
      norm={norm}
      fps={fps}
      durationInFrames={Math.max(1, durationInFrames)}
      tint={tint && tint.length > 0 ? tint : DEFAULT_TINT}
      seed={seed}
    >
      {children}
    </StrobeLightBody>
  );
};
