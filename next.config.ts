import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 配布検証ビルド（NEXT_PUBLIC_MVFORGE_FCP=0）が常駐本番の .next を上書きしないよう
  // 出力先を切替可能にする（例: MVFORGE_DIST_DIR=.next-dist）
  distDir: process.env.MVFORGE_DIST_DIR || ".next",
  // Remotionのレンダラー/バンドラーはNextにバンドルさせない（Node側でそのまま動かす）
  serverExternalPackages: [
    "@remotion/bundler",
    "@remotion/renderer",
    "esbuild",
  ],
};

export default nextConfig;
