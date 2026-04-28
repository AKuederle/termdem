import { expect, test } from "vite-plus/test";
import { createTerminalDemo, TmpDir } from "../src/index.ts";
import {
  clientShimSource,
  nodeBuiltinBrowserExternalSource,
  nodeBuiltinsBrowserExternal,
  previewEntrySource,
  resetPreviewReplayState,
} from "../src/preview-server.ts";

test("createTerminalDemo preserves backend terminal definitions and config", () => {
  const dir = new TmpDir({});
  const script = () => {};
  const setup = () => ({ ready: true });
  const teardown = () => {};

  const demo = createTerminalDemo({
    panes: [
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
    setup,
    teardown,
    settings: {
      size: { width: 1920, height: 1080 },
      typeDelayMs: 100,
      zoom: 1.5,
    },
  });

  expect(demo.panes.map((terminal) => terminal.name)).toEqual(["server", "client"]);
  expect(demo.script).toBe(script);
  expect(demo.setup).toBe(setup);
  expect(demo.teardown).toBe(teardown);
  expect("config" in demo).toBe(false);
  expect("terminalDefinitions" in demo).toBe(false);
  expect(demo.settings).toEqual({
    size: { width: 1920, height: 1080 },
    typeDelayMs: 100,
    zoom: 1.5,
  });
});

test("createTerminalDemo scripts can wait without selecting a pane", async () => {
  const calls: string[] = [];
  const demo = createTerminalDemo({
    panes: [{ name: "main", pwd: new TmpDir({}) }],
    script: async (api) => {
      await api.wait(125);
      calls.push("after wait");
    },
  });

  await demo.script(
    {
      node: {
        async exec() {
          throw new Error("node.exec should not be required for wait");
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
    },
    undefined,
  );

  expect(calls).toEqual(["wait:125", "after wait"]);
});

test("client shim exports browser-safe public demo helpers", () => {
  const source = clientShimSource();

  expect(source).toContain("export const keys");
  expect(source).toContain('ESC: "\\x1b"');
  expect(source).toContain("export const typingDelays");
  expect(source).toContain("WPM_120: 100");
  expect(source).toContain(
    "export function createTerminalDemo({ panes, script, settings = {}, setup, teardown })",
  );
  expect(source).not.toContain('export { keys } from "@akuederle/termdem"');
});

test("preview entry imports demo through a named export", () => {
  const source = previewEntrySource("/tmp/demo.tsx");

  expect(source).toContain('import { demo, render } from "/@fs//tmp/demo.tsx";');
  expect(source).toContain("panes: demo.panes");
  expect(source).toContain("settings: demo.settings");
  expect(source).not.toContain("terminalDefinitions");
  expect(source).not.toContain("config: demo.config");
  expect(source).not.toContain("import demo");
});

test("preview Vite config externalizes Node builtins from the browser bundle", async () => {
  const plugin = nodeBuiltinsBrowserExternal();
  const { resolveId } = plugin;
  type ResolveIdHook = (
    this: unknown,
    source: string,
    importer: string | undefined,
    options: { ssr?: boolean },
  ) => unknown;

  if (typeof resolveId !== "function") {
    throw new Error("Expected node builtin external plugin to expose a resolveId hook");
  }

  expect(plugin.enforce).toBe("pre");

  const resolve = resolveId as ResolveIdHook;

  expect(resolve.call(undefined, "node:dgram", undefined, { ssr: false })).toBe(
    "\0termdem-node-builtin-browser-external:dgram",
  );
  expect(resolve.call(undefined, "node:dgram", undefined, { ssr: true })).toBeUndefined();
});

test("browser Node builtin external exports named throwing placeholders", () => {
  const source = nodeBuiltinBrowserExternalSource("dgram");

  expect(source).toContain("export const createSocket = __termdemNodeBuiltinUnavailable;");
  expect(source).toContain("export default __termdemNodeBuiltinUnavailable;");
  expect(source).toContain("Node builtin");
  expect(source).toContain("dgram");
});

test("preview replay reset clears stale pane state and output buffers", () => {
  const latestMessages = new Map([
    [
      "pane.meta:main",
      { type: "pane.meta" as const, pane: "main", shell: "/bin/bash", cwd: "/tmp", prompt: "$ " },
    ],
    ["pane.status:main", { type: "pane.status" as const, pane: "main", status: "ready" as const }],
    ["playbook.state", { type: "playbook.state" as const, state: "done" as const }],
    ["recording.state", { type: "recording.state" as const, state: "done" as const }],
  ]);
  const paneOutputBuffers = new Map([["main", "old transcript"]]);

  resetPreviewReplayState(latestMessages, paneOutputBuffers);

  expect(paneOutputBuffers.size).toBe(0);
  expect([...latestMessages.keys()]).toEqual(["playbook.state", "recording.state"]);
});
