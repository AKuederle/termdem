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
