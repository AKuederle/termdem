import { randomBytes } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { createServer, type Alias, type Plugin, type ViteDevServer } from "vite";
import { WebSocket, WebSocketServer, type RawData } from "ws";
import { createPaneSession } from "./pane-session.ts";
import {
  parsePaneClientMessage,
  type PaneActionCompletedMessage,
  type PaneClientMessage,
  type PaneServerMessage,
} from "./protocol.ts";
import type { TerminalDemo } from "./terminal-demo.ts";
import { createTerminalWorkspace, type TerminalWorkspaceDefinition } from "./workspace.ts";

export type PreviewServerOptions = {
  demoPath: string;
  host?: string;
  open?: boolean;
  port?: number;
};

export type TermdemPreviewServer = {
  close(): Promise<void>;
  urls: string[];
};

type PaneWorkspace = {
  cwd: string;
  dispose(): Promise<void>;
};

type PreviewDemoModule = Partial<TerminalDemo<readonly TerminalWorkspaceDefinition[]>>;

const bridgeToken = randomBytes(24).toString("hex");

export async function runPreviewCommand(options: PreviewServerOptions) {
  const server = await startPreviewServer(options);

  try {
    await waitForTerminationSignal();
  } finally {
    await server.close();
  }
}

export async function startPreviewServer(
  options: PreviewServerOptions,
): Promise<TermdemPreviewServer> {
  const demoPath = resolve(options.demoPath);
  const root = await mkdtemp(join(tmpdir(), "termdem-preview-"));
  const clientShimPath = join(root, "termdem-client-shim.js");
  const entryPath = join(root, "src", "main.tsx");

  try {
    await mkdir(dirname(entryPath), { recursive: true });
    await writeFile(join(root, "index.html"), previewHtml(), "utf8");
    await writeFile(clientShimPath, clientShimSource(), "utf8");
    await writeFile(join(root, "src", "style.css"), '@import "tailwindcss";\n', "utf8");
    await writeFile(entryPath, previewEntrySource(demoPath), "utf8");

    const viteServer = await createServer({
      appType: "spa",
      configFile: false,
      css: {
        devSourcemap: false,
      },
      logLevel: "silent",
      optimizeDeps: {
        entries: [],
        noDiscovery: true,
      },
      resolve: {
        alias: runtimeDependencyAliases(),
      },
      root,
      plugins: [
        termdemClientShim(clientShimPath),
        tailwindcss(),
        react(),
        ptyBridge({
          demoPath,
        }),
      ],
      server: {
        fs: {
          allow: [root, dirname(demoPath), process.cwd()],
        },
        host: options.host ?? "127.0.0.1",
        open: options.open ?? true,
        port: options.port,
        sourcemapIgnoreList(sourcePath) {
          return sourcePath.includes("/node_modules/");
        },
      },
    });

    await viteServer.listen();
    printPreviewUrls(viteServer);

    return {
      urls: viteServer.resolvedUrls?.local ?? [],
      async close() {
        try {
          await viteServer.close();
        } finally {
          await rm(root, { recursive: true, force: true });
        }
      },
    };
  } catch (error) {
    await rm(root, { recursive: true, force: true });
    throw error;
  }
}

function ptyBridge({ demoPath }: { demoPath: string }): Plugin {
  const wss = new WebSocketServer({ noServer: true });
  let viteServer: ViteDevServer | null = null;

  return {
    name: "termdem-pty-bridge",
    configureServer(server) {
      viteServer = server;
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
          void wireSession({
            demoPath,
            paneName,
            viteServer: assertViteServer(viteServer),
            ws,
          });
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

async function wireSession({
  demoPath,
  paneName,
  viteServer,
  ws,
}: {
  demoPath: string;
  paneName: string;
  viteServer: ViteDevServer;
  ws: WebSocket;
}) {
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
    const demo = await loadDemoModule(viteServer, demoPath);
    workspace = await createPaneWorkspace(demo, paneName);
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

          await handlePaneClientMessage(session, parsed, (serverMessage) => {
            sendPaneMessage(ws, serverMessage);
          });
          sendActionCompleted(ws, parsed);
        })
        .catch(async (error) => {
          await fail(error);
        });
    });
  } catch (error) {
    await fail(error);
  }
}

async function handlePaneClientMessage(
  session: Awaited<ReturnType<typeof createPaneSession>>,
  parsed: PaneClientMessage,
  send: (message: PaneServerMessage) => void,
) {
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
      send({
        type: "pane.exec.completed",
        pane: parsed.pane,
        result,
      });
      return;
    }
    default:
      parsed satisfies never;
  }
}

async function createPaneWorkspace(
  demo: PreviewDemoModule,
  paneName: string,
): Promise<PaneWorkspace> {
  const terminal = demo.terminalDefinitions?.find((definition) => definition.name === paneName);
  if (!terminal) {
    throw new Error(`Demo does not define terminal "${paneName}"`);
  }

  return createTerminalWorkspace(terminal);
}

async function loadDemoModule(viteServer: ViteDevServer, demoPath: string) {
  const demoModule = (await viteServer.ssrLoadModule(`/@fs/${toVitePath(demoPath)}`)) as unknown;
  if (!isPreviewDemoModule(demoModule)) {
    throw new Error("Demo module must export terminalDefinitions via createTerminalDemo");
  }

  return demoModule;
}

function isPreviewDemoModule(value: unknown): value is PreviewDemoModule {
  return typeof value === "object" && value !== null && "terminalDefinitions" in value;
}

function sendActionCompleted(ws: WebSocket, message: PaneClientMessage) {
  if (!("id" in message) || !message.id) {
    return;
  }

  sendPaneMessage(ws, {
    type: "pane.action.completed",
    pane: message.pane,
    id: message.id,
  } satisfies PaneActionCompletedMessage);
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

function assertViteServer(server: ViteDevServer | null) {
  if (!server) {
    throw new Error("Vite server is not available");
  }

  return server;
}

function previewHtml() {
  return `<html>
  <head>
    <title>termdem preview</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
`;
}

function previewEntrySource(demoPath: string) {
  return `import "./style.css";
import * as demo from ${JSON.stringify(`/@fs/${toVitePath(demoPath)}`)};
import { renderPreviewApp } from "@akuederle/termdem/preview-client";

renderPreviewApp(demo);
`;
}

function clientShimSource() {
  return `export { Pane, Stage, collectPaneDefinitions, renderStageScene } from "@akuederle/termdem/scene";

export class Dir {
  constructor() {}
}

export class TmpDir extends Dir {
  constructor() {
    super();
  }
}

export function createTerminalDemo(terminalDefinitions, script, config = {}) {
  return {
    config,
    script,
    terminalDefinitions,
    terminals: Object.fromEntries(
      terminalDefinitions.map((terminal) => [terminal.name, { name: terminal.name }]),
    ),
  };
}

export function quoteShellArg(value) {
  return \`'\${value.replaceAll("'", "'\\\\''")}'\`;
}

export async function execNode() {
  throw new Error("execNode is only available while the preview server loads terminal setup code.");
}
`;
}

function toVitePath(path: string) {
  return path.replaceAll("\\", "/");
}

function termdemClientShim(clientShimPath: string): Plugin {
  return {
    name: "termdem-client-shim",
    resolveId(id, _importer, options) {
      if (id === "@akuederle/termdem" && !options.ssr) {
        return clientShimPath;
      }

      return null;
    },
  };
}

function runtimeDependencyAliases(): Alias[] {
  return [
    exactAlias("@akuederle/termdem/preview-client"),
    exactAlias("@akuederle/termdem/scene"),
    exactAlias("@wterm/react"),
    exactAlias("@wterm/react/css"),
    exactAlias("react"),
    exactAlias("react-dom"),
    exactAlias("react-dom/client"),
    exactAlias("react/jsx-dev-runtime"),
    exactAlias("react/jsx-runtime"),
  ];
}

function exactAlias(specifier: string): Alias {
  return {
    find: new RegExp(`^${escapeRegExp(specifier)}$`, "u"),
    replacement: fileURLToPath(import.meta.resolve(specifier)),
  };
}

function printPreviewUrls(viteServer: ViteDevServer) {
  const localUrls = viteServer.resolvedUrls?.local ?? [];
  for (const url of localUrls) {
    process.stdout.write(`termdem preview: ${url}\n`);
  }
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function waitForTerminationSignal() {
  return new Promise<void>((resolveSignal) => {
    const cleanup = () => {
      process.off("SIGINT", onSignal);
      process.off("SIGTERM", onSignal);
    };
    const onSignal = () => {
      cleanup();
      resolveSignal();
    };

    process.once("SIGINT", onSignal);
    process.once("SIGTERM", onSignal);
  });
}
