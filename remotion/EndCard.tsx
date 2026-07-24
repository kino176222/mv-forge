import React from "react";
import {
  AbsoluteFill,
  Easing,
  interpolate,
  Sequence,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import type { EndCard as EndCardData, Project } from "@/lib/schema";
import { telopWindow } from "@/lib/telop-window";
import { XP_TITLE_COMPONENTS } from "./effects/xp/registry-components";
import { resolveXpAliasId } from "@/lib/xp/id-aliases";
import { fontById } from "./fonts";

/**
 * 🎬 エンドカード（アウトロのクレジット表示プリセット）。
 * - simple : 曲名（大）＋アーティスト名。字間が閉じる映画タイトル風
 * - credits: SONG / ARTIST / CREATED BY のラベル付きクレジットが順に浮かぶ
 * - cinema : レターボックス黒帯＋「CREATED BY ◯◯」がピント合焦で現れる
 * フォント・文字色は meta.textStyle に従う（貼り紙1枚方式）。
 * 最後の黒フェードは MVComposition 側の FadeToBlack が共通で担当する。
 */

const fadeIn = (
  frame: number,
  fps: number,
  fromSec: number,
  durSec: number,
): number =>
  interpolate(frame, [fromSec * fps, (fromSec + durSec) * fps], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

export const EndCard: React.FC<{
  endCard: EndCardData;
  project: Project;
}> = ({ endCard, project }) => {
  const frame = useCurrentFrame();
  // durationInFrames はアウトロ<Sequence>内なのでアウトロの尺（つまみの表示窓の分母）
  const { fps, height, durationInFrames } = useVideoConfig();
  const style = project.meta.textStyle;
  const font = fontById(style.font);
  const scale = height / 1080; // 縦解像度基準でフォントを相似拡大

  const title = endCard.songTitle.trim() || project.meta.title;
  const artist = endCard.artistName.trim();
  const created = endCard.createdBy.trim();

  const base: React.CSSProperties = {
    fontFamily: font.family,
    fontWeight: font.weight,
    color: style.color,
    textShadow: "0 2px 24px rgba(0,0,0,0.65), 0 0 60px rgba(0,0,0,0.4)",
    whiteSpace: "pre-wrap",
    textAlign: "center",
  };

  if (endCard.preset === "xp") {
    // 拡張タイトルでクレジット表示。未登録idは simple にフォールバック
    const Xp = endCard.xpId ? XP_TITLE_COMPONENTS[resolveXpAliasId(endCard.xpId)] : undefined;
    if (Xp) {
      const text =
        endCard.xpText.trim() ||
        [title, artist, created && `Created by ${created}`]
          .filter(Boolean)
          .join("\n");
      // つまみ: 行クレジット（MVComposition）と同経路。アウトロ内ローカル窓で
      // delay/duration を適用し、ラッパー変形で scale/offset、fontFamily でフォント。
      // duration 0=従来（アウトロの間ずっと表示・ポートへは6秒を通知＝退場は6秒目）
      const win = telopWindow(endCard.delay, endCard.duration, durationInFrames, fps);
      const xpDurF = endCard.duration > 0 ? win.durF : Math.round(fps * 6);
      const xpFontFamily =
        endCard.font === "design"
          ? undefined
          : endCard.font === "project"
            ? font.family
            : fontById(endCard.font).family;
      return (
        <Sequence from={win.fromF} durationInFrames={win.durF}>
          <AbsoluteFill
            style={{
              pointerEvents: "none",
              transform: `translate(${endCard.offsetX}%, ${endCard.offsetY}%) scale(${endCard.scale})`,
            }}
          >
            <Xp text={text} durationInFrames={xpDurF} fontFamily={xpFontFamily} />
          </AbsoluteFill>
        </Sequence>
      );
    }
  }

  if (endCard.preset === "simple" || endCard.preset === "xp") {
    // 曲名の字間がスッと閉じながらフェードイン → 罫線 → アーティスト名
    const o1 = fadeIn(frame, fps, 0.5, 1.2);
    const tracking = interpolate(
      Easing.out(Easing.cubic)(fadeIn(frame, fps, 0.5, 1.6)),
      [0, 1],
      [0.42, 0.14],
    );
    const lineW = interpolate(fadeIn(frame, fps, 1.1, 0.9), [0, 1], [0, 260 * scale]);
    const o2 = fadeIn(frame, fps, 1.4, 1.0);
    const o3 = fadeIn(frame, fps, 2.2, 1.0);
    return (
      <AbsoluteFill
        style={{ alignItems: "center", justifyContent: "center", gap: 28 * scale }}
      >
        <div
          style={{
            ...base,
            fontSize: 76 * scale,
            letterSpacing: `${tracking}em`,
            marginRight: `-${tracking}em`, // letter-spacing末尾ぶんの中央ズレ補正
            opacity: o1,
          }}
        >
          {title}
        </div>
        <div
          style={{
            width: lineW,
            height: Math.max(1, 2 * scale),
            background: style.color,
            opacity: 0.7,
          }}
        />
        {artist && (
          <div
            style={{
              ...base,
              fontSize: 34 * scale,
              letterSpacing: "0.3em",
              marginRight: "-0.3em",
              opacity: o2,
            }}
          >
            {artist}
          </div>
        )}
        {created && (
          <div
            style={{
              ...base,
              position: "absolute",
              bottom: "8%",
              fontSize: 22 * scale,
              letterSpacing: "0.2em",
              marginRight: "-0.2em",
              opacity: o3 * 0.85,
            }}
          >
            Created by {created}
          </div>
        )}
      </AbsoluteFill>
    );
  }

  if (endCard.preset === "credits") {
    // ラベル付きクレジットが1段ずつ浮かび上がる
    const rows = [
      { label: "SONG", value: title },
      { label: "ARTIST", value: artist },
      { label: "CREATED BY", value: created },
    ].filter((r) => r.value !== "");
    return (
      <AbsoluteFill
        style={{ alignItems: "center", justifyContent: "center", gap: 64 * scale }}
      >
        {rows.map((row, i) => {
          const t = fadeIn(frame, fps, 0.5 + i * 0.9, 0.9);
          const rise = (1 - Easing.out(Easing.cubic)(t)) * 26 * scale;
          return (
            <div
              key={row.label}
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 14 * scale,
                opacity: t,
                transform: `translateY(${rise}px)`,
              }}
            >
              <div
                style={{
                  ...base,
                  fontSize: 19 * scale,
                  letterSpacing: "0.5em",
                  marginRight: "-0.5em",
                  opacity: 0.6,
                }}
              >
                {row.label}
              </div>
              <div style={{ ...base, fontSize: 46 * scale, letterSpacing: "0.06em" }}>
                {row.value}
              </div>
            </div>
          );
        })}
      </AbsoluteFill>
    );
  }

  // cinema: レターボックス＋「CREATED BY ◯◯」がピント合焦
  const name = created || artist || title;
  const sub = name !== title ? title : "";
  const bar = fadeIn(frame, fps, 0.2, 0.8);
  const focus = fadeIn(frame, fps, 0.8, 1.6);
  const eased = Easing.out(Easing.cubic)(focus);
  const blur = (1 - eased) * 16 * scale;
  const zoom = 1.05 - eased * 0.05;
  const oSub = fadeIn(frame, fps, 2.2, 1.0);
  return (
    <AbsoluteFill>
      {/* レターボックス黒帯 */}
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          height: `${12 * bar}%`,
          background: "#000",
        }}
      />
      <div
        style={{
          position: "absolute",
          bottom: 0,
          left: 0,
          right: 0,
          height: `${12 * bar}%`,
          background: "#000",
        }}
      />
      <AbsoluteFill
        style={{
          alignItems: "center",
          justifyContent: "center",
          gap: 34 * scale,
          opacity: focus,
          filter: `blur(${blur}px)`,
          transform: `scale(${zoom})`,
        }}
      >
        <div
          style={{
            ...base,
            fontSize: 24 * scale,
            letterSpacing: "0.65em",
            marginRight: "-0.65em",
            opacity: 0.75,
          }}
        >
          CREATED BY
        </div>
        <div style={{ ...base, fontSize: 88 * scale, letterSpacing: "0.1em" }}>
          {name}
        </div>
        {sub && (
          <div
            style={{
              ...base,
              fontSize: 26 * scale,
              letterSpacing: "0.32em",
              marginRight: "-0.32em",
              opacity: oSub * 0.8,
              marginTop: 18 * scale,
            }}
          >
            {sub}
          </div>
        )}
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
