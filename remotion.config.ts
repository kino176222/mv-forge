import path from "node:path";
import { Config } from "@remotion/cli/config";

Config.setEntryPoint("./remotion/index.ts");
Config.setVideoImageFormat("jpeg");
Config.setOverwriteOutput(true);

// tsconfig の "@/..." エイリアスをRemotionのwebpackにも教える
Config.overrideWebpackConfig((config) => ({
  ...config,
  resolve: {
    ...config.resolve,
    alias: {
      ...(config.resolve?.alias as Record<string, string> | undefined),
      "@": process.cwd(),
    },
  },
}));
