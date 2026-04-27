import { type RecordingConfig } from "./recording-config.ts";
import { type PaneController } from "./types.ts";
import { type TerminalWorkspaceDefinition } from "./workspace.ts";

export type TerminalDefinition = TerminalWorkspaceDefinition;

export type TerminalHandle<Name extends string = string> = {
  name: Name;
};

export type TerminalDemoScriptApi<Name extends string> = {
  pane(name: Name): PaneController;
};

export type TerminalDemo<
  TTerminals extends readonly TerminalDefinition[],
  TName extends TTerminals[number]["name"] = TTerminals[number]["name"],
> = {
  config: RecordingConfig;
  script: (api: TerminalDemoScriptApi<TName>) => Promise<void> | void;
  terminalDefinitions: TTerminals;
  terminals: Record<TName, TerminalHandle<TName>>;
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
    terminals: Object.fromEntries(
      terminalDefinitions.map((terminal) => [terminal.name, { name: terminal.name }]),
    ) as TerminalDemo<TTerminals>["terminals"],
  };
}
