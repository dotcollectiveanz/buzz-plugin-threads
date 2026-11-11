import { defineConfig } from "vitest/config";

// Produces a single self-contained ESM `dist/plugin.js` with classic JSX.
// React is never bundled: components receive it from `ctx.react`.
export default defineConfig({
  esbuild: {
    jsx: "transform",
    jsxFactory: "React.createElement",
    jsxFragment: "React.Fragment",
  },
  build: {
    lib: {
      entry: "src/index.ts",
      formats: ["es"],
      fileName: () => "plugin.js",
    },
    target: "esnext",
    minify: false,
    emptyOutDir: true,
    rollupOptions: {
      output: { inlineDynamicImports: true },
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
