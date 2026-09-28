# Phase 0 — Foundation

You are implementing Phase 0 of the Personal Voice App.

Before changing code, read:

- `AGENTS.md`
- `docs/SPEC.md`
- `docs/ARCHITECTURE.md`

## Goal

Create the clean project foundation only.

## Requirements

Create a Tauri 2 application using:

- React
- TypeScript
- Rust
- pnpm

Prepare the project to target:

- Windows
- Android

Use TypeScript strict mode.

Establish a simple source structure consistent with `docs/ARCHITECTURE.md`.

Create the minimal platform and voice-provider boundaries described in the architecture docs, but do not implement Gemini, microphone capture, hotkeys, accessibility, overlays, sync, or text insertion yet.

Ensure:

- Windows dev build launches
- Android project initializes/builds as far as the current local environment supports
- lint/typecheck/build commands are documented
- test framework is initialized
- README contains local setup commands

Do not add speculative dependencies.

Do not implement future phases.

## Acceptance criteria

- project builds on Windows
- Tauri launches successfully
- TypeScript strict mode passes
- Rust formatting/check passes
- basic test command runs
- architecture folders/interfaces exist without unnecessary implementation
- no API keys or provider code exist

At the end, report:

1. files created/changed
2. commands used to validate
3. exact acceptance criteria status
4. blockers, if any

Stop after Phase 0.
