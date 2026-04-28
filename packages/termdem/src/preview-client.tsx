import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createRoot } from "react-dom/client";
import { Terminal, useTerminal } from "@wterm/react";
import "@wterm/react/css";
import {
  parseServerToBrowserMessage,
  type BrowserToServerMessage,
  type ServerToBrowserMessage,
} from "./protocol.ts";
import { flushQueuedPreviewMessages, queueOrSendPreviewMessage } from "./preview-socket.ts";
import type { DemoSize, RecordingConfig } from "./recording-config.ts";
import type { TerminalPaneComponent, TerminalPaneProps } from "./terminal-demo.ts";

type PreviewDemoModule = {
  panes: readonly { name: string }[];
  render: (panes: Record<string, TerminalPaneComponent>) => ReactNode;
  settings: RecordingConfig;
};

type PreviewSocketContextValue = {
  addPaneListener(name: string, listener: (message: ServerToBrowserMessage) => void): () => void;
  send(message: BrowserToServerMessage): void;
};

const paneFrameClassName =
  "flex min-h-0 min-w-0 flex-col overflow-hidden bg-[#101010] text-slate-100";

const CurrentPaneNameContext = createContext<string | null>(null);
const PreviewSocketContext = createContext<PreviewSocketContextValue | null>(null);

export function paneFrameDataAttributes(name: string, isCurrent: boolean) {
  return {
    "data-termdem-current": isCurrent ? "" : undefined,
    "data-termdem-pane": name,
  };
}

export function renderPreviewApp(demo: PreviewDemoModule) {
  const rootElement = document.getElementById("root");
  if (!rootElement) {
    throw new Error("Missing #root element for termdem preview");
  }

  createRoot(rootElement).render(<PreviewRoot demo={demo} />);
}

function PreviewRoot({ demo }: { demo: PreviewDemoModule }) {
  const frameSize = previewFrameSize(demo.settings);
  if (frameSize && !readEmbeddedPreview()) {
    return <FixedPreviewFrame size={frameSize} />;
  }

  return <PreviewApp demo={demo} />;
}

function FixedPreviewFrame({ size }: { size: DemoSize }) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  useEffect(() => {
    const sync = () => {
      syncEmbeddedPreviewState(iframeRef.current);
    };

    sync();
    const interval = setInterval(sync, 50);
    return () => {
      clearInterval(interval);
      delete globalThis.__termdem?.controls;
      delete globalThis.__termdem?.recording;
    };
  }, []);

  return (
    <main className="flex h-dvh w-dvw items-center justify-center overflow-auto bg-[#111]">
      <iframe
        ref={iframeRef}
        className="shrink-0 border-0 bg-[#111]"
        height={size.height}
        onLoad={() => {
          syncEmbeddedPreviewState(iframeRef.current);
        }}
        src={embeddedPreviewUrl()}
        title="termdem preview"
        width={size.width}
      />
    </main>
  );
}

export function previewFrameSize(config: RecordingConfig): DemoSize | null {
  return config.viewportSize ?? config.size ?? null;
}

function syncEmbeddedPreviewState(iframe: HTMLIFrameElement | null) {
  const embeddedWindow = iframe?.contentWindow as
    | (Window & { __termdem?: typeof globalThis.__termdem })
    | null
    | undefined;
  const embeddedTermdem = embeddedWindow?.__termdem;
  globalThis.__termdem = {
    ...globalThis.__termdem,
    controls: {
      restart: () => embeddedTermdem?.controls?.restart?.(),
      start: () => embeddedTermdem?.controls?.start?.(),
      stop: () => embeddedTermdem?.controls?.stop?.(),
    },
    recording: embeddedTermdem?.recording,
  };
}

function PreviewApp({ demo }: { demo: PreviewDemoModule }) {
  const paneNames = useInitialValue(() => paneNamesFromTerminalDefinitions(demo.panes));
  const initialAutostart = useInitialValue(() => readInitialAutostart());
  const [currentPaneName, setCurrentPaneName] = useState<string | null>(null);
  const [overlayVisible, setOverlayVisible] = useState(false);
  const [socketStatus, setSocketStatus] = useState<"connecting" | "open" | "closed" | "error">(
    "connecting",
  );
  const listenersRef = useRef(new Map<string, Set<(message: ServerToBrowserMessage) => void>>());
  const pendingMessagesRef = useRef<BrowserToServerMessage[]>([]);
  const socketRef = useRef<WebSocket | null>(null);

  const send = useEffectEvent((message: BrowserToServerMessage) => {
    queueOrSendPreviewMessage(socketRef.current, pendingMessagesRef.current, message);
  });

  const addPaneListener = useCallback(
    (name: string, listener: (message: ServerToBrowserMessage) => void) => {
      let listeners = listenersRef.current.get(name);
      if (!listeners) {
        listeners = new Set();
        listenersRef.current.set(name, listeners);
      }

      listeners.add(listener);
      return () => {
        listeners?.delete(listener);
      };
    },
    [],
  );

  const socketContext = useMemo(
    () => ({
      addPaneListener,
      send,
    }),
    [addPaneListener, send],
  );

  const paneComponents = useMemo(() => createPaneComponents(paneNames), [paneNames]);

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

  useEffect(() => {
    const socket = new WebSocket(previewSocketUrl());
    socketRef.current = socket;
    setSocketStatus("connecting");

    socket.onopen = () => {
      setSocketStatus("open");
      flushQueuedPreviewMessages(socket, pendingMessagesRef.current);
      if (initialAutostart) {
        socket.send(JSON.stringify({ type: "playbook.start" }));
      }
    };

    socket.onerror = () => {
      setSocketStatus("error");
      markRecordingError("Preview socket failed");
    };

    socket.onclose = () => {
      if (socketRef.current === socket) {
        socketRef.current = null;
      }
      setSocketStatus((status) => (status === "error" ? "error" : "closed"));
    };

    socket.onmessage = (event) => {
      if (typeof event.data !== "string") {
        return;
      }

      const message = parseServerToBrowserMessage(event.data);
      if (!message) {
        return;
      }

      switch (message.type) {
        case "pane.output":
        case "pane.meta":
        case "pane.status": {
          const listeners = listenersRef.current.get(message.pane);
          for (const listener of listeners ?? []) {
            listener(message);
          }
          return;
        }
        case "playbook.state":
          if (message.state === "running") {
            setCurrentPaneName(paneNameFromAction(message.action) ?? currentPaneName);
          }
          if (message.state === "error") {
            markRecordingError(message.error ?? "Playbook failed");
          }
          return;
        case "recording.state":
          updateRecordingState(message);
          return;
        case "preview.error":
          markRecordingError(message.message);
          return;
        default:
          message satisfies never;
      }
    };

    return () => {
      if (socketRef.current === socket) {
        socketRef.current = null;
      }
      pendingMessagesRef.current = [];
      socket.close();
    };
  }, [initialAutostart]);

  useEffect(() => {
    globalThis.__termdem = {
      ...globalThis.__termdem,
      controls: {
        restart: () => send({ type: "playbook.restart" }),
        start: () => send({ type: "playbook.start" }),
        stop: () => send({ type: "playbook.stop" }),
      },
    };

    return () => {
      delete globalThis.__termdem?.controls;
    };
  }, [send]);

  return (
    <PreviewSocketContext value={socketContext}>
      <CurrentPaneNameContext value={currentPaneName}>
        {demo.render(paneComponents)}
      </CurrentPaneNameContext>
      {overlayVisible ? (
        <PreviewOverlay
          mode={socketStatus}
          onHide={() => {
            setOverlayVisible(false);
          }}
          onRestart={() => send({ type: "playbook.restart" })}
          onStart={() => send({ type: "playbook.start" })}
          onStop={() => send({ type: "playbook.stop" })}
        />
      ) : null}
    </PreviewSocketContext>
  );
}

function PaneTerminalCard({
  className,
  name,
  style,
}: {
  className?: string;
  name: string;
  style?: TerminalPaneProps["style"];
}) {
  const currentPaneName = useContext(CurrentPaneNameContext);
  const previewSocket = usePreviewSocket();
  const { ref, write } = useTerminal();
  const [status, setStatus] = useState("connecting");

  const handleMessage = useEffectEvent((message: ServerToBrowserMessage) => {
    switch (message.type) {
      case "pane.meta":
        setStatus("ready");
        return;
      case "pane.output":
        write(message.data);
        return;
      case "pane.status":
        setStatus(message.status);
        if (message.status === "error") {
          write(`\r\n\x1b[31m[pane error] ${message.message ?? "unknown error"}\x1b[0m\r\n`);
        }
        return;
      default:
        return;
    }
  });

  useEffect(() => previewSocket.addPaneListener(name, handleMessage), [handleMessage, name]);

  return (
    <article
      {...paneFrameDataAttributes(name, currentPaneName === name)}
      className={`${paneFrameClassName} ${className ?? ""}`}
      style={style}
    >
      <header className="flex h-6 shrink-0 items-center border-b border-[#2f2f2f] bg-[#1b1b1b] px-2 font-mono text-[11px] font-semibold leading-none text-cyan-300">
        {name}
      </header>

      <Terminal
        ref={ref}
        aria-label={`${name} terminal (${status})`}
        className="min-h-0 flex-1 overflow-hidden !rounded-none"
        cols={20}
        rows={8}
        style={{ padding: 0 }}
        theme="monokai"
        autoResize
        cursorBlink
        onData={(data) => {
          previewSocket.send({ type: "pane.input", pane: name, data });
        }}
        onResize={(cols, rows) => {
          previewSocket.send({ type: "pane.resize", pane: name, cols, rows });
        }}
        tabIndex={0}
      />
    </article>
  );
}

function createPaneComponents(paneNames: string[]) {
  const panes = Object.fromEntries(
    paneNames.map((name) => {
      function TermdemPane({ className, style }: TerminalPaneProps) {
        return <PaneTerminalCard className={className} name={name} style={style} />;
      }

      TermdemPane.displayName = `TermdemPane(${name})`;
      return [name, TermdemPane];
    }),
  );

  return panes as Record<string, TerminalPaneComponent>;
}

function PreviewOverlay({
  mode,
  onHide,
  onRestart,
  onStart,
  onStop,
}: {
  mode: string;
  onHide: () => void;
  onRestart: () => void;
  onStart: () => void;
  onStop: () => void;
}) {
  return (
    <div className="fixed right-4 top-4 z-50 flex items-center gap-2 rounded bg-black/80 p-2 font-mono text-xs text-white shadow-lg">
      <span>{mode}</span>
      <button className="rounded bg-cyan-600 px-2 py-1" type="button" onClick={onStart}>
        Start
      </button>
      <button className="rounded bg-slate-700 px-2 py-1" type="button" onClick={onRestart}>
        Restart
      </button>
      <button className="rounded bg-slate-700 px-2 py-1" type="button" onClick={onStop}>
        Stop
      </button>
      <button className="rounded bg-slate-700 px-2 py-1" type="button" onClick={onHide}>
        Close
      </button>
    </div>
  );
}

function paneNamesFromTerminalDefinitions(terminalDefinitions: readonly { name: string }[]) {
  const paneNames: string[] = [];
  const seenNames = new Set<string>();

  for (const terminal of terminalDefinitions) {
    if (seenNames.has(terminal.name)) {
      throw new Error(`Duplicate terminal name "${terminal.name}"`);
    }

    seenNames.add(terminal.name);
    paneNames.push(terminal.name);
  }

  return paneNames;
}

function previewSocketUrl() {
  const url = new URL("/preview", window.location.href);
  url.protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  url.searchParams.set("token", bridgeToken());
  return url.toString();
}

function bridgeToken() {
  const token = document.querySelector<HTMLMetaElement>('meta[name="termdem-bridge-token"]');
  if (!token?.content) {
    throw new Error("Missing preview bridge token");
  }

  return token.content;
}

function readInitialAutostart() {
  return new URL(window.location.href).searchParams.get("termdem_autostart") !== "0";
}

function readEmbeddedPreview() {
  return new URL(window.location.href).searchParams.get("termdem_embedded") === "1";
}

function embeddedPreviewUrl() {
  const url = new URL(window.location.href);
  url.searchParams.set("termdem_embedded", "1");
  return url.toString();
}

function updateRecordingState(
  message: Extract<ServerToBrowserMessage, { type: "recording.state" }>,
) {
  switch (message.state) {
    case "ready":
      markRecordingReady(true);
      markRecordingDone(false);
      markRecordingError(undefined);
      return;
    case "started":
      markRecordingStarted(message.action);
      return;
    case "done":
      markRecordingDone(true);
      return;
    case "error":
      markRecordingError(message.error ?? "Recording failed");
      return;
    default:
      message.state satisfies never;
  }
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

function markRecordingStarted(action?: string) {
  globalThis.__termdem = {
    ...globalThis.__termdem,
    recording: {
      ...globalThis.__termdem?.recording,
      action,
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
      action: undefined,
      done,
    },
  };
}

function markRecordingError(error: string | undefined) {
  globalThis.__termdem = {
    ...globalThis.__termdem,
    recording: {
      ...globalThis.__termdem?.recording,
      error,
    },
  };
}

function paneNameFromAction(action: string | undefined) {
  if (!action) {
    return null;
  }

  const match = /^pane\("([^"]+)"\)\./u.exec(action);
  return match?.[1] ?? null;
}

function useInitialValue<T>(factory: () => T) {
  const ref = useRef<{ value: T } | null>(null);
  if (!ref.current) {
    ref.current = { value: factory() };
  }

  return ref.current.value;
}

function usePreviewSocket() {
  const context = useContext(PreviewSocketContext);
  if (!context) {
    throw new Error("Missing preview socket context");
  }

  return context;
}

declare global {
  // eslint-disable-next-line no-var
  var __termdem:
    | {
        controls?: {
          restart?: () => void;
          start?: () => void;
          stop?: () => void;
        };
        recording?: {
          action?: string;
          done?: boolean;
          error?: string;
          ready?: boolean;
        };
      }
    | undefined;
}
