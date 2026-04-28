import { defineConfig } from "vite-plus";

export default defineConfig({
  pack: {
    dts: {
      tsgo: true,
    },
    entry: [
      "src/index.ts",
      "src/cli.ts",
      "src/preview-client.tsx",
      "src/preview-server.ts",
      "src/protocol.ts",
    ],
  },
  lint: {
    options: {
      typeAware: true,
      typeCheck: true,
    },
  },
  fmt: {},
  test: {
    tags: [{ name: "smoke" }],
  },
});
