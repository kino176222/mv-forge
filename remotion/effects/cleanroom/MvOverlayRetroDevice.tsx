import React from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";

/**
 * MvOverlayRetroDevice — 「レトロ映像機器越しに世界を見る」オーバーレイ家族。
 * クリーンルーム実装（技法メモとポスターの雰囲気のみを根拠に白紙から作成）。
 *
 * 骨格（家族共通）:
 *   1. 最下層に素の children を必ず全面描画（効果が弱まっても被写体が消えない）
 *   2. その上へグレード/変形済みコピーを強度でクロスフェード
 *   3. 発光・網目/走査線・着色かぶり・粒子・周辺減光を積層
 *   4. 全層の不透明度に intensity 係数を掛けて一括スケール
 *
 * variant(0..1) → 4プリセット:
 *   0.00 TAPE   … 青かぶりVHS。水平ワーブル＋色収差＋走査線。転換部だけグリッチが暴れ、
 *                 終端は歪みが2倍へ暴走する「テープが切れる」型
 *   0.33 WALL   … 発光LED壁。強ブラー土台＋呼吸する屈折＋縁ぼけ2段フォーカス＋
 *                 水平ストリーク発光＋ドット網タイル。マゼンタ光漏れ＋青紫かぶり
 *   0.67 SCOPE  … 静止した計器ルック。等間隔グリッド線＋中央フォーカス円＋左右黒帯＋
 *                 teal退色＋暖色ハイライト。動きほぼゼロ・入り最速(約0.3秒)
 *   1.00 HEAT   … 偽色暗視。モノクロ化→暗紫〜橙〜白の輝度写像＋大径ブルーム＋
 *                 丸い覗き窓ビネット。エンベロープは電源ON/OFFの黒板開閉に使う
 *
 * 決定論的（Math.random不使用）。外部素材なし（CSS/SVG手続き生成のみ）。
 */
export interface MvOverlayRetroDeviceProps {
  children: React.ReactNode;
  durationInFrames: number;
  intensity?: number; // 0..100
  variant?: number; // 0..1
  tint?: string; // 基調色の差し替え（未指定=プリセット既定）
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const smooth = (x: number) => {
  const c = clamp(x, 0, 1);
  return c * c * (3 - 2 * c); // 緩急のあるS字（機械のスイッチ感を少し丸める）
};
// 決定論的ハッシュ: 整数tick → 0..1
const hash01 = (n: number) => {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
};

// 粒子タイル（静的SVGをデータURI化。位相はbackgroundPositionで飛ばす）
const NOISE_TILE =
  "data:image/svg+xml," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160">' +
      '<filter id="n"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="11"/>' +
      '<feColorMatrix type="saturate" values="0"/></filter>' +
      '<rect width="160" height="160" filter="url(#n)"/></svg>'
  );

export const MvOverlayRetroDevice: React.FC<MvOverlayRetroDeviceProps> = ({
  children,
  durationInFrames,
  intensity = 100,
  variant = 0,
  tint,
}) => {
  const frame = useCurrentFrame();
  const { width, height, fps } = useVideoConfig();
  const rawId = React.useId();
  const uid = "rd" + rawId.replace(/[^a-zA-Z0-9_-]/g, "");

  const preset = Math.round(clamp(variant, 0, 1) * 3); // 0..3
  const k = clamp(intensity, 0, 100) / 100;
  const dur = Math.max(1, durationInFrames);
  const S = width / 1920; // 全px値は基準幅1920比

  const t = frame / fps; // 先頭からの経過秒
  const tLeft = Math.max(0, (dur - 1 - frame) / fps); // 終端からの残り秒

  // 家族標準: 台形エンベロープ（入り/抜けを秒で読むので尺可変に強い）
  const attack = preset === 2 ? 0.3 : 0.55;
  const release = preset === 2 ? 0.4 : 0.6;
  const env = Math.min(smooth(t / attack), smooth(tLeft / release));

  const hasTint = typeof tint === "string" && tint.trim().length > 0;

  if (k <= 0.001) {
    return (
      <AbsoluteFill style={{ isolation: "isolate" }}>
        <AbsoluteFill>{children}</AbsoluteFill>
      </AbsoluteFill>
    );
  }

  // 変位/収差レイヤーは縁欠け防止のオーバースキャン
  const overscan = "scale(1.06)";

  let layers: React.ReactNode = null;
  let defs: React.ReactNode = null;

  if (preset === 0) {
    // ───────── TAPE: 転換部グリッチ持ちの王道ビデオテープ ─────────
    const cast = hasTint ? tint! : "#3652c0";
    // 逆台形: 入口と出口だけ1になるグリッチ用エンベロープ
    const glitch = 1 - Math.min(smooth(t / 0.85), smooth(tLeft / 0.95));
    // 終端の残り1秒で歪みを通常の2倍へ暴走
    const endRun = smooth(1 - Math.min(1, tLeft));
    // 水平ワーブル: 縦方向だけ周波数を持つノイズ＋横ずれのみ
    const seed = 1 + (Math.floor(t * 24) % 97); // 24fps刻みでシャリつかせる
    const fy = 0.13 + 0.045 * Math.sin(t * 1.5); // 基底周波数がゆっくり呼吸
    const warpPx = 9 * S * k * (1 + glitch * 0.9 + endRun * 1.0);
    // 色収差: 画面幅の0.25%基準＋毎秒9回のハッシュジッタで電気的な震え
    const jit = hash01(Math.floor(t * 9));
    const aberr = width * 0.0025 * k * (1 + glitch * 1.6) * (0.7 + 0.6 * jit);

    defs = (
      <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden>
        <defs>
          <filter id={`${uid}-warp`} x="-10%" y="-10%" width="120%" height="120%">
            <feTurbulence
              type="fractalNoise"
              baseFrequency={`0.0001 ${fy.toFixed(4)}`}
              numOctaves={1}
              seed={seed}
              result="noise"
            />
            {/* Gを中立値0.5に固定 → 縦ずれゼロ・横ずれのみ */}
            <feComponentTransfer in="noise" result="hnoise">
              <feFuncG type="discrete" tableValues="0.5" />
            </feComponentTransfer>
            <feDisplacementMap
              in="SourceGraphic"
              in2="hnoise"
              scale={warpPx.toFixed(2)}
              xChannelSelector="R"
              yChannelSelector="G"
            />
          </filter>
          <filter id={`${uid}-red`}>
            <feColorMatrix type="matrix" values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0" />
          </filter>
          <filter id={`${uid}-cyan`}>
            <feColorMatrix type="matrix" values="0 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 1 0" />
          </filter>
        </defs>
      </svg>
    );

    layers = (
      <>
        {/* 退色グレード＋水平ワーブルのコピーをクロスフェード */}
        <AbsoluteFill
          style={{
            transform: overscan,
            filter: `url(#${uid}-warp) saturate(0.78) contrast(1.06) brightness(1.04)`,
            opacity: env * k,
          }}
        >
          {children}
        </AbsoluteFill>
        {/* 色収差: チャンネル排他コピーを逆方向へずらしてscreen重ね */}
        <AbsoluteFill
          style={{
            transform: `${overscan} translateX(${aberr.toFixed(2)}px)`,
            filter: `url(#${uid}-red)`,
            mixBlendMode: "screen",
            opacity: 0.75 * env * k,
          }}
        >
          {children}
        </AbsoluteFill>
        <AbsoluteFill
          style={{
            transform: `${overscan} translateX(${(-aberr).toFixed(2)}px)`,
            filter: `url(#${uid}-cyan)`,
            mixBlendMode: "screen",
            opacity: 0.55 * env * k,
          }}
        >
          {children}
        </AbsoluteFill>
        {/* 青のsoft-light染め */}
        <AbsoluteFill
          style={{ background: cast, mixBlendMode: "soft-light", opacity: 0.55 * env * k }}
        />
        {/* 細かい走査線: 暗線1px＋微明線1pxのペア */}
        <AbsoluteFill
          style={{
            backgroundImage:
              "repeating-linear-gradient(0deg, rgba(0,0,0,0.22) 0px, rgba(0,0,0,0.22) 1px, rgba(255,255,255,0.045) 1px, rgba(255,255,255,0.045) 2px, transparent 2px, transparent 4px)",
            opacity: 0.65 * env * k,
          }}
        />
        {/* 粒子: 24fps刻みで位相を飛ばす */}
        <AbsoluteFill
          style={{
            backgroundImage: `url("${NOISE_TILE}")`,
            backgroundSize: `${Math.round(160 * S)}px ${Math.round(160 * S)}px`,
            backgroundPosition: `${Math.round(hash01(Math.floor(t * 24) * 3 + 1) * 160)}px ${Math.round(hash01(Math.floor(t * 24) * 3 + 2) * 160)}px`,
            mixBlendMode: "overlay",
            opacity: 0.16 * env * k,
          }}
        />
        {/* 周辺減光 */}
        <AbsoluteFill
          style={{
            background:
              "radial-gradient(ellipse 78% 72% at 50% 47%, transparent 55%, rgba(2,2,8,0.55) 100%)",
            opacity: env * k,
          }}
        />
      </>
    );
  } else if (preset === 1) {
    // ───────── WALL: 発光LED壁。変形が最も重い個体 ─────────
    const leak = hasTint ? tint! : "#d84fc0";
    const breath = 0.85 + 0.15 * Math.sin(t * 0.9); // ゆっくり呼吸するぼけ量
    const blurPx = 15 * S * breath;
    const dot = Math.max(4, Math.round(8 * S));
    const squeeze = 1 / 7;

    layers = (
      <>
        {/* 強ブラー土台（発光壁の面をつくる） */}
        <AbsoluteFill
          style={{
            transform: overscan,
            filter: `blur(${blurPx.toFixed(1)}px) saturate(1.22) brightness(1.04)`,
            opacity: env * k,
          }}
        >
          {children}
        </AbsoluteFill>
        {/* 2段フォーカス: 縁ほどさらにぼける */}
        <AbsoluteFill
          style={{
            transform: overscan,
            filter: `blur(${(blurPx * 2.1).toFixed(1)}px) saturate(1.25)`,
            WebkitMaskImage:
              "radial-gradient(circle at 50% 50%, transparent 38%, black 82%)",
            maskImage: "radial-gradient(circle at 50% 50%, transparent 38%, black 82%)",
            opacity: 0.85 * env * k,
          }}
        >
          {children}
        </AbsoluteFill>
        {/* 水平ストリーク発光: 1/7へ圧縮→ブラー→7倍へ引き伸ばす */}
        <AbsoluteFill
          style={{
            transform: `scaleX(${(1 / squeeze).toFixed(3)})`,
            mixBlendMode: "screen",
            opacity: 0.4 * env * k,
          }}
        >
          <AbsoluteFill
            style={{
              transform: `scaleX(${squeeze.toFixed(4)})`,
              filter: `blur(${(9 * S).toFixed(1)}px) brightness(1.45) contrast(1.7) saturate(1.2)`,
            }}
          >
            {children}
          </AbsoluteFill>
        </AbsoluteFill>
        {/* LEDドット網: 中心透明・周縁暗の放射グラデ正方タイル */}
        <AbsoluteFill
          style={{
            backgroundImage:
              "radial-gradient(circle, rgba(0,0,0,0) 0%, rgba(0,0,0,0) 32%, rgba(0,0,0,0.72) 74%, rgba(0,0,0,0.72) 100%)",
            backgroundSize: `${dot}px ${dot}px`,
            mixBlendMode: "multiply",
            opacity: 0.58 * env * k,
          }}
        />
        {/* 横方向の画素列を強調する暗線 */}
        <AbsoluteFill
          style={{
            backgroundImage: `repeating-linear-gradient(0deg, rgba(0,0,0,0.28) 0px, rgba(0,0,0,0.28) 1px, transparent 1px, transparent ${dot}px)`,
            mixBlendMode: "multiply",
            opacity: 0.35 * env * k,
          }}
        />
        {/* マゼンタ光漏れ（左端＝筐体の反射の記号） */}
        <AbsoluteFill
          style={{
            background: `linear-gradient(90deg, ${leak} 0%, transparent 30%)`,
            mixBlendMode: "screen",
            opacity: 0.22 * env * k,
          }}
        />
        {/* 青紫かぶり */}
        <AbsoluteFill
          style={{
            background: "linear-gradient(105deg, #6a3fd8 0%, #2c3fb0 100%)",
            mixBlendMode: "soft-light",
            opacity: 0.5 * env * k,
          }}
        />
        {/* 粒子（動く） */}
        <AbsoluteFill
          style={{
            backgroundImage: `url("${NOISE_TILE}")`,
            backgroundSize: `${Math.round(160 * S)}px ${Math.round(160 * S)}px`,
            backgroundPosition: `${Math.round(hash01(Math.floor(t * 24) * 5 + 3) * 160)}px ${Math.round(hash01(Math.floor(t * 24) * 5 + 4) * 160)}px`,
            mixBlendMode: "overlay",
            opacity: 0.12 * env * k,
          }}
        />
        {/* 周辺減光 */}
        <AbsoluteFill
          style={{
            background:
              "radial-gradient(ellipse 80% 74% at 50% 50%, transparent 52%, rgba(4,2,10,0.6) 100%)",
            opacity: env * k,
          }}
        />
      </>
    );
  } else if (preset === 2) {
    // ───────── SCOPE: 静止した計器ルック（覗き窓） ─────────
    const teal = hasTint ? tint! : "#2f8c85";
    const barW = width * 0.065;
    // 静止塵: 固定インデックスのハッシュで配置（毎フレーム同一＝静止）
    const specks = [0, 1, 2, 3, 4].map((i) => ({
      x: hash01(i * 7 + 1) * 0.86 + 0.07,
      y: hash01(i * 7 + 2) * 0.86 + 0.07,
      r: (1.2 + hash01(i * 7 + 3) * 1.8) * S,
      o: 0.25 + hash01(i * 7 + 4) * 0.3,
    }));

    layers = (
      <>
        {/* teal退色グレード＋淡いヘイズ */}
        <AbsoluteFill
          style={{
            filter: "saturate(0.68) brightness(1.05) contrast(0.96)",
            opacity: env * k,
          }}
        >
          {children}
        </AbsoluteFill>
        <AbsoluteFill
          style={{
            filter: `blur(${(7 * S).toFixed(1)}px) brightness(1.12)`,
            mixBlendMode: "screen",
            opacity: 0.22 * env * k,
          }}
        >
          {children}
        </AbsoluteFill>
        <AbsoluteFill
          style={{ background: teal, mixBlendMode: "soft-light", opacity: 0.4 * env * k }}
        />
        {/* 暖色ハイライト（被写体側にわずかな体温） */}
        <AbsoluteFill
          style={{
            background:
              "radial-gradient(circle at 32% 34%, rgba(255,198,140,0.14), transparent 55%)",
            mixBlendMode: "screen",
            opacity: env * k,
          }}
        />
        {/* 作図オーバーレイ: 等間隔の縦横線＋中央フォーカス円（家族で唯一） */}
        <svg
          viewBox="0 0 1920 1080"
          preserveAspectRatio="none"
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%", opacity: 0.5 * env * k }}
        >
          {[1, 2, 3].map((i) => (
            <line
              key={`v${i}`}
              x1={(1920 / 4) * i}
              y1={0}
              x2={(1920 / 4) * i}
              y2={1080}
              stroke="rgba(222,230,229,0.55)"
              strokeWidth={1.2}
            />
          ))}
          {[1, 2, 3].map((i) => (
            <line
              key={`h${i}`}
              x1={0}
              y1={(1080 / 4) * i}
              x2={1920}
              y2={(1080 / 4) * i}
              stroke="rgba(222,230,229,0.55)"
              strokeWidth={1.2}
            />
          ))}
          <circle
            cx={960}
            cy={540}
            r={150}
            fill="none"
            stroke="rgba(222,230,229,0.6)"
            strokeWidth={1.6}
          />
        </svg>
        {/* 左右黒帯（内側へ柔らかく落ちる） */}
        <div
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            bottom: 0,
            width: barW,
            background: "linear-gradient(90deg, rgba(0,0,0,0.96) 55%, transparent 100%)",
            opacity: env * k,
          }}
        />
        <div
          style={{
            position: "absolute",
            right: 0,
            top: 0,
            bottom: 0,
            width: barW,
            background: "linear-gradient(270deg, rgba(0,0,0,0.96) 55%, transparent 100%)",
            opacity: env * k,
          }}
        />
        {/* 静止グレイン＋黒い塵（写真的変奏。動かさない） */}
        <AbsoluteFill
          style={{
            backgroundImage: `url("${NOISE_TILE}")`,
            backgroundSize: `${Math.round(160 * S)}px ${Math.round(160 * S)}px`,
            mixBlendMode: "overlay",
            opacity: 0.1 * env * k,
          }}
        />
        {specks.map((p, i) => (
          <div
            key={i}
            style={{
              position: "absolute",
              left: p.x * width,
              top: p.y * height,
              width: p.r * 2,
              height: p.r * 2,
              borderRadius: "50%",
              background: "rgba(10,12,12,1)",
              opacity: p.o * env * k,
            }}
          />
        ))}
        {/* 覗き窓の丸み（中心をわずかに上へ） */}
        <AbsoluteFill
          style={{
            background:
              "radial-gradient(ellipse 82% 74% at 50% 46%, transparent 58%, rgba(3,5,5,0.5) 100%)",
            opacity: env * k,
          }}
        />
      </>
    );
  } else {
    // ───────── HEAT: 偽色暗視。色を丸ごと捨てて輝度を写像 ─────────
    const glowTint = hasTint ? tint! : "#ff8a2e";
    // 電源ON/OFF: エンベロープは黒板の開閉に使う（ルックは全編一定強度）
    const plate = 1 - Math.min(smooth(t / 0.5), smooth(tLeft / 0.5));

    defs = (
      <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden>
        <defs>
          {/* モノクロ化 → 暗紫〜橙〜白のテーブル写像 */}
          <filter id={`${uid}-heat`}>
            <feColorMatrix type="saturate" values="0" />
            <feComponentTransfer>
              <feFuncR type="table" tableValues="0.07 0.42 0.96 1.0" />
              <feFuncG type="table" tableValues="0.02 0.09 0.45 0.98" />
              <feFuncB type="table" tableValues="0.30 0.46 0.10 0.92" />
            </feComponentTransfer>
          </filter>
        </defs>
      </svg>
    );

    layers = (
      <>
        {/* 偽色コピー（強度でクロスフェード。下に素の映像が残る保険） */}
        <AbsoluteFill
          style={{
            filter: `url(#${uid}-heat) contrast(1.08)`,
            opacity: k,
          }}
        >
          {children}
        </AbsoluteFill>
        {/* 大径ブルーム: 偽色を明るく持ち上げて大きくぼかしscreen */}
        <AbsoluteFill
          style={{
            transform: overscan,
            filter: `url(#${uid}-heat) brightness(1.4) contrast(1.55) blur(${(26 * S).toFixed(1)}px)`,
            mixBlendMode: "screen",
            opacity: 0.45 * k,
          }}
        >
          {children}
        </AbsoluteFill>
        {/* 橙の熱かぶり（発熱源側をほんのり染める） */}
        <AbsoluteFill
          style={{
            background: `radial-gradient(circle at 36% 58%, ${glowTint}, transparent 60%)`,
            mixBlendMode: "soft-light",
            opacity: 0.35 * k,
          }}
        />
        {/* 静止グレイン薄め */}
        <AbsoluteFill
          style={{
            backgroundImage: `url("${NOISE_TILE}")`,
            backgroundSize: `${Math.round(160 * S)}px ${Math.round(160 * S)}px`,
            mixBlendMode: "overlay",
            opacity: 0.09 * k,
          }}
        />
        {/* 丸い覗き窓ビネット（強め） */}
        <AbsoluteFill
          style={{
            background:
              "radial-gradient(ellipse 68% 62% at 50% 48%, transparent 52%, rgba(6,0,12,0.9) 100%)",
            opacity: k,
          }}
        />
        {/* 電源ON/OFFの黒板: 冒頭0.5秒で開き、終端0.5秒前から閉じる */}
        {plate > 0.001 && (
          <AbsoluteFill style={{ background: "#020103", opacity: plate }} />
        )}
      </>
    );
  }

  return (
    <AbsoluteFill style={{ isolation: "isolate" }}>
      <AbsoluteFill>{children}</AbsoluteFill>
      <AbsoluteFill style={{ pointerEvents: "none" }}>
        {defs}
        {layers}
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
