import React, { useRef, useLayoutEffect } from "react";
import {
  AbsoluteFill,
  useCurrentFrame,
  useVideoConfig,
  staticFile,
  delayRender,
  continueRender,
} from "remotion";

/* ---------- パラメータ型 & プリセット ---------- */
export interface FlareParams {
  /** シーン番号（未使用の予約フィールド。後方互換のため保持） */
  scene: number;
  /** 光源位置 (centered, aspect補正済み空間。x:-aspect..aspect / y:-1..1) */
  light: { x: number; y: number };
  intensity: number;
  anamorphic: number;
  ghosts: number;
  halo: number;
  chromatic: number;
  blades: number;
  dirt: number;
  flicker: number;
  coreTint: [number, number, number];
  streakTint: [number, number, number];
  coreSize: number;
  anamDouble: number;
  spikeAmt: number;
  ghostScale: number;
  ghostBody: number;
  /* ---- 光学語彙拡張 (省略時 0/[0,0,0] = 従来の見た目) ---- */
  ghostTint?: [number, number, number];
  raySpray?: number;
  rayAsym?: number;
  /** rayAsymの片寄り方向（度数、0=+x） */
  rayDir?: number;
  veilAmount?: number;
  veilTint?: [number, number, number];
  rings?: number;
  streakOffset?: number;
  streakOffsetY?: number;
  ghostSpread?: number;
  ghostSat?: number;
  /** 単発の自由位置ゴースト玉 */
  orb?: number;
  orbX?: number;
  orbY?: number;
  orbSize?: number;
  orbTint?: [number, number, number];
  rayDense?: number;
  streakBreak?: number;
  rayDetach?: number;
}

export type FlarePresetName = keyof typeof PRESETS;

/**
 * 内蔵プリセット（自作）。MVの定番シーン12種を光学語彙で作ったオリジナル。
 * 味の方針: 均一分布の「のっぺり」を避け、非対称・かすれ・ちらばりを必ずどこかに入れる。
 */
const ORIGINAL_PRESETS: Record<string, FlareParams> = {
  "Dusk Ember": { scene: 2, light: { x: 0.66, y: 0.34 }, intensity: 1.1, anamorphic: 0.12, ghosts: 6, halo: 0.06, chromatic: 0.6, blades: 7, dirt: 0.32, flicker: 0, coreTint: [1.22, 0.9, 0.62], streakTint: [1.05, 0.85, 0.65], coreSize: 0.85, anamDouble: 0, spikeAmt: 0.35, ghostScale: 1.1, ghostBody: 0.5, raySpray: 0.55, rayAsym: 0.3, rayDir: 235, veilAmount: 0.34, veilTint: [1.0, 0.75, 0.45], ghostSpread: 0.3, ghostSat: 0.5 },
  "Neon Rain": { scene: 2, light: { x: 0.55, y: 0.3 }, intensity: 0.95, anamorphic: 1.25, ghosts: 3, halo: 0.04, chromatic: 0.75, blades: 6, dirt: 0.45, flicker: 0.08, coreTint: [0.7, 0.85, 1.25], streakTint: [0.55, 0.75, 1.3], coreSize: 1.35, anamDouble: 0.55, spikeAmt: 0.15, ghostScale: 0.6, ghostBody: 0.8, streakBreak: 0.55, veilAmount: 0.18, veilTint: [0.5, 0.65, 1.1] },
  "Stage Glow": { scene: 2, light: { x: 0.5, y: 0.22 }, intensity: 1.25, anamorphic: 0.25, ghosts: 2, halo: 0.14, chromatic: 0.4, blades: 8, dirt: 0.18, flicker: 0.22, coreTint: [1.05, 1.02, 0.95], streakTint: [0.95, 0.95, 1.05], coreSize: 1.25, anamDouble: 0, spikeAmt: 0.9, ghostScale: 0.7, ghostBody: 0.4, raySpray: 0.35, rayDense: 0.45, veilAmount: 0.15, veilTint: [0.95, 0.95, 1.0] },
  "Moon Veil": { scene: 2, light: { x: 0.72, y: 0.2 }, intensity: 0.55, anamorphic: 0.05, ghosts: 1, halo: 0.42, chromatic: 0.3, blades: 6, dirt: 0.1, flicker: 0, coreTint: [0.88, 0.95, 1.15], streakTint: [0.85, 0.9, 1.1], coreSize: 2.2, anamDouble: 0, spikeAmt: 0.08, ghostScale: 0.9, ghostBody: 0.6, veilAmount: 0.3, veilTint: [0.7, 0.8, 1.05], rings: 0.12 },
  "Window Light": { scene: 2, light: { x: 0.3, y: 0.28 }, intensity: 0.85, anamorphic: 0.08, ghosts: 4, halo: 0.1, chromatic: 0.35, blades: 7, dirt: 0.22, flicker: 0, coreTint: [1.08, 1.0, 0.88], streakTint: [1.0, 0.95, 0.85], coreSize: 2.5, anamDouble: 0, spikeAmt: 0.1, ghostScale: 2.6, ghostBody: 1.0, ghostTint: [1.0, 0.85, 0.6], veilAmount: 0.32, veilTint: [1.0, 0.9, 0.7], ghostSpread: 0.25 },
  "Passing Train": { scene: 2, light: { x: 0.42, y: 0.4 }, intensity: 1.05, anamorphic: 1.05, ghosts: 5, halo: 0.03, chromatic: 0.65, blades: 6, dirt: 0.3, flicker: 0.14, coreTint: [0.9, 0.95, 1.1], streakTint: [0.65, 0.9, 1.1], coreSize: 1.0, anamDouble: 1.0, spikeAmt: 0.1, ghostScale: 0.7, ghostBody: 0.9, streakOffset: 0.6, streakOffsetY: -0.2, streakBreak: 0.7, ghostSpread: 0.4 },
  "Gold Sparks": { scene: 2, light: { x: 0.6, y: 0.38 }, intensity: 1.0, anamorphic: 0.05, ghosts: 5, halo: 0.05, chromatic: 0.55, blades: 7, dirt: 0.5, flicker: 0.1, coreTint: [1.25, 0.95, 0.5], streakTint: [1.15, 0.9, 0.55], coreSize: 0.75, anamDouble: 0, spikeAmt: 0.6, ghostScale: 0.9, ghostBody: 0.6, ghostTint: [1.0, 0.7, 0.3], raySpray: 0.85, rayDense: 0.6, ghostSpread: 0.5, ghostSat: 0.7 },
  "Frost Flash": { scene: 2, light: { x: 0.68, y: 0.3 }, intensity: 1.0, anamorphic: 0.1, ghosts: 4, halo: 0.32, chromatic: 0.45, blades: 8, dirt: 0.12, flicker: 0, coreTint: [0.92, 1.0, 1.12], streakTint: [0.85, 0.95, 1.12], coreSize: 1.05, anamDouble: 0, spikeAmt: 0.8, ghostScale: 1.1, ghostBody: 0.7, raySpray: 0.7, rayAsym: 0.35, rayDir: 150, rings: 0.18, rayDense: 0.5 },
  "Amber Halo": { scene: 2, light: { x: 0.64, y: 0.3 }, intensity: 0.9, anamorphic: 0.06, ghosts: 4, halo: 0.5, chromatic: 0.6, blades: 6, dirt: 0.25, flicker: 0, coreTint: [1.2, 0.95, 0.6], streakTint: [1.1, 0.95, 0.7], coreSize: 1.0, anamDouble: 0, spikeAmt: 0.2, ghostScale: 0.55, ghostBody: 0.35, ghostTint: [1.0, 0.8, 0.45], rings: 0.55, ghostSpread: 0.65, ghostSat: 0.5 },
  "Rainy Glass": { scene: 2, light: { x: 0.58, y: 0.32 }, intensity: 0.9, anamorphic: 0.2, ghosts: 2, halo: 0.08, chromatic: 0.7, blades: 6, dirt: 0.85, flicker: 0.06, coreTint: [0.85, 0.95, 1.15], streakTint: [0.8, 0.9, 1.1], coreSize: 1.3, anamDouble: 0, spikeAmt: 0.2, ghostScale: 0.8, ghostBody: 1.0, veilAmount: 0.22, veilTint: [0.6, 0.75, 1.0], streakBreak: 0.4 },
  "Crimson Echo": { scene: 2, light: { x: 0.62, y: 0.35 }, intensity: 0.95, anamorphic: 0.3, ghosts: 4, halo: 0.1, chromatic: 0.55, blades: 7, dirt: 0.35, flicker: 0, coreTint: [1.3, 0.6, 0.45], streakTint: [1.15, 0.55, 0.5], coreSize: 1.1, anamDouble: 0, spikeAmt: 0.3, ghostScale: 1.0, ghostBody: 0.7, ghostTint: [1.1, 0.5, 0.4], veilAmount: 0.26, veilTint: [1.0, 0.5, 0.4], ghostSpread: 0.35, ghostSat: 0.5 },
  "Violet Pulse": { scene: 2, light: { x: 0.56, y: 0.3 }, intensity: 0.95, anamorphic: 0.4, ghosts: 6, halo: 0.12, chromatic: 0.9, blades: 6, dirt: 0.2, flicker: 0.12, coreTint: [0.95, 0.8, 1.2], streakTint: [0.85, 0.6, 1.2], coreSize: 1.15, anamDouble: 0.3, spikeAmt: 0.25, ghostScale: 1.0, ghostBody: 0.6, ghostTint: [0.8, 0.55, 1.1], ghostSpread: 0.5, ghostSat: 0.8, orb: 0.35, orbX: -0.75, orbY: -0.35, orbSize: 0.09, orbTint: [0.75, 0.55, 1.1] },
};

export const PRESETS: Record<string, FlareParams> = {
  ...ORIGINAL_PRESETS,
};

/* ---------- シェーダー（フレアのみ黒地で描き、screen合成で背景に載せる） ---------- */
const VERT = `
attribute vec2 a_pos;
void main(){ gl_Position = vec4(a_pos, 0.0, 1.0); }
`;

const FRAG = `
precision highp float;

uniform vec2  u_res;
uniform float u_time;
uniform vec2  u_light;
uniform float u_intensity;
uniform float u_anamorphic;
uniform float u_ghosts;
uniform float u_halo;
uniform float u_chroma;
uniform float u_dirt;
uniform float u_blades;
uniform float u_spikes;
uniform float u_flick;
uniform vec3  u_coreTint;
uniform vec3  u_streakTint;
uniform float u_coreSize;
uniform float u_anamDouble;
uniform float u_spikeAmt;
uniform float u_ghostScale;
uniform float u_ghostBody;
uniform sampler2D u_streakTex;   /* self-made 1D streak noise */
uniform sampler2D u_grainTex;    /* self-made film grain */
uniform float u_useTex;          /* 1 = textures loaded, 0 = procedural fallback */
uniform vec2  u_grainOffset;     /* per-frame grain scroll (deterministic) */

/* ---- optical-vocabulary extensions (all default 0/off = legacy look) ---- */
uniform vec3  u_ghostTint;       /* [0,0,0]=legacy rainbow ghosts; else clean single-tint disks */
uniform float u_raySpray;        /* 0..1 fine radial ray spray amount */
uniform float u_rayAsym;         /* 0..1 one-sided ray bias */
uniform float u_veilAmount;      /* 0..1 broad veiling glare that lifts the whole frame */
uniform vec3  u_veilTint;        /* veil colour */
uniform float u_rings;           /* 0..1 concentric large ring-group strength */
uniform float u_streakOffset;    /* 0..1 extra off-height anamorphic streak amount (0=off) */
uniform float u_streakOffsetY;   /* internal-y where the extra streak runs */
uniform float u_rayDir;          /* ray-bias direction in radians (0 = legacy +x side) */
uniform float u_ghostSpread;     /* 0..1 perpendicular off-axis scatter of the ghost train */
uniform float u_ghostSat;        /* 0..1 ghost chroma boost (vivid single-hue discs) */
uniform float u_orbAmount;       /* 0..1 standalone free-position ghost orb (0=off) */
uniform vec2  u_orbPos;          /* orb position, internal units (centre origin) */
uniform float u_orbSize;         /* orb radius, internal units */
uniform vec3  u_orbTint;         /* orb colour */
uniform float u_rayDense;        /* 0..1 dense multi-octave ray chaff on top of raySpray (0=off) */
uniform float u_streakBreak;     /* 0..1 dry-brush kasure: breaks the offset streak into dashes (0=off) */
uniform float u_rayDetach;       /* 0..1 detach the dense chaff from the core (hollow inner zone) */

float hash11(float n){ return fract(sin(n*127.1 + 311.7)*43758.5453123); }
float hash21(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7)))*43758.5453123); }

float noise1(float x){
  float i = floor(x), f = fract(x);
  float u = f*f*(3.0-2.0*f);
  return mix(hash11(i), hash11(i+1.0), u);
}

float noise2(vec2 p){
  vec2 i = floor(p), f = fract(p);
  vec2 u = f*f*(3.0-2.0*f);
  return mix(
    mix(hash21(i),               hash21(i+vec2(1.0,0.0)), u.x),
    mix(hash21(i+vec2(0.0,1.0)), hash21(i+vec2(1.0,1.0)), u.x), u.y);
}

/* ---------- soft aperture bokeh ---------- */
float bokeh(vec2 p, float size, float blades, float feather){
  float r = length(p);
  float a = atan(p.y, p.x);
  float seg = 6.2831853/blades;
  float poly = cos(floor(0.5 + a/seg)*seg - a);
  float metric = mix(r, poly*r, 0.24);
  float nr = metric / max(size, 1e-4);
  float mask = 1.0 - smoothstep(1.0 - feather, 1.05, nr);
  float dome = mix(0.50, 1.0, exp(-nr*nr*0.85));
  float rim  = smoothstep(0.70, 0.95, nr) * (1.0 - smoothstep(0.95, 1.08, nr));
  float body = mask * dome;
  return body*(0.32 + u_ghostBody*0.68) + rim*mask*(0.50 - u_ghostBody*0.28);
}

/* chroma push around luminance: s=0 keeps the colour, s=1 ~3x chroma.
   Only ever called behind a u_ghostSat guard so legacy output stays bit-exact. */
vec3 satBoost(vec3 c, float s){
  float lum = dot(c, vec3(0.299, 0.587, 0.114));
  return max(vec3(lum) + (c - vec3(lum))*(1.0 + 2.2*s), vec3(0.0));
}

/* ---------- the flare (one chromatic channel pass) ---------- */
vec3 flarePass(vec2 uv, vec2 L){
  vec3 col = vec3(0.0);
  vec2 d = uv - L;
  float dist = length(d);

  float core = exp(-dist*dist*(90.0*u_coreSize))*1.7
             + exp(-dist*(7.0*u_coreSize))*0.45
             + 0.008/(0.03 + dist);
  col += core * u_coreTint;
  col += exp(-dist*1.8)*0.035 * u_coreTint;

  float ang = atan(d.y, d.x);
  float rot = 0.35 + 0.015*sin(u_time*0.7);
  float sp  = pow(abs(sin(ang*u_spikes*0.5 + rot)), 48.0);
  sp       += pow(abs(sin(ang*u_spikes*0.5 + rot)), 8.0)*0.10;
  float vspike = pow(abs(d.y)/max(dist, 1e-4), 30.0) * exp(-dist*10.0);
  sp += vspike*0.8;
  col += sp * exp(-dist*4.2) * 0.5 * u_spikeAmt * mix(vec3(1.0,0.92,0.80), u_coreTint, 0.6);

  float sep  = 0.0045 * u_anamDouble;
  float lenF = exp(-d.x*d.x*0.38);
  float hair = (exp(-abs(d.y - sep)*300.0) + exp(-abs(d.y + sep)*300.0)) * lenF;
  float glow = exp(-abs(d.y)*24.0) * exp(-d.x*d.x*0.7) * 0.32
             + exp(-abs(d.y)*6.5)  * exp(-d.x*d.x*1.8) * 0.12;
  float sN    = texture2D(u_streakTex, vec2(0.35, d.x*0.30 + u_time*0.015)).r;
  float sHair = mix(1.0, mix(0.40, 1.30, sN), u_useTex);
  float sGlow = mix(1.0, mix(0.82, 1.10, sN), u_useTex);
  col += (hair*sHair + glow*sGlow) * u_streakTint * u_anamorphic * 1.15;

  float offAxis = smoothstep(0.03, 0.35, length(L));
  for(int i=0;i<12;i++){
    float fi = float(i);
    float w = clamp(u_ghosts - fi, 0.0, 1.0);
    if(w <= 0.0){ continue; }
    float h1 = hash11(fi*7.31 + 3.7);
    float h2 = hash11(fi*13.7 + 1.3);
    float h3 = hash11(fi*5.13 + 9.1);
    float h4 = hash11(fi*3.71 + 6.9);
    float s  = mix(0.25, 2.05, (fi + h1*0.8)/12.0);
    vec2 gp  = L*(1.0 - s);
    /* off-axis scatter: deterministic per-disc shove perpendicular to the axis */
    if(u_ghostSpread > 0.001){
      float h5 = hash11(fi*11.29 + 2.71);
      vec2 perp = normalize(vec2(-L.y, L.x) + vec2(1e-5, 0.0));
      gp += perp * (h5*2.0 - 1.0) * u_ghostSpread * 0.55;
    }
    float size = mix(0.014, 0.150, pow(h2, 1.6)) * (0.55 + 0.55*s) * u_ghostScale;
    float g = bokeh(uv - gp, size, u_blades, mix(0.45, 0.85, h3));
    /* colour: clean single-tint disks when u_ghostTint set, else filmic rainbow */
    vec3 tint; float amp;
    if(u_ghostTint.r + u_ghostTint.g + u_ghostTint.b > 0.001){
      tint = u_ghostTint * (0.80 + 0.40*h3);
      amp  = mix(0.075, 0.240, h4) * exp(-abs(s-1.05)*0.42);
    } else {
      tint = mix(vec3(1.00,0.45,0.20), vec3(0.22,0.68,1.00), clamp(s*0.62, 0.0, 1.0));
      tint = mix(tint, vec3(0.70,0.38,1.00), h3*0.25);
      tint = mix(vec3(0.75), tint, 0.85);
      amp = mix(0.045, 0.165, h4) * exp(-abs(s-1.05)*0.55);
    }
    /* saturation ceiling lift: deeper chroma + enough body to survive the tonemap */
    if(u_ghostSat > 0.001){
      tint = satBoost(tint, u_ghostSat);
      amp *= 1.0 + 1.1*u_ghostSat;
    }
    col += g * tint * amp * w * (0.35 + 0.65*offAxis);
  }
  {
    vec2 gp = L*0.82;
    float g = bokeh(uv - gp, 0.045*u_ghostScale, u_blades, 0.55);
    vec3 irisC = (u_ghostTint.r + u_ghostTint.g + u_ghostTint.b > 0.001)
               ? u_ghostTint
               : mix(vec3(0.75), vec3(1.0,0.70,0.38), 0.85);
    if(u_ghostSat > 0.001) irisC = satBoost(irisC, u_ghostSat);
    col += g * irisC * 0.13 * step(0.5, u_ghosts) * offAxis;
  }

  float r = length(uv);
  float halo = exp(-pow((r - 0.46)*17.0, 2.0));
  float axw = 0.35 + 0.65*pow(max(dot(normalize(uv + 1e-4), normalize(-L + 1e-4)), 0.0), 2.0);
  col += halo * axw * vec3(0.55,0.70,1.00) * u_halo * 0.42 * offAxis;

  /* --- ray spray: dozens of fine, jittered radial rays from the source --- */
  if(u_raySpray > 0.001){
    float ra = atan(d.y, d.x);
    float freq = 34.0;
    float t2   = (ra/6.2831853 + 0.5)*freq;
    float idx  = floor(t2);
    float cell = fract(t2);
    float ray  = pow(max(1.0 - abs(cell - 0.5)*2.0, 0.0), 22.0);
    ray *= 0.35 + 0.95*hash11(idx + 7.0);
    float rprof = exp(-dist*2.4) * smoothstep(0.0, 0.04, dist);
    float asy  = mix(1.0, 0.5 + 0.5*cos(ra - u_rayDir), u_rayAsym);
    col += ray * rprof * asy * u_raySpray * 0.55
         * mix(vec3(1.0,0.95,0.85), u_coreTint, 0.5);

    /* dense chaff: two finer octaves of hair rays with per-ray length jitter,
       radial segment clumping (broken fibres) and faint prismatic tint patches */
    if(u_rayDense > 0.001){
      vec3 acc = vec3(0.0);
      for(int o=0;o<2;o++){
        float fo    = float(o);
        float freqD = mix(70.0, 170.0, fo);
        float tD    = (ra/6.2831853 + 0.5)*freqD;
        float idxD  = floor(tD);
        float cellD = fract(tD);
        float ctr   = 0.30 + 0.40*hash11(idxD*9.17 + fo*13.0);
        float rayD  = pow(max(1.0 - abs(cellD - ctr)*2.0, 0.0), mix(5.0, 3.0, fo));
        rayD *= 0.15 + 0.85*hash11(idxD*1.71 + fo*57.0);
        float lenJ  = mix(0.6, 2.2, hash11(idxD*3.33 + 11.0 + fo*31.0));
        float seg   = smoothstep(0.28, 0.70, noise2(vec2(hash11(idxD + fo*7.0)*40.0, dist*5.5)));
        float rprofD = exp(-dist*lenJ*0.8)
                     * smoothstep(0.03 + 0.30*u_rayDetach, 0.10 + 0.50*u_rayDetach, dist);
        vec3 tintD  = vec3(1.0) + 0.35*vec3(sin(idxD*1.3), sin(idxD*2.1 + 2.0), sin(idxD*1.7 + 4.0));
        acc += rayD * rprofD * seg * tintD * mix(1.6, 1.15, fo);
      }
      float patch = 0.12 + 0.88*smoothstep(0.25, 0.80, noise2(vec2(ra*5.0, dist*2.5) + 9.0));
      float asyD = pow(asy, 2.4);
      col += acc * patch * asyD * u_rayDense
           * mix(vec3(1.0,0.97,0.90), u_coreTint, 0.4);
    }
  }

  /* --- concentric large ring group on frame centre, warm inner rim --- */
  if(u_rings > 0.001){
    float rr = length(uv);
    float acc = exp(-rr*rr*2.0)*0.95;
    for(int k=1;k<4;k++){
      float radius = float(k)*0.18;
      acc += exp(-pow((rr - radius)*7.5, 2.0)) * (1.0 - float(k)*0.16);
    }
    vec3 ringCol = mix(vec3(1.00,0.62,0.32), vec3(0.55,0.74,1.00), clamp(rr*0.9, 0.0, 1.0));
    col += acc * u_rings * 0.22 * ringCol * offAxis;
  }

  /* --- extra anamorphic streak at a different height (off light-y) --- */
  if(u_streakOffset > 0.001){
    float ddy   = uv.y - u_streakOffsetY;
    float ddx   = d.x;
    float lenF2 = exp(-ddx*ddx*0.38);
    /* kasure fragments read as soft wide stubs, not sharp hairlines: widen with streakBreak */
    float hair2 = exp(-abs(ddy)*mix(300.0, 70.0, u_streakBreak)) * lenF2
                * mix(1.0, 0.55, u_streakBreak);
    float glow2 = exp(-abs(ddy)*22.0) * exp(-ddx*ddx*0.7) * 0.30;
    /* kasure: island gate — long soft fragments with real gaps (dry-brush dashes).
       Applies to the offset streak only; the hero streak through the core stays continuous. */
    if(u_streakBreak > 0.001){
      float bn2 = texture2D(u_streakTex, vec2(0.55, ddx*0.012 + 0.37)).r * 0.85
                + texture2D(u_streakTex, vec2(0.90, ddx*0.05 + 0.81)).r * 0.15;
      bn2 = mix(noise1(ddx*1.6 + 21.0)*0.85 + noise1(ddx*6.0 + 33.0)*0.15, bn2, u_useTex);
      float th    = 0.34 + 0.40*u_streakBreak;
      float gate2 = smoothstep(th - 0.22, th + 0.26, bn2);
      hair2 *= mix(1.0, gate2*(0.75 + 0.75*bn2), clamp(u_streakBreak*1.7, 0.0, 1.0));
      glow2 *= mix(1.0, pow(gate2, 1.3)*(0.6 + 0.5*bn2), clamp(u_streakBreak*1.35, 0.0, 1.0));
    }
    col += (hair2 + glow2) * u_streakTint * u_streakOffset * 1.05;
  }

  /* --- standalone free-position ghost orb (single coloured disc, off the axis) --- */
  if(u_orbAmount > 0.001){
    float g = bokeh(uv - u_orbPos, max(u_orbSize, 1e-3), u_blades, 0.5);
    vec3 oc = (u_ghostSat > 0.001) ? satBoost(u_orbTint, u_ghostSat) : u_orbTint;
    col += g * oc * u_orbAmount * 0.30;
  }

  return col;
}

/* ---------- procedural lens dirt ---------- */
float dirtLayer(vec2 p, float scale, float dens){
  vec2 g = floor(p*scale), f = fract(p*scale);
  vec2 pt = vec2(0.25 + 0.5*hash21(g + 7.0), 0.25 + 0.5*hash21(g + 13.0));
  float rr = 0.06 + 0.16*hash21(g + 29.0);
  float on = step(dens, hash21(g + 3.0));
  return smoothstep(rr, rr*0.25, length(f - pt)) * on * (0.4 + 0.6*hash21(g + 47.0));
}
float dirtTex(vec2 uv){
  vec2 p = uv + 3.0;
  float d = dirtLayer(p, 4.0, 0.72)*0.55
          + dirtLayer(p + 11.3, 9.0, 0.80)*0.40
          + dirtLayer(p + 5.7, 22.0, 0.88)*0.55;
  d += pow(noise2(vec2(p.x*1.6, p.y*48.0) + 3.0), 8.0)*0.5;
  return d;
}

vec3 aces(vec3 x){
  return clamp((x*(2.51*x + 0.03))/(x*(2.43*x + 0.59) + 0.14), 0.0, 1.0);
}

void main(){
  vec2 frag = gl_FragCoord.xy / u_res;
  vec2 uv = frag*2.0 - 1.0;
  uv.x *= u_res.x / u_res.y;
  vec2 L = u_light;

  /* フレアのみ黒地 */
  vec3 col = vec3(0.0);
  float occ = 1.0;

  float amp = u_intensity * u_flick * occ * smoothstep(2.5, 1.1, length(L));

  /* chromatic aberration: three radial-scaled passes */
  float ch = u_chroma*0.013;
  vec3 f;
  f.r = flarePass(uv*(1.0 + ch), L).r;
  f.g = flarePass(uv,            L).g;
  f.b = flarePass(uv*(1.0 - ch), L).b;
  col += f * amp;

  /* veil: broad coloured veiling glare — lifts the whole frame, no ring */
  if(u_veilAmount > 0.001){
    float veilFall = 0.40 + 0.60*exp(-length(uv - L)*0.8);
    col += u_veilAmount * u_veilTint * veilFall * amp * 0.55;
  }

  float dE = amp * (0.20 + 0.80*exp(-length(uv - L)*1.1));
  col += dirtTex(uv) * dE * u_dirt * vec3(0.90,0.95,1.05) * 0.30;

  col *= 1.0 - 0.32*pow(length(uv*vec2(0.72,1.0)), 2.4);
  col = aces(col*1.12);

  float gr;
  if(u_useTex > 0.5){
    gr = texture2D(u_grainTex, gl_FragCoord.xy / 256.0 + u_grainOffset).r;
  } else {
    gr = hash21(gl_FragCoord.xy + vec2(fract(u_time*0.973)*191.0, 0.0));
  }
  col += (gr - 0.5) * (0.010 + u_dirt*0.030);

  gl_FragColor = vec4(col, 1.0);
}
`;

const NTAB = (() => {
  let s = 1337 >>> 0;
  const tab = new Float32Array(256);
  for (let i = 0; i < 256; i++) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    tab[i] = s / 4294967296;
  }
  return tab;
})();
function vnoise(t: number): number {
  const i0 = Math.floor(t);
  const f = t - i0;
  const u = f * f * (3 - 2 * f);
  const a = NTAB[i0 & 255];
  const b = NTAB[(i0 + 1) & 255];
  return a + (b - a) * u;
}

const UNIFORM_NAMES = [
  "u_res",
  "u_time",
  "u_light",
  "u_intensity",
  "u_anamorphic",
  "u_ghosts",
  "u_halo",
  "u_chroma",
  "u_dirt",
  "u_blades",
  "u_spikes",
  "u_flick",
  "u_coreTint",
  "u_streakTint",
  "u_coreSize",
  "u_anamDouble",
  "u_spikeAmt",
  "u_ghostScale",
  "u_ghostBody",
  "u_ghostTint",
  "u_raySpray",
  "u_rayAsym",
  "u_veilAmount",
  "u_veilTint",
  "u_rings",
  "u_streakOffset",
  "u_streakOffsetY",
  "u_rayDir",
  "u_ghostSpread",
  "u_ghostSat",
  "u_orbAmount",
  "u_orbPos",
  "u_orbSize",
  "u_orbTint",
  "u_rayDense",
  "u_streakBreak",
  "u_rayDetach",
  "u_streakTex",
  "u_grainTex",
  "u_useTex",
  "u_grainOffset",
] as const;

interface GLState {
  gl: WebGLRenderingContext;
  prog: WebGLProgram;
  U: Record<string, WebGLUniformLocation | null>;
  streakTex: WebGLTexture;
  grainTexs: WebGLTexture[];
  useTex: number;
}

function make1x1(gl: WebGLRenderingContext): WebGLTexture {
  const t = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.RGBA,
    1,
    1,
    0,
    gl.RGBA,
    gl.UNSIGNED_BYTE,
    new Uint8Array([128, 128, 128, 255]),
  );
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  return t;
}

function makeTexFromImage(
  gl: WebGLRenderingContext,
  img: HTMLImageElement,
): WebGLTexture {
  const t = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  return t;
}

function compile(
  gl: WebGLRenderingContext,
  type: number,
  src: string,
): WebGLShader {
  const sh = gl.createShader(type)!;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    throw new Error("LensFlare shader compile: " + gl.getShaderInfoLog(sh));
  }
  return sh;
}

function initGL(canvas: HTMLCanvasElement): GLState {
  const gl = canvas.getContext("webgl", {
    antialias: false,
    alpha: false,
    depth: false,
    stencil: false,
    preserveDrawingBuffer: true,
  }) as WebGLRenderingContext | null;
  if (!gl) throw new Error("LensFlare: WebGL not available");

  const prog = gl.createProgram()!;
  gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VERT));
  gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FRAG));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    throw new Error("LensFlare link: " + gl.getProgramInfoLog(prog));
  }
  gl.useProgram(prog);

  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([-1, -1, 3, -1, -1, 3]),
    gl.STATIC_DRAW,
  );
  const aPos = gl.getAttribLocation(prog, "a_pos");
  gl.enableVertexAttribArray(aPos);
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

  const U: Record<string, WebGLUniformLocation | null> = {};
  for (const n of UNIFORM_NAMES) U[n] = gl.getUniformLocation(prog, n);

  const gray = make1x1(gl);
  return { gl, prog, U, streakTex: gray, grainTexs: [gray], useTex: 0 };
}

export const LensFlare: React.FC<{
  children?: React.ReactNode;
  /** 未使用（旧props契約との互換のため残置）。FxStackからは渡さない */
  durationInFrames?: number;
  preset?: FlarePresetName;
  /** 0..1 の画面比率で光源X (省略時プリセット値) */
  lightX?: number;
  /** 0..1 の画面比率で光源Y (省略時プリセット値、0=上端) */
  lightY?: number;
  intensity?: number;
  anamorphic?: number;
  ghosts?: number;
  halo?: number;
  chromatic?: number;
  blades?: number;
  dirt?: number;
  flicker?: number;
  coreSize?: number;
  anamDouble?: number;
  spikeAmt?: number;
  ghostScale?: number;
  ghostBody?: number;
  coreTint?: [number, number, number];
  streakTint?: [number, number, number];
  /** 光源の動き。none=固定 / drift=ゆらぎ(リサージュ) / sweep=横流れ(画面を横断) / path=A→B移動(曲げ可) */
  motion?: "none" | "drift" | "sweep" | "path";
  /** driftの振れ幅 (0..1 画面比率)。pathでは「ゆらぎ混ぜ」として微量効く */
  motionAmount?: number;
  /** 動きの速さ倍率 */
  motionSpeed?: number;
  /** path: 終点 (0..1 画面比率) */
  destX?: number;
  destY?: number;
  /** path: 曲げハンドルの中点からのオフセット (0..1 画面比率スケール)。0=直線 */
  bendX?: number;
  bendY?: number;
}> = ({
  children,
  preset = "Dusk Ember",
  lightX,
  lightY,
  intensity,
  anamorphic,
  ghosts,
  halo,
  chromatic,
  blades,
  dirt,
  flicker,
  coreSize,
  anamDouble,
  spikeAmt,
  ghostScale,
  ghostBody,
  coreTint,
  streakTint,
  motion = "none",
  motionAmount = 0,
  motionSpeed = 1,
  destX,
  destY,
  bendX = 0,
  bendY = 0,
}) => {
  const frame = useCurrentFrame();
  const { width, height, fps, durationInFrames } = useVideoConfig();
  const aspect = width / height;

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const glRef = useRef<GLState | null>(null);
  const drawRef = useRef<(() => void) | null>(null);
  const texHandleRef = useRef<number | null>(null);

  const base = PRESETS[preset] ?? PRESETS["Dusk Ember"];
  const p: FlareParams = {
    ...base, // 光学語彙拡張フィールド(ghostTint/raySpray/orb...)はプリセット値をそのまま継承
    intensity: intensity ?? base.intensity,
    anamorphic: anamorphic ?? base.anamorphic,
    ghosts: ghosts ?? base.ghosts,
    halo: halo ?? base.halo,
    chromatic: chromatic ?? base.chromatic,
    blades: blades ?? base.blades,
    dirt: dirt ?? base.dirt,
    flicker: flicker ?? base.flicker,
    coreTint: coreTint ?? base.coreTint,
    streakTint: streakTint ?? base.streakTint,
    coreSize: coreSize ?? base.coreSize,
    anamDouble: anamDouble ?? base.anamDouble,
    spikeAmt: spikeAmt ?? base.spikeAmt,
    ghostScale: ghostScale ?? base.ghostScale,
    ghostBody: ghostBody ?? base.ghostBody,
  };

  // 決定論的な時間 (フレーム駆動)
  const simT = frame / fps;

  // 光源の動き: 0..1 画面比率空間でフレーム駆動オフセット（決定論）
  let mLx = lightX;
  let mLy = lightY;
  if (motion !== "none" && lightX != null && lightY != null) {
    if (motion === "drift" && motionAmount > 0) {
      // ゆらぎ: リサージュ（speed=1で周期 ≈ 9s の遅い漂い）
      mLx = lightX + motionAmount * Math.sin(simT * 0.7 * motionSpeed);
      mLy = lightY + motionAmount * 0.6 * Math.sin(simT * 1.13 * motionSpeed + 1.3);
    } else if (motion === "sweep") {
      // 横流れ: 画面を横断してwrap（speed=1で約20秒/往路）
      const t = lightX + simT * 0.05 * motionSpeed;
      mLx = ((t % 1) + 1) % 1;
    } else if (motion === "path" && destX != null && destY != null) {
      // パス: 区間の頭→末尾で A(lightX/Y) から B(destX/Y) へ2次ベジェ移動。
      // 曲げハンドル M=中点+bend は「曲線が通る点」なので制御点 C = 2M - (A+B)/2 = 中点 + 2*bend。
      // 直線等速はCGっぽく見えるため smoothstep でイーズし、motionAmount を微量ゆらぎとして混ぜる。
      const t0 = Math.min(1, Math.max(0, frame / Math.max(durationInFrames - 1, 1)));
      const t = t0 * t0 * (3 - 2 * t0);
      const midX = (lightX + destX) / 2;
      const midY = (lightY + destY) / 2;
      const cX = midX + 2 * bendX;
      const cY = midY + 2 * bendY;
      const u = 1 - t;
      mLx = u * u * lightX + 2 * u * t * cX + t * t * destX;
      mLy = u * u * lightY + 2 * u * t * cY + t * t * destY;
      if (motionAmount > 0) {
        // ゆらぎ混ぜ: 手持ちカメラ風の微揺れ（driftの1/3量）
        mLx += motionAmount * 0.33 * Math.sin(simT * 0.9 * motionSpeed + 0.4);
        mLy += motionAmount * 0.2 * Math.sin(simT * 1.31 * motionSpeed + 1.7);
      }
    }
  }

  // 光源: lightX/Y (0..1 画面比率) を渡せば centered/aspect補正空間へ変換、無ければプリセット値
  const Lx = mLx != null ? (mLx * 2 - 1) * aspect : base.light.x;
  const Ly = mLy != null ? 1 - mLy * 2 : base.light.y;

  // flicker (never fully dark)
  let flick = 1.0;
  if (p.flicker > 0) {
    const n =
      (vnoise(simT * 8.0) * 2 - 1) * 0.38 +
      (vnoise(simT * 2.3 + 64) * 2 - 1) * 0.22;
    flick = Math.max(0.25, 1.0 + p.flicker * n);
  }
  const spikes = p.blades % 2 === 0 ? p.blades : p.blades * 2;

  // grain: 3-frame cycle + deterministic scroll (24fps cadence)
  const gf = Math.floor(simT * 24.0);
  const grainFrame = (((gf % 3) + 3) % 3) as number;
  const grainOffset: [number, number] = [
    (gf * 0.1372) % 1.0,
    (gf * 0.3791) % 1.0,
  ];

  // 現在のフレームを1枚描画する closure。テクスチャ非同期ロード完了時にも再利用する。
  const draw = () => {
    const st = glRef.current;
    const canvas = canvasRef.current;
    if (!st || !canvas) return;
    const { gl, U } = st;
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.useProgram(st.prog);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, st.streakTex);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(
      gl.TEXTURE_2D,
      st.grainTexs[grainFrame % st.grainTexs.length],
    );
    gl.uniform1i(U.u_streakTex, 0);
    gl.uniform1i(U.u_grainTex, 1);
    gl.uniform1f(U.u_useTex, st.useTex);
    gl.uniform2f(U.u_grainOffset, grainOffset[0], grainOffset[1]);

    gl.uniform2f(U.u_res, canvas.width, canvas.height);
    gl.uniform1f(U.u_time, simT);
    gl.uniform2f(U.u_light, Lx, Ly);
    gl.uniform1f(U.u_intensity, p.intensity);
    gl.uniform1f(U.u_anamorphic, p.anamorphic);
    gl.uniform1f(U.u_ghosts, p.ghosts);
    gl.uniform1f(U.u_halo, p.halo);
    gl.uniform1f(U.u_chroma, p.chromatic);
    gl.uniform1f(U.u_dirt, p.dirt);
    gl.uniform1f(U.u_blades, p.blades);
    gl.uniform1f(U.u_spikes, spikes);
    gl.uniform1f(U.u_flick, flick);
    gl.uniform3fv(U.u_coreTint, p.coreTint);
    gl.uniform3fv(U.u_streakTint, p.streakTint);
    gl.uniform1f(U.u_coreSize, p.coreSize);
    gl.uniform1f(U.u_anamDouble, p.anamDouble);
    gl.uniform1f(U.u_spikeAmt, p.spikeAmt);
    gl.uniform1f(U.u_ghostScale, p.ghostScale);
    gl.uniform1f(U.u_ghostBody, p.ghostBody);
    gl.uniform3fv(U.u_ghostTint, p.ghostTint ?? [0, 0, 0]);
    gl.uniform1f(U.u_raySpray, p.raySpray ?? 0);
    gl.uniform1f(U.u_rayAsym, p.rayAsym ?? 0);
    gl.uniform1f(U.u_rayDir, ((p.rayDir ?? 0) * Math.PI) / 180);
    gl.uniform1f(U.u_veilAmount, p.veilAmount ?? 0);
    gl.uniform3fv(U.u_veilTint, p.veilTint ?? [1, 1, 1]);
    gl.uniform1f(U.u_rings, p.rings ?? 0);
    gl.uniform1f(U.u_streakOffset, p.streakOffset ?? 0);
    gl.uniform1f(U.u_streakOffsetY, p.streakOffsetY ?? 0);
    gl.uniform1f(U.u_ghostSpread, p.ghostSpread ?? 0);
    gl.uniform1f(U.u_ghostSat, p.ghostSat ?? 0);
    gl.uniform1f(U.u_orbAmount, p.orb ?? 0);
    gl.uniform2f(U.u_orbPos, p.orbX ?? 0, p.orbY ?? 0);
    gl.uniform1f(U.u_orbSize, p.orbSize ?? 0.08);
    gl.uniform3fv(U.u_orbTint, p.orbTint ?? [1, 1, 1]);
    gl.uniform1f(U.u_rayDense, p.rayDense ?? 0);
    gl.uniform1f(U.u_streakBreak, p.streakBreak ?? 0);
    gl.uniform1f(U.u_rayDetach, p.rayDetach ?? 0);

    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.flush();
  };
  drawRef.current = draw;

  // GL 初期化 + テクスチャ非同期ロード (サイズ変化で再構築)。draw より前に宣言 → 先に走る。
  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let st: GLState;
    try {
      st = initGL(canvas);
    } catch (e) {
      // WebGL 不可環境では黙って諦める (下地は透ける)
      // eslint-disable-next-line no-console
      console.error(e);
      return;
    }
    glRef.current = st;

    // context loss を一応ハンドル
    const onLost = (ev: Event) => {
      ev.preventDefault();
    };
    const onRestored = () => {
      try {
        const restored = initGL(canvas);
        glRef.current = restored;
        drawRef.current?.();
      } catch {
        /* noop */
      }
    };
    canvas.addEventListener("webglcontextlost", onLost as EventListener);
    canvas.addEventListener("webglcontextrestored", onRestored);

    // テクスチャがロード完了するまでレンダをブロック
    const handle = delayRender("LensFlare: load textures");
    texHandleRef.current = handle;

    const load = (name: string) =>
      new Promise<HTMLImageElement>((res, rej) => {
        const im = new Image();
        im.crossOrigin = "anonymous";
        im.onload = () => res(im);
        im.onerror = () => rej(new Error("LensFlare img load failed: " + name));
        im.src = staticFile("flare/" + name);
      });

    let cancelled = false;
    Promise.all([
      load("streak_noise.png"),
      load("grain_0.png"),
      load("grain_1.png"),
      load("grain_2.png"),
    ])
      .then(([si, g0, g1, g2]) => {
        if (cancelled) return;
        const cur = glRef.current;
        if (!cur) return;
        cur.streakTex = makeTexFromImage(cur.gl, si);
        cur.grainTexs = [
          makeTexFromImage(cur.gl, g0),
          makeTexFromImage(cur.gl, g1),
          makeTexFromImage(cur.gl, g2),
        ];
        cur.useTex = 1;
        drawRef.current?.(); // テクスチャ入りで描き直してからキャプチャさせる
      })
      .catch((e) => {
        // 失敗時は procedural fallback (useTex=0) のまま = 黒画面にはしない
        // eslint-disable-next-line no-console
        console.error(e);
      })
      .finally(() => {
        if (texHandleRef.current != null) {
          continueRender(texHandleRef.current);
          texHandleRef.current = null;
        }
      });

    return () => {
      cancelled = true;
      canvas.removeEventListener("webglcontextlost", onLost as EventListener);
      canvas.removeEventListener("webglcontextrestored", onRestored);
      if (texHandleRef.current != null) {
        continueRender(texHandleRef.current);
        texHandleRef.current = null;
      }
      glRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [width, height]);

  // 毎フレーム: パラメータ or frame が変わるたびその場で同期的に1枚描画
  useLayoutEffect(() => {
    drawRef.current?.();
  });

  return (
    <AbsoluteFill>
      {/* 下地 (children) */}
      <AbsoluteFill>{children}</AbsoluteFill>
      {/* 光だけ足す: 黒地フレアを screen で重ねる */}
      <canvas
        ref={canvasRef}
        width={width}
        height={height}
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          mixBlendMode: "screen",
          pointerEvents: "none",
        }}
      />
    </AbsoluteFill>
  );
};
