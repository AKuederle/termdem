import { useEffect, useEffectEvent, useRef, useState } from "react";
import { Terminal, useTerminal } from "@wterm/react";
import "@wterm/react/css";
import {
  parsePaneServerMessage,
  type PaneClientMessage,
} from "../../../packages/termdem/src/protocol.ts";
import {
  Pane,
  renderStageScene,
  Stage,
  type PaneDefinition,
} from "../../../packages/termdem/src/scene.ts";
import type { ExecResult } from "../../../packages/termdem/src/types.ts";

type PaneTheme = "light" | "monokai" | "solarized-dark";
type PaneStatus = "connecting" | "open" | "closed" | "error";
type PaneName = keyof typeof paneSpecs;
type PreviewMode = "running" | "stopped";

type PaneScriptApi = {
  exec(command: string, options?: { typeDelayMs?: number }): Promise<ExecResult>;
};

type PaneSpec = {
  title: string;
  theme: PaneTheme;
};

type PanePlaybookApi = {
  pane: (name: PaneName) => PaneScriptApi;
};

type PaneRuntime = PaneScriptApi & {
  connectionKey: number;
  ready: boolean;
  write(data: string): void;
};

type PendingExec = {
  reject: (error: Error) => void;
  resolve: (result: ExecResult) => void;
};

const paneSpecs = {
  A: {
    title: "A",
    theme: "monokai",
  },
  B: {
    title: "B",
    theme: "solarized-dark",
  },
  C: {
    title: "C",
    theme: "monokai",
  },
} satisfies Record<string, PaneSpec>;

async function demoPlaybook(api: PanePlaybookApi) {
  const listing = await api.pane("A").exec("command ls -1 --color=never", { typeDelayMs: 38 });
  const file = listing.lines[0];
  if (!file) {
    throw new Error("Expected pane A listing to contain at least one file");
  }

  await api.pane("B").exec(`cat ${quoteShellArg(file)}`, { typeDelayMs: 32 });
  await api.pane("C").exec(`printf 'pane B read %s\\n' ${quoteShellArg(file)}`, {
    typeDelayMs: 18,
  });
}

const demoScene = (
  <Stage>
    <main className="grid h-dvh min-h-0 grid-cols-1 grid-rows-3 gap-px bg-[#3a3a3a] text-slate-100 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] lg:grid-rows-2">
      <Pane name="A" className="min-h-0 min-w-0" />
      <Pane name="B" className="min-h-0 min-w-0 lg:row-start-2" />
      <Pane name="C" className="min-h-0 min-w-0 lg:col-start-2 lg:row-span-2 lg:row-start-1" />
    </main>
  </Stage>
);

const paneFrameClassName =
  "flex min-h-0 min-w-0 flex-col overflow-hidden bg-[#101010] text-slate-100";

const ignoreTerminalInput = () => {};

function socketUrlForPane(paneName: string) {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const bridgeToken = getBridgeToken();
  return `${protocol}//${window.location.host}/panes/${paneName}?token=${encodeURIComponent(bridgeToken)}`;
}

function PaneTerminalCard({
  onRuntimeChange,
  pane,
}: {
  onRuntimeChange: (name: PaneName, runtime: PaneRuntime) => void;
  pane: PaneDefinition;
}) {
  const spec = getPaneSpec(pane.name);
  const { connectionKey, exec, meta, ref, requestResize, status, write } = usePaneConnection(
    pane.name,
  );

  useEffect(() => {
    onRuntimeChange(pane.name as PaneName, {
      connectionKey,
      exec,
      ready: status === "open" && Boolean(meta),
      write,
    });
  }, [connectionKey, meta, pane.name, status]);

  return (
    <article className={`${paneFrameClassName} ${pane.className ?? ""}`} style={pane.style}>
      <header className="flex h-7 shrink-0 items-center justify-between gap-2 border-b border-[#3a3a3a] bg-[#1b1b1b] px-2 font-mono text-[11px] leading-none">
        <h2 className="m-0 text-[11px] font-semibold text-cyan-300">{spec.title}</h2>
      </header>

      <Terminal
        ref={ref}
        aria-readonly
        className="pointer-events-none min-h-0 flex-1 select-none overflow-hidden !rounded-none"
        theme={spec.theme}
        autoResize
        cursorBlink
        onData={ignoreTerminalInput}
        onResize={requestResize}
        tabIndex={-1}
      />
    </article>
  );
}

function usePaneConnection(paneName: string) {
  const socketRef = useRef<WebSocket | null>(null);
  const pendingExecsRef = useRef<PendingExec[]>([]);
  const { ref, write } = useTerminal();
  const [connectionKey, setConnectionKey] = useState(0);
  const [meta, setMeta] = useState<{ cwd: string; prompt: string; shell: string } | null>(null);
  const [status, setStatus] = useState<PaneStatus>("connecting");

  const rejectPendingExecs = useEffectEvent((error: Error) => {
    const pendingExecs = pendingExecsRef.current.splice(0);
    for (const pendingExec of pendingExecs) {
      pendingExec.reject(error);
    }
  });

  const sendMessage = useEffectEvent((message: PaneClientMessage) => {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      throw new Error(`Pane ${paneName} is not connected`);
    }

    socket.send(JSON.stringify(message));
  });

  const exec = useEffectEvent((command: string, options?: { typeDelayMs?: number }) => {
    return new Promise<ExecResult>((resolve, reject) => {
      pendingExecsRef.current.push({ resolve, reject });

      try {
        sendMessage({
          type: "pane.exec",
          pane: paneName,
          command,
          typeDelayMs: options?.typeDelayMs,
        });
      } catch (error) {
        pendingExecsRef.current.pop();
        reject(error instanceof Error ? error : new Error("Failed to send pane.exec"));
      }
    });
  });

  const requestResize = useEffectEvent((cols: number, rows: number) => {
    try {
      sendMessage({
        type: "pane.resize",
        pane: paneName,
        cols,
        rows,
      });
    } catch {}
  });

  const handleServerMessage = useEffectEvent((raw: string) => {
    const message = parsePaneServerMessage(raw);
    if (!message || message.pane !== paneName) {
      return;
    }

    switch (message.type) {
      case "pane.meta":
        setMeta({
          cwd: message.cwd,
          prompt: message.prompt,
          shell: message.shell,
        });
        setStatus("open");
        return;
      case "pane.output":
        write(message.data);
        setStatus((currentStatus) => (currentStatus === "error" ? currentStatus : "open"));
        return;
      case "pane.exec.completed":
        pendingExecsRef.current.shift()?.resolve(message.result);
        return;
      case "pane.exit":
        setStatus("closed");
        write(
          `\r\n\x1b[33m[pane exited: code=${message.exitCode ?? "null"}, signal=${message.signal ?? "null"}]\x1b[0m\r\n`,
        );
        rejectPendingExecs(new Error(`Pane ${paneName} exited`));
        return;
      case "pane.error":
        setStatus("error");
        write(`\r\n\x1b[31m[pane error] ${message.message}\x1b[0m\r\n`);
        rejectPendingExecs(new Error(message.message));
        return;
      default:
        return;
    }
  });

  useEffect(() => {
    setStatus("connecting");
    setMeta(null);

    const socket = new WebSocket(socketUrlForPane(paneName));
    socketRef.current = socket;

    socket.onmessage = (event) => {
      if (typeof event.data === "string") {
        handleServerMessage(event.data);
      }
    };

    socket.onerror = () => {
      setStatus("error");
    };

    socket.onclose = () => {
      if (socketRef.current === socket) {
        socketRef.current = null;
      }

      rejectPendingExecs(new Error(`Pane ${paneName} disconnected`));
      setStatus((currentStatus) => (currentStatus === "error" ? "error" : "closed"));
    };

    return () => {
      if (socketRef.current === socket) {
        socketRef.current = null;
      }

      rejectPendingExecs(new Error(`Pane ${paneName} disconnected`));
      socket.close();
    };
  }, [connectionKey, paneName]);

  const reconnect = useEffectEvent(() => {
    setConnectionKey((value) => value + 1);
  });

  return {
    connectionKey,
    exec,
    meta,
    reconnect,
    ref,
    requestResize,
    status,
    write,
  };
}

function formatError(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

function createPlaybookApi(
  runtimes: Map<PaneName, PaneRuntime>,
  waitForPlaybookActive: () => Promise<void>,
): PanePlaybookApi {
  return {
    pane(name) {
      const runtime = runtimes.get(name);
      if (!runtime?.ready) {
        throw new Error(`Pane "${name}" is not ready`);
      }

      return {
        async exec(command, options) {
          await waitForPlaybookActive();
          const result = await runtime.exec(command, options);
          await waitForPlaybookActive();
          return result;
        },
      };
    },
  };
}

function getPaneSpec(name: string) {
  const spec = paneSpecs[name as PaneName] as PaneSpec | undefined;
  if (!spec) {
    throw new Error(`Unknown pane "${name}"`);
  }

  return spec;
}

function quoteShellArg(value: string) {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function getBridgeToken() {
  const token = document
    .querySelector('meta[name="termdem-bridge-token"]')
    ?.getAttribute("content");
  if (!token) {
    throw new Error("Missing termdem bridge token");
  }

  return token;
}

function PreviewOverlay({
  mode,
  onHide,
  onRestart,
  onResume,
  onStop,
}: {
  mode: PreviewMode;
  onHide: () => void;
  onRestart: () => void;
  onResume: () => void;
  onStop: () => void;
}) {
  return (
    <div className="fixed right-3 top-3 z-50 flex items-center gap-2 border border-cyan-300/30 bg-black/80 px-2 py-1 font-mono text-[11px] text-slate-200 shadow-xl shadow-black/30 backdrop-blur">
      <span className="text-cyan-300">termdem</span>
      <span className={mode === "running" ? "text-emerald-300" : "text-amber-200"}>{mode}</span>
      {mode === "running" ? (
        <button className="text-slate-300 hover:text-white" type="button" onClick={onStop}>
          stop
        </button>
      ) : (
        <button className="text-slate-300 hover:text-white" type="button" onClick={onResume}>
          resume
        </button>
      )}
      <button className="text-slate-300 hover:text-white" type="button" onClick={onRestart}>
        restart
      </button>
      <button className="text-slate-500 hover:text-white" type="button" onClick={onHide}>
        hide
      </button>
    </div>
  );
}

export default function App() {
  const paneRuntimesRef = useRef(new Map<PaneName, PaneRuntime>());
  const playbookRunIdRef = useRef(0);
  const previewModeRef = useRef<PreviewMode>("running");
  const resumeWaitersRef = useRef<Array<() => void>>([]);
  const [runtimeVersion, setRuntimeVersion] = useState(0);
  const [overlayVisible, setOverlayVisible] = useState(false);
  const [previewMode, setPreviewMode] = useState<PreviewMode>("running");
  const [sessionKey, setSessionKey] = useState(0);
  const runningPlaybookKeyRef = useRef<string | null>(null);

  useEffect(() => {
    previewModeRef.current = previewMode;
  }, [previewMode]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key === ".") {
        event.preventDefault();
        setOverlayVisible((visible) => !visible);
        return;
      }

      if (event.key === "Escape") {
        setOverlayVisible(false);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  const onRuntimeChange = useEffectEvent((name: PaneName, runtime: PaneRuntime) => {
    paneRuntimesRef.current.set(name, runtime);
    setRuntimeVersion((version) => version + 1);
  });

  const resumePlaybook = useEffectEvent(() => {
    previewModeRef.current = "running";
    setPreviewMode("running");

    const waiters = resumeWaitersRef.current.splice(0);
    for (const resolve of waiters) {
      resolve();
    }
  });

  const stopPlaybook = useEffectEvent(() => {
    previewModeRef.current = "stopped";
    setPreviewMode("stopped");
  });

  const restartPreview = useEffectEvent(() => {
    playbookRunIdRef.current += 1;
    paneRuntimesRef.current.clear();
    runningPlaybookKeyRef.current = null;
    resumePlaybook();

    const waiters = resumeWaitersRef.current.splice(0);
    for (const resolve of waiters) {
      resolve();
    }

    setRuntimeVersion((version) => version + 1);
    setSessionKey((key) => key + 1);
  });

  const waitForPlaybookActive = useEffectEvent(async (runId: number) => {
    while (previewModeRef.current !== "running") {
      if (playbookRunIdRef.current !== runId) {
        throw new Error("Playbook restarted");
      }

      await new Promise<void>((resolve) => {
        resumeWaitersRef.current.push(resolve);
      });
    }

    if (playbookRunIdRef.current !== runId) {
      throw new Error("Playbook restarted");
    }
  });

  const runPlaybook = useEffectEvent(async (runId: number) => {
    try {
      await demoPlaybook(
        createPlaybookApi(paneRuntimesRef.current, () => {
          return waitForPlaybookActive(runId);
        }),
      );
    } catch (error) {
      if (runId !== playbookRunIdRef.current || formatError(error) === "Playbook restarted") {
        return;
      }

      const firstPane = paneRuntimesRef.current.get("A");
      firstPane?.write(`\r\n\x1b[31m[playbook error] ${formatError(error)}\x1b[0m\r\n`);
    }
  });

  useEffect(() => {
    if (previewMode !== "running") {
      return;
    }

    const paneNames = Object.keys(paneSpecs) as PaneName[];
    const runtimes = paneRuntimesRef.current;
    if (!paneNames.every((name) => runtimes.get(name)?.ready)) {
      return;
    }

    const playbookKey = paneNames.map((name) => runtimes.get(name)?.connectionKey).join(":");
    if (runningPlaybookKeyRef.current === playbookKey) {
      return;
    }

    runningPlaybookKeyRef.current = playbookKey;
    void runPlaybook(playbookRunIdRef.current);
  }, [previewMode, runtimeVersion]);

  return (
    <>
      {renderStageScene(demoScene, (pane) => (
        <PaneTerminalCard
          key={`${sessionKey}:${pane.name}`}
          onRuntimeChange={onRuntimeChange}
          pane={pane}
        />
      ))}
      {overlayVisible ? (
        <PreviewOverlay
          mode={previewMode}
          onHide={() => {
            setOverlayVisible(false);
          }}
          onRestart={() => {
            restartPreview();
          }}
          onResume={() => {
            resumePlaybook();
          }}
          onStop={() => {
            stopPlaybook();
          }}
        />
      ) : null}
    </>
  );
}
