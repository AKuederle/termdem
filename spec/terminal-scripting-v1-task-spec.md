# Terminal Scripting V1 Task Spec

This spec converts the v1 PRD into an ordered list of executable implementation tasks. The goal is to preserve momentum and make each task independently verifiable.

## Delivery Principle

Tasks are ordered to validate the hardest architectural question first: can `exec()` look like typed terminal input while still returning structured, pruned command results that drive later steps?

The build should proceed in this order:

1. establish narrow runtime contracts
2. implement deterministic pane sessions
3. implement backend-instrumented `exec`
4. implement cleanup and pruning
5. prove command-to-command dependency in the browser

## Milestone 1: Runtime Contracts

### Task 1. Define public v1 runtime types

Create the core TypeScript contracts for the v1 execution model.

Deliverables:

- `PaneController` interface
- `ExecOptions` type
- `ExecResult` type
- `PressKey` type
- normalization result type for pruned command output

Acceptance criteria:

- `PaneController` exposes `type`, `press`, and `exec`
- `exec` accepts typing delay options
- `ExecResult` includes command, exit code, raw output, normalized text, and normalized lines
- contracts are explicit and do not include hidden-step or DSL concerns

### Task 2. Define the backend/browser message protocol

Create a structured transport contract between the pane runtime and the browser renderer.

Deliverables:

- client-to-runtime message shapes
- runtime-to-client message shapes
- execution marker event format or equivalent internal boundary contract

Acceptance criteria:

- the protocol can represent visible typing, key presses, pane output, metadata, and command completion
- `exec` semantics are representable without requiring the browser to infer command boundaries
- pane addressing is by stable pane name only

## Milestone 2: Named Pane Component Model

### Task 3. Create typed React pane components

Implement the TSX render contract for placing runtime-provided pane components in user layouts.

Deliverables:

- generated pane components keyed by terminal name
- typed render props for pane placement
- pane mount validation

Acceptance criteria:

- panes can be placed in TSX by terminal name
- duplicate pane names fail clearly
- missing or duplicated pane component mounts fail clearly
- scripts and runtime logic can resolve panes by name without inspecting layout internals

### Task 4. Connect pane components to browser terminal surfaces

Bind rendered pane components to browser-rendered `wterm` instances.

Deliverables:

- pane component-to-terminal mounting logic
- lifecycle handling for connect, disconnect, and resize

Acceptance criteria:

- a named pane can render a connected terminal surface
- multiple panes can be rendered simultaneously
- the browser presentation layer stays a renderer and does not own scripting semantics

## Milestone 3: Deterministic PTY Sessions

### Task 5. Implement deterministic PTY session creation

Create a backend session layer that starts one PTY per pane in a tightly controlled shell environment.

Deliverables:

- PTY session manager
- pane-name to PTY-session mapping
- deterministic shell startup configuration

Acceptance criteria:

- each pane gets its own PTY
- the shell environment is stable enough for prompt and command-boundary reasoning
- session startup behavior is repeatable across tests

### Task 6. Implement visible `type(text, options)`

Add scripted typing with configurable delay.

Deliverables:

- runtime method for per-character typing
- browser rendering path for visible typing

Acceptance criteria:

- text appears in the pane progressively using the configured delay
- the shell receives the intended input
- typing behavior can be tested deterministically

### Task 7. Implement `press(key)`

Add explicit key dispatch for the initial supported key set.

Deliverables:

- key-to-byte mapping for at least Enter
- runtime dispatch path to PTY sessions

Acceptance criteria:

- `press("Enter")` submits the current command line in the pane
- key dispatch behavior is testable without UI-specific assertions

## Milestone 4: Backend-Instrumented Exec

### Task 8. Implement command boundary instrumentation

Create the internal execution wrapper that allows the runtime to identify the start and end of a command and capture its exit code.

Deliverables:

- execution wrapper format
- marker generation strategy
- exit code extraction

Acceptance criteria:

- command completion is detected by runtime instrumentation rather than prompt guessing alone
- the runtime can reliably associate captured output with a single `exec` call
- the exit code is available in the final `ExecResult`

### Task 9. Implement `exec(command, options)`

Build the central v1 primitive on top of `type`, `press`, and backend instrumentation.

Deliverables:

- `exec` implementation
- typing delay support on `exec`
- browser-visible command playback path

Acceptance criteria:

- `exec` visibly behaves like typing the command and pressing Enter
- `exec` returns a promise that resolves to `ExecResult`
- `exec` supports configurable typing delay
- `exec` does not expose instrumentation markers to the viewer

## Milestone 5: Cleanup and Pruning

### Task 10. Implement low-level VT stripping

Create the low-level control-sequence stripping layer for captured command output.

Deliverables:

- utility wrapper for low-level VT stripping
- compatibility behavior for supported Node runtime versions

Acceptance criteria:

- ANSI and VT control sequences are removed from normalized command results
- the solution does not depend on a broad cleanup library for shell semantics

### Task 11. Implement semantic pruning and normalization

Build the runtime-owned cleanup module that turns raw command capture into script-usable text.

Deliverables:

- normalization module
- `text` result assembly
- `lines` result assembly

Normalization responsibilities:

- remove execution markers
- normalize carriage-return rewrites
- remove prompt noise from command completion
- trim trailing empty lines in the normalized view

Acceptance criteria:

- the module outputs normalized `text` and `lines`
- the module preserves `raw` output separately for debugging
- cleanup behavior is isolated in a small deep module with a narrow contract

## Milestone 6: End-to-End Validation

### Task 12. Build the validation demo scenario

Use the runtime to prove the first real scripting dependency.

Scenario:

1. execute `command ls -1 --color=never`
2. read the first normalized output line
3. execute `cat <first-file>`

Deliverables:

- a demo layout with at least one named pane component
- a script that runs the validation scenario

Acceptance criteria:

- the first command is visibly typed with delay
- the result contains normalized lines
- the second command uses the first result programmatically
- the second command is visibly typed with delay
- the resulting output is shown in the same pane

## Milestone 7: Testing

### Task 13. Add unit tests for runtime contracts and pane registration

Acceptance criteria:

- pane component registration behavior is covered
- duplicate naming behavior is covered
- public runtime contracts remain narrow and stable

### Task 14. Add unit tests for PTY actions

Acceptance criteria:

- `type` behavior is covered
- `press` behavior is covered
- deterministic shell session setup is covered

### Task 15. Add unit tests for exec instrumentation and normalization

Acceptance criteria:

- command boundary detection is covered
- exit code capture is covered
- low-level VT stripping is covered
- semantic pruning is covered
- `ExecResult.text` and `ExecResult.lines` are covered

### Task 16. Add integration test for the validation scenario

Acceptance criteria:

- the `ls -> first file -> cat` flow passes end to end
- the second command depends on the real result of the first command
- the test asserts external behavior rather than internal buffer details

## Stretch Tasks After V1 Validation

These are explicitly not required for the first successful slice:

- hidden steps
- hidden input
- multi-pane orchestration primitives
- recording/export
- template-literal DSL
- headless terminal-state reconstruction

## Definition of Done

The v1 slice is done when all of the following are true:

- a pane can be declared in TSX and rendered in the browser
- the pane is backed by a deterministic PTY session
- `type`, `press`, and `exec` are implemented
- `exec` supports typing delay
- `exec` returns raw output, normalized text, normalized lines, and exit code
- cleanup is split into low-level VT stripping and runtime-owned semantic pruning
- the system passes the `command ls -1 --color=never -> first file -> cat` validation scenario
