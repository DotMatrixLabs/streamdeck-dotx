import commonjs from "@rollup/plugin-commonjs";
import json from "@rollup/plugin-json";
import nodeResolve from "@rollup/plugin-node-resolve";
import typescript from "@rollup/plugin-typescript";

export default {
  input: "src/plugin.ts",
  output: {
    file: "com.dotmatrixlabs.dotx.streamdeck.sdPlugin/bin/plugin.js",
    format: "cjs",
    sourcemap: true,
  },
  external: [],
  plugins: [
    typescript({
      tsconfig: "./tsconfig.json",
      sourceMap: true,
      inlineSources: true,
      include: ["src/**/*.ts"],
    }),
    nodeResolve({
      preferBuiltins: true,
      extensions: [".mjs", ".js", ".json", ".node", ".ts"],
    }),
    commonjs(),
    json(),
  ],
};
