import { expect, test } from "vite-plus/test";
import { createTerminalDemo, TmpDir } from "../src/index.ts";
import { clientShimSource, previewEntrySource } from "../src/preview-server.ts";

test("createTerminalDemo preserves backend terminal definitions and config", () => {
  const dir = new TmpDir({});
  const script = () => {};

  const demo = createTerminalDemo(
    [
      {
        name: "server",
        pwd: dir,
      },
      {
        name: "client",
        pwd: dir,
      },
    ],
    script,
    {
      size: { width: 1920, height: 1080 },
      typeDelayMs: 100,
      viewportSize: { width: 1440, height: 900 },
    },
  );

  expect(demo.terminalDefinitions.map((terminal) => terminal.name)).toEqual(["server", "client"]);
  expect(demo.script).toBe(script);
  expect(demo.config).toEqual({
    size: { width: 1920, height: 1080 },
    typeDelayMs: 100,
    viewportSize: { width: 1440, height: 900 },
  });
});

test("createTerminalDemo scripts can wait without selecting a pane", async () => {
  const calls: string[] = [];
  const demo = createTerminalDemo([{ name: "main", pwd: new TmpDir({}) }], async (api) => {
    await api.wait(125);
    calls.push("after wait");
  });

  await demo.script({
    node: {
      async execFile() {
        throw new Error("node.execFile should not be required for wait");
      },
    },
    pane() {
      throw new Error("pane should not be required for wait");
    },
    async wait(delayMs) {
      calls.push(`wait:${delayMs}`);
    },
    async waitFor() {
      throw new Error("waitFor should not be required for wait");
    },
  });

  expect(calls).toEqual(["wait:125", "after wait"]);
});

test("client shim exports browser-safe public demo helpers", () => {
  const source = clientShimSource();

  expect(source).toContain("export const keys");
  expect(source).toContain('ESC: "\\x1b"');
  expect(source).toContain("export const typingDelays");
  expect(source).toContain("WPM_120: 100");
  expect(source).not.toContain('export { keys } from "@akuederle/termdem"');
});

test("preview entry imports demo through a named export", () => {
  const source = previewEntrySource("/tmp/demo.tsx");

  expect(source).toContain('import { demo, render } from "/@fs//tmp/demo.tsx";');
  expect(source).not.toContain("import demo");
});
