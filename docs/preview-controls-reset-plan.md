# Preview Controls, Pause/Resume, and Restart Reset Plan

## Goal

Improve preview playback controls and make restart a full reset across the backend runtime, backend replay buffers, and browser terminal surfaces.

## Behavioral Requirements

1. Preview controls expose real playbook state instead of socket-only state.
2. The controls use compact icon buttons with accessible labels, disabled states, active states, and click feedback.
3. Pause and resume are true runtime operations:
   - pause does not cancel the active run;
   - resume continues the same run generation;
   - stop still cancels the active generation;
   - restart cancels, disposes, clears, and starts a fresh generation.
4. Paused time does not count toward `api.wait()` delays.
5. Pause checkpoints apply to script actions and long visible typing paths.
6. Restart fully resets backend state:
   - closes PTYs;
   - disposes terminal workspaces;
   - clears pane output replay buffers;
   - clears stale latest pane messages;
   - broadcasts a reset message to connected clients.
7. Restart clears terminal content in the frontend before fresh backend output appears.
8. Reconnecting after restart does not replay stale terminal output.
9. No backwards compatibility shims are needed.

## Implementation Slices

### Slice 1: Plan Commit

- Add this plan document.
- Commit it before implementation changes.

### Slice 2: Runtime Pause/Resume State

Red:

- Add runtime tests proving `pause()` blocks `api.wait()` without consuming active delay time.
- Add runtime tests proving `resume()` continues the same run and `stop()` cancels a paused run.

Green:

- Add `paused` to `PlaybookState`.
- Add `pause()` and `resume()` methods to `PlaybookRuntime`.
- Keep `generation` unchanged for pause/resume.
- Wake paused waiters on resume, stop, restart, and close.
- Make `ensureActive()` wait while paused and re-check generation after waking.

### Slice 3: Pause Checkpoints in Visible Pane Operations

Red:

- Add tests proving a visible typed action can pause mid-action and resume.

Green:

- Thread an activity checkpoint callback from `PlaybookRuntime` into pane type/send/exec paths.
- Check the callback between typed characters and before command submission where practical.

### Slice 4: Protocol and Server Control Handling

Red:

- Add protocol tests for `playbook.pause`, `playbook.resume`, `preview.reset`, and `playbook.state: "paused"`.
- Add server-facing tests or focused helper tests for restart buffer clearing.

Green:

- Add `preview.reset` server-to-browser message.
- Route `playbook.pause` to `runtime.pause()`.
- Route `playbook.resume` to `runtime.resume()`.
- Keep `playbook.start` as run start and `playbook.stop` as cancellation.
- Clear backend replay buffers and latest pane messages during restart before new output is generated.

### Slice 5: Frontend Terminal Reset and State Model

Red:

- Add preview client tests for state derivation and reset/remount key behavior.

Green:

- Track playbook state in `PreviewApp`.
- Broadcast reset through context to panes.
- Clear/remount terminal surfaces on `preview.reset`.
- Reset pane status locally when reset arrives.

### Slice 6: Icon Control Overlay

Red:

- Add tests for control view-model behavior: disabled states, active play/pause state, and pending command feedback.

Green:

- Replace text controls with icon buttons.
- Add accessible labels and titles.
- Add pressed/pending/active visual states.
- Disable controls when the socket is unavailable or a conflicting command is pending.

### Slice 7: Verification and Final Review Handling

- Run targeted tests after each slice.
- Run the package test suite and type/check command after implementation.
- Compare final implementation against this plan.
- Check roborev open reviews periodically with `roborev fix --open --list`.
- After the final implementation commit, wait for latest review with `roborev wait --sha HEAD`.
- Address and close relevant reviews with `roborev comment` and `roborev close`.
