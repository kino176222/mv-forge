import React, { useEffect, useRef, useState } from "react";
import {
  AbsoluteFill,
  Img,
  continueRender,
  delayRender,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { resolveParams } from "@/lib/effects-meta";
import type { EffectInstance } from "@/lib/schema";
import { parallaxUniforms } from "./parallax-math";

/**
 * 2.5Dパララックス: 深度マップ（images/<name>.depth.png）を使い、
 * WebGLで手前と奥を別速度で動かして1枚絵に立体感を与える。
 * 深度マップが無い/読めない場合は静止画にフォールバックする。
 */

const VERT = `
attribute vec2 aPos;
varying vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

const FRAG = `
precision highp float;
varying vec2 vUv;
uniform sampler2D uImage;
uniform sampler2D uDepth;
uniform vec2 uShift;
uniform float uZoom;
uniform float uHeight;
uniform float uSteady;
uniform float uIso;
void main() {
  vec2 c = vUv - 0.5;
  vec2 uv0 = c / uZoom + 0.5;      // 深度の参照用
  uv0.y = 1.0 - uv0.y;
  float d = texture2D(uDepth, uv0).r;
  float pz = uZoom * (1.0 + uHeight * (d - uSteady) * (1.0 - uIso));  // 深度依存の遠近スケール
  vec2 uv = c / pz + 0.5;
  uv.y = 1.0 - uv.y;
  vec2 suv = clamp(uv + uShift * (d - uSteady), 0.001, 0.999);  // clampは保険（数式上は発動しない）
  gl_FragColor = texture2D(uImage, suv);
}`;

interface GlState {
  gl: WebGLRenderingContext;
  uShift: WebGLUniformLocation;
  uZoom: WebGLUniformLocation;
  uHeight: WebGLUniformLocation;
  uSteady: WebGLUniformLocation;
  uIso: WebGLUniformLocation;
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

export const ParallaxLayer: React.FC<{
  src: string;
  depthSrc: string;
  instance: EffectInstance;
  durationInFrames: number;
}> = ({ src, depthSrc, instance, durationInFrames }) => {
  const frame = useCurrentFrame();
  const { width, height, fps } = useVideoConfig();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const glRef = useRef<GlState | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "fallback">(
    "loading",
  );
  const [handle] = useState(() => delayRender("parallax-textures"));

  const p = resolveParams("parallax", instance.params);
  const intensity = Number(p.intensity);
  const direction = String(p.direction);

  useEffect(() => {
    let cancelled = false;
    Promise.all([loadImage(src), loadImage(depthSrc)])
      .then(([img, depth]) => {
        if (cancelled || !canvasRef.current) return;
        const gl = canvasRef.current.getContext("webgl", {
          preserveDrawingBuffer: true,
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

        const bindTex = (unit: number, image: HTMLImageElement, name: string) => {
          const tex = gl.createTexture();
          gl.activeTexture(gl.TEXTURE0 + unit);
          gl.bindTexture(gl.TEXTURE_2D, tex);
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, image);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
          gl.uniform1i(gl.getUniformLocation(prog, name), unit);
        };
        bindTex(0, img, "uImage");
        bindTex(1, depth, "uDepth");

        glRef.current = {
          gl,
          uShift: gl.getUniformLocation(prog, "uShift")!,
          uZoom: gl.getUniformLocation(prog, "uZoom")!,
          uHeight: gl.getUniformLocation(prog, "uHeight")!,
          uSteady: gl.getUniformLocation(prog, "uSteady")!,
          uIso: gl.getUniformLocation(prog, "uIso")!,
        };
        setStatus("ready");
        continueRender(handle);
      })
      .catch(() => {
        if (!cancelled) {
          setStatus("fallback");
          continueRender(handle);
        }
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src, depthSrc]);

  useEffect(() => {
    const state = glRef.current;
    if (status !== "ready" || !state) return;
    const { gl, uShift, uZoom, uHeight, uSteady, uIso } = state;
    const t = frame / fps;
    const progress = frame / Math.max(1, durationInFrames);
    const u = parallaxUniforms({ tSec: t, progress, intensity, direction });
    gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
    gl.uniform2f(uShift, u.sx, u.sy);
    gl.uniform1f(uZoom, u.zoom);
    gl.uniform1f(uHeight, u.height);
    gl.uniform1f(uSteady, u.steady);
    gl.uniform1f(uIso, u.isometric);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }, [frame, status, fps, durationInFrames, intensity, direction]);

  if (status === "fallback") {
    return (
      <AbsoluteFill>
        <Img src={src} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
      </AbsoluteFill>
    );
  }
  return (
    <AbsoluteFill style={{ background: "#000" }}>
      <canvas
        ref={canvasRef}
        width={width}
        height={height}
        style={{ width: "100%", height: "100%" }}
      />
    </AbsoluteFill>
  );
};
