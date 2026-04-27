import { randomBytes } from "node:crypto";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
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
  demo: PreviewDemoModule;
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
  const reactSsrShimPath = join(root, "react-ssr-shim.mjs");
  const reactJsxDevRuntimeSsrShimPath = join(root, "react-jsx-dev-runtime-ssr-shim.mjs");
  const reactJsxRuntimeSsrShimPath = join(root, "react-jsx-runtime-ssr-shim.mjs");
  const packageRuntimeDir = dirname(fileURLToPath(import.meta.url));

  try {
    await mkdir(dirname(entryPath), { recursive: true });
    await linkBrowserDependency(root, "react");
    await linkBrowserDependency(root, "react-dom");
    await writeFile(join(root, "index.html"), previewHtml(), "utf8");
    await writeFile(clientShimPath, clientShimSource(), "utf8");
    await writeFile(reactSsrShimPath, reactSsrShimSource(), "utf8");
    await writeFile(
      reactJsxDevRuntimeSsrShimPath,
      reactRuntimeSsrShimSource("react/jsx-dev-runtime", ["Fragment", "jsxDEV"]),
      "utf8",
    );
    await writeFile(
      reactJsxRuntimeSsrShimPath,
      reactRuntimeSsrShimSource("react/jsx-runtime", ["Fragment", "jsx", "jsxs"]),
      "utf8",
    );
    await writeFile(
      join(root, "src", "style.css"),
      previewCss({
        sourceRoots: uniqueSourceRoots([dirname(demoPath), packageRuntimeDir, process.cwd()]),
      }),
      "utf8",
    );
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
        include: ["react", "react-dom/client"],
        noDiscovery: true,
      },
      resolve: {
        alias: runtimeDependencyAliases(),
      },
      root,
      plugins: [
        termdemClientShim({
          clientShimPath,
          reactJsxDevRuntimeSsrShimPath,
          reactJsxRuntimeSsrShimPath,
          reactSsrShimPath,
        }),
        tailwindcss(),
        react(),
        ptyBridge({
          demoPath,
        }),
      ],
      server: {
        fs: {
          allow: [root, dirname(demoPath), packageRuntimeDir, process.cwd()],
        },
        host: options.host ?? "127.0.0.1",
        open: options.open ?? true,
        port: options.port,
        sourcemapIgnoreList(sourcePath) {
          return sourcePath.includes("/node_modules/");
        },
      },
    });

    const demo = await loadDemoModule(viteServer, demoPath);
    await viteServer.listen();
    printPreviewUrls(viteServer);

    return {
      demo,
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
  const demo = readDefaultPreviewDemo(demoModule);
  if (!isPreviewDemoModule(demo)) {
    throw new Error("Demo module must default-export the createTerminalDemo result");
  }

  return demo;
}

function readDefaultPreviewDemo(value: unknown): unknown {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }

  return (value as { default?: unknown }).default;
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
    return error.stack ?? error.message;
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
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <link rel="icon" href="data:," />
    <title>termdem preview</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
`;
}

function previewCss({ sourceRoots }: { sourceRoots: string[] }) {
  const tailwindSources = sourceRoots
    .map((sourceRoot) => `@source ${JSON.stringify(toVitePath(sourceRoot))};`)
    .join("\n");

  return `@import "tailwindcss";
${tailwindSources}

html,
body,
#root {
  height: 100%;
  margin: 0;
  min-height: 100%;
  overflow: hidden;
}

body {
  background: #111;
}

* {
  box-sizing: border-box;
}
`;
}

function uniqueSourceRoots(sourceRoots: string[]) {
  return [...new Set(sourceRoots)];
}

function previewEntrySource(demoPath: string) {
  return `import "./style.css";
import demo, { render } from ${JSON.stringify(`/@fs/${toVitePath(demoPath)}`)};
import { renderPreviewApp } from "@akuederle/termdem/preview-client";

const terminals = Object.fromEntries(
  demo.terminalDefinitions.map((terminal) => [terminal.name, { name: terminal.name }]),
);

renderPreviewApp({ render, script: demo.script, terminals });
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

function reactSsrShimSource() {
  return `import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const React = require(${JSON.stringify(fileURLToPath(import.meta.resolve("react")))});

export const Activity = React.Activity;
export const act = React.act;
export const cache = React.cache;
export const cacheSignal = React.cacheSignal;
export const captureOwnerStack = React.captureOwnerStack;
export const Children = React.Children;
export const Component = React.Component;
export const __CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE =
  React.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;
export const __COMPILER_RUNTIME = React.__COMPILER_RUNTIME;
export const cloneElement = React.cloneElement;
export const createContext = React.createContext;
export const createElement = React.createElement;
export const createRef = React.createRef;
export const Fragment = React.Fragment;
export const forwardRef = React.forwardRef;
export const isValidElement = React.isValidElement;
export const lazy = React.lazy;
export const memo = React.memo;
export const Profiler = React.Profiler;
export const PureComponent = React.PureComponent;
export const startTransition = React.startTransition;
export const StrictMode = React.StrictMode;
export const Suspense = React.Suspense;
export const unstable_useCacheRefresh = React.unstable_useCacheRefresh;
export const use = React.use;
export const useActionState = React.useActionState;
export const useCallback = React.useCallback;
export const useContext = React.useContext;
export const useDebugValue = React.useDebugValue;
export const useDeferredValue = React.useDeferredValue;
export const useEffect = React.useEffect;
export const useEffectEvent = React.useEffectEvent;
export const useId = React.useId;
export const useImperativeHandle = React.useImperativeHandle;
export const useInsertionEffect = React.useInsertionEffect;
export const useLayoutEffect = React.useLayoutEffect;
export const useMemo = React.useMemo;
export const useOptimistic = React.useOptimistic;
export const useReducer = React.useReducer;
export const useRef = React.useRef;
export const useState = React.useState;
export const useSyncExternalStore = React.useSyncExternalStore;
export const useTransition = React.useTransition;
export const version = React.version;
export default React;
`;
}

function reactRuntimeSsrShimSource(specifier: string, exportNames: string[]) {
  const declarations = exportNames
    .map((name) => `export const ${name} = runtime.${name};`)
    .join("\n");

  return `import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const runtime = require(${JSON.stringify(fileURLToPath(import.meta.resolve(specifier)))});

${declarations}
export default runtime;
`;
}

function toVitePath(path: string) {
  return path.replaceAll("\\", "/");
}

function termdemClientShim({
  clientShimPath,
  reactJsxDevRuntimeSsrShimPath,
  reactJsxRuntimeSsrShimPath,
  reactSsrShimPath,
}: {
  clientShimPath: string;
  reactJsxDevRuntimeSsrShimPath: string;
  reactJsxRuntimeSsrShimPath: string;
  reactSsrShimPath: string;
}): Plugin {
  const ssrOnlyAliases = new Map([
    ["react", reactSsrShimPath],
    ["react/jsx-dev-runtime", reactJsxDevRuntimeSsrShimPath],
    ["react/jsx-runtime", reactJsxRuntimeSsrShimPath],
  ]);

  return {
    enforce: "pre",
    name: "termdem-client-shim",
    resolveId(id, _importer, options) {
      if (id === "@akuederle/termdem" && options.ssr !== true) {
        return clientShimPath;
      }

      return options.ssr === true ? ssrOnlyAliases.get(id) : undefined;
    },
  };
}

function runtimeDependencyAliases(): Alias[] {
  return [
    exactAlias("@akuederle/termdem/preview-client"),
    exactAlias("@akuederle/termdem/scene"),
    exactAlias("@wterm/react"),
    exactAlias("@wterm/react/css"),
  ];
}

async function linkBrowserDependency(root: string, specifier: string) {
  const dependencyPath = dirname(fileURLToPath(import.meta.resolve(`${specifier}/package.json`)));
  const targetPath = join(root, "node_modules", ...specifier.split("/"));
  await mkdir(dirname(targetPath), { recursive: true });
  await symlink(dependencyPath, targetPath, "dir");
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
