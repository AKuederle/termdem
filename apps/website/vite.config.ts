import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { createPaneSession } from "../../packages/termdem/src/index.ts";
import {
  parsePaneClientMessage,
  type PaneServerMessage,
} from "../../packages/termdem/src/protocol.ts";
import { defineConfig, type Plugin } from "vite";
import { WebSocket, WebSocketServer, type RawData } from "ws";

const appDir = fileURLToPath(new URL(".", import.meta.url));
const repoRoot = resolve(appDir, "../..");

type PaneWorkspace = {
  cwd: string;
  dispose(): Promise<void>;
};

function ptyBridge(): Plugin {
  const wss = new WebSocketServer({ noServer: true });

  return {
    name: "termdem-pty-bridge",
    configureServer(server) {
      server.httpServer?.on("upgrade", (request, socket, head) => {
        const url = request.url ? new URL(request.url, "http://localhost") : null;

        if (!url?.pathname.startsWith("/panes/")) {
          return;
        }

        const paneName = decodeURIComponent(url.pathname.slice("/panes/".length)) || "main";

        wss.handleUpgrade(request, socket, head, (ws) => {
          void wireSession(ws, paneName);
        });
      });

      server.httpServer?.once("close", () => {
        wss.close();
      });
    },
  };
}

async function wireSession(ws: WebSocket, paneName: string) {
  const workspace = await createPaneWorkspace(paneName);
  const shell = process.env.TERMDEM_SHELL ?? "/bin/bash";
  const prompt = `(${paneName}) $ `;
  const session = await createPaneSession({
    cwd: workspace.cwd,
    shell,
    cols: 120,
    rows: 30,
    prompt,
    onOutput(data) {
      sendPaneMessage(ws, {
        type: "pane.output",
        pane: paneName,
        data,
      });
    },
  });

  let closed = false;
  let messageQueue = Promise.resolve();

  const shutdown = async () => {
    if (closed) {
      return;
    }

    closed = true;
    await session.close();
    await workspace.dispose();
  };

  const fail = async (error: unknown) => {
    sendPaneMessage(ws, {
      type: "pane.error",
      pane: paneName,
      message: formatError(error),
    });
    await shutdown();
    ws.close();
  };

  sendPaneMessage(ws, {
    type: "pane.meta",
    pane: paneName,
    shell,
    cwd: workspace.cwd,
    prompt,
  });

  ws.on("message", (message) => {
    messageQueue = messageQueue
      .then(async () => {
        const parsed = parsePaneClientMessage(rawDataToString(message));
        if (!parsed || parsed.pane !== paneName) {
          return;
        }

        switch (parsed.type) {
          case "pane.input":
            if (parsed.data === "\r") {
              await session.press("Enter");
              return;
            }

            await session.type(parsed.data);
            return;
          case "pane.resize":
            await session.resize(parsed.cols, parsed.rows);
            return;
          case "pane.type":
            await session.type(parsed.text, { delayMs: parsed.delayMs });
            return;
          case "pane.press":
            await session.press(parsed.key);
            return;
          case "pane.exec": {
            const result = await session.exec(parsed.command, {
              typeDelayMs: parsed.typeDelayMs,
            });
            sendPaneMessage(ws, {
              type: "pane.exec.completed",
              pane: paneName,
              result,
            });
            return;
          }
          default:
            return;
        }
      })
      .catch(async (error) => {
        await fail(error);
      });
  });

  ws.on("close", () => {
    void shutdown();
  });

  ws.on("error", () => {
    void shutdown();
  });
}

async function createPaneWorkspace(paneName: string): Promise<PaneWorkspace> {
  if (paneName !== "main") {
    return {
      cwd: repoRoot,
      async dispose() {},
    };
  }

  const cwd = await mkdtemp(join(tmpdir(), "termdem-pane-"));
  await writeFile(join(cwd, "alpha.txt"), "alpha file\n", "utf8");
  await writeFile(join(cwd, "bravo.txt"), "bravo file\n", "utf8");

  return {
    cwd,
    async dispose() {
      await rm(cwd, { recursive: true, force: true });
    },
  };
}

function sendPaneMessage(ws: WebSocket, message: PaneServerMessage) {
  if (ws.readyState !== WebSocket.OPEN) {
    return;
  }

  ws.send(JSON.stringify(message));
}

function formatError(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

function rawDataToString(data: RawData): string {
  if (typeof data === "string") {
    return data;
  }

  if (data instanceof ArrayBuffer) {
    return new TextDecoder().decode(data);
  }

  if (Array.isArray(data)) {
    return data.map((chunk) => rawDataToString(chunk)).join("");
  }

  return data.toString("utf8");
}

export default defineConfig({
  plugins: [react(), ptyBridge()],
});
