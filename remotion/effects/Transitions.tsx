import React, { useEffect, useState } from "react";
import {
  AbsoluteFill,
  Easing,
  continueRender,
  delayRender,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import type { EffectInstance, Project } from "@/lib/schema";
import { resolveParams } from "@/lib/effects-meta";
import { isXpEffectId, xpPortIdFromEffectId } from "@/lib/xp/bridge";
import { XP_TRANSITION_COMPONENTS } from "./xp/registry-components";
import type { Section } from "@/lib/sections";
import { hashRand } from "./rand";
import { beatPulse, type BeatClock } from "./beat";
import { pushBelt, whipBelt } from "./transition-math";

/**
 * ルマフェード用: 入ってくる絵自身の輝度をアルファに変換したマスクを作る。
 * CSSブレンドは Sequence の合成境界（stacking context）を越えて下の区間と
 * 混ざれないため、マスク方式（アルファは境界を素通りする）で実装する。
 * mask-image はRemotionのロード待ち対象外なので data URI＋decode()待ち必須
 * （GlitchSubjectと同じ知見）。
 */
const lumaMaskCache = new Map<string, Promise<string>>();
function loadLumaMask(src: string, invert: boolean): Promise<string> {
  const key = `${invert ? "inv:" : ""}${src}`;
  let p = lumaMaskCache.get(key);
  if (!p) {
    p = (async () => {
      const res = await fetch(src);
      if (!res.ok) throw new Error(`luma mask fetch failed: ${res.status}`);
      const blob = await res.blob();
      const dataUri = await new Promise<string>((resolve, reject) => {
        const fr = new FileReader();
        fr.onload = () => resolve(fr.result as string);
        fr.onerror = () => reject(new Error("luma mask read failed"));
        fr.readAsDataURL(blob);
      });
      const img = new Image();
      img.src = dataUri;
      await img.decode();
      if (!invert) return dataUri;
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext("2d");
      if (!ctx) return dataUri;
      ctx.filter = "invert(1)";
      ctx.drawImage(img, 0, 0);
      const inverted = canvas.toDataURL("image/png");
      const check = new Image();
      check.src = inverted;
      await check.decode();
      return inverted;
    })();
    lumaMaskCache.set(key, p);
    p.catch(() => lumaMaskCache.delete(key));
  }
  return p;
}

const LumaFadeIn: React.FC<{
  t: number;
  fromDark: boolean;
  lumaSrc: string | null;
  children: React.ReactNode;
}> = ({ t, fromDark, lumaSrc, children }) => {
  const [maskUri, setMaskUri] = useState<string | null>(null);
  const [handle] = useState(() => delayRender("luma-fade mask"));
  useEffect(() => {
    let alive = true;
    if (!lumaSrc) {
      continueRender(handle);
      return;
    }
    loadLumaMask(lumaSrc, fromDark)
      .then((uri) => {
        if (alive) setMaskUri(uri);
      })
      .catch(() => {
        // マスクが作れなければクロスフェードにフォールバック（レンダは止めない）
      })
      .finally(() => continueRender(handle));
    return () => {
      alive = false;
    };
  }, [lumaSrc, fromDark, handle]);

  if (!maskUri) {
    // マスク不成立時のクロスフェードも等速をやめる（前半すっと、後半じわっと）
    return (
      <AbsoluteFill style={{ opacity: Easing.inOut(Easing.quad)(t) }}>
        {children}
      </AbsoluteFill>
    );
  }
  // 前半: 輝度アルファのマスク越しに明部（暗部）から透け、後半で全体が満ちる。
  // phase1はease-outで「明部から一気に灯る」、phase2はease-in-outで余韻を残して満ちる
  const phase1 = interpolate(t, [0, 0.65], [0, 1], {
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.quad),
  });
  const phase2 = interpolate(t, [0.5, 1], [0, 1], {
    extrapolateLeft: "clamp",
    easing: Easing.inOut(Easing.quad),
  });
  return (
    <AbsoluteFill>
      <AbsoluteFill
        style={{
          opacity: phase1,
          maskImage: `url(${maskUri})`,
          maskMode: "luminance",
          maskSize: "100% 100%",
        }}
      >
        {children}
      </AbsoluteFill>
      <AbsoluteFill style={{ opacity: phase2 }}>{children}</AbsoluteFill>
    </AbsoluteFill>
  );
};

/**
 * トランジション: 区間の頭での「入り方」。前の区間は下に居残る構造なので、
 * どの型も「新しい絵がどう現れるか」で表現する。
 */
export const TransitionIn: React.FC<{
  transition: EffectInstance | null;
  fallbackFadeFrames: number;
  beatClock?: BeatClock | null;
  /** luma-fade用: 入ってくる絵のURL（静止画のみ。動画・不明時はnullでクロスフェードにフォールバック） */
  lumaSrc?: string | null;
  /**
   * 拡張切替用: 前区間（from）の中身。時間リマップ済みのReactNodeを受け取る。
   * 拡張分岐でのみ使う（自前系は前区間が下に居残る構造なので未使用）。
   * t>=1 の早期returnより後で参照するので、切替が終われば自動的にマウントが外れる。
   */
  fromContent?: React.ReactNode;
  children: React.ReactNode;
}> = ({
  transition,
  fallbackFadeFrames,
  beatClock,
  lumaSrc,
  fromContent,
  children,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const id = transition?.id ?? "__default__";
  const p = transition ? resolveParams(transition.id, transition.params) : {};

  const durFrames =
    id === "cut"
      ? 0
      : id === "__default__"
        ? fallbackFadeFrames
        : Math.max(1, Math.round(Number(p.duration ?? 0.8) * fps));

  const t =
    durFrames <= 0
      ? 1
      : interpolate(frame, [0, durFrames], [0, 1], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        });

  if (id === "cut") {
    // カットの質: 着地直後の4フレームだけ1.2%のマイクロパンチイン（ease-out）。
    // 全面が最初から見える「スパッ」の印象は保ちつつ、切替に打点が生まれる
    const settle = Easing.out(Easing.cubic)(
      interpolate(frame, [0, 4], [0, 1], {
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
      }),
    );
    const cutScale = 1.012 - 0.012 * settle;
    return (
      <AbsoluteFill
        style={
          cutScale > 1.0005 ? { transform: `scale(${cutScale})` } : undefined
        }
      >
        {children}
      </AbsoluteFill>
    );
  }
  if (t >= 1) return <AbsoluteFill>{children}</AbsoluteFill>;

  // 拡張パックトランジション（xp- プレフィックス。id解決は lib/xp-bridge → effectById 経由）
  if (isXpEffectId(id)) {
    const Xp = XP_TRANSITION_COMPONENTS[xpPortIdFromEffectId(id)];
    if (Xp) {
      // 拡張側は {from,to} 両側を自分で描く契約。前区間の中身（fromContent）を
      // 供給すると「出ていく側の動き」も復活する。fromContent 未指定なら従来どおり
      // from=null＝下に居残る前区間が透ける（出側の動きだけ失われる）にフォールバック。
      // （個体差は目視でblocklist運用。t>=1で早期returnするのでこのツリーは切替中のみマウント）
      return (
        <Xp
          from={fromContent ? <AbsoluteFill>{fromContent}</AbsoluteFill> : null}
          to={<AbsoluteFill>{children}</AbsoluteFill>}
          durationInFrames={durFrames}
        />
      );
    }
  }

  if (id === "fade-black") {
    // 一度黒に落としてから浮かぶ: 前半は黒が前の絵を覆い、後半で新しい絵が現れる
    const blackO = interpolate(t, [0, 0.35, 0.7, 1], [0, 1, 1, 0]);
    const contentO = interpolate(t, [0.45, 1], [0, 1], {
      extrapolateLeft: "clamp",
    });
    return (
      <AbsoluteFill>
        <AbsoluteFill style={{ background: "#000", opacity: blackO }} />
        <AbsoluteFill style={{ opacity: contentO }}>{children}</AbsoluteFill>
      </AbsoluteFill>
    );
  }

  if (id === "wipe") {
    // 出だし速く・終わり柔らかく（等速寄りだった従来より緩急を強める）
    const e = Easing.bezier(0.5, 0, 0.15, 1)(t);
    const dir = String(p.direction);
    // 境界の質: ハードなclip-pathをやめ、進行方向に約3%のフェザー付きマスク＋
    // 境界に細い発光エッジ。feather分だけ余分に走らせ、終端では完全不透明になる
    const feather = 3;
    const bpos = (100 + feather) * e; // 境界位置（始端からの%）: 0 → 100+feather
    const toDir =
      dir === "right"
        ? "to left"
        : dir === "up"
          ? "to top"
          : dir === "down"
            ? "to bottom"
            : "to right"; // left = 左から現れて右へ進む
    const mask = `linear-gradient(${toDir}, #000 ${Math.max(0, bpos - feather)}%, transparent ${Math.min(100 + feather, bpos)}%)`;
    // 発光エッジ: 境界に沿った淡い光の帯。走っている間だけ見え、終盤で消える
    const glowO = interpolate(t, [0, 0.08, 0.8, 1], [0, 0.55, 0.4, 0]);
    const horizontal = dir === "left" || dir === "right";
    // left/downは始端が左/上なのでそのまま、right/upは反対端から測る
    const glowPos = dir === "right" || dir === "up" ? 100 - bpos : bpos;
    const glowStyle: React.CSSProperties = horizontal
      ? {
          position: "absolute",
          top: 0,
          bottom: 0,
          left: `${glowPos}%`,
          width: "9%",
          transform: "translateX(-50%)",
          background:
            "linear-gradient(to right, transparent, rgba(255,255,255,0.85), transparent)",
        }
      : {
          position: "absolute",
          left: 0,
          right: 0,
          top: `${glowPos}%`,
          height: "9%",
          transform: "translateY(-50%)",
          background:
            "linear-gradient(to bottom, transparent, rgba(255,255,255,0.85), transparent)",
        };
    return (
      <AbsoluteFill>
        <AbsoluteFill
          style={{
            maskImage: mask,
            WebkitMaskImage: mask,
          }}
        >
          {children}
        </AbsoluteFill>
        {glowO > 0.01 && (
          <div style={{ ...glowStyle, opacity: glowO, mixBlendMode: "screen" }} />
        )}
      </AbsoluteFill>
    );
  }

  if (id === "zoom-transition") {
    const amount = Number(p.amount ?? 1.25);
    const e = Easing.out(Easing.cubic)(t);
    const scale = amount - (amount - 1) * e;
    const opacity = interpolate(t, [0, 0.6], [0, 1], {
      extrapolateRight: "clamp",
    });
    return (
      <AbsoluteFill style={{ opacity, transform: `scale(${scale})` }}>
        {children}
      </AbsoluteFill>
    );
  }

  if (id === "glitch-transition") {
    // バグりながらハードイン: スライスずれ＋RGB分離が減衰していく。
    // 減衰は非線形（出だしを強く暴れさせ、後半すっと収まる）
    const intensity = Number(p.intensity ?? 0.7) * Math.pow(1 - t, 1.7);
    const slices = 6;
    return (
      <AbsoluteFill style={{ background: "#000" }}>
        <AbsoluteFill
          style={{
            transform: `translateX(${-12 * intensity}px)`,
            filter: "saturate(3) hue-rotate(-50deg)",
            opacity: 0.5,
            mixBlendMode: "screen",
          }}
        >
          {children}
        </AbsoluteFill>
        <AbsoluteFill
          style={{
            transform: `translateX(${12 * intensity}px)`,
            filter: "saturate(3) hue-rotate(130deg)",
            opacity: 0.5,
            mixBlendMode: "screen",
          }}
        >
          {children}
        </AbsoluteFill>
        {Array.from({ length: slices }, (_, i) => {
          const top = (i / slices) * 100;
          const dx = (hashRand(frame, i) - 0.5) * 140 * intensity;
          return (
            <AbsoluteFill
              key={i}
              style={{
                clipPath: `inset(${top}% 0 ${100 - top - 100 / slices}% 0)`,
                transform: `translateX(${dx}px)`,
              }}
            >
              {children}
            </AbsoluteFill>
          );
        })}
      </AbsoluteFill>
    );
  }

  if (id === "whip-pan") {
    // 高速で振って入る（市販パックの定番）。滑り込み＋方向ブラー風＋着地の余韻。
    // in側のオフセット/blurは transition-math の whipBelt に集約（出側と1本のベルト）。
    const dir = String(p.direction ?? "left");
    const belt = whipBelt(t, dir);
    // 動いている間だけ強くブラー（速度に比例）。CSS blurは等方だが高速時は違和感がない
    const blur = belt.blur * Number(p.blur ?? 1);
    return (
      <AbsoluteFill>
        <AbsoluteFill
          style={{
            transform: `translate(${belt.inX}%, ${belt.inY}%) scale(1.04)`,
            filter: blur > 0.5 ? `blur(${blur}px)` : undefined,
          }}
        >
          {children}
        </AbsoluteFill>
      </AbsoluteFill>
    );
  }

  if (id === "push") {
    // 押し出し: 次の絵が一方向から入り、前の絵を同方向へ押し出す（両側で1本のベルト）。
    // 入側は pushBelt の in。前の絵は下で密着退場する前提なのでブラー・背景塗りなし。
    const belt = pushBelt(t, String(p.direction ?? "left"));
    return (
      <AbsoluteFill
        style={{ transform: `translate(${belt.inX}%, ${belt.inY}%)` }}
      >
        {children}
      </AbsoluteFill>
    );
  }

  if (id === "luma-fade") {
    // 輝度フェード: 明るい（暗い）ところから先に次の絵が現れる情緒系の王道
    return (
      <LumaFadeIn
        t={t}
        fromDark={String(p.from ?? "light") === "dark"}
        lumaSrc={lumaSrc ?? null}
      >
        {children}
      </LumaFadeIn>
    );
  }

  if (id === "flash-white") {
    // 白飛びで繋ぐ。beatSync=beat なら遷移中、拍のたびに光が再点火する
    const intensity = Number(p.intensity ?? 1);
    const warm = String(p.tone ?? "white") === "warm";
    // 白飛びの質: 単色白の点滅ではなく、ごくわずかに暖色へ転んだ光が
    // 中心から放射状に広がる（実写のオーバーエクスポージャの印象）
    const core = warm ? "#fff3dd" : "#fffdf7";
    const edge = warm ? "#ffe4bb" : "#fff3e2";
    // 立ち上がりは速く（閃光らしく）、引きは長い尾でじわっと戻る
    const rise = interpolate(t, [0, 0.26], [0, 1], {
      extrapolateRight: "clamp",
      easing: Easing.out(Easing.quad),
    });
    const decay = interpolate(t, [0.3, 1], [1, 0], {
      extrapolateLeft: "clamp",
      easing: Easing.out(Easing.quad),
    });
    const envelope = Math.min(rise, decay);
    const beat =
      p.beatSync === "beat" && beatClock
        ? beatPulse(beatClock, frame, fps, 0.14)
        : 0;
    const flash = Math.min(1, Math.max(envelope, beat * 0.9)) * intensity;
    // 光の広がり: 弱い時は中心の灯、ピークでは画面全体が飛ぶ
    const spread = 45 + 80 * flash; // %（farthest-corner基準）
    const contentO = interpolate(t, [0.15, 0.55], [0, 1], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    });
    return (
      <AbsoluteFill>
        <AbsoluteFill style={{ opacity: contentO }}>{children}</AbsoluteFill>
        <AbsoluteFill
          style={{
            background: `radial-gradient(circle at 50% 46%, ${core} 0%, ${core} ${spread * 0.55}%, ${edge} ${spread}%, ${warm ? "rgba(255,216,165,0)" : "rgba(255,239,219,0)"} ${spread * 1.55}%)`,
            opacity: flash,
          }}
        />
      </AbsoluteFill>
    );
  }

  if (id === "slice") {
    // 画面を帯に割って時間差スライドイン。ポップ・アップテンポ用
    const bands = Math.max(2, Math.round(Number(p.bands ?? 5)));
    const vertBands = String(p.direction ?? "h") === "v";
    // 継ぎ目の発光: 帯が走っている間だけ境界線に淡い光を走らせ、揃うと消える
    const seamO = interpolate(t, [0, 0.12, 0.7, 1], [0, 0.4, 0.28, 0]);
    return (
      <AbsoluteFill>
        {Array.from({ length: bands }, (_, i) => {
          const local = interpolate(
            t,
            [i * (0.5 / bands), i * (0.5 / bands) + 0.55],
            [0, 1],
            { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
          );
          const e = Easing.bezier(0.22, 0.9, 0.28, 1)(local);
          const off = (1 - e) * 108 * (i % 2 === 0 ? 1 : -1);
          const lead = (i / bands) * 100;
          const trail = Math.max(0, 100 - lead - 100 / bands);
          const clip = vertBands
            ? `inset(0 ${trail}% 0 ${lead}%)`
            : `inset(${lead}% 0 ${trail}% 0)`;
          const move = vertBands
            ? `translateY(${off}%)`
            : `translateX(${off}%)`;
          // 走行中だけ速度に応じた微ブラー（モーションブラー風に硬さを消す）
          const blur = (1 - e) * 2.5;
          return (
            <AbsoluteFill
              key={i}
              style={{
                clipPath: clip,
                transform: move,
                filter: blur > 0.3 ? `blur(${blur}px)` : undefined,
              }}
            >
              {children}
            </AbsoluteFill>
          );
        })}
        {seamO > 0.01 &&
          Array.from({ length: bands - 1 }, (_, i) => {
            const pos = ((i + 1) / bands) * 100;
            const seamStyle: React.CSSProperties = vertBands
              ? {
                  position: "absolute",
                  top: 0,
                  bottom: 0,
                  left: `${pos}%`,
                  width: "2.4%",
                  transform: "translateX(-50%)",
                  background:
                    "linear-gradient(to right, transparent, rgba(255,255,255,0.8), transparent)",
                }
              : {
                  position: "absolute",
                  left: 0,
                  right: 0,
                  top: `${pos}%`,
                  height: "2.4%",
                  transform: "translateY(-50%)",
                  background:
                    "linear-gradient(to bottom, transparent, rgba(255,255,255,0.8), transparent)",
                };
            return (
              <div
                key={`seam-${i}`}
                style={{ ...seamStyle, opacity: seamO, mixBlendMode: "screen" }}
              />
            );
          })}
      </AbsoluteFill>
    );
  }

  // crossfade / 既定
  return <AbsoluteFill style={{ opacity: t }}>{children}</AbsoluteFill>;
};

/**
 * トランジション出側レーン: 前区間（A）が「出ていく演技」をする仕組み。
 * 次区間の切替（exitTransition）を受け取り、末尾 exitFrames ぶんで退場する。
 * 対象外（push/whip-pan以外・null・exitFrames<=0・whipでexit≠on）は
 * ラッパー要素すら足さず children を素通しする＝構造的に回帰ゼロ。
 */
export const TransitionOut: React.FC<{
  exitTransition: EffectInstance | null; // 次区間の切替
  exitStartFrame: number; // ローカルフレーム
  exitFrames: number;
  children: React.ReactNode;
}> = ({ exitTransition, exitStartFrame, exitFrames, children }) => {
  const frame = useCurrentFrame();
  const id = exitTransition?.id;
  if (
    !exitTransition ||
    exitFrames <= 0 ||
    (id !== "push" && id !== "whip-pan")
  ) {
    return <>{children}</>;
  }
  const p = resolveParams(exitTransition.id, exitTransition.params);
  const tOut = interpolate(
    frame,
    [exitStartFrame, exitStartFrame + exitFrames],
    [0, 1],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );
  if (id === "push") {
    // 押し出しは両側で1つの演出＝常に発動
    const belt = pushBelt(tOut, String(p.direction ?? "left"));
    return (
      <AbsoluteFill
        style={{ transform: `translate(${belt.outX}%, ${belt.outY}%)` }}
      >
        {children}
      </AbsoluteFill>
    );
  }
  // whip-pan は opt-in（params.exit === "on"）のときだけ出側を発動
  if (p.exit === "on") {
    const belt = whipBelt(tOut, String(p.direction ?? "left"));
    const blur = belt.blur * Number(p.blur ?? 1);
    return (
      <AbsoluteFill
        style={{
          transform: `translate(${belt.outX}%, ${belt.outY}%) scale(1.04)`,
          filter: blur > 0.5 ? `blur(${blur}px)` : undefined,
        }}
      >
        {children}
      </AbsoluteFill>
    );
  }
  return <>{children}</>;
};

/** 区間のトランジション尺（後続の区間が上に乗るまで前の絵を残す長さ） */
export function transitionFrames(
  section: Section | undefined,
  project: Project,
  fps: number,
): number {
  const head = section ? project.lines[section.headLineIndex] : undefined;
  const t = head?.transition;
  if (!t) return Math.round(0.8 * fps); // 既定はクロスフェード0.8s
  if (t.id === "cut") return 0;
  const p = resolveParams(t.id, t.params);
  return Math.round(Number(p.duration ?? 0.8) * fps);
}
