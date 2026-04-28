# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.2.0] - 2026-04-28

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

[unreleased]: https://github.com/AKuederle/termdem/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/AKuederle/termdem/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/AKuederle/termdem/releases/tag/v0.1.0
