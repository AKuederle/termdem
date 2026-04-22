# Terminal Scripting V1 PRD

## Problem Statement

The project aims to create `termdem`, a TypeScript package for scripting and "filming" terminal demos in a browser-rendered environment. Existing terminal demo tools generally optimize for replaying static transcripts or driving a single terminal session, but they do not provide a clean model for:

- declaring multiple terminal panes in a composable browser layout
- scripting visible terminal actions as code
- capturing step output in a form that later steps can inspect and use
- making the browser presentation look like real typing while still giving the runtime structured execution results

For the first implementation slice, the key problem is proving that a scripted demo can drive a pane as if a user were typing into a real shell, while also allowing the script to consume the result of a command programmatically. The validation case is intentionally simple and concrete: run a listing command, prune the output into usable lines, pick the first file, and use that value in the next command.

## Solution

The first version of `termdem` will provide a minimal but coherent scripting model with three execution primitives:

- `type(text, options)` to simulate visible typing into a pane
- `press(key)` to send a specific key such as Enter
- `exec(command, options)` to visibly simulate typing plus Enter, while internally capturing the command's actual output and exit code in a structured result

Terminal panes will be declared in a TSX React scene using named `Pane` components. Each pane name maps to a backend PTY session rendered in the browser with `wterm`.

The key behavior of `exec()` is that it must look like real typing to the viewer but still return a pruned, machine-usable result to the script. This will be implemented by separating what the viewer sees from what the shell actually receives. The runtime will instrument command submission on the backend, capture output between runtime markers, remove those markers and terminal noise from the returned scripting result, and expose normalized text and lines for subsequent steps.

The initial end-to-end validation is:

1. Render a named pane in the browser.
2. Execute `command ls -1 --color=never` in that pane with typing delay.
3. Prune the returned output into lines.
4. Select the first line as the first file.
5. Execute `cat <first-file>` in the same pane with typing delay.

If this flow works reliably, the core execution model is validated.

## User Stories

1. As a demo author, I want to declare terminal panes in TSX, so that the visual layout of the demo lives in code.
2. As a demo author, I want every pane to have a stable unique name, so that scripts can target panes without depending on layout details.
3. As a demo author, I want to render multiple terminal panes in a browser, so that I can build demos with more than one terminal surface.
4. As a demo author, I want each pane to map to a real local PTY, so that commands behave like they do in a real shell.
5. As a demo author, I want to type text into a pane with configurable delay, so that the demo feels human rather than instantaneous.
6. As a demo author, I want to press specific keys such as Enter, so that I can model interactive terminal behavior explicitly.
7. As a demo author, I want `exec()` to simulate typed input followed by Enter, so that command execution looks the same as manually typing the command.
8. As a demo author, I want `exec()` to return a structured result, so that later script steps can make decisions based on real command output.
9. As a demo author, I want `exec()` to report the command exit code, so that my script can branch on success or failure.
10. As a demo author, I want `exec()` to return normalized text, so that I do not have to manually strip ANSI escape codes and prompt noise in every script.
11. As a demo author, I want `exec()` to return pruned lines, so that common follow-up logic like "take the first listed file" is straightforward.
12. As a demo author, I want the raw captured output to remain available, so that I can debug cases where normalization loses useful information.
13. As a demo author, I want typing delay to be supported directly on `exec()`, so that command execution can be animated without separate `type()` and `press()` calls.
14. As a demo author, I want the first demo slice to support a real command-to-command dependency, so that the runtime proves it can drive dynamic demos and not just fixed scripts.
15. As a demo author, I want terminal output pruning to happen in the runtime, so that scripts can stay readable and declarative.
16. As a demo author, I want the scripting runtime to be deterministic enough for testing, so that demos do not randomly fail due to formatting differences.
17. As a demo author, I want shell invocation for v1 to be tightly controlled, so that the runtime can make reliable assumptions about prompts and captured output.
18. As a demo author, I want the browser layer to primarily render events rather than invent execution semantics, so that the PTY-owning backend remains authoritative.
19. As a demo author, I want visible typing to be decoupled from backend command instrumentation, so that the viewer sees clean commands while the runtime still captures structured boundaries.
20. As a demo author, I want pane scripts to address panes by name only, so that layout refactors do not break script logic.
21. As a demo author, I want to build from a small primitive API before adding a DSL, so that the system is debuggable and extensible.
22. As a maintainer, I want the first version to avoid hidden-step semantics, so that the initial architecture remains narrow and testable.
23. As a maintainer, I want the first version to avoid multi-pane orchestration features beyond basic pane targeting, so that the first slice proves the command execution model first.
24. As a maintainer, I want the first version to avoid recording and export concerns, so that rendering and scripting can stabilize independently.
25. As a maintainer, I want the first slice to produce a clear validation scenario, so that feasibility can be judged by behavior rather than by architecture alone.

## Implementation Decisions

- The v1 execution surface is limited to three primitives: `type`, `press`, and `exec`.
- `exec` is the central primitive. It must behave visually like `type(command)` followed by `press("Enter")`, but it must additionally return structured execution results.
- `exec` must support a typing delay option directly, rather than forcing callers to animate typing separately.
- The runtime will use a named pane model. React scene declarations define pane names and layout; scripts refer to panes only by name.
- The browser terminal is a rendering surface backed by `wterm`. The backend PTY session remains authoritative for command execution and output capture.
- The first implementation should favor a deterministic shell environment so the runtime can reason about prompts, echoed input, and command boundaries predictably.
- Command execution boundaries will be identified by backend instrumentation rather than by trying to infer completion from prompt heuristics alone.
- The runtime will separate the visible terminal experience from the structured command capture path. The visible pane should show the authored command text and resulting output, while the backend capture logic is responsible for execution markers and result assembly.
- `exec` results must expose both raw and normalized forms of command output.
- The normalized scripting result should remove execution markers, ANSI styling, carriage-return rewrites, and trailing prompt noise.
- The normalized result should expose a `lines` view suitable for programmatic follow-up steps.
- Low-level VT and ANSI control stripping should rely on stable platform or narrowly-scoped utility support rather than custom regexes where possible. In Node runtimes that support it, the preferred baseline is the built-in VT stripping utility.
- Semantic pruning remains an internal responsibility of the runtime. No external package should be treated as authoritative for command boundaries, prompt removal, step scoping, or shell-semantic cleanup.
- The cleanup pipeline should therefore be split into two layers:
  - low-level control-sequence stripping
  - runtime-owned semantic pruning and normalization
- The initial cleanup module should be a small deep module with a narrow contract that transforms captured command output into normalized `text` and `lines`.
- Full terminal-state reconstruction is explicitly not part of the first implementation. If simple capture normalization proves insufficient later, a headless terminal-state interpreter may be evaluated as a follow-up design change rather than adopted preemptively in v1.
- The initial validation command should be treated as `command ls -1 --color=never`, even if the visible authored intent is conceptually "list files", because deterministic line-oriented output is more important than shell alias fidelity in v1.
- The initial validation should prove that the result of one command can be consumed by a later command in the same pane session.
- The first implementation should not introduce hidden steps, hidden input semantics, recording, exporting, or a template-literal DSL. Those can be layered on top after the execution model is stable.
- The initial API should remain explicit and imperative rather than magical. A DSL can be added later as syntax sugar over stable primitives.
- The system should be decomposed into a small number of deep modules:
  - a scene model that registers named panes
  - a pane session runtime that owns PTY lifecycle and visible input actions
  - an execution module that implements `exec` instrumentation, capture, pruning, and result assembly
  - a browser presentation layer that renders pane output via `wterm`
- The first product milestone should be defined behaviorally:
  - render a pane
  - run a typed command with delay
  - return pruned output
  - feed the first result into the second command
  - show the resulting output in the same pane

## Testing Decisions

- Good tests should validate observable behavior rather than implementation details. Tests should assert what a script author receives from `type`, `press`, and `exec`, and what a viewer would observe in the pane, not how the runtime internally stores buffers or markers.
- The scene model should be tested for stable pane registration and name uniqueness behavior.
- The pane session runtime should be tested for visible typing behavior, key dispatch behavior, and PTY interaction at the API level.
- The execution module should receive the heaviest test coverage. It should be tested for:
  - command boundary detection
  - correct exit code capture
  - output pruning and normalization
  - line extraction
  - typing delay support on `exec`
  - chaining one command result into another
- Cleanup tests should explicitly separate:
  - low-level control-sequence stripping behavior
  - semantic pruning behavior such as prompt removal, carriage-return handling, and trailing empty line trimming
- Integration tests should validate the first end-to-end scenario: run a deterministic list command, select the first file from the returned lines, and run `cat` on that file in the same pane.
- Tests should prefer deterministic shell setup and deterministic command forms over user-shell-dependent behavior.
- Browser-facing tests should assert that visible terminal updates occur for typed commands and command output, while backend-focused tests should assert that returned results are usable for scripting.
- The first round of tests should prioritize the deep execution module and the end-to-end behavior over exhaustive UI testing.

## Out of Scope

- Hidden steps and hidden input behavior
- Recording or exporting demos as video or replay artifacts
- A template-literal scripting DSL
- Arbitrary human takeover or free-form live editing during scripted playback
- Robust support for multiple shells with differing prompt and startup behavior
- Rich multi-pane orchestration semantics such as parallel execution, synchronization barriers, or hidden background control flows
- Advanced terminal interactions such as alternate screen management, editors, or full-screen TUIs
- Persistent session snapshots or replay state serialization

## Further Notes

- The main feasibility question for v1 is not React layout. It is whether a command can be made to look like visible typing while still yielding structured, pruned, script-usable results.
- Output cleanup is expected to be fragile if treated as a pure string-processing problem over arbitrary PTY output. The design therefore intentionally narrows the problem by capturing explicit execution windows and normalizing only those windows.
- The v1 cleanup strategy should prefer a small owned normalization module over a large dependency stack. Third-party or built-in utilities are acceptable for low-level VT stripping, but the runtime must own the semantics that matter to scripting correctness.
- The first milestone should be considered successful only if one command can produce a result that directly determines the next command.
- The recommended delivery order is:
  1. establish a named pane scene model
  2. implement pane PTY sessions with `type` and `press`
  3. implement backend-instrumented `exec`
  4. add pruning and structured results
  5. prove the `ls -> first file -> cat` scenario end to end
- Once this slice is working, future features such as hidden steps, richer orchestration, and a template-literal DSL can be added as layers over the same runtime rather than forcing a redesign.
