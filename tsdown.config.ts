import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/index.ts"],
  format: "esm",
  platform: "neutral",
  target: "es2022",
  tsconfig: "tsconfig.build.json",
  dts: { generator: "oxc", resolver: "oxc" },
  deps: { onlyBundle: [], onlyImport: [] },
  minify: true,
  sourcemap: false,
  clean: true,
});
