import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { createRoot } from "react-dom/client";
import { Terminal, useTerminal } from "@wterm/react";
import "@wterm/react/css";
import {
  parseServerToBrowserMessage,
  type BrowserToServerMessage,
  type PaneScreenSnapshot,
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

type WtermScreenReadable = {
  bridge: {
    getCell(row: number, col: number): { char: number };
    getCols(): number;
    getCursor(): { col: number; row: number; visible: boolean };
    getRows(): number;
    getScrollbackCount(): number;
    usingAltScreen(): boolean;
  } | null;
};

type SocketStatus = "connecting" | "open" | "closed" | "error";
type PlaybookUiState = "idle" | "running" | "stopped" | "done" | "error";
type PreviewControlCommand = "restart" | "stop";

export type PreviewClientState = {
  activeAction?: string;
  playbookState: PlaybookUiState;
  resetGeneration: number;
};

export const initialPreviewClientState: PreviewClientState = {
  playbookState: "idle",
  resetGeneration: 0,
};

export function nextPreviewClientState(
  state: PreviewClientState,
  message: ServerToBrowserMessage,
): PreviewClientState {
  switch (message.type) {
    case "playbook.state":
      return {
        ...state,
        activeAction: message.action,
        playbookState: message.state,
      };
    case "preview.reset":
      return {
        playbookState: "idle",
        resetGeneration: state.resetGeneration + 1,
      };
    case "pane.meta":
    case "pane.output":
    case "pane.screen.request":
    case "pane.status":
    case "recording.state":
    case "preview.error":
      return state;
    default:
      message satisfies never;
      return state;
  }
}

export function previewControlViewState({
  pendingCommand,
  playbookState,
  socketStatus,
}: {
  pendingCommand?: PreviewControlCommand;
  playbookState: PlaybookUiState;
  socketStatus: SocketStatus;
}) {
  const socketUnavailable = socketStatus !== "open";
  const commandPending = pendingCommand !== undefined;
  const running = playbookState === "running";

  return {
    pendingCommand,
    restartDisabled: socketUnavailable || commandPending,
    stopDisabled: socketUnavailable || commandPending || !running,
  };
}

const paneFrameClassName =
  "flex min-h-0 min-w-0 flex-col overflow-hidden bg-[#101010] text-slate-100";

const CurrentPaneNameContext = createContext<string | null>(null);
const PreviewSettingsContext = createContext<RecordingConfig>({});
const PreviewSocketContext = createContext<PreviewSocketContextValue | null>(null);
const PreviewResetGenerationContext = createContext(0);
const defaultPaneHeaderFontSizePx = 11;
const defaultPaneHeaderHeightPx = 24;
const defaultTerminalFontSizePx = 14;
const defaultTerminalLineHeight = 1.2;

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
  return config.size ?? null;
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
  const [clientState, setClientState] = useState(initialPreviewClientState);
  const [currentPaneName, setCurrentPaneName] = useState<string | null>(null);
  const [overlayVisible, setOverlayVisible] = useState(false);
  const [pendingCommand, setPendingCommand] = useState<PreviewControlCommand | undefined>();
  const [socketStatus, setSocketStatus] = useState<SocketStatus>("connecting");
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
  const sendControl = useEffectEvent((command: PreviewControlCommand) => {
    setPendingCommand(command);
    switch (command) {
      case "restart":
        send({ type: "playbook.restart" });
        return;
      case "stop":
        send({ type: "playbook.stop" });
        return;
      default:
        command satisfies never;
    }
  });

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
        case "pane.screen.request":
        case "pane.status": {
          const listeners = listenersRef.current.get(message.pane);
          for (const listener of listeners ?? []) {
            listener(message);
          }
          return;
        }
        case "playbook.state":
          setClientState((state) => nextPreviewClientState(state, message));
          setPendingCommand(undefined);
          if (message.state === "running") {
            setCurrentPaneName((name) => paneNameFromAction(message.action) ?? name);
          }
          if (message.state === "stopped" || message.state === "done") {
            setCurrentPaneName(null);
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
        case "preview.reset":
          setClientState((state) => nextPreviewClientState(state, message));
          setCurrentPaneName(null);
          setPendingCommand(undefined);
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
        restart: () => sendControl("restart"),
        start: () => send({ type: "playbook.start" }),
        stop: () => sendControl("stop"),
      },
    };

    return () => {
      delete globalThis.__termdem?.controls;
    };
  }, [sendControl]);

  return (
    <PreviewSocketContext value={socketContext}>
      <PreviewSettingsContext value={demo.settings}>
        <CurrentPaneNameContext value={currentPaneName}>
          <PreviewResetGenerationContext value={clientState.resetGeneration}>
            {demo.render(paneComponents)}
          </PreviewResetGenerationContext>
        </CurrentPaneNameContext>
      </PreviewSettingsContext>
      {overlayVisible ? (
        <PreviewOverlay
          pendingCommand={pendingCommand}
          playbookState={clientState.playbookState}
          socketStatus={socketStatus}
          onHide={() => {
            setOverlayVisible(false);
          }}
          onRestart={() => sendControl("restart")}
          onStop={() => sendControl("stop")}
        />
      ) : null}
    </PreviewSocketContext>
  );
}

type TerminalZoomStyle = CSSProperties & {
  "--term-font-size": string;
  "--term-row-height": string;
};

export function previewZoomStyle(config: RecordingConfig): TerminalZoomStyle {
  const zoom = config.zoom ?? 1;
  const fontSizePx = defaultTerminalFontSizePx * zoom;
  const rowHeightPx = Math.ceil(fontSizePx * defaultTerminalLineHeight);

  return {
    padding: 0,
    "--term-font-size": `${fontSizePx}px`,
    "--term-row-height": `${rowHeightPx}px`,
  };
}

export function previewPaneHeaderStyle(config: RecordingConfig): CSSProperties {
  const zoom = config.zoom ?? 1;
  return {
    fontSize: `${defaultPaneHeaderFontSizePx * zoom}px`,
    height: `${defaultPaneHeaderHeightPx * zoom}px`,
  };
}

export function readWtermScreen(wterm: WtermScreenReadable | null): PaneScreenSnapshot {
  const bridge = wterm?.bridge;
  if (!bridge) {
    return {
      altScreen: false,
      cols: 0,
      cursor: { col: 0, row: 0, visible: false },
      lines: [],
      rows: 0,
      scrollbackCount: 0,
      text: "",
    };
  }

  const cols = bridge.getCols();
  const rows = bridge.getRows();
  const lines: string[] = [];

  for (let row = 0; row < rows; row++) {
    let line = "";

    for (let col = 0; col < cols; col++) {
      const cell = bridge.getCell(row, col);
      line += cell.char >= 32 ? String.fromCodePoint(cell.char) : " ";
    }

    lines.push(line.trimEnd());
  }

  return {
    altScreen: bridge.usingAltScreen(),
    cols,
    cursor: bridge.getCursor(),
    lines,
    rows,
    scrollbackCount: bridge.getScrollbackCount(),
    text: lines.join("\n").trimEnd(),
  };
}

type ScrollableTerminalElement = Pick<HTMLElement, "clientHeight" | "scrollHeight" | "scrollTop">;

export function scrollTerminalElementToBottom(element: ScrollableTerminalElement | null) {
  if (!element) {
    return;
  }

  element.scrollTop = Math.max(0, element.scrollHeight - element.clientHeight);
}

function scheduleTerminalScrollToBottom(element: HTMLElement | null | undefined) {
  requestAnimationFrame(() => {
    scrollTerminalElementToBottom(element ?? null);
  });
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
  const previewSettings = useContext(PreviewSettingsContext);
  const resetGeneration = useContext(PreviewResetGenerationContext);
  const embeddedPreview = useInitialValue(readEmbeddedPreview);
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
        scheduleTerminalScrollToBottom(ref.current?.instance?.element);
        return;
      case "pane.screen.request":
        previewSocket.send({
          type: "pane.screen.response",
          pane: name,
          requestId: message.requestId,
          snapshot: readWtermScreen(ref.current?.instance ?? null),
        });
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
  useEffect(() => {
    setStatus("connecting");
  }, [resetGeneration]);

  return (
    <article
      {...paneFrameDataAttributes(name, currentPaneName === name)}
      className={`${paneFrameClassName} ${className ?? ""}`}
      style={style}
    >
      <header
        className="flex shrink-0 items-center border-b border-[#2f2f2f] bg-[#1b1b1b] px-2 font-mono font-semibold leading-none text-cyan-300"
        style={previewPaneHeaderStyle(previewSettings)}
      >
        {name}
      </header>

      <Terminal
        key={`${name}:${resetGeneration}`}
        ref={ref}
        aria-label={`${name} terminal (${status})`}
        className="min-h-0 flex-1 overflow-hidden !rounded-none"
        cols={20}
        rows={1}
        style={previewZoomStyle(previewSettings)}
        theme="monokai"
        autoResize
        cursorBlink
        onData={(data) => {
          if (embeddedPreview) {
            return;
          }
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
  onHide,
  onRestart,
  onStop,
  pendingCommand,
  playbookState,
  socketStatus,
}: {
  onHide: () => void;
  onRestart: () => void;
  onStop: () => void;
  pendingCommand?: PreviewControlCommand;
  playbookState: PlaybookUiState;
  socketStatus: SocketStatus;
}) {
  const controls = previewControlViewState({ pendingCommand, playbookState, socketStatus });

  return (
    <div
      className="fixed right-5 top-5 z-50 flex items-center gap-2 rounded bg-black/85 p-2 font-mono text-white shadow-lg ring-1 ring-white/10"
      style={{ fontSize: 14 }}
    >
      <span className="px-2 text-slate-300" style={{ minWidth: 96 }}>
        {socketStatus === "open" ? playbookState : socketStatus}
      </span>
      <IconButton
        disabled={controls.stopDisabled}
        label="Stop"
        pending={pendingCommand === "stop"}
        onClick={onStop}
      >
        <StopIcon />
      </IconButton>
      <IconButton
        disabled={controls.restartDisabled}
        label="Replay"
        pending={pendingCommand === "restart"}
        onClick={onRestart}
      >
        <RestartIcon />
      </IconButton>
      <IconButton label="Close controls" onClick={onHide}>
        <CloseIcon />
      </IconButton>
    </div>
  );
}

function IconButton({
  active = false,
  children,
  disabled = false,
  label,
  onClick,
  pending = false,
}: {
  active?: boolean;
  children: ReactNode;
  disabled?: boolean;
  label: string;
  onClick: () => void;
  pending?: boolean;
}) {
  const className = [
    "grid place-items-center rounded border leading-none transition",
    "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300",
    active
      ? "border-cyan-300 bg-cyan-500/30 text-cyan-100"
      : "border-white/10 bg-slate-800 text-slate-100",
    pending ? "scale-95 border-cyan-200 bg-cyan-600/40" : "",
    disabled ? "cursor-not-allowed opacity-40" : "hover:bg-slate-700 active:scale-95",
  ].join(" ");

  return (
    <button
      aria-label={label}
      className={className}
      disabled={disabled}
      style={{ fontSize: 24, height: 48, width: 48 }}
      title={label}
      type="button"
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function StopIcon() {
  return <span aria-hidden="true">■</span>;
}

function RestartIcon() {
  return <span aria-hidden="true">↻</span>;
}

function CloseIcon() {
  return <span aria-hidden="true">×</span>;
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
