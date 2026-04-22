import { randomUUID } from "node:crypto";
import { stripVTControlCharacters } from "node:util";
import { spawn, type IPty } from "node-pty";
import { normalizeExecCapture } from "./normalize.ts";
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
  resize(cols: number, rows: number): Promise<void>;
}

type PendingExec = {
  command: string;
  startedAt: number;
  rawChunks: string[];
  resolve: (result: ExecResult) => void;
  reject: (error: Error) => void;
};

type CompletedExecState = {
  reject: (error: Error) => void;
  resolve: (result: ExecResult) => void;
  result: ExecResult;
  timer: ReturnType<typeof setTimeout>;
};

const defaultPrompt = "TERMDEM> ";

export async function createPaneSession(options: PaneSessionOptions = {}): Promise<PaneSession> {
  const prompt = options.prompt ?? defaultPrompt;
  const shell = options.shell ?? "/bin/bash";
  const shellArgs = shell.endsWith("bash") ? ["--noprofile", "--norc", "-i"] : ["-i"];
  const pty = spawn(shell, shellArgs, {
    name: "xterm-256color",
    cols: options.cols ?? 120,
    rows: options.rows ?? 30,
    cwd: options.cwd ?? process.cwd(),
    env: {
      ...process.env,
      TERM: "xterm-256color",
      PS1: prompt,
      PROMPT_COMMAND: "",
    },
  });

  const session = new NodePtyPaneSession(pty, prompt, options.onOutput);
  await session.bootstrap();
  return session;
}

class NodePtyPaneSession implements PaneSession {
  private readonly pty: IPty;
  private readonly prompt: string;
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

  constructor(pty: IPty, prompt: string, onOutput?: (chunk: string) => void) {
    this.pty = pty;
    this.prompt = prompt;
    this.onOutput = onOutput;
    this.promptPattern = new RegExp(`^${escapeRegExp(prompt)}$`, "u");
    this.outputListener = this.pty.onData((data) => {
      this.handlePtyData(data);
    });
  }

  async bootstrap() {
    await this.waitForPrompt();
    this.pty.write("stty -echo\r");
    this.dataBuffer = "";
    await this.waitForPrompt();
    this.bootstrapping = false;
    this.dataBuffer = "";
  }

  async type(text: string, options: TypeOptions = {}) {
    await this.enqueue(() => this.performType(text, options));
  }

  async press(key: PressKey) {
    await this.enqueue(async () => {
      if (key !== "Enter") {
        throw new Error("Unsupported key");
      }

      this.emitVisible("\r\n");
      this.pty.write("\r");
    });
  }

  async exec(command: string, options: ExecOptions = {}) {
    return this.enqueue(async () => {
      const pending = await this.beginExec(command);
      await this.performType(command, { delayMs: options.typeDelayMs });
      this.emitVisible("\r\n");
      this.pty.write("\x15");
      this.pty.write(buildExecShellCommand(command, pending.id));
      this.pty.write("\r");
      return pending.result;
    });
  }

  async resize(cols: number, rows: number) {
    await this.enqueue(async () => {
      this.pty.resize(Math.max(20, Math.floor(cols)), Math.max(8, Math.floor(rows)));
    });
  }

  async close() {
    this.closed = true;
    this.outputListener.dispose();
    this.pendingExec?.reject(new Error("Pane session closed"));
    this.pendingExec = null;
    if (this.completedExec) {
      clearTimeout(this.completedExec.timer);
      this.completedExec.reject(new Error("Pane session closed"));
      this.completedExec = null;
    }
    this.pty.kill();
  }

  private async performType(text: string, options: TypeOptions = {}) {
    for (const char of text) {
      this.emitVisible(char);
      this.pty.write(char);
      await sleep(options.delayMs ?? 0);
    }
  }

  private async beginExec(command: string) {
    if (this.pendingExec) {
      throw new Error("exec already in progress");
    }

    const id = randomUUID();
    const result = new Promise<ExecResult>((resolve, reject) => {
      this.pendingExec = {
        command,
        startedAt: Date.now(),
        rawChunks: [],
        resolve,
        reject,
      };
    });

    return { id, result };
  }

  private enqueue<T>(task: () => Promise<T>) {
    const run = this.actionQueue.then(task);
    this.actionQueue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private emitVisible(chunk: string) {
    this.onOutput?.(chunk);
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

    this.emitVisible(text);
    if (this.captureActive) {
      this.pendingExec?.rawChunks.push(text);
    }

    const visibleText = stripVTControlCharacters(text);
    if (this.completedExec && visibleText.includes(this.prompt)) {
      const completedExec = this.completedExec;
      clearTimeout(completedExec.timer);
      this.completedExec = null;
      completedExec.resolve(completedExec.result);
    }
  }

  private handleMarker(marker: string) {
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

async function sleep(delayMs: number) {
  if (delayMs <= 0) {
    return;
  }

  await new Promise((resolve) => setTimeout(resolve, delayMs));
}
