import "./server-guard";
import { projectFile } from "./projects-server";

/**
 * 人物切り抜き（text-behind-subject / キャラ独立レイヤー用）。
 * BiRefNet(lite) をローカルで動かし images/<名前>.subject.png（透過PNG）を作る。
 * 深度マップと違い「近い物」ではなく「被写体そのもの」を抜くので、
 * 文字を完全に後ろへ回せる＆キャラだけ独立して動かせる。
 * 初回はモデルのダウンロードが走る。以降はキャッシュで数秒/枚。
 *
 * モデル選定メモ: transformers.js v4 の "background-removal" パイプラインは
 * AutoModelFor{Image,Semantic,Universal}Segmentation のみ対応。
 * briaai/RMBG-1.4 は SegformerForSemanticSegmentation 型で弾かれる、
 * Xenova/modnet は夜景アニメ立ち絵で背景を抜けない（全面不透明化）。
 * 実画像テストで BiRefNet_lite が髪の毛先までクリーンに抜けたので採用。
 */

type G = typeof globalThis & {
  __mvforgeSubjectPipe?: Promise<unknown>;
};
const g = globalThis as G;

async function getPipe() {
  if (!g.__mvforgeSubjectPipe) {
    g.__mvforgeSubjectPipe = (async () => {
      const { pipeline, env } = await import("@huggingface/transformers");
      env.allowLocalModels = false;
      return pipeline("background-removal", "onnx-community/BiRefNet_lite");
    })();
    g.__mvforgeSubjectPipe.catch(() => {
      g.__mvforgeSubjectPipe = undefined;
    });
  }
  return g.__mvforgeSubjectPipe;
}

export function subjectFileOf(image: string): string {
  return image.replace(/\.[^.]+$/, ".subject.png");
}

export async function generateSubject(
  projectName: string,
  image: string,
): Promise<string> {
  const absIn = projectFile(projectName, image);
  const absOut = projectFile(projectName, subjectFileOf(image));
  type Saveable = { save: (p: string) => Promise<unknown> };
  const pipe = (await getPipe()) as (
    input: string,
  ) => Promise<Saveable | Saveable[]>;
  // background-removal の戻りは実装により RawImage 単体 or 配列。
  // BiRefNet_lite は透過RGBAの RawImage を「単体」で返す挙動なので両対応にする。
  const out = await pipe(absIn);
  const img = Array.isArray(out) ? out[0] : out;
  await img.save(absOut);
  return subjectFileOf(image);
}
