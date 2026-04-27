import { startTransition, useEffect, useEffectEvent, useRef, useState } from "react";
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
type ScriptState = "idle" | "running" | "done" | "error";
type PaneName = keyof typeof paneSpecs;

type PaneScriptApi = {
  exec(command: string, options?: { typeDelayMs?: number }): Promise<ExecResult>;
};

type PaneSpec = {
  title: string;
  eyebrow: string;
  theme: PaneTheme;
  autoFocus?: boolean;
  script?: (api: PaneScriptApi) => Promise<void>;
};

type PendingExec = {
  reject: (error: Error) => void;
  resolve: (result: ExecResult) => void;
};

const paneSpecs = {
  a: {
    title: "a",
    eyebrow: "script",
    theme: "monokai",
    autoFocus: true,
    script: async (api: PaneScriptApi) => {
      const listing = await api.exec("command ls -1 --color=never", { typeDelayMs: 38 });
      const firstFile = listing.lines[0];
      if (!firstFile) {
        throw new Error("Expected the listing to contain at least one file");
      }

      await api.exec(`cat '${firstFile}'`, { typeDelayMs: 32 });
    },
  },
  b: {
    title: "b",
    eyebrow: "worker",
    theme: "solarized-dark",
    script: async (api: PaneScriptApi) => {
      await api.exec("pwd", { typeDelayMs: 16 });
      await api.exec("printf 'pane b ready\\n'", { typeDelayMs: 16 });
    },
  },
  c: {
    title: "c",
    eyebrow: "span",
    theme: "monokai",
    script: async (api: PaneScriptApi) => {
      await api.exec("printf 'pane c spans two rows\\n'", { typeDelayMs: 18 });
      await api.exec("date", { typeDelayMs: 18 });
    },
  },
} satisfies Record<string, PaneSpec>;

const demoScene = (
  <Stage>
    <main className="grid h-dvh min-h-0 grid-cols-1 grid-rows-3 gap-px bg-[#3a3a3a] text-slate-100 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] lg:grid-rows-2">
      <Pane name="a" className="min-h-0 min-w-0" />
      <Pane name="b" className="min-h-0 min-w-0 lg:row-start-2" />
      <Pane name="c" className="min-h-0 min-w-0 lg:col-start-2 lg:row-span-2 lg:row-start-1" />
    </main>
  </Stage>
);

const paneFrameClassName =
  "flex min-h-0 min-w-0 flex-col overflow-hidden bg-[#101010] text-slate-100";

function socketUrlForPane(paneName: string) {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const bridgeToken = getBridgeToken();
  return `${protocol}//${window.location.host}/panes/${paneName}?token=${encodeURIComponent(bridgeToken)}`;
}

function PaneTerminalCard({ pane }: { pane: PaneDefinition }) {
  const spec = getPaneSpec(pane.name);
  const {
    connectionKey,
    exec,
    focus,
    meta,
    reconnect,
    ref,
    requestResize,
    sendInput,
    status,
    write,
  } = usePaneConnection(pane.name);
  const [scriptState, setScriptState] = useState<ScriptState>("idle");
  const runningScriptKeyRef = useRef<number | null>(null);

  const runPaneScript = useEffectEvent(async () => {
    if (!spec.script) {
      return;
    }

    startTransition(() => {
      setScriptState("running");
    });

    try {
      await spec.script({ exec });
      startTransition(() => {
        setScriptState("done");
      });
    } catch (error) {
      startTransition(() => {
        setScriptState("error");
      });
      write(`\r\n\x1b[31m[script error] ${formatError(error)}\x1b[0m\r\n`);
    }
  });

  useEffect(() => {
    if (!spec.script || status !== "open" || !meta) {
      return;
    }

    if (runningScriptKeyRef.current === connectionKey) {
      return;
    }

    runningScriptKeyRef.current = connectionKey;
    void runPaneScript();
  }, [connectionKey, meta, spec.script, status]);

  return (
    <article className={`${paneFrameClassName} ${pane.className ?? ""}`} style={pane.style}>
      <header className="flex h-7 shrink-0 items-center justify-between gap-2 border-b border-[#3a3a3a] bg-[#1b1b1b] px-2 font-mono text-[11px] leading-none">
        <div className="flex min-w-0 items-center gap-2">
          <h2 className="m-0 text-[11px] font-semibold text-cyan-300">{spec.title}</h2>
          <span className="text-slate-500">{spec.eyebrow}</span>
          <span className={status === "open" ? "text-emerald-300" : "text-amber-200"}>
            {status}
          </span>
          <span className={scriptState === "done" ? "text-emerald-300" : "text-slate-400"}>
            {scriptState}
          </span>
          <span className="min-w-0 truncate text-slate-500">{meta?.cwd ?? "starting"}</span>
        </div>
        <button
          type="button"
          className="shrink-0 border-l border-[#3a3a3a] pl-2 text-slate-400 hover:text-white focus-visible:outline focus-visible:outline-1 focus-visible:outline-cyan-300"
          onClick={reconnect}
        >
          rerun
        </button>
      </header>

      <Terminal
        ref={ref}
        className="min-h-0 flex-1 overflow-hidden"
        theme={spec.theme}
        autoResize
        cursorBlink
        onReady={() => {
          if (spec.autoFocus) {
            focus();
          }
        }}
        onData={sendInput}
        onResize={requestResize}
      />
    </article>
  );
}

function usePaneConnection(paneName: string) {
  const socketRef = useRef<WebSocket | null>(null);
  const pendingExecsRef = useRef<PendingExec[]>([]);
  const { focus, ref, write } = useTerminal();
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

  const sendInput = useEffectEvent((data: string) => {
    try {
      sendMessage({
        type: "pane.input",
        pane: paneName,
        data,
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
    focus,
    meta,
    reconnect,
    ref,
    requestResize,
    sendInput,
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

function getPaneSpec(name: string) {
  const spec = paneSpecs[name as PaneName] as PaneSpec | undefined;
  if (!spec) {
    throw new Error(`Unknown pane "${name}"`);
  }

  return spec;
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

export default function App() {
  return (
    <>
      {renderStageScene(demoScene, (pane) => (
        <PaneTerminalCard key={pane.name} pane={pane} />
      ))}
    </>
  );
}
