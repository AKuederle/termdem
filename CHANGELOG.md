# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- Commands in `setup` and `teardown` are not hidden by default anymore, but require you to explicitly use
  the new `hidden` API (see "Added").
  If you don't use hidden during setup, the terminal will have content pre-populated when the script starts.
- Renamed `api.node.exec()` to `api.sidecar.exec()`.

### Fixed

- Fixed `termdem record` capturing demo-level `setup` as it ran. Visible setup output is now present in
  the first recorded frame without capturing the setup work being generated.

### Added

- Added hidden pane commands that run in the terminal of the pane, but are not shown in the gui.
  They can be accessed vai `pane.hidden.*` controls.
- Added `pane.getEnv()` snapshots for running sidecar processes with a pane's exported environment and cwd.
- `pane.sidecar.exec` gained the option to pass `environment` as an option.
  The environment can be obtained for a pane using `pane.getEnv()`.
  This allows a sidecar to inherit environmental variables and the current working directory.

## [0.3.0] - 2026-04-28

### Added

- Added `pane.screen()` for reading the current rendered terminal buffer from long-running commands.

### Fixed

- Fixed preview pane output replay duplicating initial terminal prompts for the client that creates the runtime.
- Fixed preview current-pane highlighting to preserve the latest pane while action updates are processed.
- Fixed preview terminal panes staying scrolled to the top after scrollback appears during recordings.
- Fixed preview client handling for demo modules that import Node builtins at module scope.
- Documented and covered setup-time pane exports persisting into visible script commands.
- Fixed the published package's Vite dependency to resolve to real Vite instead of Vite Plus core.

## [0.1.0] - 2026-04-28

### Added

- Initial public npm release of `@akuederle/termdem`.
- Added terminal demo scripting, preview, recording, and multi-pane rendering support.

[unreleased]: https://github.com/AKuederle/termdem/compare/v0.3.0...HEAD
[0.3.0]: https://github.com/AKuederle/termdem/compare/v0.1.0...v0.3.0
[0.1.0]: https://github.com/AKuederle/termdem/releases/tag/v0.1.0
