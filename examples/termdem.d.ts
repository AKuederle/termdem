declare namespace JSX {
  interface IntrinsicElements {
    [elementName: string]: unknown;
  }
}

declare module "@akuederle/termdem" {
  type CSSProperties = Record<string, number | string | undefined>;
  type ReactNode = unknown;

  export type TerminalCleanupContext = {
    cwd: string;
    name: string;
  };

  export type TerminalDefinition = {
    cleanup?: (context: TerminalCleanupContext) => Promise<void> | void;
    name: string;
    pwd: Dir;
  };

  export type TerminalHandle = {
    name: string;
  };

  export type PaneController = {
    exec(command: string, options?: { typeDelayMs?: number }): Promise<{ text: string }>;
    press(key: "Enter"): Promise<void>;
    type(text: string, options?: { delayMs?: number }): Promise<void>;
  };

  export class Dir {
    constructor(
      setup: () => Promise<string> | string,
      cleanup?: (dir: string) => Promise<void> | void,
    );
  }

  export class TmpDir extends Dir {
    constructor(options?: { prefix?: string; setup?: (dir: string) => Promise<void> | void });
  }

  export function createTerminalDemo<const TTerminals extends readonly TerminalDefinition[]>(
    terminals: TTerminals,
    script: (api: {
      pane: (name: TTerminals[number]["name"]) => PaneController;
    }) => Promise<void> | void,
  ): {
    script: unknown;
    terminals: Record<TTerminals[number]["name"], TerminalHandle>;
  };

  export function Pane(props: {
    className?: string;
    style?: CSSProperties;
    terminal: TerminalHandle;
  }): ReactNode;

  export function Stage(props: { children?: ReactNode }): ReactNode;
}
