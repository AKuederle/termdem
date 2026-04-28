import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

type Awaitable<T> = T | Promise<T>;

/**
 * Prepares the directory path used by a reusable workspace.
 */
export type DirSetup = (dir: string) => Awaitable<void>;

/**
 * Tears down a directory prepared by {@link DirSetup}.
 *
 * @param dir - Directory path owned by the matching workspace.
 */
export type DirTeardown = (dir: string) => Awaitable<void>;

/**
 * Options for {@link Dir}.
 */
export type DirOptions = {
  /**
   * Directory path used by this workspace.
   */
  path: string;
  /**
   * Optional setup function called with `path` before the demo uses it.
   */
  setup?: DirSetup;
  /**
   * Optional teardown function called with `path` after the final terminal using this
   * workspace is disposed.
   */
  teardown?: DirTeardown;
};

/**
 * Prepares a temporary directory created by {@link TmpDir}.
 *
 * @param dir - Fresh temporary directory path. Add fixture files or initialize a repository here.
 */
export type TmpDirSetup = (dir: string) => Awaitable<void>;

/**
 * Options for {@link TmpDir}.
 */
export type TmpDirOptions = {
  /**
   * Optional setup function called with the fresh temporary directory before the demo uses it.
   */
  setup?: TmpDirSetup;
  /**
   * Optional teardown function called before the temporary directory is removed.
   */
  teardown?: TmpDirSetup;
};

/**
 * Context passed to a terminal cleanup callback.
 */
export type TerminalCleanupContext = {
  /** Working directory used by the terminal. */
  cwd: string;
  /** Terminal name from the matching terminal definition. */
  name: string;
};

export type TerminalWorkspace = {
  cwd: string;
  dispose(): Promise<void>;
};

export type TerminalWorkspaceProvider = {
  acquire(): Promise<TerminalWorkspace>;
};

/**
 * Defines one terminal pane for a demo.
 */
export type TerminalWorkspaceDefinition = {
  /**
   * Optional cleanup callback run before the terminal workspace is released.
   *
   * Use this for pane-specific cleanup such as stopping background services or copying
   * artifacts out of the workspace.
   */
  cleanup?: (context: TerminalCleanupContext) => Awaitable<void>;
  /**
   * Unique terminal name.
   *
   * The name becomes available as `api.pane(name)` in the script and as `panes[name]`
   * in the render function.
   */
  name: string;
  /**
   * Working directory provider for this terminal.
   *
   * Share the same `Dir` or `TmpDir` instance between definitions when panes should
   * operate in the same directory.
   */
  pwd: TerminalWorkspaceProvider;
};

/**
 * Reusable directory workspace.
 *
 * `Dir` is useful when a demo should run inside an existing project directory, or when
 * multiple terminal panes should share one directory that is prepared once and released
 * after the last pane is done.
 *
 * @example
 * ```ts
 * const project = new Dir({ path: "/absolute/path/to/project" });
 *
 * export const demo = createTerminalDemo({
 *   panes: [
 *     { name: "server", pwd: project },
 *     { name: "client", pwd: project },
 *   ],
 *   script: async (api) => {
 *     await api.pane("server").sendLine("npm run dev");
 *     await api.pane("client").exec("npm test");
 *   },
 * });
 * ```
 *
 * @example
 * ```ts
 * const workspace = new Dir({
 *   path: "demo-workspace",
 *   setup: async (dir) => {
 *     await fs.mkdir(dir, { recursive: true });
 *   },
 *   teardown: async (dir) => {
 *     await fs.rm(dir, { recursive: true, force: true });
 *   },
 * });
 * ```
 */
export class Dir {
  #allocation: Promise<string> | null = null;
  #cleanup: Promise<void> | null = null;
  #cwd: string | null = null;
  #path: string;
  #references = 0;
  #setup: DirSetup | undefined;
  #teardown: DirTeardown | undefined;

  /**
   * Creates a reusable workspace provider.
   *
   * @param options - Workspace path and optional setup/teardown hooks.
   */
  constructor(options: DirOptions) {
    this.#path = options.path;
    this.#setup = options.setup;
    this.#teardown = options.teardown;
  }

  /**
   * Acquires this workspace for one terminal.
   *
   * Most demo authors do not need to call this directly; pass the `Dir` instance as
   * `pwd` in a terminal definition instead.
   *
   * @returns A workspace handle with the directory path and a `dispose()` function.
   */
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
    const cleanup = Promise.resolve(this.#teardown?.(cwd)).finally(() => {
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
    const cwd = this.#path;
    await this.#setup?.(cwd);
    this.#cwd = cwd;
    return cwd;
  }
}

/**
 * Temporary directory workspace.
 *
 * `TmpDir` creates a fresh temporary directory for the demo and removes it when the
 * terminal workspaces using it are disposed. Share one `TmpDir` instance between panes
 * when they should see the same files.
 *
 * @example
 * ```ts
 * const repo = new TmpDir({
 *   setup: async (dir) => {
 *     await fs.writeFile(path.join(dir, "README.md"), "# Demo\n", "utf8");
 *   },
 * });
 *
 * export const demo = createTerminalDemo({
 *   panes: [{ name: "git", pwd: repo }],
 *   script: async (api) => {
 *     await api.pane("git").exec("git init");
 *     await api.pane("git").exec("cat README.md");
 *   },
 * });
 * ```
 *
 * @example
 * ```ts
 * const workspace = new TmpDir({
 *   setup: async (dir) => {
 *     await fs.mkdir(path.join(dir, "src"));
 *   },
 *   teardown: async (dir) => {
 *     await fs.copyFile(path.join(dir, "log.txt"), "last-demo-log.txt");
 *   },
 * });
 * ```
 */
export class TmpDir {
  #allocation: Promise<string> | null = null;
  #cleanup: Promise<void> | null = null;
  #cwd: string | null = null;
  #references = 0;
  #setup: TmpDirSetup | undefined;
  #teardown: TmpDirSetup | undefined;

  /**
   * Creates a temporary workspace provider.
   *
   * @param options - Workspace setup/teardown hooks.
   */
  constructor(options: TmpDirOptions = {}) {
    this.#setup = options.setup;
    this.#teardown = options.teardown;
  }

  /**
   * Acquires this workspace for one terminal.
   *
   * Most demo authors do not need to call this directly; pass the `TmpDir` instance
   * as `pwd` in a terminal definition instead.
   *
   * @returns A workspace handle with the directory path and a `dispose()` function.
   */
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
    const cleanup = Promise.resolve()
      .then(async () => {
        try {
          await this.#teardown?.(cwd);
        } finally {
          await rm(cwd, { recursive: true, force: true });
        }
      })
      .finally(() => {
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
    const cwd = await mkdtemp(join(tmpdir(), "termdem-"));

    try {
      await this.#setup?.(cwd);
    } catch (error) {
      await rm(cwd, { recursive: true, force: true });
      throw error;
    }

    this.#cwd = cwd;
    return cwd;
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
