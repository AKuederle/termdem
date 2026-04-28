export type PressKey = "Enter" | "\r";

export type TypeOptions = {
  delayMs?: number;
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
}

export type NormalizeExecCaptureOptions = {
  promptPattern?: RegExp;
};

export type NormalizedExecCapture = {
  raw: string;
  text: string;
  lines: string[];
};
