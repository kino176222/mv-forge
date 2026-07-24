import type React from "react";
import type { TextStyle } from "@/lib/schema";

/** decor部品に渡す描画コンテキスト（LyricLine が組み立てる） */
export type DecorContext = {
  frame: number;
  fps: number;
  durationInFrames: number;
  text: string;
  textStyle: TextStyle;
  fontStyle: React.CSSProperties;
  /** 行の配置スタイル（hero/縦横/prologue を吸収済み） */
  positioned: React.CSSProperties;
  baseTranslate: string;
  /** 行末のフェードアウト係数（0-1） */
  exit: number;
  vertical: boolean;
  /** resolveParams 済みのパラメータ */
  params: Record<string, number | string>;
  /** 🔡 文字ごと個別制御（tile型など文字単位で描く装飾用） */
  fxTransform: (i: number) => string;
  fxDelayFrames: (i: number) => number;
};

export type DecorRenderer = {
  /** 文字レイヤーの下に敷くレイヤーを返す（大半の装飾はこれ） */
  layer?: (ctx: DecorContext) => React.ReactNode;
  /**
   * 自己完結モード: 文字と装飾が一体化した行全体を返す（tile型など）。
   * null を返すと通常の layer 描画にフォールバックする。
   */
  standalone?: (ctx: DecorContext) => React.ReactNode | null;
};
