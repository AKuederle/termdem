import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { builtinModules, createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { createServer, type Alias, type Plugin, type ViteDevServer } from "vite";
import { WebSocket, WebSocketServer, type RawData } from "ws";
import { PlaybookRuntime } from "./playbook-runtime.ts";
import {
  parseBrowserToServerMessage,
  type PaneScreenResponseMessage,
  type PaneScreenSnapshot,
  type ServerToBrowserMessage,
} from "./protocol.ts";
import type { TerminalDemo } from "./terminal-demo.ts";
import type { TerminalWorkspaceDefinition } from "./workspace.ts";

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

type PreviewDemoModule = Partial<TerminalDemo<readonly TerminalWorkspaceDefinition[]>>;

const bridgeToken = randomBytes(24).toString("hex");
const socketOpenState = 1;
const require = createRequire(import.meta.url);
const nodeBuiltinNames = new Set(
  builtinModules.flatMap((name) => (name.startsWith("node:") ? [name] : [name, `node:${name}`])),
);

type PreviewSendSocket = Pick<WebSocket, "readyState" | "send">;

type PaneScreenRequestBrokerOptions = {
  timeoutMs?: number;
};

export function createPaneScreenRequestBroker(options: PaneScreenRequestBrokerOptions = {}) {
  const timeoutMs = options.timeoutMs ?? 1_000;
  const pending = new Map<
    string,
    {
      pane: string;
      reject: (error: Error) => void;
      resolve: (snapshot: PaneScreenSnapshot) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();

  return {
    request(pane: string, clients: Set<PreviewSendSocket>): Promise<PaneScreenSnapshot> {
      const openClients = [...clients].filter((client) => client.readyState === socketOpenState);
      if (openClients.length === 0) {
        return Promise.reject(new Error("Pane screen reads require an open preview client"));
      }

      const requestId = randomUUID();
      const message = JSON.stringify({ type: "pane.screen.request", pane, requestId });
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(requestId);
          reject(new Error(`Timed out reading screen for pane "${pane}"`));
        }, timeoutMs);
        pending.set(requestId, { pane, reject, resolve, timer });

        for (const client of openClients) {
          client.send(message);
        }
      });
    },
    resolve(message: PaneScreenResponseMessage) {
      const request = pending.get(message.requestId);
      if (!request || request.pane !== message.pane) {
        return;
      }

      clearTimeout(request.timer);
      pending.delete(message.requestId);
      request.resolve(message.snapshot);
    },
  };
}

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
  const host = options.host ?? "127.0.0.1";

  try {
    await mkdir(dirname(entryPath), { recursive: true });
    await linkBrowserDependency(root, "react");
    await linkBrowserDependency(root, "react-dom");
    await linkBrowserDependency(root, "tailwindcss");
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
        nodeBuiltinsBrowserExternal(),
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
        host,
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
  let runtime: PlaybookRuntime | null = null;
  const clients = new Set<WebSocket>();
  const latestMessages = new Map<string, ServerToBrowserMessage>();
  const paneOutputBuffers = new Map<string, string>();
  const paneScreenRequests = createPaneScreenRequestBroker();

  const broadcast = (message: ServerToBrowserMessage) => {
    rememberPaneOutput(paneOutputBuffers, message);
    rememberLatestMessage(latestMessages, message);
    for (const client of clients) {
      sendPreviewMessage(client, message);
    }
  };

  return {
    name: "termdem-pty-bridge",
    configureServer(server) {
      viteServer = server;
      server.httpServer?.on("upgrade", (request, socket, head) => {
        const url = request.url ? new URL(request.url, "http://localhost") : null;

        if (url?.pathname !== "/preview") {
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

        wss.handleUpgrade(request, socket, head, (ws) => {
          void wirePreviewClient({
            broadcast,
            clients,
            demoPath,
            getRuntime: () => runtime,
            latestMessages,
            paneOutputBuffers,
            paneScreenRequests,
            saveRuntime(nextRuntime) {
              runtime = nextRuntime;
            },
            viteServer: assertViteServer(viteServer),
            ws,
          });
        });
      });

      server.httpServer?.once("close", () => {
        void runtime?.close();
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

export function nodeBuiltinsBrowserExternal(): Plugin {
  const virtualPrefix = "\0termdem-node-builtin-browser-external:";

  return {
    enforce: "pre",
    name: "termdem-node-builtins-browser-external",
    resolveId(source, _importer, options) {
      if (options?.ssr || !nodeBuiltinNames.has(source)) {
        return;
      }

      return `${virtualPrefix}${normalizeBuiltinName(source)}`;
    },
    load(id) {
      if (!id.startsWith(virtualPrefix)) {
        return;
      }

      return nodeBuiltinBrowserExternalSource(id.slice(virtualPrefix.length));
    },
  };
}

export function nodeBuiltinBrowserExternalSource(moduleName: string) {
  const errorMessage = nodeBuiltinBrowserErrorMessage(moduleName);
  const namedExports = nodeBuiltinExportNames(moduleName)
    .map((name) => `export const ${name} = __termdemNodeBuiltinUnavailable;`)
    .join("\n");

  return `const __termdemNodeBuiltinUnavailable = new Proxy(function unavailableNodeBuiltin() {
  throw new Error(${JSON.stringify(errorMessage)});
}, {
  construct() {
    throw new Error(${JSON.stringify(errorMessage)});
  },
  get() {
    throw new Error(${JSON.stringify(errorMessage)});
  },
});

${namedExports}
export default __termdemNodeBuiltinUnavailable;
`;
}

function normalizeBuiltinName(moduleName: string) {
  return moduleName.startsWith("node:") ? moduleName.slice("node:".length) : moduleName;
}

function nodeBuiltinExportNames(moduleName: string) {
  const builtin = require(normalizeBuiltinName(moduleName)) as Record<string, unknown>;
  return Object.keys(builtin)
    .filter((name) => name !== "default" && isJavaScriptIdentifier(name))
    .sort();
}

function isJavaScriptIdentifier(value: string) {
  return /^[$A-Z_a-z][$\w]*$/.test(value);
}

function nodeBuiltinBrowserErrorMessage(moduleName: string) {
  return `Node builtin "${moduleName}" is not available in the termdem preview browser bundle. Move Node-only code into setup, teardown, or script callbacks, and load it with a dynamic import when it runs on the preview server.`;
}

async function wirePreviewClient({
  broadcast,
  clients,
  demoPath,
  getRuntime,
  latestMessages,
  paneOutputBuffers,
  paneScreenRequests,
  saveRuntime,
  viteServer,
  ws,
}: {
  broadcast: (message: ServerToBrowserMessage) => void;
  clients: Set<WebSocket>;
  demoPath: string;
  getRuntime: () => PlaybookRuntime | null;
  latestMessages: Map<string, ServerToBrowserMessage>;
  paneOutputBuffers: Map<string, string>;
  paneScreenRequests: ReturnType<typeof createPaneScreenRequestBroker>;
  saveRuntime: (runtime: PlaybookRuntime) => void;
  viteServer: ViteDevServer;
  ws: WebSocket;
}) {
  const fail = async (error: unknown) => {
    sendPreviewMessage(ws, {
      type: "preview.error",
      message: formatError(error),
    });
    closeWebSocket(ws);
  };

  clients.add(ws);
  ws.on("close", () => {
    clients.delete(ws);
  });

  ws.on("error", () => {
    clients.delete(ws);
  });

  const runtimeReady = (async () => {
    const demo = await loadDemoModule(viteServer, demoPath);
    let activeRuntime = getRuntime();
    let replayBufferedState = true;
    if (!activeRuntime) {
      replayBufferedState = false;
      activeRuntime = new PlaybookRuntime({
        onPaneMeta(message) {
          broadcast({ type: "pane.meta", ...message });
        },
        onPaneOutput(message) {
          broadcast({ type: "pane.output", ...message });
        },
        onPaneStatus(status) {
          broadcast({ type: "pane.status", ...status });
        },
        onPlaybookState(state) {
          broadcast({ type: "playbook.state", ...state });
        },
        onRecordingState(state) {
          broadcast({ type: "recording.state", ...state });
        },
        readPaneScreen(pane) {
          return paneScreenRequests.request(pane, clients);
        },
        terminalDefinitions: demo.panes ?? [],
        typeDelayMs: demo.settings?.typeDelayMs,
      });
      saveRuntime(activeRuntime);
      await activeRuntime.ensureReady();
    }

    if (replayBufferedState) {
      for (const message of latestMessages.values()) {
        sendPreviewMessage(ws, message);
      }
      for (const [pane, data] of paneOutputBuffers) {
        if (data !== "") {
          sendPreviewMessage(ws, { type: "pane.output", pane, data });
        }
      }
    }

    return { demo, runtime: activeRuntime };
  })();

  ws.on("message", (message) => {
    void runtimeReady
      .then(({ demo, runtime }) =>
        handleBrowserMessage({
          broadcast,
          demo,
          latestMessages,
          paneOutputBuffers,
          paneScreenRequests,
          rawMessage: rawDataToString(message),
          runtime,
        }),
      )
      .catch(fail);
  });

  try {
    await runtimeReady;
  } catch (error) {
    await fail(error);
  }
}

async function handleBrowserMessage({
  broadcast,
  demo,
  latestMessages,
  paneOutputBuffers,
  paneScreenRequests,
  rawMessage,
  runtime,
}: {
  broadcast: (message: ServerToBrowserMessage) => void;
  demo: PreviewDemoModule;
  latestMessages: Map<string, ServerToBrowserMessage>;
  paneOutputBuffers: Map<string, string>;
  paneScreenRequests: ReturnType<typeof createPaneScreenRequestBroker>;
  rawMessage: string;
  runtime: PlaybookRuntime;
}) {
  const parsed = parseBrowserToServerMessage(rawMessage);
  if (!parsed) {
    return;
  }

  switch (parsed.type) {
    case "pane.input":
      await runtime.inputPane(parsed.pane, parsed.data);
      return;
    case "pane.resize":
      await runtime.resizePane(parsed.pane, parsed.cols, parsed.rows);
      return;
    case "pane.screen.response":
      paneScreenRequests.resolve(parsed);
      return;
    case "playbook.start":
      if (demo.script) {
        await runtime.run(demo.script, { setup: demo.setup, teardown: demo.teardown });
      }
      return;
    case "playbook.stop":
      runtime.stop();
      return;
    case "playbook.restart":
      if (demo.script) {
        resetPreviewReplayState(latestMessages, paneOutputBuffers);
        broadcast({ type: "preview.reset" });
        await runtime.restart(demo.script, { setup: demo.setup, teardown: demo.teardown });
      }
      return;
    default:
      parsed satisfies never;
  }
}

async function loadDemoModule(viteServer: ViteDevServer, demoPath: string) {
  const demoModule = (await viteServer.ssrLoadModule(`/@fs/${toVitePath(demoPath)}`)) as unknown;
  const demo = readNamedPreviewDemo(demoModule);
  if (!isPreviewDemoModule(demo)) {
    throw new Error('Demo module must export the createTerminalDemo result as "demo"');
  }

  return demo;
}

function readNamedPreviewDemo(value: unknown): unknown {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }

  return (value as { demo?: unknown }).demo;
}

function isPreviewDemoModule(value: unknown): value is PreviewDemoModule {
  return typeof value === "object" && value !== null && "panes" in value;
}

function sendPreviewMessage(ws: WebSocket, message: ServerToBrowserMessage) {
  if (ws.readyState !== WebSocket.OPEN) {
    return;
  }

  ws.send(JSON.stringify(message));
}

const maxPaneOutputBufferLength = 200_000;

function rememberPaneOutput(
  paneOutputBuffers: Map<string, string>,
  message: ServerToBrowserMessage,
) {
  if (message.type !== "pane.output") {
    return;
  }

  const next = `${paneOutputBuffers.get(message.pane) ?? ""}${message.data}`;
  paneOutputBuffers.set(message.pane, next.slice(-maxPaneOutputBufferLength));
}

function rememberLatestMessage(
  latestMessages: Map<string, ServerToBrowserMessage>,
  message: ServerToBrowserMessage,
) {
  switch (message.type) {
    case "pane.meta":
    case "pane.status":
      latestMessages.set(`${message.type}:${message.pane}`, message);
      return;
    case "playbook.state":
    case "recording.state":
      latestMessages.set(message.type, message);
      return;
    case "pane.output":
    case "pane.screen.request":
    case "preview.error":
    case "preview.reset":
      return;
    default:
      message satisfies never;
  }
}

export function resetPreviewReplayState(
  latestMessages: Map<string, ServerToBrowserMessage>,
  paneOutputBuffers: Map<string, string>,
) {
  paneOutputBuffers.clear();
  for (const key of latestMessages.keys()) {
    if (key.startsWith("pane.")) {
      latestMessages.delete(key);
    }
  }
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

export function previewEntrySource(demoPath: string) {
  return `import "./style.css";
import { demo, render } from ${JSON.stringify(`/@fs/${toVitePath(demoPath)}`)};
import { renderPreviewApp } from "@akuederle/termdem/preview-client";

renderPreviewApp({
  panes: demo.panes,
  render,
  settings: demo.settings,
});
`;
}

export function clientShimSource() {
  return `export const keys = {
  ARROW_DOWN: "\\x1b[B",
  ARROW_LEFT: "\\x1b[D",
  ARROW_RIGHT: "\\x1b[C",
  ARROW_UP: "\\x1b[A",
  BACKSPACE: "\\x7f",
  CTRL_C: "\\x03",
  CTRL_D: "\\x04",
  CTRL_L: "\\x0c",
  DELETE: "\\x1b[3~",
  END: "\\x1b[F",
  ENTER: "\\r",
  ESC: "\\x1b",
  HOME: "\\x1b[H",
  PAGE_DOWN: "\\x1b[6~",
  PAGE_UP: "\\x1b[5~",
  SHIFT_TAB: "\\x1b[Z",
  TAB: "\\t",
};

export const typingDelays = {
  WPM_30: 400,
  WPM_60: 200,
  WPM_80: 150,
  WPM_120: 100,
};

export class Dir {
  constructor() {}
}

export class TmpDir extends Dir {
  constructor() {
    super();
  }
}

export function createTerminalDemo({ panes, script, settings = {}, setup, teardown }) {
  return {
    panes,
    script,
    settings,
    setup,
    teardown,
  };
}

export function quoteShellArg(value) {
  return \`'\${value.replaceAll("'", "'\\\\''")}'\`;
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
