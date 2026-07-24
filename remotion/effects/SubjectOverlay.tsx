import React, { useEffect, useState } from "react";
import { AbsoluteFill, Img, continueRender, delayRender } from "remotion";

/**
 * 被写体の切り抜きコピー（text-behind-subject 用）。
 * 「元絵 → 歌詞 → これ」の順に重ねると、歌詞が被写体の後ろに回り込む。
 *
 * 切り抜きは2系統。優先は①、無ければ②へ自動フォールバック:
 *  ① subject.png（RMBG等の人物セグメンテーション）＝透過アルファでマスク。
 *     被写体だけをスパッと不透明に抜くので、文字が「完全に」後ろへ回る（にじみ無し）。
 *  ② depth.png（深度マップ）を luminance マスクにして元画像を再描画。
 *     深度は連続階調＝中間グレーは半透明にしか隠せず、文字が透ける（旧方式）。
 *
 * subject / depth のどちらも無い/読めない場合は何も描かない（歌詞は普通に最前面）。
 *
 * effectedContent を渡すと、素の元画像ではなく「エフェクト適用後の区間」を
 * 被写体シルエットでマスクする＝グレイン/色調整/フレア等の後処理がキャラにも
 * 正しく乗る（背景と馴染む。素のピクセルを貼る"ステッカー化"を回避）。
 */

// GlitchSubject と同じ知見: CSSのmask-imageはRemotionのロード待ち対象外のため
// data URI化＋decode()待ちで「必ず手元にある」状態にしてから使う
const maskCache = new Map<string, Promise<string>>();
function loadMaskAsDataUri(src: string): Promise<string> {
  let p = maskCache.get(src);
  if (!p) {
    p = (async () => {
      const res = await fetch(src);
      if (!res.ok) throw new Error(`depth mask fetch failed: ${res.status}`);
      const blob = await res.blob();
      const dataUri = await new Promise<string>((resolve, reject) => {
        const fr = new FileReader();
        fr.onload = () => resolve(fr.result as string);
        fr.onerror = () => reject(new Error("mask read failed"));
        fr.readAsDataURL(blob);
      });
      const img = new Image();
      img.src = dataUri;
      await img.decode();
      return dataUri;
    })();
    maskCache.set(src, p);
    p.catch(() => maskCache.delete(src));
  }
  return p;
}

export const SubjectOverlay: React.FC<{
  src: string;
  depthSrc: string;
  /** 人物切り抜きPNG（透過アルファ）。あればこちらを優先＝完全遮蔽 */
  subjectSrc?: string;
  /**
   * エフェクト適用後の区間の中身（背景＋camera＋FxStack＋Look）。
   * subjectモード時、これを被写体アルファでマスクして描く＝キャラにも後処理が乗る。
   * 省略時は素のsubject.pngをそのまま描く（従来動作）。
   */
  effectedContent?: React.ReactNode;
}> = ({ src, depthSrc, subjectSrc, effectedContent }) => {
  // mode "subject": 透過切り抜きをそのまま描く（crisp）。
  // mode "depth": 深度マップを luminance マスクにして元画像を再描画（旧・にじみ有）。
  const [resolved, setResolved] = useState<
    { mode: "subject" | "depth"; uri: string } | null
  >(null);
  const [handle] = useState(() =>
    delayRender(`subject overlay: ${subjectSrc ?? depthSrc}`),
  );
  useEffect(() => {
    let alive = true;
    (async () => {
      // ① 人物切り抜きが読めればそれを優先（透過をそのまま前景に）
      if (subjectSrc) {
        try {
          const uri = await loadMaskAsDataUri(subjectSrc);
          if (alive) setResolved({ mode: "subject", uri });
          return;
        } catch {
          // 切り抜き未生成/読めない → 深度マスクへフォールバック
        }
      }
      // ② 深度マップを luminance マスクとして使う
      try {
        const uri = await loadMaskAsDataUri(depthSrc);
        if (alive) setResolved({ mode: "depth", uri });
      } catch {
        // どちらも無ければ演出をスキップ（レンダリングは止めない）
      }
    })().finally(() => continueRender(handle));
    return () => {
      alive = false;
    };
  }, [subjectSrc, depthSrc, handle]);

  if (!resolved) return null;
  if (resolved.mode === "subject") {
    // エフェクト適用後の区間を被写体アルファでマスク＝キャラにも後処理が乗る（正しいレイヤー順）
    if (effectedContent) {
      return (
        <AbsoluteFill
          style={{
            maskImage: `url(${resolved.uri})`,
            WebkitMaskImage: `url(${resolved.uri})`,
            // subject.png のアルファ channel をそのままマスクに使う
            maskMode: "alpha",
            maskSize: "100% 100%",
            WebkitMaskSize: "100% 100%",
            pointerEvents: "none",
          }}
        >
          {effectedContent}
        </AbsoluteFill>
      );
    }
    // effectedContent 無し: 素の透過切り抜きをそのまま描く（従来動作）
    return (
      <AbsoluteFill style={{ pointerEvents: "none" }}>
        <Img
          src={resolved.uri}
          style={{ width: "100%", height: "100%", objectFit: "cover" }}
        />
      </AbsoluteFill>
    );
  }
  return (
    <AbsoluteFill
      style={{
        maskImage: `url(${resolved.uri})`,
        maskMode: "luminance",
        maskSize: "100% 100%",
        pointerEvents: "none",
      }}
    >
      <Img
        src={src}
        style={{ width: "100%", height: "100%", objectFit: "cover" }}
      />
    </AbsoluteFill>
  );
};
