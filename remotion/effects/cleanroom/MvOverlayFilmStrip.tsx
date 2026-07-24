import React, { useMemo } from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";

/**
 * MvOverlayFilmStrip — 「フィルム帯」家族のオーバーレイ。クリーンルーム実装
 * （技法メモとポスター画像の雰囲気のみを根拠に白紙から作成）。
 *
 * 下の映像(children)を必ず全面描画し、その上にフィルムらしい
 * マット・複製コマ・グレイン・傷・ビネットを積む。時間方向は
 * 「入りと抜きだけ演技し、中央はホールド」の台形。イン側は先頭からの
 * 経過秒、アウト側は終端からの残り秒で対称に読むため、任意尺で使える。
 * 緩急はイーズ曲線ではなく 24tick 量子化の乱数ステップで「機械のガタつき」を作る。
 *
 * variant(0..1) → 3プリセット:
 *   0.0 COLOR MATTE   唯一カラー保持（彩度増し）。上下に隣コマ＋フレーム線＋
 *                     リム発光のスプロケット穴。入りは全画面明滅＋縦の大ジッター
 *   0.5 MONO ROLL     レイアウト分割型。本編を左に縮め、右に拡大2コマ帯。
 *                     全面グレスケ＋乳白リフト＋煮えた黒枠＋ステップ手ブレ。
 *                     入りは約0.8秒のロールイン
 *   1.0 WARP REEL     最も破壊的。縦ぼかし＋ノイズ変位の縦うねりを本編に直接かけ、
 *                     大ブラー複製2枚を上下逆オフセット・screenで重ねる。
 *                     縦傷テクスチャがゆっくり縦に流れる
 * 完全に決定論的（Math.random 不使用）。外部素材なし（SVG手続き生成のみ）。
 */
export interface MvOverlayFilmStripProps {
  children: React.ReactNode; // 下の絵。全面に描画して上に質感を重ねる
  durationInFrames: number;
  intensity?: number; // 0..100
  variant?: number; // 0..1 家族内の見た目分岐（決定論的）
  tint?: string; // 基調色の差し替え（空/未指定=デザイン既定の寒色）
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

// シード付きハッシュ乱数 [0,1)。tick を食わせて量子化ステップを作る
const rnd = (seed: number) => {
  const x = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x);
};

const svgUri = (s: string) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(s)}`;

// グレイン: フラクタルノイズ→彩度0→50%グレー基準にトーン圧縮した小タイル
const grainTile = (seed: number, size: number) =>
  svgUri(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">` +
      `<filter id="n" x="0" y="0" width="100%" height="100%">` +
      `<feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" seed="${Math.floor(seed)}" stitchTiles="stitch" result="t"/>` +
      `<feColorMatrix in="t" type="saturate" values="0" result="m"/>` +
      `<feComponentTransfer in="m">` +
      `<feFuncR type="linear" slope="0.6" intercept="0.2"/>` +
      `<feFuncG type="linear" slope="0.6" intercept="0.2"/>` +
      `<feFuncB type="linear" slope="0.6" intercept="0.2"/>` +
      `<feFuncA type="linear" slope="0" intercept="1"/>` +
      `</feComponentTransfer></filter>` +
      `<rect width="100%" height="100%" filter="url(#n)"/></svg>`
  );

// 縦傷: 幅1〜2pxの縦長矩形（黒多め・白少なめ）を乱数配置したタイル
const scratchTile = (seed: number, w: number, h: number) => {
  let rects = "";
  for (let i = 0; i < 16; i++) {
    const x = Math.floor(rnd(seed * 31 + i) * w);
    const sw = rnd(seed * 57 + i * 3) < 0.75 ? 1 : 2;
    const col = rnd(seed * 77 + i * 5) < 0.72 ? "#000000" : "#ffffff";
    const op = (0.2 + 0.5 * rnd(seed * 91 + i * 7)).toFixed(2);
    const y = Math.floor(rnd(seed * 13 + i * 11) * h * 0.4);
    const rh = Math.floor(h * (0.35 + 0.65 * rnd(seed * 17 + i * 13)));
    rects += `<rect x="${x}" y="${y}" width="${sw}" height="${rh}" fill="${col}" opacity="${op}"/>`;
  }
  return svgUri(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">${rects}</svg>`);
};

// 煮えた黒枠: ストロークにノイズ変位＋軽いぼかしで直線を荒らす（シード違いで循環）
const boilFrame = (seed: number) => {
  const w = 480;
  const h = 360;
  const st = 16;
  return svgUri(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">` +
      `<filter id="b" x="-15%" y="-15%" width="130%" height="130%">` +
      `<feTurbulence type="fractalNoise" baseFrequency="0.045 0.055" numOctaves="2" seed="${Math.floor(seed)}" result="t"/>` +
      `<feDisplacementMap in="SourceGraphic" in2="t" scale="20" xChannelSelector="R" yChannelSelector="G"/>` +
      `<feGaussianBlur stdDeviation="0.7"/>` +
      `</filter>` +
      `<rect x="${st / 2}" y="${st / 2}" width="${w - st}" height="${h - st}" fill="none" stroke="#000000" stroke-width="${st}" filter="url(#b)"/>` +
      `</svg>`
  );
};

export const MvOverlayFilmStrip: React.FC<MvOverlayFilmStripProps> = ({
  children,
  durationInFrames,
  intensity = 100,
  variant = 0,
  tint,
}) => {
  const frame = useCurrentFrame();
  const { width, height, fps } = useVideoConfig();
  const dur = Math.max(1, durationInFrames);
  const scale = width / 1920; // 横1920基準で全px値を比例
  const k = clamp(intensity / 100, 0, 1);
  const preset = Math.round(clamp(variant, 0, 1) * 2); // 0..2
  const hasTint = typeof tint === "string" && tint.trim() !== "";
  const accent = hasTint ? tint!.trim() : "#6fe3ff"; // 既定は寒色（暖色は使わない家族）

  const t = frame / fps; // 経過秒
  const T = dur / fps; // 総尺秒
  // 24コマ相当の量子化 tick（再生fps非依存でカクカク感を出す）
  const tick = Math.floor(t * 24);
  const seed = 137 + preset * 61;
  // 対称読み: 先頭からの経過秒とお尻からの残り秒の近い方（山型は min 合成）
  const edge = Math.min(t, Math.max(0, T - t));

  // ---- 入り/抜きの演技（プリセット0・2: 明滅＋縦の大ジッター）----
  const IN = 0.65; // 入り抜きの長さ（秒）
  const gateP = clamp(edge / IN, 0, 1); // 0=端, 1=ホールド
  const inv = 1 - gateP;
  const gateJump =
    inv > 0.001 ? (rnd(tick * 3.7 + seed) - 0.5) * 2 * inv * inv * height * 0.85 * k : 0;
  const flickDark =
    inv > 0.001 && rnd(tick * 5.3 + seed + 7) < 0.45 ? 0.55 * inv * k : 0;
  const flashWhite =
    inv > 0.001 && rnd(tick * 7.1 + seed + 13) > 0.82 ? 0.5 * inv * k : 0;
  // ホールド中の微ジッター
  const jMicro = (rnd(tick * 1.3 + seed + 29) - 0.5) * 5 * scale * k;

  // ---- 質感アセット（静的 data URI・メモ化）----
  const grainA = useMemo(() => grainTile(seed + 1, 320), [seed]);
  const grainB = useMemo(() => grainTile(seed + 2, 240), [seed]);
  const scratches = useMemo(() => scratchTile(seed + 3, 480, 540), [seed]);
  const boils = useMemo(() => [0, 1, 2].map((i) => boilFrame(seed * 7 + i)), [seed]);

  // グレイン位相: 毎tickでランダムに飛ばす
  const gAx = Math.floor(rnd(tick * 2.1 + seed) * 320 * scale);
  const gAy = Math.floor(rnd(tick * 2.9 + seed + 3) * 320 * scale);
  const gBx = Math.floor(rnd(tick * 3.1 + seed + 5) * 240 * scale);
  const gBy = Math.floor(rnd(tick * 4.3 + seed + 9) * 240 * scale);

  // ダスト: 小円を数個 screen で薄く、0.5秒ごとに配置替え（準静止）
  const dstep = Math.floor(t * 2);
  const dust = [0, 1, 2, 3].map((i) => ({
    x: rnd(dstep * 17 + i * 3 + seed) * width,
    y: rnd(dstep * 23 + i * 5 + seed) * height,
    r: (2 + 4 * rnd(dstep * 29 + i * 7 + seed)) * scale,
    o: 0.08 + 0.08 * rnd(dstep * 41 + i * 11 + seed),
  }));

  // ほぼ無効なら本編のみ（重いレイヤーを丸ごと省略）
  if (k <= 0.005) {
    return (
      <AbsoluteFill style={{ backgroundColor: "#000" }}>
        <AbsoluteFill>{children}</AbsoluteFill>
      </AbsoluteFill>
    );
  }

  // 共通の後段レイヤー（グレイン2枚・ダスト・ビネット・明滅）
  const commonTex = (
    <>
      <AbsoluteFill
        style={{
          backgroundImage: `url("${grainA}")`,
          backgroundRepeat: "repeat",
          backgroundSize: `${300 * scale}px ${300 * scale}px`,
          backgroundPosition: `${gAx}px ${gAy}px`,
          mixBlendMode: "overlay",
          opacity: 0.34 * k,
        }}
      />
      <AbsoluteFill
        style={{
          backgroundImage: `url("${grainB}")`,
          backgroundRepeat: "repeat",
          backgroundSize: `${200 * scale}px ${200 * scale}px`,
          backgroundPosition: `${gBx}px ${gBy}px`,
          mixBlendMode: "soft-light",
          opacity: 0.3 * k,
        }}
      />
      {dust.map((d, i) => (
        <div
          key={i}
          style={{
            position: "absolute",
            left: d.x,
            top: d.y,
            width: d.r * 2,
            height: d.r * 2,
            borderRadius: "50%",
            background: "#fff",
            mixBlendMode: "screen",
            opacity: d.o * k,
            filter: `blur(${1.2 * scale}px)`,
          }}
        />
      ))}
      <AbsoluteFill
        style={{ boxShadow: `inset 0 0 ${height * 0.4}px rgba(0,0,0,${0.5 * k})` }}
      />
      {preset !== 1 && flickDark > 0 && (
        <AbsoluteFill style={{ background: "#000", opacity: flickDark }} />
      )}
      {preset !== 1 && flashWhite > 0 && (
        <AbsoluteFill style={{ background: "#fff", mixBlendMode: "screen", opacity: flashWhite }} />
      )}
    </>
  );

  let body: React.ReactNode;

  if (preset === 0) {
    // ============ COLOR MATTE: 縦送りフィルムのマット＋隣コマ＋発光スプロケット ============
    const barH = height * 0.075;
    const lineW = Math.max(2, 3 * scale);
    const sproW = 110 * scale;
    const sproH = 240 * scale;
    const sproPeriod = height * 0.78;
    body = (
      <>
        <AbsoluteFill style={{ transform: `translateY(${gateJump + jMicro}px)` }}>
          {/* 本編（唯一カラー保持。彩度をむしろ盛る） */}
          <AbsoluteFill
            style={{ filter: `saturate(${1 + 0.5 * k}) contrast(${1 + 0.06 * k})` }}
          >
            {children}
          </AbsoluteFill>
          {/* 上下の隣コマ（本編の複製をクロップして覗かせる） */}
          <div
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              right: 0,
              height: barH,
              overflow: "hidden",
              background: "#000",
            }}
          >
            <div
              style={{
                position: "absolute",
                top: -height * 0.62,
                left: 0,
                width: "100%",
                height,
                filter: "brightness(0.8) saturate(1.35)",
              }}
            >
              {children}
            </div>
          </div>
          <div
            style={{
              position: "absolute",
              bottom: 0,
              left: 0,
              right: 0,
              height: barH,
              overflow: "hidden",
              background: "#000",
            }}
          >
            <div
              style={{
                position: "absolute",
                top: -height * 0.25,
                left: 0,
                width: "100%",
                height,
                filter: "brightness(0.8) saturate(1.35)",
              }}
            >
              {children}
            </div>
          </div>
          {/* フレーム線（黒帯＋寒色の発光ライン） */}
          {[barH, height - barH].map((y, i) => (
            <React.Fragment key={i}>
              <div
                style={{
                  position: "absolute",
                  top: y - lineW * 2,
                  left: 0,
                  right: 0,
                  height: lineW * 4,
                  background: "#000",
                }}
              />
              <div
                style={{
                  position: "absolute",
                  top: y - lineW / 2,
                  left: 0,
                  right: 0,
                  height: lineW,
                  background: accent,
                  opacity: 0.55 * k,
                  filter: `blur(${1.5 * scale}px)`,
                  mixBlendMode: "screen",
                }}
              />
            </React.Fragment>
          ))}
          {/* スプロケット穴（左端・リムだけ発光、内側は黒で塗り潰す） */}
          {[-1, 0, 1].map((n) => (
            <div
              key={n}
              style={{
                position: "absolute",
                left: -sproW * 0.45,
                top: height * 0.5 - sproH / 2 + n * sproPeriod,
                width: sproW,
                height: sproH,
                borderRadius: 24 * scale,
                background: "#020404",
                border: `${Math.max(2, 3 * scale)}px solid ${accent}`,
                boxShadow: `0 0 ${22 * scale}px ${accent}`,
                opacity: 0.9 * k,
              }}
            />
          ))}
        </AbsoluteFill>
        {/* 静かな縦傷 */}
        <AbsoluteFill
          style={{
            backgroundImage: `url("${scratches}")`,
            backgroundRepeat: "repeat",
            backgroundSize: `${480 * scale}px ${540 * scale}px`,
            mixBlendMode: "soft-light",
            opacity: 0.28 * k,
          }}
        />
      </>
    );
  } else if (preset === 1) {
    // ============ MONO ROLL: レイアウト分割＋グレスケ＋煮えた黒枠＋ステップ手ブレ ============
    const m = 26 * scale;
    const gap = 14 * scale;
    const leftW = width * 0.55;
    const rightX = leftW + gap;
    const rightW = width - rightX - m;
    const winH = (height - m * 2 - gap) / 2;
    // ロールイン: 約0.8秒で下から定位置へ（対称読みなので抜きは自動で逆再生）
    const rollX = clamp(edge / 0.8, 0, 1);
    const rollE = 1 - Math.pow(1 - rollX, 3); // ease-out cubic
    const rollY = (1 - rollE) * height;
    // 手ブレ: 毎秒12回程度のステップ状
    const shakeStep = Math.floor(t * 12);
    const shX = (rnd(shakeStep * 3.3 + seed) - 0.5) * 12 * scale * k;
    const shY = (rnd(shakeStep * 4.7 + seed + 5) - 0.5) * 12 * scale * k;
    // 黒枠の煮え: 数tickごとにシードを回す
    const boil = boils[Math.floor(tick / 2) % 3];

    const win = (
      x: number,
      y: number,
      w: number,
      h: number,
      zoom: number,
      ox: number,
      oy: number,
      bright: number,
      key: number
    ) => {
      const s = Math.max(w / width, h / height) * zoom; // カバーに必要な倍率
      return (
        <div
          key={key}
          style={{
            position: "absolute",
            left: x,
            top: y,
            width: w,
            height: h,
            overflow: "hidden",
            background: "#050505",
          }}
        >
          <div
            style={{
              position: "absolute",
              left: (w - width) / 2 + ox,
              top: (h - height) / 2 + oy,
              width,
              height,
              transform: `scale(${s})`,
              filter: `brightness(${bright})`,
            }}
          >
            {children}
          </div>
          {/* 手描き風に煮えた黒枠 */}
          <div
            style={{
              position: "absolute",
              inset: -6 * scale,
              backgroundImage: `url("${boil}")`,
              backgroundSize: "100% 100%",
              opacity: 0.95,
            }}
          />
        </div>
      );
    };

    body = (
      <>
        {/* 黒浮きした暗幕（真っ黒にしない） */}
        <AbsoluteFill style={{ background: "#131313" }} />
        <AbsoluteFill
          style={{
            transform: `translate(${shX}px, ${rollY + shY}px)`,
            filter: `grayscale(1) contrast(${1 + 0.3 * k}) brightness(1.03)`,
          }}
        >
          {/* 左: 本編を縮めた主コマ */}
          {win(m, m, leftW - m, height - m * 2, 1, 0, 0, 1, 0)}
          {/* 右: 同素材の拡大2コマ帯（別の場所を覗く） */}
          {win(rightX, m, rightW, winH, 1.8, -width * 0.12, -height * 0.05, 0.72, 1)}
          {win(rightX, m + winH + gap, rightW, winH, 1.9, width * 0.1, height * 0.08, 0.68, 2)}
        </AbsoluteFill>
        {/* 乳白リフト: 白平面を screen でごく薄く（古いフィルムの黒浮き） */}
        <AbsoluteFill
          style={{ background: "#fff", mixBlendMode: "screen", opacity: 0.055 * k }}
        />
        {hasTint && (
          <AbsoluteFill
            style={{ background: accent, mixBlendMode: "soft-light", opacity: 0.07 * k }}
          />
        )}
      </>
    );
  } else {
    // ============ WARP REEL: 縦ぼかし＋縦うねり＋大ブラー多重像＋流れる縦傷 ============
    const warpId = `mvfs-warp-${seed}`;
    // 変位のシードを数tickごとに回して縁と歪みを生かす
    const warpSeed = seed + (Math.floor(t * 8) % 9);
    body = (
      <>
        <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden>
          <defs>
            <filter id={warpId} x="-15%" y="-15%" width="130%" height="130%">
              <feTurbulence
                type="fractalNoise"
                baseFrequency="0.006 0.045"
                numOctaves={2}
                seed={warpSeed}
                result="w"
              />
              <feDisplacementMap
                in="SourceGraphic"
                in2="w"
                scale={46 * scale * k}
                xChannelSelector="R"
                yChannelSelector="G"
              />
              <feGaussianBlur
                stdDeviation={`${1.5 * scale} ${14 * scale * (0.4 + 0.6 * k)}`}
              />
            </filter>
          </defs>
        </svg>
        <AbsoluteFill style={{ transform: `translateY(${gateJump * 1.2 + jMicro}px)` }}>
          {/* 本編: 全面退色＋縦うねり＋縦方向の強いぼかし（変位フィルタは本編1枚だけ） */}
          <AbsoluteFill
            style={{
              filter: `grayscale(1) contrast(${1 + 0.12 * k}) brightness(0.98) url(#${warpId})`,
            }}
          >
            {children}
          </AbsoluteFill>
          {/* 大ブラー複製 ×2: 上下逆オフセット・screen・半透明（暴れるリールの多重像） */}
          <AbsoluteFill
            style={{
              transform: `translateY(${-40 * scale}px)`,
              filter: `grayscale(1) blur(${30 * scale}px) brightness(1.15)`,
              mixBlendMode: "screen",
              opacity: 0.3 * k,
            }}
          >
            {children}
          </AbsoluteFill>
          <AbsoluteFill
            style={{
              transform: `translateY(${44 * scale}px)`,
              filter: `grayscale(1) blur(${34 * scale}px) brightness(1.1)`,
              mixBlendMode: "screen",
              opacity: 0.26 * k,
            }}
          >
            {children}
          </AbsoluteFill>
        </AbsoluteFill>
        {/* 縦傷テクスチャがゆっくり縦に流れる */}
        <AbsoluteFill
          style={{
            backgroundImage: `url("${scratches}")`,
            backgroundRepeat: "repeat",
            backgroundSize: `${480 * scale}px ${540 * scale}px`,
            backgroundPosition: `0px ${(t * 26 * scale) % (540 * scale)}px`,
            mixBlendMode: "soft-light",
            opacity: 0.55 * k,
          }}
        />
        {/* 乳白リフト（退色の黒浮き） */}
        <AbsoluteFill
          style={{ background: "#fff", mixBlendMode: "screen", opacity: 0.04 * k }}
        />
        {hasTint && (
          <AbsoluteFill
            style={{ background: accent, mixBlendMode: "soft-light", opacity: 0.06 * k }}
          />
        )}
      </>
    );
  }

  return (
    <AbsoluteFill
      style={{
        backgroundColor: "#000",
        overflow: "hidden",
        isolation: "isolate", // ブレンドを外に漏らさない
        pointerEvents: "none",
      }}
    >
      {body}
      {commonTex}
    </AbsoluteFill>
  );
};
