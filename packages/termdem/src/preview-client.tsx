import { useEffect, useEffectEvent, useRef, useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { Terminal, useTerminal } from "@wterm/react";
import "@wterm/react/css";
import { parsePaneServerMessage, type PaneClientMessage } from "./protocol.ts";
import { collectPaneDefinitions, renderStageScene, type PaneDefinition } from "./scene.ts";
import type { ExecResult, PaneController, PressKey, TypeOptions } from "./types.ts";

type PreviewMode = "running" | "stopped";

type PreviewDemoModule = {
  render: (terminals: Record<string, { name: string }>) => ReactNode;
  script?: (api: { pane(name: string): PaneController }) => Promise<void> | void;
  terminals: Record<string, { name: string }>;
};

type PaneRuntime = PaneController & {
  connectionKey: number;
  ready: boolean;
  write(data: string): void;
};

type PendingAction = {
  reject: (error: Error) => void;
  resolve: () => void;
};

type PendingExec = {
  reject: (error: Error) => void;
  resolve: (result: ExecResult) => void;
};

type AwaitedPaneActionMessage =
  | {
      type: "pane.press";
      key: PressKey;
    }
  | {
      type: "pane.type";
      text: string;
      delayMs?: number;
    };

const paneFrameClassName =
  "flex min-h-0 min-w-0 flex-col overflow-hidden bg-[#101010] text-slate-100";

const ignoreTerminalInput = () => {};

export function renderPreviewApp(demo: PreviewDemoModule) {
  const rootElement = document.getElementById("root");
  if (!rootElement) {
    throw new Error("Missing #root element for termdem preview");
  }

  createRoot(rootElement).render(<PreviewApp demo={demo} />);
}

function PreviewApp({ demo }: { demo: PreviewDemoModule }) {
  const scene = useInitialValue(() => createDemoScene(demo));
  const paneNames = useInitialValue(() => collectPaneDefinitions(scene).map((pane) => pane.name));
  const initialPreviewMode = useInitialValue(() => readInitialPreviewMode());
  const paneRuntimesRef = useRef(new Map<string, PaneRuntime>());
  const playbookRunIdRef = useRef(0);
  const previewModeRef = useRef<PreviewMode>(initialPreviewMode);
  const resumeWaitersRef = useRef<Array<() => void>>([]);
  const runningPlaybookKeyRef = useRef<string | null>(null);
  const [overlayVisible, setOverlayVisible] = useState(false);
  const [previewMode, setPreviewMode] = useState<PreviewMode>(initialPreviewMode);
  const [runtimeVersion, setRuntimeVersion] = useState(0);
  const [sessionKey, setSessionKey] = useState(0);

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

  const onRuntimeChange = useEffectEvent((name: string, runtime: PaneRuntime) => {
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
    markRecordingDone(false);
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
    markRecordingStarted();

    if (!demo.script) {
      markRecordingDone(true);
      return;
    }

    try {
      await demo.script(
        createPlaybookApi(paneRuntimesRef.current, () => waitForPlaybookActive(runId)),
      );
      if (runId === playbookRunIdRef.current) {
        markRecordingDone(true);
      }
    } catch (error) {
      if (runId !== playbookRunIdRef.current || formatError(error) === "Playbook restarted") {
        return;
      }

      const firstPane = paneRuntimesRef.current.get(paneNames[0] ?? "");
      const message = formatError(error);
      firstPane?.write(`\r\n\x1b[31m[playbook error] ${message}\x1b[0m\r\n`);
      markRecordingError(message);
    }
  });

  useEffect(() => {
    markRecordingDone(false);
  }, []);

  useEffect(() => {
    globalThis.__termdem = {
      ...globalThis.__termdem,
      controls: {
        start: resumePlaybook,
      },
    };

    return () => {
      if (globalThis.__termdem?.controls?.start === resumePlaybook) {
        delete globalThis.__termdem.controls;
      }
    };
  }, [resumePlaybook]);

  useEffect(() => {
    const runtimes = paneRuntimesRef.current;
    markRecordingReady(paneNames.every((name) => runtimes.get(name)?.ready));
  }, [paneNames, runtimeVersion]);

  useEffect(() => {
    if (previewMode !== "running") {
      return;
    }

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
  }, [paneNames, previewMode, runPlaybook, runtimeVersion]);

  return (
    <>
      {renderStageScene(scene, (pane) => (
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

function PaneTerminalCard({
  onRuntimeChange,
  pane,
}: {
  onRuntimeChange: (name: string, runtime: PaneRuntime) => void;
  pane: PaneDefinition;
}) {
  const { connectionKey, exec, press, ref, requestResize, status, type, write } = usePaneConnection(
    pane.name,
  );

  useEffect(() => {
    onRuntimeChange(pane.name, {
      connectionKey,
      exec,
      press,
      ready: status === "open",
      type,
      write,
    });
  }, [connectionKey, pane.name, status]);

  return (
    <article className={`${paneFrameClassName} ${pane.className ?? ""}`} style={pane.style}>
      <header className="flex h-6 shrink-0 items-center border-b border-[#2f2f2f] bg-[#1b1b1b] px-2 font-mono text-[11px] font-semibold leading-none text-cyan-300">
        {pane.name}
      </header>

      <Terminal
        ref={ref}
        aria-readonly
        className="pointer-events-none min-h-0 flex-1 select-none overflow-hidden !rounded-none"
        cols={20}
        rows={8}
        style={{ padding: 0 }}
        theme="monokai"
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
  const actionIdRef = useRef(0);
  const latestResizeRef = useRef<{ cols: number; rows: number } | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const pendingActionsRef = useRef(new Map<string, PendingAction>());
  const pendingExecsRef = useRef<PendingExec[]>([]);
  const { ref, write } = useTerminal();
  const connectionKey = 0;
  const [status, setStatus] = useState<"connecting" | "open" | "closed" | "error">("connecting");

  const rejectPendingWork = useEffectEvent((error: Error) => {
    const pendingActions = [...pendingActionsRef.current.values()];
    pendingActionsRef.current.clear();
    for (const pendingAction of pendingActions) {
      pendingAction.reject(error);
    }

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

  const sendAction = useEffectEvent((message: AwaitedPaneActionMessage) => {
    return new Promise<void>((resolve, reject) => {
      const id = `${paneName}:${actionIdRef.current++}`;
      pendingActionsRef.current.set(id, { resolve, reject });

      try {
        sendMessage({ ...message, id, pane: paneName } as PaneClientMessage);
      } catch (error) {
        pendingActionsRef.current.delete(id);
        reject(error instanceof Error ? error : new Error("Failed to send pane action"));
      }
    });
  });

  const sendLatestResize = useEffectEvent(() => {
    const latestResize = latestResizeRef.current;
    if (!latestResize) {
      return;
    }

    sendMessage({
      type: "pane.resize",
      pane: paneName,
      cols: latestResize.cols,
      rows: latestResize.rows,
    });
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

  const press = useEffectEvent((key: PressKey) => {
    return sendAction({
      type: "pane.press",
      key,
    });
  });

  const requestResize = useEffectEvent((cols: number, rows: number) => {
    latestResizeRef.current = { cols, rows };

    try {
      sendLatestResize();
    } catch {}
  });

  const type = useEffectEvent((text: string, options?: TypeOptions) => {
    return sendAction({
      type: "pane.type",
      text,
      delayMs: options?.delayMs,
    });
  });

  const handleServerMessage = useEffectEvent((raw: string) => {
    const message = parsePaneServerMessage(raw);
    if (!message || message.pane !== paneName) {
      return;
    }

    switch (message.type) {
      case "pane.meta":
        sendLatestResize();
        setStatus("open");
        return;
      case "pane.output":
        write(message.data);
        setStatus((currentStatus) => (currentStatus === "error" ? currentStatus : "open"));
        return;
      case "pane.action.completed":
        pendingActionsRef.current.get(message.id)?.resolve();
        pendingActionsRef.current.delete(message.id);
        return;
      case "pane.exec.completed":
        pendingExecsRef.current.shift()?.resolve(message.result);
        return;
      case "pane.exit":
        setStatus("closed");
        write(
          `\r\n\x1b[33m[pane exited: code=${message.exitCode ?? "null"}, signal=${message.signal ?? "null"}]\x1b[0m\r\n`,
        );
        rejectPendingWork(new Error(`Pane ${paneName} exited`));
        return;
      case "pane.error":
        setStatus("error");
        write(`\r\n\x1b[31m[pane error] ${message.message}\x1b[0m\r\n`);
        rejectPendingWork(new Error(message.message));
        return;
      default:
        return;
    }
  });

  useEffect(() => {
    setStatus("connecting");

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

      rejectPendingWork(new Error(`Pane ${paneName} disconnected`));
      setStatus((currentStatus) => (currentStatus === "error" ? "error" : "closed"));
    };

    return () => {
      if (socketRef.current === socket) {
        socketRef.current = null;
      }

      rejectPendingWork(new Error(`Pane ${paneName} disconnected`));
      socket.close();
    };
  }, [paneName]);

  return {
    connectionKey,
    exec,
    press,
    ref,
    requestResize,
    status,
    type,
    write,
  };
}

function createPlaybookApi(
  runtimes: Map<string, PaneRuntime>,
  waitForPlaybookActive: () => Promise<void>,
) {
  return {
    pane(name: string): PaneController {
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
        async press(key) {
          await waitForPlaybookActive();
          await runtime.press(key);
          await waitForPlaybookActive();
        },
        async type(text, options) {
          await waitForPlaybookActive();
          await runtime.type(text, options);
          await waitForPlaybookActive();
        },
      };
    },
  };
}

function createDemoScene(demo: PreviewDemoModule) {
  return demo.render(demo.terminals);
}

function socketUrlForPane(paneName: string) {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const bridgeToken = getBridgeToken();
  return `${protocol}//${window.location.host}/panes/${paneName}?token=${encodeURIComponent(bridgeToken)}`;
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

function useInitialValue<T>(createValue: () => T) {
  const valueRef = useRef<{ value: T } | null>(null);
  if (!valueRef.current) {
    valueRef.current = { value: createValue() };
  }

  return valueRef.current.value;
}

function readInitialPreviewMode(): PreviewMode {
  if (globalThis.location?.search) {
    const params = new URLSearchParams(globalThis.location.search);
    if (params.get("termdem_autostart") === "0") {
      return "stopped";
    }
  }

  return "running";
}

function markRecordingReady(ready: boolean) {
  globalThis.__termdem = {
    ...globalThis.__termdem,
    recording: {
      ...globalThis.__termdem?.recording,
      ready,
    },
  };
}

function markRecordingStarted() {
  globalThis.__termdem = {
    ...globalThis.__termdem,
    recording: {
      ...globalThis.__termdem?.recording,
      done: false,
      error: undefined,
    },
  };
}

function markRecordingDone(done: boolean) {
  globalThis.__termdem = {
    ...globalThis.__termdem,
    recording: {
      ...globalThis.__termdem?.recording,
      done,
      error: done ? undefined : globalThis.__termdem?.recording?.error,
    },
  };
}

function markRecordingError(error: string) {
  globalThis.__termdem = {
    ...globalThis.__termdem,
    recording: {
      ...globalThis.__termdem?.recording,
      error,
    },
  };
}

function formatError(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

declare global {
  var __termdem:
    | {
        controls?: {
          start?: () => void;
        };
        recording?: {
          done?: boolean;
          error?: string;
          ready?: boolean;
        };
      }
    | undefined;
}
