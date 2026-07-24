import "./server-guard";
import { projectFile } from "./projects-server";

/**
 * ③2.5Dパララックス用の深度マップ生成。
 * Depth Anything V2 (small) をローカルで動かし images/<名前>.depth.png を作る。
 * 初回はモデル(約50MB)のダウンロードが走る。以降はキャッシュで数秒/枚。
 */

type G = typeof globalThis & {
  __mvforgeDepthPipe?: Promise<unknown>;
};
const g = globalThis as G;

async function getPipe() {
  if (!g.__mvforgeDepthPipe) {
    g.__mvforgeDepthPipe = (async () => {
      const { pipeline, env } = await import("@huggingface/transformers");
      env.allowLocalModels = false;
      return pipeline("depth-estimation", "onnx-community/depth-anything-v2-small");
    })();
    g.__mvforgeDepthPipe.catch(() => {
      g.__mvforgeDepthPipe = undefined;
    });
  }
  return g.__mvforgeDepthPipe;
}

export function depthFileOf(image: string): string {
  return image.replace(/\.[^.]+$/, ".depth.png");
}

export async function generateDepth(
  projectName: string,
  image: string,
): Promise<string> {
  const absIn = projectFile(projectName, image);
  const absOut = projectFile(projectName, depthFileOf(image));
  const pipe = (await getPipe()) as (
    input: string,
  ) => Promise<{ depth: { save: (p: string) => Promise<unknown> } }>;
  const result = await pipe(absIn);
  await result.depth.save(absOut);
  return depthFileOf(image);
}
