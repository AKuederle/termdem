import { randomUUID } from "node:crypto";
import { spawn, type IPty } from "node-pty";
import { normalizeExecCapture } from "./normalize.ts";
import { typingDelays } from "./typing-delays.ts";
import { normalizeTypableText, typableTextValue, type TypableText } from "./typed-string.ts";
import type { ExecOptions, ExecResult, PaneController, PressKey, TypeOptions } from "./types.ts";

export type PaneSessionOptions = {
  cwd?: string;
  shell?: string;
  cols?: number;
  rows?: number;
  prompt?: string;
  onOutput?: (chunk: string) => void;
};

export interface PaneSession extends Omit<PaneController, "getEnv" | "hidden"> {
  close(): Promise<void>;
  execHidden(command: string): Promise<ExecResult>;
  getEnvVars(): Promise<Record<string, string>>;
  pressHidden(key: PressKey): Promise<void>;
  resize(cols: number, rows: number): Promise<void>;
  sendLineHidden(command: TypableText): Promise<void>;
  typeHidden(text: TypableText, options?: TypeOptions): Promise<void>;
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

type PaneSessionTypeOptions = TypeOptions & {
  waitForActive?: () => Promise<void>;
};

type PaneSessionExecOptions = ExecOptions & {
  waitForActive?: () => Promise<void>;
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
  const bootstrapPrompt = `TD_BOOTSTRAP:${randomUUID()}> `;
  const promptSetupMarker = `TD_PROMPT_SETUP:${randomUUID()}`;
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
      PS1: bootstrapPrompt,
      PROMPT_COMMAND: "",
    },
  });

  const session = new NodePtyPaneSession(
    pty,
    prompt,
    promptMarker,
    promptMarkerVariable,
    bootstrapPrompt,
    promptSetupMarker,
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
  private readonly bootstrapPrompt: string;
  private readonly promptSetupMarker: string;
  private readonly onOutput: ((chunk: string) => void) | undefined;
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
    bootstrapPrompt: string,
    promptSetupMarker: string,
    cwd: string,
    onOutput?: (chunk: string) => void,
  ) {
    this.pty = pty;
    this.prompt = prompt;
    this.promptMarker = promptMarker;
    this.promptMarkerVariable = promptMarkerVariable;
    this.bootstrapPrompt = bootstrapPrompt;
    this.promptSetupMarker = promptSetupMarker;
    this.currentCwd = cwd;
    this.onOutput = onOutput;
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
    const renderedPrompt = await this.waitForPromptMarker();

    this.bootstrapping = false;
    this.dataBuffer = "";
    this.emitVisible(stripLeadingBracketedPasteMode(renderedPrompt));
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
      `printf '\\036%s\\036' ${shQuote(this.promptSetupMarker)}`,
    ].join("; ");
  }

  async cwd() {
    return this.enqueue(async () => this.currentCwd);
  }

  async getEnvVars() {
    return this.enqueue(async () => {
      const result = await this.performExecHidden(exportedEnvironmentCommand);
      if (result.exitCode !== 0) {
        throw new Error(`Failed to capture pane environment: ${result.text}`);
      }

      return parseExportedEnvironment(result.text);
    });
  }

  async screen() {
    return this.enqueue(async () => {
      throw new Error("Pane screen reads require a preview client");
    });
  }

  async type(text: TypableText, options: PaneSessionTypeOptions = {}) {
    await this.enqueue(() => this.performType(text, options));
  }

  async press(key: PressKey) {
    await this.enqueue(async () => {
      const input = normalizePressKey(key);
      this.emitInputVisible(input === "\r" ? "\r\n" : input);
      this.pty.write(input);
    });
  }

  async exec(command: TypableText, options: PaneSessionExecOptions = {}) {
    return this.enqueue(async () => {
      const commandText = typableTextValue(command);
      const pending = await this.beginExec(commandText, { visible: true });
      await this.performType(command, {
        typeDelayMs: options.typeDelayMs,
        waitForActive: options.waitForActive,
      });
      await options.waitForActive?.();
      this.emitInputVisible("\r\n");
      this.pty.write("\x15");
      this.pty.write(buildExecShellCommand(commandText, pending.id));
      this.pty.write("\r");
      return pending.result;
    });
  }

  async execHidden(command: string) {
    return this.enqueue(async () => {
      return this.performExecHidden(command);
    });
  }

  async typeHidden(text: TypableText, options: PaneSessionTypeOptions = {}) {
    await this.enqueue(() => this.performTypeHidden(text, options));
  }

  async pressHidden(key: PressKey) {
    await this.enqueue(async () => {
      const input = normalizePressKey(key);
      this.hideOutputUntilPrompts(countPromptProducingControls(input));
      this.pty.write(input);
    });
  }

  async resize(cols: number, rows: number) {
    await this.enqueue(async () => {
      this.pty.resize(Math.max(20, Math.floor(cols)), Math.max(8, Math.floor(rows)));
    });
  }

  async sendLine(command: TypableText, options: PaneSessionTypeOptions = {}) {
    await this.enqueue(async () => {
      await this.performType(command, options);
      await options.waitForActive?.();
      this.emitInputVisible("\r\n");
      this.pty.write("\r");
    });
  }

  async sendLineHidden(command: TypableText) {
    await this.enqueue(async () => {
      this.hideOutputUntilPrompt();
      this.pty.write(`${typableTextValue(command)}\r`);
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

  private async performType(text: TypableText, options: PaneSessionTypeOptions = {}) {
    for (const segment of normalizeTypableText(text)) {
      for (const char of segment.text) {
        await options.waitForActive?.();
        this.emitInputVisible(char);
        this.pty.write(char);
        await sleep(segment.typeDelayMs ?? options.typeDelayMs ?? typingDelays.WPM_60);
      }
    }
  }

  private async performTypeHidden(text: TypableText, options: PaneSessionTypeOptions = {}) {
    this.hideOutputUntilPrompts(countPromptProducingControls(typableTextValue(text)));

    for (const segment of normalizeTypableText(text)) {
      for (const char of segment.text) {
        await options.waitForActive?.();
        this.pty.write(char);
        await sleep(segment.typeDelayMs ?? options.typeDelayMs ?? typingDelays.WPM_60);
      }
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

  private async performExecHidden(command: string) {
    const pending = await this.beginExec(command, { visible: false });
    this.pty.write(buildExecShellCommand(command, pending.id));
    this.pty.write("\r");
    return pending.result;
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
  }

  private handleMarker(marker: string) {
    const cwd = parsePromptCwdMarker(marker, this.promptMarker);
    if (cwd !== null) {
      this.currentCwd = cwd;
      if (this.hiddenOutputUntilPrompt > 0) {
        this.hiddenOutputUntilPrompt -= 1;
      }
      if (this.completedExec) {
        const completedExec = this.completedExec;
        clearTimeout(completedExec.timer);
        this.completedExec = null;
        completedExec.resolve(completedExec.result);
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
    const normalized = normalizeExecCapture(pendingExec.rawChunks.join(""));
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

        if (this.dataBuffer.includes(this.bootstrapPrompt)) {
          resolve();
          return;
        }

        if (Date.now() - start >= timeoutMs) {
          reject(new Error("Timed out waiting for shell bootstrap prompt"));
          return;
        }

        setTimeout(tick, 10);
      };

      tick();
    });
  }

  private waitForPromptMarker(timeoutMs = 2000) {
    const start = Date.now();

    return new Promise<string>((resolve, reject) => {
      const tick = () => {
        if (this.closed) {
          reject(new Error("Pane session closed during bootstrap"));
          return;
        }

        const promptMarker = findPromptMarker(this.dataBuffer, this.promptMarker);
        const setupMarkerEnd = findMarkerEnd(this.dataBuffer, this.promptSetupMarker);
        if (
          promptMarker !== null &&
          setupMarkerEnd !== null &&
          setupMarkerEnd <= promptMarker.start
        ) {
          this.currentCwd = promptMarker.cwd;
          resolve(this.dataBuffer.slice(setupMarkerEnd, promptMarker.start));
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

const exportedEnvironmentCommand = [
  "while IFS= read -r __td_env_name; do",
  "printf '%s\\t%s\\n'",
  `"$(printf '%s' "$__td_env_name" | base64 | tr -d '\\n')"`,
  `"$(printf '%s' "\${!__td_env_name}" | base64 | tr -d '\\n')";`,
  "done < <(compgen -e)",
].join(" ");

function parseExportedEnvironment(text: string) {
  const env: Record<string, string> = {};
  for (const line of text.split("\n")) {
    if (line === "") {
      continue;
    }

    const [encodedName, encodedValue] = line.split("\t", 2);
    if (!encodedName || encodedValue === undefined) {
      continue;
    }

    env[decodeBase64(encodedName)] = decodeBase64(encodedValue);
  }

  return env;
}

function decodeBase64(value: string) {
  return Buffer.from(value, "base64").toString("utf8");
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

function findPromptMarker(text: string, promptMarker: string) {
  const markerPrefix = `\u001e${promptMarker}:`;
  const markerStart = text.indexOf(markerPrefix);
  if (markerStart === -1) {
    return null;
  }

  const markerEnd = text.indexOf("\u001e", markerStart + markerPrefix.length);
  if (markerEnd === -1) {
    return null;
  }

  const cwd = parsePromptCwdMarker(text.slice(markerStart + 1, markerEnd), promptMarker);
  if (cwd === null) {
    return null;
  }

  return { cwd, start: markerStart };
}

function findMarkerEnd(text: string, marker: string) {
  const encodedMarker = `\u001e${marker}\u001e`;
  const markerStart = text.indexOf(encodedMarker);

  return markerStart === -1 ? null : markerStart + encodedMarker.length;
}

function stripLeadingBracketedPasteMode(text: string) {
  const sequence = `${String.fromCharCode(27)}[?2004h`;
  let start = 0;
  while (text.startsWith(sequence, start)) {
    start += sequence.length;
  }

  return text.slice(start);
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

function normalizePressKey(key: PressKey) {
  return key === "Enter" ? "\r" : key;
}

async function sleep(delayMs: number) {
  if (delayMs <= 0) {
    return;
  }

  await new Promise((resolve) => setTimeout(resolve, delayMs));
}
