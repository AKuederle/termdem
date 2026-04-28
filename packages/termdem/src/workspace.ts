import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

type Awaitable<T> = T | Promise<T>;

/**
 * Creates or returns the directory path used by a reusable workspace.
 *
 * Return an absolute or relative path to an existing directory. The setup function may
 * create the directory before returning it.
 */
export type DirSetup = () => Awaitable<string>;

/**
 * Cleans up a directory created or selected by {@link DirSetup}.
 *
 * @param dir - Directory path returned by the matching setup function.
 */
export type DirCleanup = (dir: string) => Awaitable<void>;

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
   * Prefix for the generated temporary directory name.
   *
   * Defaults to `"termdem-"`.
   */
  prefix?: string;
  /**
   * Optional setup function called with the fresh temporary directory before the demo uses it.
   */
  setup?: TmpDirSetup;
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
  pwd: Dir;
  /**
   * Hidden shell command run before visible demo actions begin.
   *
   * Use this for aliases or shell setup that should affect the pane but should not appear
   * in the visible transcript.
   */
  setupCommand?: string;
};

export type TerminalWorkspace = {
  cwd: string;
  dispose(): Promise<void>;
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
 * const project = new Dir(() => "/absolute/path/to/project");
 *
 * export const demo = createTerminalDemo([
 *   { name: "server", pwd: project },
 *   { name: "client", pwd: project },
 * ], async (api) => {
 *   await api.pane("server").sendLine("npm run dev");
 *   await api.pane("client").exec("npm test");
 * });
 * ```
 *
 * @example
 * ```ts
 * const workspace = new Dir(
 *   async () => {
 *     await fs.mkdir("demo-workspace", { recursive: true });
 *     return "demo-workspace";
 *   },
 *   async (dir) => {
 *     await fs.rm(dir, { recursive: true, force: true });
 *   },
 * );
 * ```
 */
export class Dir {
  #allocation: Promise<string> | null = null;
  #cleanup: Promise<void> | null = null;
  #cwd: string | null = null;
  #dispose: DirCleanup | undefined;
  #references = 0;
  #setup: DirSetup;

  /**
   * Creates a reusable workspace provider.
   *
   * @param setup - Function that returns the directory path to use. It may create or
   * prepare the directory before returning.
   * @param cleanup - Optional function called with the directory path after the final
   * terminal using this `Dir` is disposed.
   */
  constructor(setup: DirSetup, cleanup?: DirCleanup) {
    this.#setup = setup;
    this.#dispose = cleanup;
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

/**
 * Temporary directory workspace.
 *
 * `TmpDir` creates a fresh temporary directory for the demo and removes it when the
 * terminal workspaces using it are disposed. Share one `TmpDir` instance between panes
 * when they should see the same files.
 *
 * @example
 * ```ts
 * const repo = new TmpDir(async (dir) => {
 *   await fs.writeFile(path.join(dir, "README.md"), "# Demo\n", "utf8");
 * });
 *
 * export const demo = createTerminalDemo([
 *   { name: "git", pwd: repo },
 * ], async (api) => {
 *   await api.pane("git").exec("git init");
 *   await api.pane("git").exec("cat README.md");
 * });
 * ```
 *
 * @example
 * ```ts
 * const workspace = new TmpDir({
 *   prefix: "my-demo-",
 *   setup: async (dir) => {
 *     await fs.mkdir(path.join(dir, "src"));
 *   },
 * });
 * ```
 */
export class TmpDir extends Dir {
  /**
   * Creates a temporary workspace provider.
   *
   * @param options - Either a setup function or an options object. When a function is
   * passed, it is called with the fresh temporary directory. When an object is passed,
   * `setup` prepares the directory and `prefix` customizes the temporary directory name.
   */
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
