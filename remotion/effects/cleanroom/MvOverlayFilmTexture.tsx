import React, { useId, useMemo } from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";

/**
 * MvOverlayFilmTexture — フィルム質感（塵・傷・粒状・染料発色）の「空気」を
 * 映像にまとわせるオーバーレイ家族。クリーンルーム実装（技法メモとポスターの
 * 雰囲気のみを根拠に白紙から作成）。
 *
 * 家族標準の骨格:
 *   - 元映像(children)は無加工で最下層に全面描画
 *   - 質感プレート（SVG文字列→data URI化した静止テクスチャ）を上に重ねる
 *   - 台形エンベロープ（イン→保持→アウト、smoothstepの静かなease）で出入り
 *   - 決定論的（ハッシュ乱数のみ。Math.random不使用）
 *
 * variant(0..1) → 2プリセット:
 *   0.0側 DIRTS  グレードなしのオーバーレイ純度100%。据え置きヘイズ＋
 *                微明滅する塵・傷の静的2プレートをscreenで乗せるだけ。
 *                右1/3＋上端帯に偏った露出マスクが主役
 *   1.0側 GRADE  映像自体を作り替える側。SVGフィルタ1本（モノクロ＋染料加算＋
 *                R/Bチャンネルぼかし＋プリズム＋ピボット固定コントラスト＋
 *                ハレーション）を元映像の複製に適用し不透明度で元と混ぜる。
 *                粒状ジャンプ・黒埃/毛のtick引き直しはこちらだけ
 */
export interface MvOverlayFilmTextureProps {
  children: React.ReactNode;
  durationInFrames: number;
  intensity?: number; // 0..100
  variant?: number; // 0..1 家族内の見た目分岐
  tint?: string; // 任意: 基調色（ヘイズ・塵の色味）。未指定=薄い青みグレー
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

// smoothstep: 端点と所要時間を変えずに緩急化（静かなease-in-out）
const smooth = (t: number) => {
  const x = clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
};

// 整数インデックス＋ソルト→0..1 のハッシュ乱数（レンダーが揺れない）
const hash01 = (i: number, salt: number) => {
  const x = Math.sin(i * 127.1 + salt * 311.7) * 43758.5453;
  return x - Math.floor(x);
};

// #rgb / #rrggbb → 0..1 RGB（失敗時はデザイン既定の薄い青みグレー）
const DEFAULT_TINT: [number, number, number] = [0.84, 0.87, 0.91];
const hexToRgb01 = (hex?: string): [number, number, number] => {
  if (!hex) return DEFAULT_TINT;
  const m = hex.trim().match(/^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/);
  if (!m) return DEFAULT_TINT;
  let h = m[1];
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  return [
    parseInt(h.slice(0, 2), 16) / 255,
    parseInt(h.slice(2, 4), 16) / 255,
    parseInt(h.slice(4, 6), 16) / 255,
  ];
};

const svgUri = (svg: string) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

// 輝度モノクロ化（Rec.709係数）。alpha行は素通し（premultiplied対策）
const LUM_M = "0.2126 0.7152 0.0722 0 0 0.2126 0.7152 0.0722 0 0 0.2126 0.7152 0.0722 0 0 0 0 0 1 0";
const KEEP_R = "1 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 1 0";
const KEEP_G = "0 0 0 0 0 0 1 0 0 0 0 0 0 0 0 0 0 0 1 0";
const KEEP_B = "0 0 0 0 0 0 0 0 0 0 0 0 1 0 0 0 0 0 1 0";
// 3×3染料混合行列（原色が互いにわずかに滲む）。alpha行は素通し
const DYE_M = "1 0.24 0.08 0 0 0.10 1 0.20 0 0 0.06 0.18 1 0 0 0 0 0 1 0";

export const MvOverlayFilmTexture: React.FC<MvOverlayFilmTextureProps> = ({
  children,
  durationInFrames,
  intensity = 80,
  variant = 0,
  tint,
}) => {
  const frame = useCurrentFrame();
  const { width, height, fps } = useVideoConfig();
  const fid = `mvft${useId().replace(/[^a-zA-Z0-9]/g, "")}`;

  const k = clamp(intensity, 0, 100) / 100;
  const v = clamp(variant, 0, 1);
  const isGrade = v >= 0.5;
  const salt = 31 + Math.round(v * 200) * 0.37;
  const sd = 7 + Math.round(v * 97); // SVG feTurbulence 用の整数seed
  const s = width / 1920; // 幅1920基準の設計値スケール
  const t = frame / fps;
  const tEnd = Math.max(1, durationInFrames) / fps;

  // 台形エンベロープ。アウト側は「終端からの残り時間」で読み、min合成で
  // 任意の尺でもイン・アウトが端に張り付く。役割別に開始をずらせる
  const envAt = (delay: number, fade: number) => {
    const a = smooth((t - delay) / fade);
    const b = smooth((tEnd - t - delay * 0.6) / fade);
    return Math.min(a, b);
  };

  // 微明滅: 毎秒6回・深さ2割弱。ハッシュ目標値間をsmoothstepで補間（パカパカさせない）
  const seg = t * 6;
  const i0 = Math.floor(seg);
  const fa = hash01(i0, salt + 5);
  const fb = hash01(i0 + 1, salt + 5);
  const flicker = 1 - 0.18 * (fa + (fb - fa) * smooth(seg - i0));

  const [tr, tg, tb] = hexToRgb01(tint);
  const tintRgb = `rgb(${Math.round(tr * 255)},${Math.round(tg * 255)},${Math.round(tb * 255)})`;

  // ---- 質感プレート（ビルド時に一度だけ決定論的に生成） ----

  // プレート1: まだらヘイズ＋拭き跡ストリーク＋黒の抜け。
  // 露出マスク＝水平グラデ（右1/3が濃く左は気配だけ）＋上端に薄い帯
  const hazeUri = useMemo(() => {
    const W = Math.round(width);
    const H = Math.round(height);
    let blotches = "";
    for (let i = 0; i < 6; i++) {
      const x = W * (0.45 + 0.55 * hash01(i, salt + 21));
      const y = H * hash01(i + 40, salt + 21);
      const rx = (60 + 150 * hash01(i + 80, salt + 21)) * s;
      const ry = rx * (0.5 + 0.6 * hash01(i + 120, salt + 21));
      const o = 0.45 + 0.4 * hash01(i + 160, salt + 21);
      blotches += `<ellipse cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" rx="${rx.toFixed(1)}" ry="${ry.toFixed(1)}" fill="#000" filter="url(#bl)" opacity="${o.toFixed(2)}"/>`;
    }
    for (let i = 0; i < 14; i++) {
      const x = W * hash01(i + 500, salt + 23);
      const y = H * hash01(i + 600, salt + 23);
      const r = (2 + 4 * hash01(i + 700, salt + 23)) * s;
      blotches += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r.toFixed(1)}" fill="#000" filter="url(#bs)" opacity="0.5"/>`;
    }
    const bf1 = (0.0021 / s).toFixed(5);
    const bf1y = (0.0032 / s).toFixed(5);
    const bf2 = (0.018 / s).toFixed(5);
    const bf2y = (0.0009 / s).toFixed(6);
    const bf3 = (0.5 / s).toFixed(4);
    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">` +
      `<defs>` +
      `<filter id="hz" x="-5%" y="-5%" width="110%" height="110%"><feTurbulence type="fractalNoise" baseFrequency="${bf1} ${bf1y}" numOctaves="3" seed="${sd}"/><feColorMatrix type="matrix" values="0 0 0 0 ${tr.toFixed(3)} 0 0 0 0 ${tg.toFixed(3)} 0 0 0 0 ${tb.toFixed(3)} 0.85 0.55 0 0 -0.32"/></filter>` +
      `<filter id="st" x="-5%" y="-5%" width="110%" height="110%"><feTurbulence type="fractalNoise" baseFrequency="${bf2} ${bf2y}" numOctaves="2" seed="${sd + 3}"/><feColorMatrix type="matrix" values="0 0 0 0 ${tr.toFixed(3)} 0 0 0 0 ${tg.toFixed(3)} 0 0 0 0 ${tb.toFixed(3)} 0.7 0.5 0 0 -0.42"/></filter>` +
      `<filter id="fg"><feTurbulence type="fractalNoise" baseFrequency="${bf3}" numOctaves="2" seed="${sd + 9}"/><feColorMatrix type="matrix" values="0 0 0 0 ${tr.toFixed(3)} 0 0 0 0 ${tg.toFixed(3)} 0 0 0 0 ${tb.toFixed(3)} 0 0 0.55 0 -0.2"/></filter>` +
      `<filter id="bl"><feGaussianBlur stdDeviation="${(34 * s).toFixed(1)}"/></filter>` +
      `<filter id="bs"><feGaussianBlur stdDeviation="${(6 * s).toFixed(1)}"/></filter>` +
      `<linearGradient id="gx" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#fff" stop-opacity="0.10"/><stop offset="0.55" stop-color="#fff" stop-opacity="0.22"/><stop offset="0.72" stop-color="#fff" stop-opacity="0.7"/><stop offset="1" stop-color="#fff" stop-opacity="1"/></linearGradient>` +
      `<linearGradient id="gy" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity="0.55"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>` +
      `<mask id="mx"><rect width="${W}" height="${H}" fill="url(#gx)"/><rect width="${W}" height="${Math.round(H * 0.14)}" fill="url(#gy)"/></mask>` +
      `</defs>` +
      `<g mask="url(#mx)">` +
      `<rect width="${W}" height="${H}" filter="url(#hz)"/>` +
      `<rect width="${W}" height="${H}" filter="url(#st)" opacity="0.5"/>` +
      `<rect width="${W}" height="${H}" filter="url(#fg)" opacity="0.35"/>` +
      blotches +
      `</g></svg>`;
    return svgUri(svg);
  }, [width, height, s, sd, salt, tr, tg, tb]);

  // プレート2: 明るい塵・傷・繊維。マスクの濃い側（右）と上端に偏らせて撒く
  const dustUri = useMemo(() => {
    const W = Math.round(width);
    const H = Math.round(height);
    let el = "";
    for (let i = 0; i < 70; i++) {
      const b = hash01(i, salt + 51);
      let x: number;
      let y: number;
      if (b < 0.55) {
        x = W * (0.6 + 0.4 * hash01(i + 200, salt + 52));
        y = H * hash01(i + 300, salt + 52);
      } else if (b < 0.8) {
        x = W * hash01(i + 200, salt + 52);
        y = H * 0.16 * hash01(i + 300, salt + 52);
      } else {
        x = W * hash01(i + 200, salt + 52);
        y = H * hash01(i + 300, salt + 52);
      }
      const r = (1 + 3 * hash01(i + 400, salt + 52) ** 2) * s;
      const o = 0.1 + 0.3 * hash01(i + 500, salt + 52);
      el += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r.toFixed(2)}" fill="${tintRgb}" opacity="${o.toFixed(2)}"/>`;
    }
    // フィルム傷: 縦長細矩形（幅1〜3px・長さ画面の1/3〜1本分）
    for (let i = 0; i < 4; i++) {
      const x = W * (0.35 + 0.62 * hash01(i + 900, salt + 53));
      const w = (1 + 2 * hash01(i + 950, salt + 53)) * s;
      const len = H * (0.33 + 0.67 * hash01(i + 970, salt + 53));
      const y = (H - len) * hash01(i + 990, salt + 53);
      const o = 0.1 + 0.15 * hash01(i + 1010, salt + 53);
      el += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(2)}" height="${len.toFixed(1)}" fill="${tintRgb}" filter="url(#fb)" opacity="${o.toFixed(2)}"/>`;
    }
    // 毛・繊維: 手描き風の短い開曲線＋軽いぼかし
    for (let i = 0; i < 3; i++) {
      const x0 = W * (0.5 + 0.5 * hash01(i + 1100, salt + 54));
      const y0 = H * hash01(i + 1150, salt + 54);
      const ang = hash01(i + 1200, salt + 54) * Math.PI * 2;
      const len = (60 + 90 * hash01(i + 1250, salt + 54)) * s;
      const x1 = x0 + Math.cos(ang) * len;
      const y1 = y0 + Math.sin(ang) * len;
      const bend = len * 0.35 * (hash01(i + 1300, salt + 54) - 0.5) * 2;
      const cx = (x0 + x1) / 2 - Math.sin(ang) * bend;
      const cy = (y0 + y1) / 2 + Math.cos(ang) * bend;
      el += `<path d="M ${x0.toFixed(1)} ${y0.toFixed(1)} Q ${cx.toFixed(1)} ${cy.toFixed(1)} ${x1.toFixed(1)} ${y1.toFixed(1)}" stroke="${tintRgb}" stroke-width="${(1.2 * s).toFixed(2)}" fill="none" stroke-linecap="round" filter="url(#fb)" opacity="0.28"/>`;
    }
    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">` +
      `<defs><filter id="fb" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="${(0.7 * s).toFixed(2)}"/></filter></defs>` +
      el +
      `</svg>`;
    return svgUri(svg);
  }, [width, height, s, salt, tintRgb]);

  // 粒状ノイズタイル: 50%グレー中心のグレースケール（overlayで明暗両方向にざらつく）
  const grainUri = useMemo(() => {
    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" width="220" height="220">` +
      `<filter id="g"><feTurbulence type="fractalNoise" baseFrequency="0.8" numOctaves="2" seed="${sd + 17}" stitchTiles="stitch"/>` +
      `<feColorMatrix type="saturate" values="0"/>` +
      `<feComponentTransfer><feFuncR type="linear" slope="0.55" intercept="0.22"/><feFuncG type="linear" slope="0.55" intercept="0.22"/><feFuncB type="linear" slope="0.55" intercept="0.22"/><feFuncA type="linear" slope="0" intercept="1"/></feComponentTransfer></filter>` +
      `<rect width="220" height="220" filter="url(#g)"/></svg>`;
    return svgUri(svg);
  }, [sd]);

  // ---- レイヤー分岐 ----

  let texture: React.ReactNode = null;

  if (!isGrade) {
    // DIRTS: エンベロープ1本（イン約1.75秒・アウト対称）
    const env = envAt(0, 1.75) * k;
    texture = (
      <>
        <AbsoluteFill
          style={{
            backgroundImage: `url("${hazeUri}")`,
            backgroundSize: "100% 100%",
            mixBlendMode: "screen",
            opacity: env * 0.95,
            // ぼかし系は画面端で透明を巻き込むのでこのレイヤーだけ拡大して端を逃がす
            transform: "scale(1.03)",
          }}
        />
        <AbsoluteFill
          style={{
            backgroundImage: `url("${dustUri}")`,
            backgroundSize: "100% 100%",
            mixBlendMode: "screen",
            opacity: env * flicker,
            transform: "scale(1.015)",
          }}
        />
      </>
    );
  } else {
    // GRADE: 役割別エンベロープ5本が微妙にずれて立ち上がる
    const envGrade = envAt(0, 1.3); // グレード全体の混合率
    const envDye = envAt(0.05, 1.3); // 染料加算量
    const envPrism = envAt(0.15, 1.3); // プリズム＋チャンネルぼかし（ぼかしはピーク0.3止まり）
    const envHalo = envAt(0.3, 1.4); // ハレーション
    const envCon = envAt(0.45, 1.5); // コントラスト（ピボット固定線形）

    const prismPx = 1.8 * s * envPrism;
    const chBlur = 5 * s * envPrism * 0.3;
    const conSlope = 1 + 0.55 * envCon; // slope最大1.6弱
    const conPivot = 0.44; // 中間灰よりやや暗め
    const conIcpt = conPivot * (1 - conSlope);
    const haloAmt = 0.32 * envHalo;
    const haloBlur = 55 * s;

    // 段階更新: テンプレ基準24fps相当の整数tick（再生fps非依存）
    const tick = Math.floor(t * 24);
    const gx = Math.floor(hash01(tick, salt + 71) * 220 * s);
    const gy = Math.floor(hash01(tick + 999, salt + 71) * 220 * s);

    // 黒い埃・毛: 3フレームホールドで引き直し、約半分を間引き「常に満員」にしない
    const dtick = Math.floor(tick / 3);
    const specks: React.ReactNode[] = [];
    for (let i = 0; i < 8; i++) {
      if (hash01(dtick * 17 + i, salt + 81) < 0.55) continue;
      const x = width * hash01(dtick * 29 + i * 7, salt + 82);
      const y = height * hash01(dtick * 31 + i * 11, salt + 83);
      const r = (1 + 2.5 * hash01(dtick * 37 + i * 13, salt + 84)) * s;
      specks.push(<circle key={`d${i}`} cx={x} cy={y} r={r} fill="#0b0b0c" opacity={0.75} />);
    }
    for (let i = 0; i < 2; i++) {
      if (hash01(dtick * 41 + i, salt + 85) < 0.5) continue;
      const x0 = width * hash01(dtick * 43 + i * 17, salt + 86);
      const y0 = height * hash01(dtick * 47 + i * 19, salt + 87);
      const ang = hash01(dtick * 53 + i * 23, salt + 88) * Math.PI * 2;
      const len = (40 + 80 * hash01(dtick * 59 + i * 29, salt + 89)) * s;
      const x1 = x0 + Math.cos(ang) * len;
      const y1 = y0 + Math.sin(ang) * len;
      const bend = len * 0.3 * (hash01(dtick * 61 + i * 31, salt + 90) - 0.5) * 2;
      const cx = (x0 + x1) / 2 - Math.sin(ang) * bend;
      const cy = (y0 + y1) / 2 + Math.cos(ang) * bend;
      specks.push(
        <path
          key={`h${i}`}
          d={`M ${x0.toFixed(1)} ${y0.toFixed(1)} Q ${cx.toFixed(1)} ${cy.toFixed(1)} ${x1.toFixed(1)} ${y1.toFixed(1)}`}
          stroke="#0d0d0e"
          strokeWidth={1.8 * s}
          fill="none"
          strokeLinecap="round"
          opacity={0.8}
        />,
      );
    }

    texture = (
      <>
        {/* グレード本体: 元映像の複製にSVGフィルタを適用し不透明度で元と混ぜる */}
        <AbsoluteFill
          style={{
            opacity: envGrade * k * 0.88,
            filter: `url(#${fid})`,
            // チャンネルずらし・ぼかしの端の色縁を逃がす
            transform: "scale(1.04)",
          }}
        >
          {children}
        </AbsoluteFill>
        {/* 粒状: タイル位置を24fps相当tickでジャンプ（毎フレーム引き直される見え） */}
        <AbsoluteFill
          style={{
            backgroundImage: `url("${grainUri}")`,
            backgroundSize: `${Math.round(220 * s)}px ${Math.round(220 * s)}px`,
            backgroundPosition: `${gx}px ${gy}px`,
            mixBlendMode: "overlay",
            opacity: envAt(0.35, 1.3) * k * 0.5,
          }}
        />
        {/* 黒い埃・毛: ブレンドせず普通に上描き */}
        <svg
          width={width}
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          style={{ position: "absolute", inset: 0, opacity: envAt(0.25, 1.3) * k * flicker }}
        >
          {specks}
        </svg>
        {/* グレードのSVGフィルタ定義（描画されない） */}
        <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden>
          <defs>
            <filter id={fid} x="-8%" y="-8%" width="116%" height="116%" colorInterpolationFilters="sRGB">
              {/* 輝度ベースでモノクロ化 */}
              <feColorMatrix in="SourceGraphic" type="matrix" values={LUM_M} result="mono" />
              {/* ハイライト抽出: 黒レベルを7割まで持ち上げ→ガンマで中間調を締める */}
              <feComponentTransfer in="mono" result="hi0">
                <feFuncR type="linear" slope="3.333" intercept="-2.333" />
                <feFuncG type="linear" slope="3.333" intercept="-2.333" />
                <feFuncB type="linear" slope="3.333" intercept="-2.333" />
              </feComponentTransfer>
              <feComponentTransfer in="hi0" result="hi">
                <feFuncR type="gamma" amplitude="1" exponent="1.9" offset="0" />
                <feFuncG type="gamma" amplitude="1" exponent="1.9" offset="0" />
                <feFuncB type="gamma" amplitude="1" exponent="1.9" offset="0" />
              </feComponentTransfer>
              {/* 3×3染料混合行列で着色（alpha行は素通し）→モノクロに加算 */}
              <feColorMatrix in="hi" type="matrix" values={DYE_M} result="dye" />
              <feComposite in="mono" in2="dye" operator="arithmetic" k1="0" k2="1" k3={String(envDye)} k4="0" result="tinted" />
              {/* 色収差プリズム: 赤を右へ・青を左へ。R/Bのみぼかし、Gはシャープ */}
              <feColorMatrix in="tinted" type="matrix" values={KEEP_R} result="ronly" />
              <feOffset in="ronly" dx={prismPx} dy={0} result="roff" />
              <feGaussianBlur in="roff" stdDeviation={chBlur} result="rb" />
              <feColorMatrix in="tinted" type="matrix" values={KEEP_B} result="bonly" />
              <feOffset in="bonly" dx={-prismPx} dy={0} result="boff" />
              <feGaussianBlur in="boff" stdDeviation={chBlur} result="bb" />
              <feColorMatrix in="tinted" type="matrix" values={KEEP_G} result="gonly" />
              <feComposite in="rb" in2="gonly" operator="arithmetic" k1="0" k2="1" k3="1" k4="0" result="rg" />
              <feComposite in="rg" in2="bb" operator="arithmetic" k1="0" k2="1" k3="1" k4="0" result="prism" />
              {/* コントラスト: ピボット固定線形 out=(in-pivot)*slope+pivot */}
              <feComponentTransfer in="prism" result="con">
                <feFuncR type="linear" slope={conSlope} intercept={conIcpt} />
                <feFuncG type="linear" slope={conSlope} intercept={conIcpt} />
                <feFuncB type="linear" slope={conSlope} intercept={conIcpt} />
              </feComponentTransfer>
              {/* ハレーション: 無彩色の白ボケ。軽くぼかし→輝度→急峻抽出→大きくぼかし→screen */}
              <feGaussianBlur in="con" stdDeviation={2 * s} result="h1" />
              <feColorMatrix in="h1" type="matrix" values={LUM_M} result="h2" />
              <feComponentTransfer in="h2" result="h3">
                <feFuncR type="linear" slope="8" intercept="-6.56" />
                <feFuncG type="linear" slope="8" intercept="-6.56" />
                <feFuncB type="linear" slope="8" intercept="-6.56" />
              </feComponentTransfer>
              <feGaussianBlur in="h3" stdDeviation={haloBlur} result="h4" />
              <feColorMatrix
                in="h4"
                type="matrix"
                values={`${haloAmt} 0 0 0 0 0 ${haloAmt} 0 0 0 0 0 ${haloAmt} 0 0 0 0 0 1 0`}
                result="halo"
              />
              <feBlend in="con" in2="halo" mode="screen" />
            </filter>
          </defs>
        </svg>
      </>
    );
  }

  return (
    // isolationでblendの外漏れを防ぎ、背景は黒
    <AbsoluteFill style={{ backgroundColor: "#000", isolation: "isolate", pointerEvents: "none" }}>
      <AbsoluteFill>{children}</AbsoluteFill>
      {texture}
    </AbsoluteFill>
  );
};
