# termdem Examples

These examples describe the intended authoring shape for termdem demos. They use the target
`createTerminalDemo` API that the package is building toward.

Each example lives in its own folder with a README and a `demo.tsx` file.

- `git-vim`: single-pane Git workflow where file creation and editing happen through raw Vim keystrokes.
- `socket-cli`: multi-pane CLI workflow where one command returns a random local socket URL that drives later panes.

Recording size defaults live in each demo's `createTerminalDemo(..., config)` call. The future
`record` CLI should support `--size <width>x<height>` for the output video size and
`--viewportSize <width>x<height>` when the browser viewport should differ from the recorded video.
If only `--size` is passed, it applies to both recording and viewport size.
