import React, { useEffect, useRef, useState } from "react";
import {
  AbsoluteFill,
  continueRender,
  delayRender,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { hashRand } from "./rand";

const MAX_DROPS = 50;

/**
 * 水滴（レンズの雨粒）: 画面手前のガラス面に付いた水滴。
 * 大半はその場で微かに揺れ、一部が周期的にスッと流れ落ちる。
 *
 * ★本物らしさの核心＝「レンズとして背景を屈折させる」こと。
 * bgSrc（背景の静止画）が渡されれば GPU(WebGL) で背景テクスチャを
 * 水滴ごとに歪め・ぼかし・明るくして本物の光学に寄せる。
 * 背景が無い区間（動画背景など）は従来のCSS表現にフォールバックする。
 */

/** 各水滴の状態（GPU/CSS共通の生成ロジック）。位置・半径は「高さ基準の正規化uv」で返す。 */
function computeDrops(
  count: number,
  size: number,
  drip: number,
  blurAmt: number,
  frame: number,
  fps: number,
  height: number,
) {
  const scale = height / 1080;
  const dropBlurPx = (1 + blurAmt * 5) * scale;
  return Array.from({ length: count }, (_, i) => {
    const xPct = hashRand(i, 61) * 96 + 2; // %
    const yPct = hashRand(i, 62) * 86 + 4; // %
    // 小粒を多めに、大粒を少数（べき乗で小さい側に寄せる＝ガラス玉の均一感を崩す）
    const rPx = (0.3 + Math.pow(hashRand(i, 63), 1.8) * 1.25) * size * scale;
    const isDrip = hashRand(i, 64) < drip;
    const wobblePx = Math.sin(frame / fps + i * 2.1) * 0.6 * scale;

    let dyPct = 0;
    let stretch = 1;
    let opacity = 0.92;
    if (isDrip) {
      const periodSec = 5 + hashRand(i, 65) * 6;
      const cycleFrames = Math.round(periodSec * fps);
      const local = (frame + Math.round(hashRand(i, 66) * cycleFrames)) % cycleFrames;
      const fallFrames = Math.round(1.4 * fps);
      const t = interpolate(local, [cycleFrames - fallFrames, cycleFrames], [0, 1], {
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
      });
      dyPct = t * t * (25 + hashRand(i, 67) * 20); // %（加速しながら落ちる）
      stretch = 1 + t * 0.9;
      opacity = 0.92 * (1 - t * 0.55);
    }

    return {
      // 正規化: x/y は 0..1（yは上=0）、半径・ぼかしは「高さの割合」
      cx: xPct / 100,
      cy: (yPct + dyPct) / 100 + wobblePx / height,
      r: rPx / height,
      stretch,
      opacity,
      blur: dropBlurPx / height,
      // CSS版で使う px 値
      xPct,
      yPct: yPct + dyPct,
      rPx,
      wobblePx,
    };
  });
}

/* ---------- GPU（WebGL）版: 背景を本物のレンズとして屈折 ---------- */

const VERT = `
attribute vec2 aPos;
varying vec2 vUv;
void main() {
  // 画面uv（y下向き=0が上）
  vUv = vec2(aPos.x * 0.5 + 0.5, 0.5 - aPos.y * 0.5);
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

const FRAG = `
precision highp float;
varying vec2 vUv;
uniform sampler2D uImage;
uniform float uAspect;        // width / height
uniform int uCount;
uniform vec4 uDropsA[${MAX_DROPS}];  // xy=中心uv, z=半径(高さ基準), w=縦伸び
uniform vec2 uDropsB[${MAX_DROPS}];  // x=不透明度, y=ぼかし
uniform float uRefract;       // 0..1 屈折の強さ
uniform float uBright;        // 明るさ(本物は背景より明るい)

vec3 texAt(vec2 uv) {
  return texture2D(uImage, vec2(uv.x, uv.y)).rgb;
}

// 安価な5タップぼかし
vec3 sampleBlur(vec2 uv, float b) {
  vec3 s = texAt(uv) * 0.4;
  s += texAt(uv + vec2(b, 0.0)) * 0.15;
  s += texAt(uv - vec2(b, 0.0)) * 0.15;
  s += texAt(uv + vec2(0.0, b)) * 0.15;
  s += texAt(uv - vec2(0.0, b)) * 0.15;
  return s;
}

void main() {
  vec2 uv = vUv;
  // 水滴の部分だけを描き、他は透明（背景は下のレイヤーがそのまま見える）
  vec4 acc = vec4(0.0);
  for (int i = 0; i < ${MAX_DROPS}; i++) {
    if (i >= uCount) break;
    vec2 c = uDropsA[i].xy;
    float r = uDropsA[i].z;
    float stretch = max(uDropsA[i].w, 0.001);
    // アスペクト補正した楕円距離（水滴を丸く保つ＋落下時は縦長）
    vec2 d = uv - c;
    vec2 da = vec2(d.x * uAspect, d.y / stretch);
    float dist = length(da);
    // 輪郭を少し不揃いにする（完全な真円=ガラス玉っぽさを崩す）
    float ang = atan(da.y, da.x);
    float rr = r * (1.0 + 0.05 * sin(ang * 5.0 + c.x * 37.0) + 0.035 * sin(ang * 3.0 - c.y * 29.0));
    if (dist < rr) {
      float nd = dist / rr;                      // 0中心..1縁
      float lens = 1.0 - nd * nd;                // 中心1..縁0（平たいレンズ profile）
      // 中心からの向き(真uv空間へ戻す)
      vec2 dir = da / max(dist, 1e-4);
      vec2 dirUv = normalize(vec2(dir.x / uAspect, dir.y * stretch));
      // 屈折変位: 全体に控えめ、縁でわずかに曲げる（真球の強拡大をやめる）
      float disp = uRefract * 0.10 * nd * (0.5 + 0.5 * lens);
      vec2 sUv = clamp(uv - dirUv * disp, 0.001, 0.999);
      float blur = uDropsB[i].y * (0.3 + 0.7 * nd);
      vec3 rc = sampleBlur(sUv, blur);
      // 明るさは中心だけほんのり（縁は素の背景に近い＝ギラつきを抑える）
      rc *= mix(1.0, uBright, lens);
      // 小さく鋭いグリント（点。大きな白玉にはしない）
      vec2 hl = da - vec2(-0.34, -0.36) * r;
      float glint = smoothstep(0.14 * r, 0.0, length(hl));
      rc += glint * 0.55;
      // 縁のごく薄い暗リング（濡れ縁）
      float rim = smoothstep(0.72, 1.0, nd);
      rc *= (1.0 - rim * 0.28);
      // アルファ: 中心ほど濃く、縁はなめらかに消える
      float a = (1.0 - smoothstep(0.86, 1.0, nd)) * uDropsB[i].x;
      // over 合成（前の水滴の上に重ねる）
      acc.rgb = rc * a + acc.rgb * (1.0 - a);
      acc.a = a + acc.a * (1.0 - a);
    }
  }
  gl_FragColor = acc;
}`;

interface GlState {
  gl: WebGLRenderingContext;
  uAspect: WebGLUniformLocation;
  uCount: WebGLUniformLocation;
  uDropsA: WebGLUniformLocation;
  uDropsB: WebGLUniformLocation;
  uRefract: WebGLUniformLocation;
  uBright: WebGLUniformLocation;
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`load failed: ${url}`));
    img.src = url;
  });
}

const RainDropsGL: React.FC<{
  count: number;
  size: number;
  drip: number;
  blur: number;
  refract: number;
  bright: number;
  bgSrc: string;
  onFail: () => void;
}> = ({ count, size, drip, blur, refract, bright, bgSrc, onFail }) => {
  const frame = useCurrentFrame();
  const { width, height, fps } = useVideoConfig();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const glRef = useRef<GlState | null>(null);
  const [ready, setReady] = useState(false);
  const [handle] = useState(() => delayRender("raindrops-texture"));

  useEffect(() => {
    let cancelled = false;
    loadImage(bgSrc)
      .then((img) => {
        if (cancelled || !canvasRef.current) return;
        const gl = canvasRef.current.getContext("webgl", {
          preserveDrawingBuffer: true,
          premultipliedAlpha: false,
        });
        if (!gl) throw new Error("no webgl");
        const compile = (type: number, srcCode: string) => {
          const sh = gl.createShader(type)!;
          gl.shaderSource(sh, srcCode);
          gl.compileShader(sh);
          if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS))
            throw new Error(gl.getShaderInfoLog(sh) ?? "shader error");
          return sh;
        };
        const prog = gl.createProgram()!;
        gl.attachShader(prog, compile(gl.VERTEX_SHADER, VERT));
        gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FRAG));
        gl.linkProgram(prog);
        if (!gl.getProgramParameter(prog, gl.LINK_STATUS))
          throw new Error(gl.getProgramInfoLog(prog) ?? "link error");
        gl.useProgram(prog);

        const buf = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, buf);
        gl.bufferData(
          gl.ARRAY_BUFFER,
          new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
          gl.STATIC_DRAW,
        );
        const aPos = gl.getAttribLocation(prog, "aPos");
        gl.enableVertexAttribArray(aPos);
        gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

        const tex = gl.createTexture();
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, img);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.uniform1i(gl.getUniformLocation(prog, "uImage"), 0);

        // 透明背景＋水滴のみを合成（背景は下のレイヤーがそのまま透ける）
        gl.clearColor(0, 0, 0, 0);
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

        glRef.current = {
          gl,
          uAspect: gl.getUniformLocation(prog, "uAspect")!,
          uCount: gl.getUniformLocation(prog, "uCount")!,
          uDropsA: gl.getUniformLocation(prog, "uDropsA[0]")!,
          uDropsB: gl.getUniformLocation(prog, "uDropsB[0]")!,
          uRefract: gl.getUniformLocation(prog, "uRefract")!,
          uBright: gl.getUniformLocation(prog, "uBright")!,
        };
        setReady(true);
        continueRender(handle);
      })
      .catch(() => {
        if (!cancelled) {
          continueRender(handle);
          onFail();
        }
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bgSrc]);

  useEffect(() => {
    const state = glRef.current;
    if (!ready || !state) return;
    const { gl } = state;
    const drops = computeDrops(count, size, drip, blur, frame, fps, height);

    const a = new Float32Array(MAX_DROPS * 4);
    const b = new Float32Array(MAX_DROPS * 2);
    drops.forEach((d, i) => {
      if (i >= MAX_DROPS) return;
      a[i * 4] = d.cx;
      a[i * 4 + 1] = d.cy;
      a[i * 4 + 2] = d.r;
      a[i * 4 + 3] = d.stretch;
      b[i * 2] = d.opacity;
      b[i * 2 + 1] = d.blur;
    });

    gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.uniform1f(state.uAspect, width / height);
    gl.uniform1i(state.uCount, Math.min(count, MAX_DROPS));
    gl.uniform4fv(state.uDropsA, a);
    gl.uniform2fv(state.uDropsB, b);
    gl.uniform1f(state.uRefract, refract);
    gl.uniform1f(state.uBright, bright);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }, [ready, frame, count, size, drip, blur, refract, bright, width, height, fps]);

  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      <canvas
        ref={canvasRef}
        width={width}
        height={height}
        style={{ width: "100%", height: "100%" }}
      />
    </AbsoluteFill>
  );
};

/* ---------- CSS版（背景が無い区間のフォールバック） ---------- */

const RainDropsCss: React.FC<{
  count: number;
  size: number;
  drip: number;
  blur: number;
}> = ({ count, size, drip, blur }) => {
  const frame = useCurrentFrame();
  const { fps, height } = useVideoConfig();
  const scale = height / 1080;
  const drops = computeDrops(count, size, drip, blur, frame, fps, height);
  const dropBlur = (1 + blur * 5) * scale;

  return (
    <AbsoluteFill style={{ pointerEvents: "none", overflow: "hidden" }}>
      {drops.map((d, i) => (
        <div
          key={i}
          style={{
            position: "absolute",
            left: `${d.xPct}%`,
            top: `calc(${d.yPct}% + ${d.wobblePx}px)`,
            width: d.rPx,
            height: d.rPx * 1.15 * d.stretch,
            borderRadius: "46% 54% 52% 48% / 40% 42% 58% 60%",
            background:
              "radial-gradient(circle at 32% 28%, rgba(255,255,255,0.85) 0%, rgba(255,255,255,0.28) 18%, rgba(255,255,255,0.06) 45%, rgba(0,0,0,0.18) 78%, rgba(0,0,0,0.3) 100%)",
            boxShadow: `inset 0 ${1.5 * scale}px ${3 * scale}px rgba(255,255,255,0.5), 0 ${2 * scale}px ${6 * scale}px rgba(0,0,0,0.25)`,
            filter: `blur(${dropBlur}px)`,
            opacity: d.opacity,
            mixBlendMode: "screen",
          }}
        />
      ))}
    </AbsoluteFill>
  );
};

/* ---------- 公開コンポーネント: 背景があればGPU、無ければCSS ---------- */

export const RainDrops: React.FC<{
  count: number;
  size: number; // 基準サイズ(px, 1080p基準)
  drip: number; // 0-1 流れ落ちる水滴の割合
  blur: number; // 0-1 ピンボケ度（手前ボケの強さ）
  refract?: number; // 0-1 屈折の強さ（GPU時のみ）
  bright?: number; // 明るさ（GPU時のみ, 本物は背景より明るい）
  bgSrc?: string; // 背景の静止画URL。あればGPUで本物の屈折
}> = ({ count, size, drip, blur, refract = 0.6, bright = 1.15, bgSrc }) => {
  const [glFailed, setGlFailed] = useState(false);
  if (bgSrc && !glFailed) {
    return (
      <RainDropsGL
        count={count}
        size={size}
        drip={drip}
        blur={blur}
        refract={refract}
        bright={bright}
        bgSrc={bgSrc}
        onFail={() => setGlFailed(true)}
      />
    );
  }
  return <RainDropsCss count={count} size={size} drip={drip} blur={blur} />;
};
