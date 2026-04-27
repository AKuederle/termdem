export { recordBrowserPage, type BrowserRecordingOptions } from "./browser-recorder.ts";
export {
  ExecNodeError,
  execNode,
  quoteShellArg,
  type ExecNodeOptions,
  type ExecNodeResult,
} from "./helpers.ts";
export { normalizeExecCapture } from "./normalize.ts";
export { createPaneSession, type PaneSession, type PaneSessionOptions } from "./pane-session.ts";
export {
  parseDemoSize,
  resolveRecordingConfig,
  type DemoSize,
  type RecordingCliOptions,
  type RecordingConfig,
  type ResolvedRecordingConfig,
} from "./recording-config.ts";
export { inferRecordingFormat, type RecordingFormat } from "./recording-output.ts";
export {
  createTerminalWorkspace,
  Dir,
  TmpDir,
  type DirCleanup,
  type DirSetup,
  type TerminalCleanupContext,
  type TerminalWorkspace,
  type TerminalWorkspaceDefinition,
  type TmpDirOptions,
  type TmpDirSetup,
} from "./workspace.ts";
export { collectPaneDefinitions, Pane, renderStageScene, Stage } from "./scene.ts";
export {
  createTerminalDemo,
  type TerminalDefinition,
  type TerminalDemo,
  type TerminalDemoScriptApi,
  type TerminalHandle,
} from "./terminal-demo.ts";
export type {
  ExecOptions,
  ExecResult,
  NormalizeExecCaptureOptions,
  NormalizedExecCapture,
  PaneController,
  PressKey,
  TypeOptions,
} from "./types.ts";
