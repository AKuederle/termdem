export { normalizeExecCapture } from "./normalize.ts";
export { createPaneSession, type PaneSession, type PaneSessionOptions } from "./pane-session.ts";
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
export type {
  ExecOptions,
  ExecResult,
  NormalizeExecCaptureOptions,
  NormalizedExecCapture,
  PaneController,
  PressKey,
  TypeOptions,
} from "./types.ts";
