import { defineConfig } from "vite-plus";

export default defineConfig({
  staged: {
    "*": "vp check --fix",
  },
  fmt: {
    proseWrap: "preserve",
  },
  lint: { options: { typeAware: true, typeCheck: true } },
  test: {
    tags: [{ name: "smoke" }],
  },
  run: {
    cache: true,
  },
});
