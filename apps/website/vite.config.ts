import { randomBytes } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { createPaneSession } from "../../packages/termdem/src/index.ts";
import {
  parsePaneClientMessage,
  type PaneServerMessage,
} from "../../packages/termdem/src/protocol.ts";
import { defineConfig, type Plugin } from "vite";
import { WebSocket, WebSocketServer, type RawData } from "ws";

const bridgeToken = randomBytes(24).toString("hex");

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

        if (
          !isAuthorizedUpgrade(
            request,
            url,
            Boolean(server.config.server.https),
            socket.remoteAddress,
          )
        ) {
          socket.destroy();
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
    transformIndexHtml() {
      return [
        {
          tag: "meta",
          attrs: {
            name: "termdem-bridge-token",
            content: bridgeToken,
          },
          injectTo: "head",
        },
      ];
    },
  };
}

async function wireSession(ws: WebSocket, paneName: string) {
  let workspace: PaneWorkspace | null = null;
  let session: Awaited<ReturnType<typeof createPaneSession>> | null = null;
  let closed = false;
  let messageQueue = Promise.resolve();

  const shutdown = async () => {
    if (closed) {
      return;
    }

    closed = true;
    await session?.close();
    await workspace?.dispose();
  };

  const fail = async (error: unknown) => {
    sendPaneMessage(ws, {
      type: "pane.error",
      pane: paneName,
      message: formatError(error),
    });
    await shutdown();
    closeWebSocket(ws);
  };

  ws.on("close", () => {
    void shutdown();
  });

  ws.on("error", () => {
    void shutdown();
  });

  try {
    workspace = await createPaneWorkspace(paneName);
    if (closed) {
      await shutdown();
      return;
    }

    const shell = process.env.TERMDEM_SHELL ?? "/bin/bash";
    const prompt = `(${paneName}) $ `;
    session = await createPaneSession({
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

    if (closed) {
      await shutdown();
      return;
    }

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
          if (!session) {
            return;
          }

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
  } catch (error) {
    await fail(error);
  }
}

async function createPaneWorkspace(paneName: string): Promise<PaneWorkspace> {
  const cwd = await mkdtemp(join(tmpdir(), "termdem-pane-"));
  await writeFile(join(cwd, "alpha.txt"), `alpha file from pane ${paneName}\n`, "utf8");
  await writeFile(join(cwd, "bravo.txt"), `bravo file from pane ${paneName}\n`, "utf8");

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

function isAuthorizedUpgrade(
  request: { headers: Record<string, string | string[] | undefined> },
  url: URL,
  httpsEnabled: boolean,
  remoteAddress: string | undefined,
) {
  if (url.searchParams.get("token") !== bridgeToken) {
    return false;
  }

  if (!isLoopbackAddress(remoteAddress)) {
    return false;
  }

  const origin = firstHeaderValue(request.headers.origin);
  const host = firstHeaderValue(request.headers.host);
  if (!origin || !host) {
    return false;
  }

  const expectedOrigin = `${httpsEnabled ? "https" : "http"}://${host}`;
  return origin === expectedOrigin;
}

function firstHeaderValue(value: string | string[] | undefined) {
  if (Array.isArray(value)) {
    return value[0];
  }

  return value;
}

function closeWebSocket(ws: WebSocket) {
  if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
    ws.close();
  }
}

function isLoopbackAddress(address: string | undefined) {
  if (!address) {
    return false;
  }

  if (address === "::1") {
    return true;
  }

  if (address.startsWith("::ffff:")) {
    return isIPv4Loopback(address.slice("::ffff:".length));
  }

  return isIPv4Loopback(address);
}

function isIPv4Loopback(address: string) {
  const octets = address.split(".");
  if (octets.length !== 4) {
    return false;
  }

  const numbers = octets.map((octet) => Number.parseInt(octet, 10));
  if (numbers.some((value) => Number.isNaN(value) || value < 0 || value > 255)) {
    return false;
  }

  return numbers[0] === 127;
}

export default defineConfig({
  plugins: [tailwindcss(), react(), ptyBridge()],
});
