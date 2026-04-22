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
  note: string;
  footer: string;
  theme: PaneTheme;
  autoFocus?: boolean;
  script?: (api: PaneScriptApi) => Promise<void>;
};

type PendingExec = {
  reject: (error: Error) => void;
  resolve: (result: ExecResult) => void;
};

const paneSpecs = {
  main: {
    title: "validation",
    eyebrow: "Scripted Pane",
    note: "Runs ls, prunes lines, then cats the first listed file.",
    footer: "isolated demo workspace with alpha.txt and bravo.txt",
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
  support: {
    title: "support",
    eyebrow: "Second Pane",
    note: "Independent PTY proving the scene can mount multiple named panes.",
    footer: "repo-root pane running its own script sequence",
    theme: "solarized-dark",
    script: async (api: PaneScriptApi) => {
      await api.exec("pwd", { typeDelayMs: 16 });
      await api.exec("printf 'secondary pane ready\\n'", { typeDelayMs: 16 });
    },
  },
} satisfies Record<string, PaneSpec>;

const demoScene = (
  <Stage>
    <section className="terminal-grid">
      <Pane name="main" className="terminal-card terminal-card--feature" />
      <Pane name="support" className="terminal-card" />
    </section>
  </Stage>
);

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
  }, [connectionKey, meta, runPaneScript, spec.script, status]);

  return (
    <article className={pane.className} style={pane.style}>
      <header className="terminal-header">
        <div>
          <p className="terminal-eyebrow">{spec.eyebrow}</p>
          <h2>{spec.title}</h2>
        </div>
        <button type="button" className="reconnect-button" onClick={reconnect}>
          reconnect
        </button>
      </header>

      <div className="terminal-meta">
        <span data-status={status}>{status}</span>
        <span data-script={scriptState}>{scriptState}</span>
        <span>{spec.note}</span>
      </div>

      <Terminal
        ref={ref}
        className="terminal-surface"
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

      <footer className="terminal-footer">
        <span>{meta?.cwd ?? "waiting for pane session"}</span>
        <span>{spec.footer}</span>
      </footer>
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
  }, [connectionKey, handleServerMessage, paneName, rejectPendingExecs]);

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
    <main className="page-shell">
      <section className="hero">
        <p className="kicker">Validation Demo</p>
        <h1>Named panes, real PTYs, scripted command chaining</h1>
        <p className="lede">
          This page renders a TSX scene made from <code>Stage</code> and <code>Pane</code>, then
          mounts each pane into a dedicated <code>@wterm/react</code> terminal. The main pane runs
          the first validation script end to end: <code>ls</code>, prune the returned lines, and
          <code>cat</code> the first file.
        </p>
      </section>

      {renderStageScene(demoScene, (pane) => (
        <PaneTerminalCard key={pane.name} pane={pane} />
      ))}
    </main>
  );
}
