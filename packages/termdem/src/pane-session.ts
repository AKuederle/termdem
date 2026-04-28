import { randomUUID } from "node:crypto";
import { stripVTControlCharacters } from "node:util";
import { spawn, type IPty } from "node-pty";
import { normalizeExecCapture } from "./normalize.ts";
import { typingDelays } from "./typing-delays.ts";
import type { ExecOptions, ExecResult, PaneController, PressKey, TypeOptions } from "./types.ts";

export type PaneSessionOptions = {
  cwd?: string;
  shell?: string;
  cols?: number;
  rows?: number;
  prompt?: string;
  onOutput?: (chunk: string) => void;
};

export interface PaneSession extends PaneController {
  close(): Promise<void>;
  execHidden(command: string): Promise<ExecResult>;
  pressHidden(key: PressKey): Promise<void>;
  resize(cols: number, rows: number): Promise<void>;
  sendLineHidden(command: string): Promise<void>;
  typeHidden(text: string, options?: TypeOptions): Promise<void>;
}

type PendingExec = {
  command: string;
  startedAt: number;
  rawChunks: string[];
  visible: boolean;
  resolve: (result: ExecResult) => void;
  reject: (error: Error) => void;
};

type CompletedExecState = {
  reject: (error: Error) => void;
  resolve: (result: ExecResult) => void;
  result: ExecResult;
  timer: ReturnType<typeof setTimeout>;
  visible: boolean;
};

const defaultPrompt = "TERMDEM> ";

export async function createPaneSession(options: PaneSessionOptions = {}): Promise<PaneSession> {
  const prompt = options.prompt ?? defaultPrompt;
  if (prompt === "") {
    throw new Error("Pane session prompt must not be empty");
  }

  const shell = options.shell ?? "/bin/bash";
  if (!shell.endsWith("bash")) {
    throw new Error("Only bash shells are currently supported");
  }

  const promptMarker = `TD_PROMPT:${randomUUID()}`;
  const promptMarkerVariable = `TERMDEM_PROMPT_MARKER_${randomUUID().replaceAll("-", "_")}`;
  const cwd = options.cwd ?? process.cwd();
  const shellArgs = ["--noprofile", "--norc", "-i"];
  const pty = spawn(shell, shellArgs, {
    name: "xterm-256color",
    cols: options.cols ?? 120,
    rows: options.rows ?? 30,
    cwd,
    env: {
      ...process.env,
      DELTA_PAGER: "cat",
      GH_PAGER: "cat",
      GIT_PAGER: "cat",
      LESS: "FRX",
      MANPAGER: "cat",
      PAGER: "cat",
      TERM: "xterm-256color",
      PS1: prompt,
      PROMPT_COMMAND: "",
    },
  });

  const session = new NodePtyPaneSession(
    pty,
    prompt,
    promptMarker,
    promptMarkerVariable,
    cwd,
    options.onOutput,
  );
  await session.bootstrap();
  return session;
}

class NodePtyPaneSession implements PaneSession {
  private readonly pty: IPty;
  private readonly prompt: string;
  private readonly promptMarker: string;
  private readonly promptMarkerVariable: string;
  private readonly onOutput: ((chunk: string) => void) | undefined;
  private readonly promptPattern: RegExp;
  private readonly outputListener;
  private actionQueue = Promise.resolve();
  private dataBuffer = "";
  private pendingExec: PendingExec | null = null;
  private captureActive = false;
  private completedExec: CompletedExecState | null = null;
  private closed = false;
  private bootstrapping = true;
  private alternateScreenActive = false;
  private hiddenOutputUntilPrompt = 0;
  private currentCwd: string;

  constructor(
    pty: IPty,
    prompt: string,
    promptMarker: string,
    promptMarkerVariable: string,
    cwd: string,
    onOutput?: (chunk: string) => void,
  ) {
    this.pty = pty;
    this.prompt = prompt;
    this.promptMarker = promptMarker;
    this.promptMarkerVariable = promptMarkerVariable;
    this.currentCwd = cwd;
    this.onOutput = onOutput;
    this.promptPattern = new RegExp(`^${escapeRegExp(prompt)}$`, "u");
    this.outputListener = this.pty.onData((data) => {
      this.handlePtyData(data);
    });
  }

  async bootstrap() {
    await this.waitForPrompt();
    this.dataBuffer = "";
    this.pty.write("stty -echo\r");
    await this.waitForPrompt();
    this.dataBuffer = "";
    this.pty.write(`${this.buildBootstrapCommand()}\r`);
    await this.waitForPromptMarker();

    this.bootstrapping = false;
    this.dataBuffer = "";
    this.emitVisible(this.prompt);
  }

  private buildBootstrapCommand() {
    const promptRecipe = [
      this.prompt,
      `$(printf '\\036%s:%s\\036' "$${this.promptMarkerVariable}" "$(printf '%s' "$PWD" | base64 | tr -d '\\n')")`,
    ].join("");
    return [
      `${this.promptMarkerVariable}=${shQuote(this.promptMarker)}`,
      `PS1=${shQuote(promptRecipe)}`,
      "PROMPT_COMMAND=",
    ].join("; ");
  }

  async cwd() {
    return this.enqueue(async () => this.currentCwd);
  }

  async type(text: string, options: TypeOptions = {}) {
    await this.enqueue(() => this.performType(text, options));
  }

  async press(key: PressKey) {
    await this.enqueue(async () => {
      if (key !== "Enter" && key !== "\r") {
        throw new Error("Unsupported key");
      }

      this.emitInputVisible("\r\n");
      this.pty.write("\r");
    });
  }

  async exec(command: string, options: ExecOptions = {}) {
    return this.enqueue(async () => {
      const pending = await this.beginExec(command, { visible: true });
      await this.performType(command, { typeDelayMs: options.typeDelayMs });
      this.emitInputVisible("\r\n");
      this.pty.write("\x15");
      this.pty.write(buildExecShellCommand(command, pending.id));
      this.pty.write("\r");
      return pending.result;
    });
  }

  async execHidden(command: string) {
    return this.enqueue(async () => {
      const pending = await this.beginExec(command, { visible: false });
      this.pty.write(buildExecShellCommand(command, pending.id));
      this.pty.write("\r");
      return pending.result;
    });
  }

  async typeHidden(text: string, options: TypeOptions = {}) {
    await this.enqueue(() => this.performTypeHidden(text, options));
  }

  async pressHidden(key: PressKey) {
    await this.enqueue(async () => {
      if (key !== "Enter" && key !== "\r") {
        throw new Error("Unsupported key");
      }

      this.hideOutputUntilPrompt();
      this.pty.write("\r");
    });
  }

  async resize(cols: number, rows: number) {
    await this.enqueue(async () => {
      this.pty.resize(Math.max(20, Math.floor(cols)), Math.max(8, Math.floor(rows)));
    });
  }

  async sendLine(command: string, options: TypeOptions = {}) {
    await this.enqueue(async () => {
      await this.performType(command, options);
      this.emitInputVisible("\r\n");
      this.pty.write("\r");
    });
  }

  async sendLineHidden(command: string) {
    await this.enqueue(async () => {
      this.hideOutputUntilPrompt();
      this.pty.write(`${command}\r`);
    });
  }

  async close() {
    this.closed = true;
    this.outputListener.dispose();
    const closeError = new Error("Pane session closed");
    this.pendingExec?.reject(closeError);
    this.pendingExec = null;
    if (this.completedExec) {
      clearTimeout(this.completedExec.timer);
      this.completedExec.reject(closeError);
      this.completedExec = null;
    }
    this.actionQueue.catch(() => {});
    this.pty.kill();
  }

  private async performType(text: string, options: TypeOptions = {}) {
    for (const char of text) {
      this.emitInputVisible(char);
      this.pty.write(char);
      await sleep(options.typeDelayMs ?? typingDelays.WPM_60);
    }
  }

  private async performTypeHidden(text: string, options: TypeOptions = {}) {
    this.hideOutputUntilPrompts(countPromptProducingControls(text));

    for (const char of text) {
      this.pty.write(char);
      await sleep(options.typeDelayMs ?? typingDelays.WPM_60);
    }
  }

  private async beginExec(command: string, options: { visible: boolean }) {
    if (this.pendingExec) {
      throw new Error("exec already in progress");
    }

    const id = randomUUID();
    const result = new Promise<ExecResult>((resolve, reject) => {
      this.pendingExec = {
        command,
        startedAt: Date.now(),
        rawChunks: [],
        visible: options.visible,
        resolve,
        reject,
      };
    });
    result.catch(() => {});

    return { id, result };
  }

  private enqueue<T>(task: () => Promise<T>) {
    const run = this.actionQueue.then(async () => {
      if (this.closed) {
        throw new Error("Pane session closed");
      }

      return task();
    });
    this.actionQueue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private emitVisible(chunk: string) {
    this.onOutput?.(chunk);
  }

  private emitInputVisible(chunk: string) {
    if (!this.alternateScreenActive) {
      this.emitVisible(chunk);
    }
  }

  private handlePtyData(data: string) {
    if (this.bootstrapping) {
      this.dataBuffer += data;
      return;
    }

    this.dataBuffer += data;

    while (this.dataBuffer.length > 0) {
      const markerStart = this.dataBuffer.indexOf("\u001e");
      if (markerStart === -1) {
        this.flushText(this.dataBuffer);
        this.dataBuffer = "";
        return;
      }

      if (markerStart > 0) {
        this.flushText(this.dataBuffer.slice(0, markerStart));
        this.dataBuffer = this.dataBuffer.slice(markerStart);
      }

      const markerEnd = this.dataBuffer.indexOf("\u001e", 1);
      if (markerEnd === -1) {
        return;
      }

      const marker = this.dataBuffer.slice(1, markerEnd);
      this.dataBuffer = this.dataBuffer.slice(markerEnd + 1);
      this.handleMarker(marker);
    }
  }

  private flushText(text: string) {
    if (text === "") {
      return;
    }

    this.alternateScreenActive = nextAlternateScreenState(this.alternateScreenActive, text);
    const visibleText = stripVTControlCharacters(text);
    const suppressHiddenPromptOutput = this.hiddenOutputUntilPrompt > 0;

    if (
      !suppressHiddenPromptOutput &&
      this.pendingExec?.visible !== false &&
      this.completedExec?.visible !== false
    ) {
      this.emitVisible(text);
    }
    if (this.captureActive) {
      this.pendingExec?.rawChunks.push(text);
    }

    if (this.completedExec && visibleText.includes(this.prompt)) {
      const completedExec = this.completedExec;
      clearTimeout(completedExec.timer);
      this.completedExec = null;
      completedExec.resolve(completedExec.result);
    }
  }

  private handleMarker(marker: string) {
    const cwd = parsePromptCwdMarker(marker, this.promptMarker);
    if (cwd !== null) {
      this.currentCwd = cwd;
      if (this.hiddenOutputUntilPrompt > 0) {
        this.hiddenOutputUntilPrompt -= 1;
      }
      return;
    }

    if (marker.startsWith("TD_BEGIN:")) {
      this.captureActive = true;
      return;
    }

    if (!marker.startsWith("TD_END:")) {
      this.flushText(`\u001e${marker}\u001e`);
      return;
    }

    const pendingExec = this.pendingExec;
    if (!pendingExec) {
      return;
    }

    this.captureActive = false;
    const [, , statusText = "1"] = marker.split(":");
    this.pendingExec = null;
    const normalized = normalizeExecCapture(pendingExec.rawChunks.join(""), {
      promptPattern: this.promptPattern,
    });
    const result: ExecResult = {
      command: pendingExec.command,
      exitCode: Number.parseInt(statusText, 10),
      raw: normalized.raw,
      text: normalized.text,
      lines: normalized.lines,
      startedAt: pendingExec.startedAt,
      endedAt: Date.now(),
    };
    this.completedExec = {
      reject: pendingExec.reject,
      resolve: pendingExec.resolve,
      result,
      timer: setTimeout(() => {
        const completedExec = this.completedExec;
        if (!completedExec) {
          return;
        }

        this.completedExec = null;
        completedExec.reject(new Error(`Timed out waiting for prompt ${this.prompt}`));
      }, 2000),
      visible: pendingExec.visible,
    };
  }

  private waitForPrompt(timeoutMs = 2000) {
    const start = Date.now();

    return new Promise<void>((resolve, reject) => {
      const tick = () => {
        if (this.closed) {
          reject(new Error("Pane session closed during bootstrap"));
          return;
        }

        if (this.dataBuffer.includes(this.prompt)) {
          resolve();
          return;
        }

        if (Date.now() - start >= timeoutMs) {
          reject(new Error(`Timed out waiting for prompt ${this.prompt}`));
          return;
        }

        setTimeout(tick, 10);
      };

      tick();
    });
  }

  private waitForPromptMarker(timeoutMs = 2000) {
    const start = Date.now();

    return new Promise<void>((resolve, reject) => {
      const tick = () => {
        if (this.closed) {
          reject(new Error("Pane session closed during bootstrap"));
          return;
        }

        const cwd = findPromptCwdMarker(this.dataBuffer, this.promptMarker);
        if (cwd !== null) {
          this.currentCwd = cwd;
          resolve();
          return;
        }

        if (Date.now() - start >= timeoutMs) {
          reject(new Error(`Timed out waiting for prompt marker ${this.promptMarker}`));
          return;
        }

        setTimeout(tick, 10);
      };

      tick();
    });
  }

  private hideOutputUntilPrompt() {
    this.hideOutputUntilPrompts(1);
  }

  private hideOutputUntilPrompts(count: number) {
    this.hiddenOutputUntilPrompt += count;
  }
}

function buildExecShellCommand(command: string, stepId: string) {
  const quotedCommand = shQuote(command);
  const quotedStepId = shQuote(stepId);
  return [
    `printf '\\036TD_BEGIN:%s\\036' ${quotedStepId}`,
    `eval -- ${quotedCommand}`,
    "__td_status=$?",
    `printf '\\036TD_END:%s:%s\\036' ${quotedStepId} "$__td_status"`,
  ].join("; ");
}

function shQuote(value: string) {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function findPromptCwdMarker(text: string, promptMarker: string) {
  const markerPrefix = `\u001e${promptMarker}:`;
  const markerStart = text.indexOf(markerPrefix);
  if (markerStart === -1) {
    return null;
  }

  const markerEnd = text.indexOf("\u001e", markerStart + markerPrefix.length);
  if (markerEnd === -1) {
    return null;
  }

  return parsePromptCwdMarker(text.slice(markerStart + 1, markerEnd), promptMarker);
}

function parsePromptCwdMarker(marker: string, promptMarker: string) {
  const prefix = `${promptMarker}:`;
  if (!marker.startsWith(prefix)) {
    return null;
  }

  const encodedCwd = marker.slice(prefix.length);
  if (encodedCwd === "") {
    return null;
  }

  return Buffer.from(encodedCwd, "base64").toString("utf8");
}

function nextAlternateScreenState(current: boolean, text: string) {
  let next = current;
  const escape = String.fromCharCode(27);
  const prefixes = [`${escape}[?47`, `${escape}[?1047`, `${escape}[?1049`];

  for (let index = 0; index < text.length; index++) {
    for (const prefix of prefixes) {
      if (!text.startsWith(prefix, index)) {
        continue;
      }

      const command = text[index + prefix.length];
      if (command === "h" || command === "l") {
        next = command === "h";
      }
    }
  }

  return next;
}

function countPromptProducingControls(text: string) {
  let count = 0;
  for (const char of text) {
    const code = char.charCodeAt(0);
    if (code === 3 || code === 4 || code === 10 || code === 12 || code === 13) {
      count += 1;
    }
  }

  return count;
}

async function sleep(delayMs: number) {
  if (delayMs <= 0) {
    return;
  }

  await new Promise((resolve) => setTimeout(resolve, delayMs));
}
