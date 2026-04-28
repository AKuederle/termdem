import { expect, test } from "vite-plus/test";
import { createPaneScreenRequestBroker } from "../src/preview-server.ts";
import type { PaneScreenSnapshot } from "../src/types.ts";

test("pane screen request broker resolves snapshots from browser responses", async () => {
  const sent: string[] = [];
  const broker = createPaneScreenRequestBroker({ timeoutMs: 100 });
  const client = {
    readyState: 1 as const,
    send(message: string) {
      sent.push(message);
    },
  };
  const snapshot: PaneScreenSnapshot = {
    altScreen: false,
    cols: 80,
    cursor: { col: 0, row: 1, visible: true },
    lines: ["ready"],
    rows: 24,
    scrollbackCount: 0,
    text: "ready",
  };

  const pending = broker.request("server", new Set([client]));
  const request = JSON.parse(sent[0] ?? "") as { requestId: string };

  broker.resolve({
    type: "pane.screen.response",
    pane: "server",
    requestId: request.requestId,
    snapshot,
  });

  await expect(pending).resolves.toEqual(snapshot);
});
