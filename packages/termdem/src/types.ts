export type PressKey = "Enter" | "\r";

export type TypeOptions = {
  typeDelayMs?: number;
};

export type ExecOptions = {
  typeDelayMs?: number;
};

export type ExecResult = {
  command: string;
  exitCode: number;
  raw: string;
  text: string;
  lines: string[];
  startedAt: number;
  endedAt: number;
};

export interface PaneController {
  type(text: string, options?: TypeOptions): Promise<void>;
  press(key: PressKey): Promise<void>;
  exec(command: string, options?: ExecOptions): Promise<ExecResult>;
  sendLine(command: string, options?: TypeOptions): Promise<void>;
}

export type NodeExecOptions = {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  pane?: string;
  reject?: boolean;
  timeoutMs?: number;
};

export type NodeExecResult = {
  exitCode: number;
  stderr: string;
  stdout: string;
};

export type ExecNodeOptions = NodeExecOptions;
export type ExecNodeResult = NodeExecResult;

export type WaitForOptions = {
  intervalMs?: number;
  timeoutMs?: number;
};

export type NormalizeExecCaptureOptions = {
  promptPattern?: RegExp;
};

export type NormalizedExecCapture = {
  raw: string;
  text: string;
  lines: string[];
};
