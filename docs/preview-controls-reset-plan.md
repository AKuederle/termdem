# Preview Controls and Restart Reset Plan

## Goal

Improve preview playback controls and make restart a full reset across the backend runtime, backend replay buffers, and browser terminal surfaces.

## Behavioral Requirements

1. Preview controls expose real playbook state instead of socket-only state.
2. The controls use compact icon buttons with accessible labels, disabled states, active states, and click feedback.
3. The overlay exposes exactly three controls:
   - stop cancels the active generation;
   - replay cancels, disposes, clears, and starts a fresh generation;
   - close hides the overlay.
4. Runtime checkpoints keep stop/restart cancellation responsive during waits and visible typing.
5. Pause/resume is intentionally unsupported.
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

### Slice 2: Runtime Cancellation State

Red:

- Add runtime tests proving `stop()` cancels the active run.
- Add runtime tests proving resize requests during restart do not prevent replay.

Green:

- Keep `generation` as the cancellation token.
- Keep stop/restart as generation-changing operations.
- Store pane sizes across restart so frontend remount resize messages are not fatal.

### Slice 3: Cancellation Checkpoints in Visible Pane Operations

Red:

- Add tests proving visible typed actions respect stop/restart checkpoints.

Green:

- Thread an activity checkpoint callback from `PlaybookRuntime` into pane type/send/exec paths.
- Check the callback between typed characters and before command submission where practical.

### Slice 4: Protocol and Server Control Handling

Red:

- Add protocol tests for `preview.reset` and the supported playbook control messages.
- Add server-facing tests or focused helper tests for restart buffer clearing.

Green:

- Add `preview.reset` server-to-browser message.
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

- Add tests for control view-model behavior: disabled states and pending command feedback.

Green:

- Replace text controls with stop, replay, and close icon buttons.
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
