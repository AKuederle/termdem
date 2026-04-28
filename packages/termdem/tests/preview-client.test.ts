import { expect, test } from "vite-plus/test";
import { createPlaybookApi, paneFrameDataAttributes } from "../src/preview-client.tsx";
import type { PaneController } from "../src/types.ts";

test("pane frame data attributes expose pane identity and presence-style current state", () => {
  expect(paneFrameDataAttributes("server", true)).toEqual({
    "data-termdem-current": "",
    "data-termdem-pane": "server",
  });

  expect(paneFrameDataAttributes("listener", false)).toEqual({
    "data-termdem-current": undefined,
    "data-termdem-pane": "listener",
  });
});

test("playbook pane actions mark the current pane without clearing it during waits", async () => {
  const currentPanes: string[] = [];
  const actions: string[] = [];
  const typeDelays: Array<number | undefined> = [];
  const runtime: PaneController & { ready: boolean } = {
    ready: true,
    async exec(command, options) {
      actions.push(`exec:${command}`);
      typeDelays.push(options?.typeDelayMs);
      return {
        command,
        endedAt: 2,
        exitCode: 0,
        lines: [],
        raw: "",
        startedAt: 1,
        text: "",
      };
    },
    async press(key) {
      actions.push(`press:${key}`);
    },
    async type(text, options) {
      actions.push(`type:${text}`);
      typeDelays.push(options?.typeDelayMs);
    },
  };

  const api = createPlaybookApi(
    new Map([["server", runtime]]),
    async () => {},
    (paneName) => {
      currentPanes.push(paneName);
    },
    100,
  );

  const server = api.pane("server");
  await server.type("npm test");
  await server.exec("npm test", { typeDelayMs: 25 });
  await api.wait(10);
  await server.press("Enter");

  expect(actions).toEqual(["type:npm test", "exec:npm test", "press:Enter"]);
  expect(currentPanes).toEqual(["server", "server", "server"]);
  expect(typeDelays).toEqual([100, 25]);
});
