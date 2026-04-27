declare const process: {
  execPath: string;
};

declare module "node:child_process" {
  export function execFile(
    file: string,
    args: string[],
    callback: (error: Error | null) => void,
  ): void;
}

declare module "node:fs/promises" {
  export function cp(
    source: string,
    destination: string,
    options?: { recursive?: boolean },
  ): Promise<void>;
}

declare module "node:path" {
  export function dirname(path: string): string;
  export function join(...parts: string[]): string;
}

declare module "node:url" {
  export function fileURLToPath(url: string): string;
}
