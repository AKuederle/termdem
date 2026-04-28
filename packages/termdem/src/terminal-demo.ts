import type { CSSProperties, ReactElement } from "react";
import { type RecordingConfig } from "./recording-config.ts";
import {
  type NodeExecOptions,
  type NodeExecResult,
  type PaneController,
  type WaitForOptions,
} from "./types.ts";
import { type TerminalWorkspaceDefinition } from "./workspace.ts";

export type TerminalDefinition = TerminalWorkspaceDefinition;

export type TerminalPaneProps = {
  className?: string;
  style?: CSSProperties;
};

export type TerminalPaneComponent = (props: TerminalPaneProps) => ReactElement;

export type TerminalPaneComponents<TDemo extends TerminalDemo<readonly TerminalDefinition[]>> =
  TDemo extends TerminalDemo<infer TTerminals>
    ? Record<TTerminals[number]["name"], TerminalPaneComponent>
    : never;

export type TerminalDemoScriptApi<Name extends string> = {
  node: {
    execFile(
      file: string,
      args?: readonly string[],
      options?: NodeExecOptions,
    ): Promise<NodeExecResult>;
  };
  pane(name: Name): PaneController;
  wait(delayMs: number): Promise<void>;
  waitFor(label: string, probe: () => Promise<boolean>, options?: WaitForOptions): Promise<void>;
};

export type TerminalDemo<
  TTerminals extends readonly TerminalDefinition[],
  TName extends TTerminals[number]["name"] = TTerminals[number]["name"],
> = {
  config: RecordingConfig;
  script: (api: TerminalDemoScriptApi<TName>) => Promise<void> | void;
  terminalDefinitions: TTerminals;
};

export function createTerminalDemo<const TTerminals extends readonly TerminalDefinition[]>(
  terminalDefinitions: TTerminals,
  script: (api: TerminalDemoScriptApi<TTerminals[number]["name"]>) => Promise<void> | void,
  config: RecordingConfig = {},
): TerminalDemo<TTerminals> {
  return {
    config,
    script,
    terminalDefinitions,
  };
}
