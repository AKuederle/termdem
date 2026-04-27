import { execFile } from "node:child_process";

export type ExecNodeOptions = {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  reject?: boolean;
};

export type ExecNodeResult = {
  exitCode: number;
  stderr: string;
  stdout: string;
};

export class ExecNodeError extends Error {
  exitCode: number;
  stderr: string;
  stdout: string;

  constructor(message: string, result: ExecNodeResult) {
    super(message);
    this.name = "ExecNodeError";
    this.exitCode = result.exitCode;
    this.stderr = result.stderr;
    this.stdout = result.stdout;
  }
}

export function quoteShellArg(value: string) {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

export async function execNode(
  scriptPath: string,
  args: readonly string[] = [],
  options: ExecNodeOptions = {},
): Promise<ExecNodeResult> {
  return new Promise((resolve, reject) => {
    execFile(
      process.execPath,
      [scriptPath, ...args],
      {
        cwd: options.cwd,
        env: options.env,
      },
      (error, stdout, stderr) => {
        const result = {
          exitCode: getExitCode(error),
          stderr,
          stdout,
        };

        if (error && options.reject !== false) {
          reject(
            new ExecNodeError(`node ${scriptPath} exited with code ${result.exitCode}`, result),
          );
          return;
        }

        resolve(result);
      },
    );
  });
}

function getExitCode(error: Error | null) {
  if (!error || !("code" in error) || typeof error.code !== "number") {
    return error ? 1 : 0;
  }

  return error.code;
}
