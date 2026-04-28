import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

type Awaitable<T> = T | Promise<T>;

export type DirSetup = () => Awaitable<string>;
export type DirCleanup = (dir: string) => Awaitable<void>;
export type TmpDirSetup = (dir: string) => Awaitable<void>;

export type TmpDirOptions = {
  prefix?: string;
  setup?: TmpDirSetup;
};

export type TerminalCleanupContext = {
  cwd: string;
  name: string;
};

export type TerminalWorkspaceDefinition = {
  cleanup?: (context: TerminalCleanupContext) => Awaitable<void>;
  name: string;
  pwd: Dir;
  setupCommand?: string;
};

export type TerminalWorkspace = {
  cwd: string;
  dispose(): Promise<void>;
};

export class Dir {
  #allocation: Promise<string> | null = null;
  #cleanup: Promise<void> | null = null;
  #cwd: string | null = null;
  #dispose: DirCleanup | undefined;
  #references = 0;
  #setup: DirSetup;

  constructor(setup: DirSetup, cleanup?: DirCleanup) {
    this.#setup = setup;
    this.#dispose = cleanup;
  }

  async acquire(): Promise<TerminalWorkspace> {
    const cwd = await this.#ensureCwd();
    this.#references += 1;

    let disposed = false;
    return {
      cwd,
      dispose: async () => {
        if (disposed) {
          return;
        }

        disposed = true;
        this.#references -= 1;
        if (this.#references === 0) {
          await this.#release();
        }
      },
    };
  }

  async #release(): Promise<void> {
    if (this.#cleanup) {
      await this.#cleanup;
      return;
    }

    if (this.#allocation) {
      try {
        await this.#allocation;
      } catch {
        return;
      }
    }

    if (!this.#cwd) {
      return;
    }

    const cwd = this.#cwd;
    this.#cwd = null;
    this.#allocation = null;
    const cleanup = Promise.resolve(this.#dispose?.(cwd)).finally(() => {
      if (this.#cleanup === cleanup) {
        this.#cleanup = null;
      }
    });
    this.#cleanup = cleanup;
    await cleanup;
  }

  async #ensureCwd(): Promise<string> {
    if (this.#cleanup) {
      await this.#cleanup;
    }

    if (this.#cwd) {
      return this.#cwd;
    }

    if (!this.#allocation) {
      this.#allocation = this.#setupCwd();
    }

    return this.#allocation;
  }

  async #setupCwd() {
    const cwd = await this.#setup();
    this.#cwd = cwd;
    return cwd;
  }
}

export class TmpDir extends Dir {
  constructor(options: TmpDirOptions | TmpDirSetup = {}) {
    const setup = typeof options === "function" ? options : options.setup;
    const prefix = typeof options === "function" ? "termdem-" : (options.prefix ?? "termdem-");

    super(
      async () => {
        const cwd = await mkdtemp(join(tmpdir(), prefix));

        try {
          await setup?.(cwd);
        } catch (error) {
          await rm(cwd, { recursive: true, force: true });
          throw error;
        }

        return cwd;
      },
      async (cwd) => {
        await rm(cwd, { recursive: true, force: true });
      },
    );
  }
}

export async function createTerminalWorkspace(
  terminal: TerminalWorkspaceDefinition,
): Promise<TerminalWorkspace> {
  const workspace = await terminal.pwd.acquire();
  let disposed = false;

  return {
    cwd: workspace.cwd,
    dispose: async () => {
      if (disposed) {
        return;
      }

      disposed = true;
      try {
        await terminal.cleanup?.({
          cwd: workspace.cwd,
          name: terminal.name,
        });
      } finally {
        await workspace.dispose();
      }
    },
  };
}
