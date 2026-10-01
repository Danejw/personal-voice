# AGENTS.md

## Purpose

These rules apply to Cursor, Codex, and any other coding agent working in this repository.

Read these files before changing code:

1. `docs/SPEC.md`
2. `docs/ARCHITECTURE.md`
3. the prompt for the current implementation phase
4. `docs/PV-Phases/` if the work is a Personal Voice (PV) prompt — completed vs skipped phases are listed there

## Core rules

- Preserve one Tauri 2 codebase for Windows and Android.
- Keep shared product logic in TypeScript/Rust wherever practical.
- Keep OS-specific behavior behind a platform boundary.
- Do not scatter Windows/Android conditionals throughout the app.
- Do not create a separate Android product or separate Android business-logic codebase.
- Android-specific native features may live in a small Kotlin-backed Tauri plugin.
- Do not introduce Electron.
- Do not introduce another transcription provider in V1.
- Do not introduce a local speech model in V1.
- Do not proxy live microphone audio through our backend.
- Never embed a permanent Gemini API key in a shipped client.
- Keep Gemini-specific behavior behind a provider/session interface.
- Keep platform-specific behavior behind a platform adapter.
- Prefer the smallest implementation that satisfies the active phase.
- Do not implement future phases early.
- Do not redesign unrelated code.
- Do not add packages without a concrete need.
- Pin important dependencies rather than using floating versions.
- Use TypeScript strict mode.
- Keep Rust formatted and warning-free where practical.
- Add tests for shared logic and state transitions.
- Do not claim a phase is complete until its acceptance criteria have been tested.
- UI is borderless: do not add CSS/HTML borders (or faux inset-ring shadows). Separate surfaces with background, spacing, radius, and soft shadows. See `.cursor/rules/no-borders.mdc`.

## Simplicity rule

This is a personal app first.

Avoid:

- enterprise abstractions
- plugin marketplaces
- microservices
- event buses
- queues
- analytics infrastructure
- billing
- teams
- transcript warehouses
- multiple ASR providers
- unnecessary dependency injection frameworks

Use simple interfaces only where they protect important boundaries.

## Required architectural boundaries

### Voice provider boundary

Conceptually:

```ts
interface TranscriptionSession {
  connect(): Promise<void>;
  startUtterance(): Promise<void>;
  sendAudio(chunk: ArrayBuffer): Promise<void>;
  endUtterance(): Promise<void>;
  close(): Promise<void>;
}
```

Exact names may change.

Gemini implementation belongs behind this boundary.

### Platform boundary

Conceptually:

```ts
interface PlatformAdapter {
  startCapture(): Promise<void>;
  stopCapture(): Promise<void>;
  insertText(text: string): Promise<void>;
  showListeningIndicator(): Promise<void>;
  hideListeningIndicator(): Promise<void>;
}
```

Exact method shapes may differ if implementation realities require it.

### State model

Use an explicit state machine or reducer around:

```text
IDLE
CONNECTING
LISTENING
FINALIZING
INSERTING
ERROR
```

Do not model the lifecycle with many unrelated booleans.

## Security

- Permanent Google API credentials belong only in the secure backend.
- Client receives short-lived credentials/tokens only.
- Do not log API keys or short-lived tokens.
- Do not permanently store microphone audio.
- Do not sync microphone audio.
- Saved Assistant conversation text may be stored for the signed-in account. Automatic dictation transcript warehouses stay out of scope. Microphone audio is never stored or synced.

## Git discipline

For each phase:

- keep changes scoped to the phase
- document important architecture decisions
- run tests/builds
- report exactly what changed
- report unresolved issues truthfully
- do not silently continue into the next phase

## When APIs differ from this spec

If a current official API differs from these documents:

1. preserve the intended architecture
2. use the current official API
3. document the deviation in the implementation summary
4. update the relevant project doc if the difference is durable
