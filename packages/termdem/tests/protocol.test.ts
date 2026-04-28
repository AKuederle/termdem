import { expect, test } from "vite-plus/test";
import { parseBrowserToServerMessage, parseServerToBrowserMessage } from "../src/protocol.ts";

test("parseBrowserToServerMessage accepts pane resize and input messages", () => {
  expect(
    parseBrowserToServerMessage(
      JSON.stringify({
        type: "pane.resize",
        pane: "main",
        cols: 120,
        rows: 30,
      }),
    ),
  ).toEqual({
    type: "pane.resize",
    pane: "main",
    cols: 120,
    rows: 30,
  });

  expect(
    parseBrowserToServerMessage(
      JSON.stringify({
        type: "pane.input",
        pane: "main",
        data: "a",
      }),
    ),
  ).toEqual({
    type: "pane.input",
    pane: "main",
    data: "a",
  });
});

test("parseBrowserToServerMessage accepts pane screen responses", () => {
  expect(
    parseBrowserToServerMessage(
      JSON.stringify({
        type: "pane.screen.response",
        pane: "server",
        requestId: "screen-1",
        snapshot: {
          altScreen: false,
          cols: 80,
          cursor: { col: 5, row: 2, visible: true },
          lines: ["ready", "listening"],
          rows: 24,
          scrollbackCount: 3,
          text: "ready\nlistening",
        },
      }),
    ),
  ).toEqual({
    type: "pane.screen.response",
    pane: "server",
    requestId: "screen-1",
    snapshot: {
      altScreen: false,
      cols: 80,
      cursor: { col: 5, row: 2, visible: true },
      lines: ["ready", "listening"],
      rows: 24,
      scrollbackCount: 3,
      text: "ready\nlistening",
    },
  });
});

test("parseBrowserToServerMessage accepts playbook controls and rejects browser playbook actions", () => {
  expect(parseBrowserToServerMessage(JSON.stringify({ type: "playbook.start" }))).toEqual({
    type: "playbook.start",
  });
  expect(parseBrowserToServerMessage(JSON.stringify({ type: "playbook.restart" }))).toEqual({
    type: "playbook.restart",
  });
  expect(parseBrowserToServerMessage(JSON.stringify({ type: "playbook.stop" }))).toEqual({
    type: "playbook.stop",
  });
  expect(parseBrowserToServerMessage(JSON.stringify({ type: "playbook.pause" }))).toBeNull();
  expect(parseBrowserToServerMessage(JSON.stringify({ type: "playbook.resume" }))).toBeNull();

  expect(
    parseBrowserToServerMessage(
      JSON.stringify({
        type: "pane.exec",
        pane: "main",
        command: "node health.js",
      }),
    ),
  ).toBeNull();
  expect(
    parseBrowserToServerMessage(
      JSON.stringify({
        type: "pane.hiddenExec",
        pane: "main",
        command: "node health.js",
      }),
    ),
  ).toBeNull();
});

test("parseBrowserToServerMessage rejects malformed pane messages", () => {
  expect(
    parseBrowserToServerMessage(
      JSON.stringify({
        type: "pane.resize",
        pane: "",
        cols: 120,
        rows: 30,
      }),
    ),
  ).toBeNull();
});

test("parseServerToBrowserMessage accepts pane, playbook, recording, and preview messages", () => {
  expect(
    parseServerToBrowserMessage(
      JSON.stringify({
        type: "pane.meta",
        pane: "main",
        shell: "/bin/bash",
        cwd: "/tmp/demo",
        prompt: "(main) $ ",
      }),
    ),
  ).toEqual({
    type: "pane.meta",
    pane: "main",
    shell: "/bin/bash",
    cwd: "/tmp/demo",
    prompt: "(main) $ ",
  });

  expect(
    parseServerToBrowserMessage(
      JSON.stringify({
        type: "playbook.state",
        state: "running",
        action: "waitFor(listener ready)",
      }),
    ),
  ).toEqual({
    type: "playbook.state",
    state: "running",
    action: "waitFor(listener ready)",
    error: undefined,
  });

  expect(
    parseServerToBrowserMessage(JSON.stringify({ type: "recording.state", state: "done" })),
  ).toEqual({
    type: "recording.state",
    state: "done",
    action: undefined,
    error: undefined,
  });

  expect(
    parseServerToBrowserMessage(JSON.stringify({ type: "preview.error", message: "boom" })),
  ).toEqual({
    type: "preview.error",
    message: "boom",
  });

  expect(
    parseServerToBrowserMessage(
      JSON.stringify({
        type: "pane.screen.request",
        pane: "server",
        requestId: "screen-1",
      }),
    ),
  ).toEqual({
    type: "pane.screen.request",
    pane: "server",
    requestId: "screen-1",
  });

  expect(parseServerToBrowserMessage(JSON.stringify({ type: "preview.reset" }))).toEqual({
    type: "preview.reset",
  });
});
