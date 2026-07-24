import React from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig, interpolate } from "remotion";

/**
 * MvOverlayImpactShake — 激しいカメラ演出のインパクト系オーバーレイ家族。
 * クリーンルーム実装（技法メモとポスターの雰囲気のみを根拠に白紙から作成）。
 *
 * 同一映像1枚に載せるカメラ演出であり、カット切替のトランジションではない。
 * children（下の絵）は一切加工せず、外側のラッパーが変形・複製・積層だけで
 * 迫力を作る。原本のシャープな1枚を必ず不透明で最下に残すのが鉄則。
 *
 * variant(0..1) → 4プリセット:
 *   0.00 PUNCH   一撃型。冒頭0.5秒で完結し以後は完全に素通し。
 *                階段状の粗い揺れ＋4方向screenエコー＋簡易ブラー包絡。
 *   0.33 QUAKE   クレッシェンド型。揺れとズームが全尺で直線的に育つ。
 *                値ノイズ多重揺れ＋シャッター開角サンプリング残像＋3×3ミラーラップ。
 *   0.67 SHAKE   台形持続型。入り0.5秒/抜け0.5秒をmin合成で読む持続揺れ。
 *                アナモルフィック非等方スケール＋放射ズームブラー＋周辺減光。
 *   1.00 WHIP    ホイップ型。強いS字で全尺丁度1回転（乱数なしの決定論）。
 *                角速度連動の角度スミア。intensityはスミアのみに効く。
 *
 * 完全決定論（Math.random不使用）。外部素材なし・CSS/remotion標準のみ。
 */
export interface MvOverlayImpactShakeProps {
  children: React.ReactNode; // 下の絵。全面に描画して上に質感を重ねる
  durationInFrames: number;
  intensity?: number; // 0..100
  variant?: number; // 0..1 同家族内の見た目分岐（決定論的）
  tint?: string; // 任意: 基調色。未指定=無着色（この家族は色をほぼ使わない）
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

// フレーム由来の決定論ハッシュ乱数（-1..1）。Math.random禁止の代替。
const hash01 = (n: number) => {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453123;
  return s - Math.floor(s);
};
const hashSigned = (n: number) => hash01(n) * 2 - 1;

// 階段状ノイズ: tick = floor(秒×更新周波数) ごとに目標値がジャンプ（fps非依存）
const stair = (sec: number, hz: number, seed: number) =>
  hashSigned(Math.floor(sec * hz) * 1.618 + seed * 57.7);

// 値ノイズ: 隣接する2つの乱数目標の間をsmoothstepで補間する滑らかチャンネル
const vnoise = (sec: number, hz: number, seed: number) => {
  const x = sec * hz;
  const i = Math.floor(x);
  const f = x - i;
  const a = hashSigned(i * 1.618 + seed * 57.7);
  const b = hashSigned((i + 1) * 1.618 + seed * 57.7);
  const u = f * f * (3 - 2 * f);
  return a + (b - a) * u;
};

// 両端に長い平坦部を持つ強いS字（中央の一瞬で回りきる）
const whipCurve = (t: number, sharpness: number) => {
  const tt = clamp(t, 0, 1);
  const p = Math.pow(tt, sharpness);
  const q = Math.pow(1 - tt, sharpness);
  return p / (p + q);
};

type Cam = { x: number; y: number; rot: number; sx: number; sy: number };
const camCss = (c: Cam) =>
  `translate(${c.x.toFixed(2)}px, ${c.y.toFixed(2)}px) rotate(${c.rot.toFixed(3)}deg) scale(${c.sx.toFixed(4)}, ${c.sy.toFixed(4)})`;

// 3×3の九宮格ミラーラップ: 中央だけ素、周囲8枚は共有辺で鏡像反転。
// 大回転・大揺れでも画面外が継ぎ目のない鏡張りで埋まる。外周タイルはやや伸長。
const MirrorTiles: React.FC<{ w: number; h: number; stretch?: number; children: React.ReactNode }> = ({
  w,
  h,
  stretch = 1.06,
  children,
}) => (
  <div style={{ position: "absolute", left: -w, top: -h, width: w * 3, height: h * 3 }}>
    {[0, 1, 2].map((r) =>
      [0, 1, 2].map((c) => {
        const sx = c === 1 ? 1 : -1;
        const sy = r === 1 ? 1 : -1;
        const outer = c !== 1 || r !== 1;
        const st = outer ? stretch : 1;
        return (
          <div
            key={`${r}-${c}`}
            style={{
              position: "absolute",
              left: c * w,
              top: r * h,
              width: w,
              height: h,
              overflow: "hidden",
              transform: `scale(${sx * st}, ${sy * st})`,
            }}
          >
            {children}
          </div>
        );
      })
    )}
  </div>
);

export const MvOverlayImpactShake: React.FC<MvOverlayImpactShakeProps> = ({
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
  const preset = Math.round(clamp(variant, 0, 1) * 3); // 0..3
  const rs = width / 1920; // 解像度スケール（設計基準フルHD比）
  const sec = frame / fps;
  const seed = 7.3 + preset * 13.9;

  let baseCam: Cam = { x: 0, y: 0, rot: 0, sx: 1, sy: 1 };
  let baseBlurPx = 0;
  let useMirror = false;
  let ghosts: React.ReactNode = null;
  let extras: React.ReactNode = null;
  let envNow = 0; // tint層などの強度参照用

  if (preset === 0) {
    // ---- PUNCH: 一撃型。冒頭0.5秒だけで完結、以後は完全に素通し ----
    const hitLen = Math.max(2, Math.min(dur, Math.round(fps * 0.5)));
    // 静止→急降下→短い保持→急復帰の台形的カーブ
    const envLin = interpolate(frame, [0, hitLen * 0.08, hitLen * 0.42, hitLen], [0, 1, 0.88, 0], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    });
    const env = Math.pow(envLin, 0.85); // 立ち上がりを少し尖らせる
    const e = env * k;
    envNow = env;

    baseCam = {
      x: stair(sec, 18, seed + 1) * 64 * rs * e,
      y: stair(sec, 18, seed + 2) * 44 * rs * e,
      rot: stair(sec, 13, seed + 3) * 2.4 * e,
      sx: 1 + 0.2 * e, // オーバースキャン兼パンチイン
      sy: 1 + 0.2 * e,
    };

    // 簡易CSSブラー包絡: 効果中ほぼ最大→終わり際に急減衰
    const blurEnv = interpolate(frame, [0, hitLen * 0.08, hitLen * 0.72, hitLen], [0, 1, 0.85, 0], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    });
    baseBlurPx = 3.2 * rs * k * blurEnv;

    // 方向性エコー: 上下左右4方向へ数%ずらした半透明コピーをscreen合成（打撃の分身感）
    if (e > 0.04) {
      const off = width * 0.026 * e;
      const dirs: Array<[number, number]> = [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ];
      ghosts = dirs.map(([dx, dy], i) => (
        <AbsoluteFill
          key={i}
          style={{
            transform: camCss({ ...baseCam, x: baseCam.x + dx * off, y: baseCam.y + dy * off }),
            opacity: 0.3 * env,
            mixBlendMode: "screen",
            filter: `blur(${(1.2 * rs).toFixed(2)}px)`,
          }}
        >
          {children}
        </AbsoluteFill>
      ));
    }
  } else if (preset === 1) {
    // ---- QUAKE: クレッシェンド型。揺れとズームがゼロから直線的に育つ ----
    const camAt = (f: number): Cam => {
      const s = f / fps;
      const g = clamp(f / dur, 0, 1) * k; // 直線的な成長
      const amp = 78 * rs * g;
      // 値ノイズ多重揺れ: 主揺れ＋やや速い副揺れ＋正弦波の常時ゆらぎ（X/Y別シード・位相をずらす）
      const x =
        (vnoise(s, 3.1, seed + 11) * 0.7 + vnoise(s, 7.7, seed + 12) * 0.35) * amp +
        Math.sin(s * 9.7 + 1.3) * 6 * rs * g;
      const y =
        (vnoise(s, 2.7, seed + 21) * 0.7 + vnoise(s, 8.3, seed + 22) * 0.35) * amp * 0.8 +
        Math.sin(s * 11.3 + 4.1) * 5 * rs * g;
      const rot = vnoise(s, 2.3, seed + 31) * 3.2 * g + Math.sin(s * 7.9 + 2.2) * 0.5 * g;
      const zoom = 1 + 0.3 * g;
      return { x, y, rot, sx: zoom, sy: zoom };
    };

    const g = clamp(frame / dur, 0, 1);
    envNow = g;
    baseCam = camAt(frame);
    useMirror = true;

    // シャッター開角サンプリング: 現在フレーム中心±0.85フレームの窓を等加重スタック
    // （下から 1/1, 1/2, 1/3 … で全サンプルが等しい重みで平均される）
    if (g * k > 0.04) {
      const offsets = [-0.85, -0.425, 0.425, 0.85];
      ghosts = offsets.map((off, i) => (
        <AbsoluteFill key={i} style={{ opacity: 1 / (i + 2) }}>
          <AbsoluteFill style={{ transform: camCss(camAt(frame + off)) }}>
            <AbsoluteFill style={{ transform: "scale(1.22)" }}>{children}</AbsoluteFill>
          </AbsoluteFill>
        </AbsoluteFill>
      ));
    }
  } else if (preset === 2) {
    // ---- SHAKE: 台形持続型。入り=先頭からの経過、抜け=終端までの残りをmin合成 ----
    const ramp = Math.max(2, Math.round(fps * 0.5));
    const attack = clamp(frame / ramp, 0, 1);
    const release = clamp((dur - frame) / ramp, 0, 1);
    const envLin = Math.min(1, attack, release); // 重要イディオム: 別々に読んでmin合成（尺可変対応）
    const env = envLin * envLin * (3 - 2 * envLin); // smoothstepで緩急
    const e = env * k;
    envNow = env;

    // 粗い階段状の重畳揺れ（周波数の異なる2チャンネル）＋微小回転
    const shakeX = (stair(sec, 8.6, seed + 41) * 0.65 + stair(sec, 14.2, seed + 42) * 0.35) * 58 * rs * e;
    const shakeY = (stair(sec, 7.9, seed + 43) * 0.65 + stair(sec, 13.1, seed + 44) * 0.35) * 46 * rs * e;
    const rot = stair(sec, 7.1, seed + 45) * 2.6 * e;

    // アナモルフィック: 横を潰し縦を伸ばす非等方スケール＋中心の微拡大（壊れたレンズ感）
    const camZoom = 1 + 0.34 * e;
    const squeeze = 0.15 * e;
    baseCam = { x: shakeX, y: shakeY, rot, sx: camZoom * (1 - squeeze), sy: camZoom * (1 + squeeze) };

    // 放射ズームブラー: 中心原点でスケールを±13%帯に散らしたコピーを積層。
    // 先頭（最下の原本）はシャープ・不透明のまま、残りは薄く＋ごく弱いぼかし
    if (e > 0.04) {
      const spreads = [-1, -0.6, -0.2, 0.2, 0.6, 1];
      ghosts = spreads.map((j, i) => {
        const zs = 1 + 0.13 * e * j;
        return (
          <AbsoluteFill
            key={i}
            style={{
              transform: camCss({ ...baseCam, sx: baseCam.sx * zs, sy: baseCam.sy * zs }),
              opacity: 0.12,
              filter: `blur(${(1.2 * rs).toFixed(2)}px)`,
            }}
          >
            {children}
          </AbsoluteFill>
        );
      });
    }

    // 周辺減光（黒ビネット）
    extras = (
      <AbsoluteFill
        style={{
          background: `radial-gradient(ellipse at 50% 50%, transparent 52%, rgba(0,0,0,${(0.5 * e).toFixed(3)}) 100%)`,
        }}
      />
    );
  } else {
    // ---- WHIP: 決定論の1回転。強いS字で実質は中央の一瞬で回りきる ----
    const t = frame / dur;
    const s = whipCurve(t, 7);
    const angle = 360 * s; // 回転角は乱数なし・intensity非依存で常に完遂
    const zoom = 1 + 0.08 * Math.sin(Math.PI * s); // 回転の山で軽くパンチイン
    envNow = Math.sin(Math.PI * s);

    baseCam = { x: 0, y: 0, rot: angle, sx: zoom, sy: zoom };
    useMirror = true;

    // 角度スミア: 回転の数値微分から瞬間角速度を求め、比例した角度幅（最大30度）に
    // ゴーストを等間隔配置＋等加重スタック。ブラー量を包絡でなく「速度」から導く。
    const angleAt = (f: number) => 360 * whipCurve(f / dur, 7);
    const dAng = angleAt(frame + 0.5) - angleAt(frame - 0.5); // deg/frame
    const smear = Math.min(30, Math.abs(dAng) * 0.9) * k; // intensityはスミアのみに効く
    if (smear > 1) {
      const step = 3.5;
      const n = Math.min(8, Math.max(1, Math.floor(smear / step)));
      const dirSign = Math.sign(dAng) || 1;
      ghosts = Array.from({ length: n }, (_, i) => (
        <AbsoluteFill
          key={i}
          style={{
            transform: camCss({ ...baseCam, rot: angle - dirSign * step * (i + 1) }),
            opacity: 1 / (i + 2),
            filter: `blur(${(1.8 * rs).toFixed(2)}px)`, // 帯状ムラを弱いガウスで馴染ませる
          }}
        >
          <AbsoluteFill style={{ transform: "scale(1.3)" }}>{children}</AbsoluteFill>
        </AbsoluteFill>
      ));
    }
  }

  // 任意の基調色: ごく薄いoverlayで色味を差すのみ（既定は無着色）
  const tintLayer =
    tint && envNow * k > 0.02 ? (
      <AbsoluteFill
        style={{
          background: `radial-gradient(circle at 50% 50%, ${tint} 0%, transparent 68%)`,
          mixBlendMode: "overlay",
          opacity: 0.16 * envNow * k,
        }}
      />
    ) : null;

  return (
    <AbsoluteFill style={{ background: "#000", overflow: "hidden", pointerEvents: "none" }}>
      {/* カメラ層: translate＋rotate＋scaleを1つのtransformに（原点は画面中央）。
          最下は必ずシャープな原本を不透明で残す */}
      <AbsoluteFill
        style={{
          transform: camCss(baseCam),
          filter: baseBlurPx > 0.3 ? `blur(${baseBlurPx.toFixed(2)}px)` : undefined,
        }}
      >
        {useMirror ? (
          <MirrorTiles w={width} h={height}>
            {children}
          </MirrorTiles>
        ) : (
          <AbsoluteFill>{children}</AbsoluteFill>
        )}
      </AbsoluteFill>
      {ghosts}
      {extras}
      {tintLayer}
    </AbsoluteFill>
  );
};
