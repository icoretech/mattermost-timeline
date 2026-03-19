import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import cssInjectedByJsPlugin from "vite-plugin-css-injected-by-js";

const pluginId = require("../plugin.json").id;

export default defineConfig({
  plugins: [react(), cssInjectedByJsPlugin()],
  build: {
    lib: {
      entry: resolve(__dirname, "src/index.tsx"),
      formats: ["iife"],
      name: `plugin_${pluginId.replace(/[.-]/g, "_")}`,
      fileName: () => "main.js",
    },
    outDir: "dist",
    rollupOptions: {
      external: [
        "react",
        "react-dom",
        "redux",
        "react-redux",
        "prop-types",
        "react-bootstrap",
        "react-router-dom",
      ],
      output: {
        globals: {
          react: "React",
          "react-dom": "ReactDOM",
          redux: "Redux",
          "react-redux": "ReactRedux",
          "prop-types": "PropTypes",
          "react-bootstrap": "ReactBootstrap",
          "react-router-dom": "ReactRouterDom",
        },
      },
    },
    sourcemap: false,
    minify: true,
    cssCodeSplit: false,
  },
  css: {
    preprocessorOptions: {
      scss: {
        api: "modern-compiler",
      },
    },
  },
  resolve: {
    alias: {
      src: resolve(__dirname, "src"),
    },
  },
});
