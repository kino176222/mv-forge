import React, { useEffect, useRef, useState } from "react";
import {
  continueRender,
  delayRender,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

/**
 * 電撃ラインのGPU発光レンダラ。
 * SVGリボン（塗った帯）ではなく、距離フィールド＋加算合成で「本物の光」を描く:
 * - 芯は白熱、周囲はハローが指数減衰（inverse-glow）
 * - 加算合成(ONE,ONE)なので光が重なると真っ白に飛ぶ＝電光の質感
 * - 線に沿った揺らぎ＋全体の瞬き（フリッカー）で「生きた電気」に
 * 形（points）と明るさ(bright)は既存の軌跡ロジックから受け取る＝あのトレースを活かす。
 */

const VERT = `
attribute vec2 aPos;    // バッファpx空間（法線オフセット済み）
attribute float aEdge;  // -1..1 幅方向の位置（0=芯）
attribute float aU;     // 0..1 線に沿った位置
attribute float aInten; // 0..1 その点の明るさ
uniform vec2 uRes;
varying float vEdge;
varying float vU;
varying float vInten;
void main() {
  vEdge = aEdge;
  vU = aU;
  vInten = aInten;
  vec2 clip = (aPos / uRes) * 2.0 - 1.0;
  clip.y = -clip.y;
  gl_Position = vec4(clip, 0.0, 1.0);
}`;

const FRAG = `
precision highp float;
varying float vEdge;
varying float vU;
varying float vInten;
uniform float uTime;
uniform float uFlicker;
uniform float uBright;
uniform vec3 uColor;

float hash(float x) { return fract(sin(x * 12.9898) * 43758.5453); }

void main() {
  float d = abs(vEdge);                    // 0芯..1縁
  float halo = pow(1.0 - d, 2.4);          // 広いグロー
  float core = smoothstep(0.14, 0.0, d);   // 細い白熱芯
  // フリッカー: 線に沿った速い揺らぎ＋全体の不規則な瞬き
  float along = 0.72 + 0.28 * sin(vU * 40.0 + uTime * 24.0)
                     + 0.12 * sin(vU * 13.0 - uTime * 9.0);
  float glob = 0.6 + 0.8 * hash(floor(uTime * 26.0));
  float fl = mix(1.0, along * glob, uFlicker);
  float inten = (halo * 0.7 + core * 1.7) * vInten * fl * uBright;
  vec3 col = mix(uColor, vec3(1.0), core); // 芯は白、ハローは色付き
  gl_FragColor = vec4(col * inten, inten); // 加算合成前提（premult済み）
}`;

// この描画セッションでWebGLがハード的に使えないと判明したら以後は即フォールバック
// （headlessのSwiftShader枯渇環境で毎フレーム無駄にリトライしないため）
let webglBroken = false;

interface GlState {
  gl: WebGLRenderingContext;
  prog: WebGLProgram;
  buf: WebGLBuffer;
  aPos: number;
  aEdge: number;
  aU: number;
  aInten: number;
  uRes: WebGLUniformLocation | null;
  uTime: WebGLUniformLocation | null;
  uFlicker: WebGLUniformLocation | null;
  uBright: WebGLUniformLocation | null;
  uColor: WebGLUniformLocation | null;
}

export const ElectricLineGL: React.FC<{
  points: [number, number][]; // バッファpx空間の軌跡
  bright: number[]; // 各点の明るさ 0..1（既存 prof.b）
  bufW: number;
  bufH: number;
  glowWidth: number; // グローの半径(px)
  color: [number, number, number]; // ハロー色 0..1
  brightness: number; // 全体の明るさ倍率
  flicker: number; // 0..1
  fallback?: React.ReactNode; // WebGL不可時に代わりに描くもの（旧SVG）
}> = ({
  points,
  bright,
  bufW,
  bufH,
  glowWidth,
  color,
  brightness,
  flicker,
  fallback,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const glRef = useRef<GlState | null>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  // 書き出し(still/動画)で「描画前にキャプチャされる」のを防ぐ
  const [handle] = useState(() => delayRender("electric-line"));
  const doneRef = useRef(false);

  useEffect(() => {
    if (webglBroken) {
      // 既にこのセッションでWebGL不可と判明済み → 即フォールバック
      setFailed(true);
      continueRender(handle);
      return;
    }
    let cancelled = false;
    // Remotionのヘッドレスでは mount直後の同期 getContext が null を返すことがある
    // （GL準備前）。水滴と同じく「非同期後に取得」＋数回リトライで確実に取る。
    const setup = (attempt: number) => {
      if (cancelled) return;
      const canvas = canvasRef.current;
      if (!canvas) {
        continueRender(handle);
        return;
      }
      const gl = canvas.getContext("webgl", {
        premultipliedAlpha: false,
        preserveDrawingBuffer: true,
      });
      if (!gl) {
        // SwiftShader のコンテキスト枯渇（BindToCurrentSequence）に備え数回リトライ
        if (attempt < 5) {
          setTimeout(() => setup(attempt + 1), 10);
          return;
        }
        // WebGL不可 → このセッションは以後フォールバック固定＋旧SVGを描画
        webglBroken = true;
        setFailed(true);
        continueRender(handle);
        return;
      }
      const compile = (type: number, src: string) => {
        const sh = gl.createShader(type)!;
        gl.shaderSource(sh, src);
        gl.compileShader(sh);
        if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS))
          throw new Error(gl.getShaderInfoLog(sh) ?? "shader error");
        return sh;
      };
      const prog = gl.createProgram()!;
      gl.attachShader(prog, compile(gl.VERTEX_SHADER, VERT));
      gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FRAG));
      gl.linkProgram(prog);
      gl.useProgram(prog);
      const buf = gl.createBuffer()!;
      gl.clearColor(0, 0, 0, 0);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE); // 加算合成: 光が足し算で重なる
      glRef.current = {
        gl,
        prog,
        buf,
        aPos: gl.getAttribLocation(prog, "aPos"),
        aEdge: gl.getAttribLocation(prog, "aEdge"),
        aU: gl.getAttribLocation(prog, "aU"),
        aInten: gl.getAttribLocation(prog, "aInten"),
        uRes: gl.getUniformLocation(prog, "uRes"),
        uTime: gl.getUniformLocation(prog, "uTime"),
        uFlicker: gl.getUniformLocation(prog, "uFlicker"),
        uBright: gl.getUniformLocation(prog, "uBright"),
        uColor: gl.getUniformLocation(prog, "uColor"),
      };
      setReady(true);
    };
    setTimeout(() => setup(0), 0);
    return () => {
      cancelled = true;
      // コンテキストを明示解放（StrictModeの二重マウントでSwiftShaderのスロットを枯渇させない）
      const st = glRef.current;
      if (st) {
        st.gl.getExtension("WEBGL_lose_context")?.loseContext();
        glRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const st = glRef.current;
    if (!ready || !st) return;
    const { gl } = st;
    const N = points.length;
    if (N < 2) return;

    // 三角ストリップ用の頂点（各点で法線±方向に glowWidth 広げる）
    const stride = 5; // x,y,edge,u,inten
    const verts = new Float32Array(N * 2 * stride);
    const normal = (j: number): [number, number] => {
      const a = points[Math.max(0, j - 1)];
      const b = points[Math.min(N - 1, j + 1)];
      const dx = b[0] - a[0];
      const dy = b[1] - a[1];
      const l = Math.hypot(dx, dy) || 1;
      return [-dy / l, dx / l];
    };
    for (let j = 0; j < N; j++) {
      const [nx, ny] = normal(j);
      const u = j / (N - 1);
      const inten = bright[j] ?? 0.5;
      const base = j * 2 * stride;
      // top (edge=+1)
      verts[base] = points[j][0] + nx * glowWidth;
      verts[base + 1] = points[j][1] + ny * glowWidth;
      verts[base + 2] = 1;
      verts[base + 3] = u;
      verts[base + 4] = inten;
      // bottom (edge=-1)
      verts[base + 5] = points[j][0] - nx * glowWidth;
      verts[base + 6] = points[j][1] - ny * glowWidth;
      verts[base + 7] = -1;
      verts[base + 8] = u;
      verts[base + 9] = inten;
    }

    gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(st.prog);
    gl.bindBuffer(gl.ARRAY_BUFFER, st.buf);
    gl.bufferData(gl.ARRAY_BUFFER, verts, gl.DYNAMIC_DRAW);
    const fb = stride * 4;
    gl.enableVertexAttribArray(st.aPos);
    gl.vertexAttribPointer(st.aPos, 2, gl.FLOAT, false, fb, 0);
    gl.enableVertexAttribArray(st.aEdge);
    gl.vertexAttribPointer(st.aEdge, 1, gl.FLOAT, false, fb, 8);
    gl.enableVertexAttribArray(st.aU);
    gl.vertexAttribPointer(st.aU, 1, gl.FLOAT, false, fb, 12);
    gl.enableVertexAttribArray(st.aInten);
    gl.vertexAttribPointer(st.aInten, 1, gl.FLOAT, false, fb, 16);

    gl.uniform2f(st.uRes, bufW, bufH);
    gl.uniform1f(st.uTime, frame / fps);
    gl.uniform1f(st.uFlicker, flicker);
    gl.uniform1f(st.uBright, brightness);
    gl.uniform3f(st.uColor, color[0], color[1], color[2]);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, N * 2);
    if (!doneRef.current) {
      doneRef.current = true;
      continueRender(handle);
    }
  }, [ready, frame, points, bright, bufW, bufH, glowWidth, color, brightness, flicker, fps]);

  // WebGL不可の環境（headlessのSwiftShader等）では旧SVGにフォールバック
  if (failed) return <>{fallback ?? null}</>;

  return (
    <canvas
      ref={canvasRef}
      width={Math.max(2, Math.round(bufW))}
      height={Math.max(2, Math.round(bufH))}
      style={{
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        display: "block",
        mixBlendMode: "screen",
        pointerEvents: "none",
      }}
    />
  );
};
