import { expect, test } from "vite-plus/test";
import { parsePaneClientMessage, parsePaneServerMessage } from "../src/protocol.ts";

test("parsePaneClientMessage accepts exec messages with typing delay", () => {
  const message = parsePaneClientMessage(
    JSON.stringify({
      type: "pane.exec",
      pane: "main",
      command: "command ls -1 --color=never",
      typeDelayMs: 40,
    }),
  );

  expect(message).toEqual({
    type: "pane.exec",
    pane: "main",
    command: "command ls -1 --color=never",
    typeDelayMs: 40,
  });
});

test("parsePaneClientMessage accepts action ids for ordered keystrokes", () => {
  const message = parsePaneClientMessage(
    JSON.stringify({
      type: "pane.type",
      id: "action-1",
      pane: "main",
      text: "vim README.md",
      delayMs: 20,
    }),
  );

  expect(message).toEqual({
    type: "pane.type",
    id: "action-1",
    pane: "main",
    text: "vim README.md",
    delayMs: 20,
  });
});

test("parsePaneClientMessage rejects malformed pane messages", () => {
  expect(
    parsePaneClientMessage(
      JSON.stringify({
        type: "pane.resize",
        pane: "",
        cols: 120,
        rows: 30,
      }),
    ),
  ).toBeNull();
});

test("parsePaneServerMessage accepts action completion payloads", () => {
  const message = parsePaneServerMessage(
    JSON.stringify({
      type: "pane.action.completed",
      pane: "main",
      id: "action-1",
    }),
  );

  expect(message).toEqual({
    type: "pane.action.completed",
    pane: "main",
    id: "action-1",
  });
});

test("parsePaneServerMessage accepts command completion payloads", () => {
  const message = parsePaneServerMessage(
    JSON.stringify({
      type: "pane.exec.completed",
      pane: "main",
      result: {
        command: "cat 'alpha.txt'",
        exitCode: 0,
        raw: "alpha file\r\n",
        text: "alpha file",
        lines: ["alpha file"],
        startedAt: 1,
        endedAt: 2,
      },
    }),
  );

  expect(message).toEqual({
    type: "pane.exec.completed",
    pane: "main",
    result: {
      command: "cat 'alpha.txt'",
      exitCode: 0,
      raw: "alpha file\r\n",
      text: "alpha file",
      lines: ["alpha file"],
      startedAt: 1,
      endedAt: 2,
    },
  });
});
