import React from "react";
import {
  AbsoluteFill,
  Easing,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

/**
 * MvOverlaySplitScreen — 画面を黒地のマスク窓で分割し、開閉の瞬間を
 * フラッシュ/ストロボで隠す「分割画面」家族のクリーンルーム実装。
 * 技法メモとポスター画像のみを根拠に白紙から作成。
 *
 * 家族の文法: ルートは純黒。映像(children)は overflow:hidden の窓 div で
 * 切り抜き、窓の内側にフルサイズの映像を逆オフセットで置く（マスクだけが
 * 開閉し、中身は歪まず定位置）。入り→長い中間ホールド→抜けの3幕で、
 * 入りカーブは先頭からの経過秒、抜けカーブは終端相対で読む（任意尺対応）。
 *
 * variant(0..1) → 4プリセット:
 *   0.00 BAND-DUO   中央横帯(高さ4割)を階段状ギャップで左右2パネルに分割。
 *                   中身は7割縮小・外端揃え。フラッシュは各窓の内側のみ。
 *   0.33 WIPE-PANEL 黒パネルが左から画面半分までワイプイン(タイトル置き場)。
 *                   開閉時は輝度フラッシュ＋強ブラー＋黄ベタ1フレーム明滅、
 *                   窓全体を一時モノクロ化。intensityを下げると素のカバーへ。
 *   0.66 TRIPLE     縦3分割が画面中心から左右対称に開く。中央は素、左右は
 *                   暗化クローン。入り抜けはストロボ＋白ベール＋グレイン＋
 *                   RGBずらし＋縦歪み＋ブラーバーストが同時発火。
 *   1.00 TORN-FRAME 開閉なし。上半分弱の破れ縁横帯に中央クロップ、右上に
 *                   5Hzで揺れる局所円形ぼかし、極薄グレー線。冒頭終端は
 *                   素カバーで、切替を白飛びフラッシュで繋ぐ。全編モノクロ強グレイン。
 *
 * intensity(0..100): フラッシュ・ストロボ・暗化・歪み量に乗算。
 * レイアウトの開閉自体には掛けない（WIPE-PANEL のみ例外的にパネル幅へ反映）。
 * tint: アクセント色の差し替え（WIPE-PANELのベタ板 / TORN-FRAMEの細線）。
 * 完全決定論（Math.random不使用）。素材はCSS/SVGの手続き生成のみ。
 */
export interface MvOverlaySplitScreenProps {
  children: React.ReactNode; // 下の絵。全面に描画して上に質感を重ねる
  durationInFrames: number;
  intensity?: number; // 0..100
  variant?: number; // 0..1 同家族内の見た目分岐（決定論的に）
  tint?: string; // 任意: 基調色の差し替え（空/未指定=デザイン既定）
}

const clamp = (n: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, n));

// シード付きハッシュ乱数（決定論的）。整数tickを食わせて毎フレーム位相ジャンプ。
const hash01 = (n: number) => {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453123;
  return x - Math.floor(x);
};

const CL = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

// ── 手続き生成グレイン（フラクタルノイズ→彩度ゼロ、overlay合成で±両方向の粒に）
// 罠対策: sRGB補間を明示しないと linearRGB で粒が化ける。
const GRAIN_TILE = 256;
const GRAIN_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="${GRAIN_TILE}" height="${GRAIN_TILE}"><filter id="g" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="7" stitchTiles="stitch"/><feColorMatrix type="saturate" values="0"/></filter><rect width="100%" height="100%" filter="url(#g)"/></svg>`;
const GRAIN_URI = `data:image/svg+xml;utf8,${encodeURIComponent(GRAIN_SVG)}`;

// ── 破れ縁の帯マスク（白ポリゴンにタービュレンス＋ディスプレイスメントで縁を荒らす）
// 1920x1080基準で書き、mask-size 100% 100% で実解像度へスケール。左縁はわずかに外傾。
const TORN_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080" viewBox="0 0 1920 1080" preserveAspectRatio="none"><filter id="r" x="-4%" y="-10%" width="108%" height="120%" color-interpolation-filters="sRGB"><feTurbulence type="turbulence" baseFrequency="0.011 0.045" numOctaves="2" seed="13" result="t"/><feDisplacementMap in="SourceGraphic" in2="t" scale="16"/></filter><polygon points="54,44 1920,60 1920,540 10,520" fill="#fff" filter="url(#r)"/></svg>`;
const TORN_URI = `data:image/svg+xml;utf8,${encodeURIComponent(TORN_SVG)}`;

export const MvOverlaySplitScreen: React.FC<MvOverlaySplitScreenProps> = ({
  children,
  durationInFrames,
  intensity = 100,
  variant = 0,
  tint,
}) => {
  const frame = useCurrentFrame();
  const { width, height, fps } = useVideoConfig();
  const dur = Math.max(1, durationInFrames);
  const k = clamp(intensity, 0, 100) / 100;
  const v = clamp(variant, 0, 1);
  const preset = Math.round(v * 3); // 0..3
  const s = width / 1920; // 1920px基準の寸法スケール

  const t = frame / fps; // 先頭からの経過秒（入り側カーブ用）
  const tEnd = (dur - 1 - frame) / fps; // 終端までの残り秒（抜け側カーブ用）

  // テンプレ基準24fpsで刻む整数tick（再生fpsに依存しない位相）
  const tick = Math.floor(t * 24);
  const seed = Math.floor(v * 997) + 31;
  const grainPos = `${Math.floor(hash01(tick * 2 + seed) * GRAIN_TILE)}px ${Math.floor(
    hash01(tick * 2 + 1 + seed) * GRAIN_TILE
  )}px`;

  const grainLayer = (opacity: number) =>
    opacity > 0.004 ? (
      <AbsoluteFill
        style={{
          backgroundImage: `url("${GRAIN_URI}")`,
          backgroundRepeat: "repeat",
          backgroundPosition: grainPos,
          mixBlendMode: "overlay",
          opacity: clamp(opacity, 0, 1),
        }}
      />
    ) : null;

  // 窓：スクリーン座標のコンテンツ層を (x,y,w,h) で切り抜く。中身は逆オフセットで定位置。
  const windowBox = (
    x: number,
    y: number,
    w: number,
    h: number,
    inner: React.ReactNode,
    innerStyle?: React.CSSProperties,
    overlay?: React.ReactNode
  ) => (
    <div
      style={{
        position: "absolute",
        left: x,
        top: y,
        width: Math.max(0, w),
        height: Math.max(0, h),
        overflow: "hidden",
      }}
    >
      <div
        style={{
          position: "absolute",
          left: -x,
          top: -y,
          width,
          height,
          ...innerStyle,
        }}
      >
        {inner}
      </div>
      {overlay}
    </div>
  );

  let body: React.ReactNode = null;

  if (preset === 0) {
    // ── BAND-DUO: 中央横帯を左右2パネル＋階段ギャップで分割
    const openIn = interpolate(t, [0, 0.42], [0, 1], {
      ...CL,
      easing: Easing.out(Easing.cubic),
    });
    const openOut = interpolate(tEnd, [0, 0.36], [0, 1], {
      ...CL,
      easing: Easing.out(Easing.cubic),
    });
    const open = Math.min(openIn, openOut); // 台形＝両側min合成
    const gapProg = Math.round(open * 3) / 3; // 階段状の開閉
    const bandH = 0.4 * height * open;
    const topY = 0.5 * height - bandH / 2;
    const gapW = 0.025 * width * gapProg;
    const leftW = width / 2 - gapW / 2;
    const rightX = width / 2 + gapW / 2;

    // 開閉の瞬間だけ、各パネル窓の内側に白フラッシュ（全画面には出さない）
    const flash =
      Math.max(
        interpolate(t, [0.04, 0.16, 0.5], [0, 1, 0], CL),
        interpolate(tEnd, [0.02, 0.12, 0.44], [0, 1, 0], CL)
      ) * k;
    const flashDiv = (
      <AbsoluteFill style={{ background: "#fff", opacity: 0.85 * flash }} />
    );

    // 中身は7割縮小。左右それぞれ外端揃え・帯の垂直中心に合わせる。
    const contentTop = 0.5 * height - 0.35 * height;
    const leftContent = (
      <div
        style={{
          position: "absolute",
          left: 0,
          top: contentTop,
          width,
          height,
          transform: "scale(0.7)",
          transformOrigin: "0% 0%",
        }}
      >
        {children}
      </div>
    );
    const rightContent = (
      <div
        style={{
          position: "absolute",
          left: 0,
          top: contentTop,
          width,
          height,
          transform: "scale(0.7)",
          transformOrigin: "100% 0%",
        }}
      >
        {children}
      </div>
    );

    body = (
      <>
        {windowBox(0, topY, leftW, bandH, leftContent, undefined, flashDiv)}
        {windowBox(rightX, topY, width - rightX, bandH, rightContent, undefined, flashDiv)}
        {grainLayer(0.07 * k)}
      </>
    );
  } else if (preset === 1) {
    // ── WIPE-PANEL: 純黒パネルが左端から画面半分までワイプするだけの最小構成
    const openIn = interpolate(t, [0, 0.4], [0, 1], {
      ...CL,
      easing: Easing.out(Easing.cubic),
    });
    const openOut = interpolate(tEnd, [0, 0.34], [0, 1], {
      ...CL,
      easing: Easing.out(Easing.cubic),
    });
    const open = Math.min(openIn, openOut);
    // 例外個体: intensityを下げると分割演出を素の映像カバーへ戻す
    const panelW = 0.5 * width * open * k;

    // 開閉バースト（両端だけ山＝max合成）
    const burst =
      Math.max(
        interpolate(t, [0, 0.32, 0.52], [1, 1, 0], CL),
        interpolate(tEnd, [0, 0.28, 0.48], [1, 1, 0], CL)
      ) * k;
    const strobeOn = tick % 2 === 0; // 1フレーム刻みのON/OFF
    const boardColor = tint && tint.length > 0 ? tint : "#ffdf00"; // 純黄のベタ板

    // 輝度を振り切って白飛び＋強ブラー（縁の暗落ちを隠すため1割強スケールアップ）
    const blurPx = 9 * s * burst * (strobeOn ? 1 : 0.4);
    const bright = strobeOn ? 1 + 13 * burst : 1;
    const filters = [
      "contrast(1.07) saturate(1.02)", // 全編の軽いコントラスト持ち上げ
      burst > 0.01 ? `grayscale(${clamp(burst * 1.2, 0, 1)})` : "", // 窓全体を一時モノクロ化
      burst > 0.01 ? `brightness(${bright}) blur(${blurPx}px)` : "",
    ]
      .filter(Boolean)
      .join(" ");

    body = (
      <>
        <AbsoluteFill
          style={{
            filter: filters,
            transform: burst > 0.01 ? `scale(${1 + 0.12 * burst})` : undefined,
          }}
        >
          {children}
        </AbsoluteFill>
        {/* 黄ベタ板と輝度フラッシュが1フレーム交互に明滅 */}
        <AbsoluteFill
          style={{
            background: boardColor,
            opacity: !strobeOn && burst > 0.01 ? 0.8 * burst : 0,
          }}
        />
        <AbsoluteFill
          style={{
            background: "#fff",
            opacity: strobeOn && burst > 0.01 ? 0.55 * burst : 0,
          }}
        />
        <div
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            bottom: 0,
            width: panelW,
            background: "#000",
          }}
        />
        {grainLayer(0.1 * burst)}
      </>
    );
  } else if (preset === 2) {
    // ── TRIPLE: 縦3分割が画面中心から左右対称に開く。左右は暗化クローン。
    const openIn = interpolate(t, [0, 0.16, 0.22, 0.48], [0, 0.52, 0.56, 1], {
      ...CL,
      easing: Easing.inOut(Easing.quad),
    });
    const openOut = interpolate(tEnd, [0, 0.4], [0, 1], {
      ...CL,
      easing: Easing.out(Easing.cubic),
    });
    const open = Math.min(openIn, openOut);
    const revealW = width * open;
    const revealX = (width - revealW) / 2;

    // 家族最豪華の同時発火バースト
    const burst =
      Math.max(
        interpolate(t, [0, 0.4, 0.7], [1, 1, 0], CL),
        interpolate(tEnd, [0, 0.36, 0.64], [1, 1, 0], CL)
      ) * k;
    const blurSpike =
      Math.max(
        interpolate(t, [0, 0.1, 0.32], [1, 0.4, 0], CL),
        interpolate(tEnd, [0, 0.1, 0.32], [1, 0.4, 0], CL)
      ) * k;
    const veil =
      Math.max(
        interpolate(t, [0, 0.1, 0.5], [0.9, 0.45, 0], CL),
        interpolate(tEnd, [0, 0.1, 0.46], [0.9, 0.45, 0], CL)
      ) * k;
    const strobeOn = tick % 2 === 0;
    const bright = strobeOn ? 1 + 11 * burst : 1;
    const prismPx = 7 * s * burst; // RGBずらし量はバースト包絡線に連動
    const uid = `mvss-prism-${Math.round(v * 1000)}`;

    const panels = [0, 1, 2].map((i) => {
      const wx = (i * width) / 3;
      return (
        <React.Fragment key={i}>
          {windowBox(
            wx,
            0,
            width / 3,
            height,
            <AbsoluteFill
              style={
                i === 1
                  ? undefined
                  : { filter: "brightness(0.37) saturate(0.92)" } // 主従を作る暗化
              }
            >
              {children}
            </AbsoluteFill>
          )}
        </React.Fragment>
      );
    });

    const filters = [
      prismPx > 0.15 ? `url(#${uid})` : "",
      blurSpike > 0.01 ? `blur(${12 * s * blurSpike}px)` : "",
      burst > 0.01 ? `brightness(${bright})` : "",
    ]
      .filter(Boolean)
      .join(" ");

    body = (
      <>
        {prismPx > 0.15 ? (
          <svg width={0} height={0} style={{ position: "absolute" }}>
            <defs>
              {/* RとBを逆向きに小さくオフセットしscreen合成（角度固定・量は包絡線連動） */}
              <filter
                id={uid}
                x="-3%"
                y="-3%"
                width="106%"
                height="106%"
                colorInterpolationFilters="sRGB"
              >
                <feColorMatrix
                  in="SourceGraphic"
                  type="matrix"
                  values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0"
                  result="r"
                />
                <feOffset in="r" dx={prismPx} dy={0} result="ro" />
                <feColorMatrix
                  in="SourceGraphic"
                  type="matrix"
                  values="0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0"
                  result="g"
                />
                <feColorMatrix
                  in="SourceGraphic"
                  type="matrix"
                  values="0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0"
                  result="b"
                />
                <feOffset in="b" dx={-prismPx} dy={0} result="bo" />
                <feBlend in="ro" in2="g" mode="screen" result="rg" />
                <feBlend in="rg" in2="bo" mode="screen" />
              </filter>
            </defs>
          </svg>
        ) : null}
        <div
          style={{
            position: "absolute",
            left: revealX,
            top: 0,
            width: revealW,
            height,
            overflow: "hidden",
            filter: filters.length > 0 ? filters : undefined,
            // 縦数%歪み＋ブラー時のスケールアップ（縁の暗落ち隠し）
            transform: `scale(${1 + 0.11 * blurSpike}) scaleY(${1 + 0.05 * burst})`,
            transformOrigin: "50% 50%",
          }}
        >
          <div
            style={{
              position: "absolute",
              left: -revealX,
              top: 0,
              width,
              height,
            }}
          >
            {panels}
          </div>
        </div>
        <AbsoluteFill style={{ background: "#fff", opacity: veil }} />
        {grainLayer(0.3 * burst + 0.05 * k)}
      </>
    );
  } else {
    // ── TORN-FRAME: 開閉なし。破れ縁帯＋局所円形ぼかし。切替は白飛びで繋ぐ。
    const tIn = 0.66; // 冒頭は素カバー→ここで帯へ
    const tOutLead = 1.15; // 抜けフラッシュは終端の1秒強手前
    const flash =
      Math.max(
        interpolate(t, [tIn - 0.2, tIn, tIn + 0.34], [0, 1, 0], CL),
        interpolate(tEnd, [tOutLead - 0.34, tOutLead, tOutLead + 0.2], [0, 1, 0], CL)
      ) * Math.max(0.35, k);
    const bandPhase = t >= tIn && tEnd >= tOutLead;
    const lineColor = tint && tint.length > 0 ? tint : "#cfcfcf";

    // 全編モノクロ強グレイン＋白飛びは輝度10倍級
    const monoFilter = `grayscale(0.92) contrast(1.08) brightness(${1 + 9 * flash})`;

    // 右上の局所円形ぼかし: 量が5Hz・±3割で滑らかに揺れる
    const wobble = 1 + 0.3 * Math.sin(2 * Math.PI * 5 * t);
    const blurPx = 9 * s * wobble * Math.max(0.35, k);

    body = (
      <>
        <AbsoluteFill style={{ filter: monoFilter }}>
          {bandPhase ? (
            <>
              {/* 破れ縁の横帯（左縁わずかに外傾）にソース中央をクロップ */}
              <AbsoluteFill
                style={{
                  WebkitMaskImage: `url("${TORN_URI}")`,
                  maskImage: `url("${TORN_URI}")`,
                  WebkitMaskSize: "100% 100%",
                  maskSize: "100% 100%",
                }}
              >
                <AbsoluteFill
                  style={{ transform: "scale(1.18)", transformOrigin: "50% 42%" }}
                >
                  {children}
                </AbsoluteFill>
              </AbsoluteFill>
              {/* 局所円形ぼかし（帯マスク∩円マスクの二重掛け） */}
              <AbsoluteFill
                style={{
                  WebkitMaskImage: `url("${TORN_URI}")`,
                  maskImage: `url("${TORN_URI}")`,
                  WebkitMaskSize: "100% 100%",
                  maskSize: "100% 100%",
                }}
              >
                <AbsoluteFill
                  style={{
                    WebkitMaskImage: `radial-gradient(circle at 74% 24%, #000 0%, #000 8%, transparent 13%)`,
                    maskImage: `radial-gradient(circle at 74% 24%, #000 0%, #000 8%, transparent 13%)`,
                  }}
                >
                  <AbsoluteFill
                    style={{
                      transform: "scale(1.21)",
                      transformOrigin: "50% 42%",
                      filter: `blur(${blurPx}px)`,
                    }}
                  >
                    {children}
                  </AbsoluteFill>
                </AbsoluteFill>
              </AbsoluteFill>
              {/* 極薄グレー線2本 */}
              <div
                style={{
                  position: "absolute",
                  left: 0,
                  top: 0.502 * height,
                  width: "100%",
                  height: Math.max(1, 2 * s),
                  background: lineColor,
                  opacity: 0.5,
                }}
              />
              <div
                style={{
                  position: "absolute",
                  left: 0.04 * width,
                  top: 0.524 * height,
                  width: 0.92 * width,
                  height: Math.max(1, 1.4 * s),
                  background: lineColor,
                  opacity: 0.18,
                }}
              />
            </>
          ) : (
            // 冒頭・終端は素映像フルカバー
            <AbsoluteFill>{children}</AbsoluteFill>
          )}
        </AbsoluteFill>
        <AbsoluteFill style={{ background: "#fff", opacity: 0.9 * flash }} />
        {grainLayer(0.2 + 0.16 * k)}
      </>
    );
  }

  return (
    <AbsoluteFill style={{ background: "#000", pointerEvents: "none" }}>
      {body}
    </AbsoluteFill>
  );
};
