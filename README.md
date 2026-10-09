<p align="center">
  <img src="src-tauri/icons/icon.svg" alt="Personal Voice icon" width="80" height="80" />
</p>

<h1 align="center">Personal Voice</h1>

<p align="center">
  <strong>Dictate anywhere. Talk to an assistant that can use your devices.</strong><br />
  One personal Windows + Android app for dictation, saved knowledge, and a Gemini Live assistant.
</p>

<p align="center">
  <a href="https://github.com/Danejw/personal-voice/releases/latest">Latest release</a>
  · <a href="#getting-started">Get started</a>
  · <a href="#features">Features</a>
  · <a href="#assistant-and-tool-harness">Assistant harness</a>
  · <a href="#development">Development</a>
  · <a href="#documentation">Documentation</a>
</p>

---

## What it does

Personal Voice has two connected but independent experiences:

- **Dictation:** hold your chosen hotkey or floating microphone, speak, and release. Gemini finalizes the speech with punctuation and cleanup; Personal Voice inserts the result at the cursor or sends it to your chosen destination.
- **Assistant:** start a real-time **Gemini 3.8 Live** voice conversation or send typed messages. The Assistant can draw on explicitly available account context and use bounded tools to inspect information, manage notes and memories, and carry out supported device actions.

Both run from the same **Tauri 2** application, with shared TypeScript logic and platform-specific Windows/Android implementations. Dictation uses **Gemini 3.5 Transcribe Live**; Assistant uses a separate **Gemini 3.8 Live** session. They do not record microphone audio into a persistent transcript warehouse.

### Basic controls

| Platform | Dictation | Assistant |
| --- | --- | --- |
| **Windows** | Configurable global shortcut or floating control; release to insert or route the final text | Assistant page, typed messages or live microphone conversation; optional desktop inspection and approved controls |
| **Android** | Floating microphone and supported native input integration; hold-to-talk destinations | Assistant page with voice/typed conversation, notes, camera context, and supported account/cross-device tools |

Sign in and complete the device-permission onboarding before using microphone, overlay, or platform-dependent features. Windows-only accessibility and window tools do **not** run locally on Android.

## Features

| Area | What is available |
| --- | --- |
| **Dictation** | Hold-to-talk, Gemini transcript cleanup, selectable destinations, per-device keybindings/controls, voice start/stop sounds, microphone selection where supported |
| **Destinations** | Focused text field, saved Notes, and **Remote Dictation** to another selected device's focused cursor |
| **Dictionary, Snippets & Transforms** | Personal vocabulary; deterministic trigger-to-text snippet expansion; built-in and custom text transforms |
| **Selection & history** | Capture selected text for further use; recent local dictations with optional account sync of final text |
| **Notes & Handoffs** | Saved, editable Notes; send items to another signed-in device's handoff inbox; continue an Assistant conversation on another device |
| **Assistant conversation** | Chat-first workspace with a searchable thread rail, new conversation, resume/rename/delete, full-height transcript, typed/voice turns and Google Search grounding |
| **Visual awareness** | Explicit screen snapshots, selected text, cursor/pointer inspection on Windows, accessibility-tree inspection, camera photos, and user-requested ongoing Camera Context |
| **Device actions** | Allowlisted Windows application/window/UI Automation actions; bounded supervised screen workflows; supported remote Windows reads/actions with existing approval controls |
| **Memory** | Explicit remember/edit/forget, memory learning, semantic retrieval, source indexing and a **Memory** page showing a read-only network of memories and connections |
| **Insights & Analytics** | Analytics now offers **Dictation / Assistant** views: measured Assistant sessions, finalized turns, bounded active time, daily activity, voice/typed use and device totals. The separate Insights page still analyzes dictation patterns and offers reviewable suggestions. The **Tools & Reliability** tab now measures tool attempts, outcome classifications, failure reasons and latency. **Insights → Your Assistant** now provides a persistent, evidence-based communication-style profile and practical messaging tips, with the same usage charts as Your Voice for measured peak days/times, device share, input modes and tool categories. Dictation and Assistant suggestions appear together under **Suggestions**. Personal Playbooks remain account-owned **non-executable drafts**, separate from system playbooks. |
| **Devices & Settings** | Signed-in device management, local controls, sync preferences, Assistant auto-run/review controls, and app updates |

Some features require an authenticated account, a synced device, Windows OS APIs, user permission, or separately configured backend services. A declared Assistant tool is not a promise that the capability is available on every device.

### Navigation

The app sidebar contains **Voice** (Dictations, Dictionary, Selection, Notes, Handoffs, Snippets, Transforms), **Assistant**, **Memory**, **Insights**, **Analytics**, **Devices & Controls**, and **Settings**. On Android and narrow windows this appears as a menu drawer.

The **Assistant** page opens on the Conversation view, with a searchable left thread rail on desktop and a collapsible history drawer on narrow screens. Select a saved thread and press **Continue conversation** to resume it. **New conversation** starts an independent thread. **Settings** contains memory learning, semantic search, notes/dictation recall and saved-memory management; **Advanced tools** contains optional screen, camera and accessibility controls. When a session is idle, the composer is disabled until you start/continue it.

## Assistant and tool harness

The Assistant is not an unrestricted computer agent. It uses a defined set of Gemini Live function declarations, typed validation, existing confirmation settings, and real platform executors. For complex tasks, the harness supplies guidance about which supported tool to use and how to interpret its result.

| Layer | Implementation | Responsibility |
| --- | --- | --- |
| Live tools | [`src/assistant/tools.ts`](src/assistant/tools.ts) | Function declarations, schemas, argument validation and routing |
| Execution | [`AssistantController.ts`](src/assistant/AssistantController.ts) | Tool queue, confirmation/auto-run rules, dispatch and function responses |
| Tool intelligence | [`toolIntelligence.ts`](src/assistant/harness/toolIntelligence.ts) | Intent, platform, alternatives, next steps and verification hints |
| On-demand playbooks | [`playbooks/`](src/assistant/harness/playbooks/) | Seven reference workflows for screen, Windows, notes, memory, cross-device, content and camera tasks |
| Context guidance | [`contextAssembler.ts`](src/assistant/harness/contextAssembler.ts) | Trusted Windows/Android capability notes and brief guidance for complex typed requests |
| Result interpretation | [`toolResults.ts`](src/assistant/harness/toolResults.ts) | Separate observed information, action acknowledgements, incomplete tasks, errors and bounded recovery guidance |
| Evaluation | [`evals/`](src/assistant/harness/evals/) | Tool-route fixtures, catalog drift checks, offline regressions, optional sanitized live traces and independent goal scoring |

**At the PR #26 baseline:** the catalog contains **54 declared tools** and **81 evaluation scenarios** (54 tool-specific, 20 disambiguation, seven no-tool). These numbers change when tools are added or retired; the source code, not this snapshot, is authoritative.

Important boundaries:

- A tool reporting success does **not** by itself prove that the requested goal was reached. The harness distinguishes an acknowledgement from an observed end state.
- Playbooks load **on demand**, not before every simple command. No extra planner/model call is required by the harness.
- Context guidance uses known platform/device information; it does not assume a registered remote device is online. Spoken requests use device capability context; short deterministic task hints currently apply to *typed* multi-step requests.
- Tool selection does **not** expand permissions. User confirmation, auto-run preferences, platform capability checks and action allowlists still apply.
- Evaluations are offline by default. Scripted/mock passing scores measure regression mechanics, **not actual Gemini success rates**. Real model evaluation requires opt-in trace capture and independent observation.

See [Assistant phase reports](docs/Assistant-Phases/), including [tool registry](docs/Assistant-Phases/16-tool-intelligence-harness.md), [playbooks](docs/Assistant-Phases/17-tool-playbooks.md), [result intelligence](docs/Assistant-Phases/18-tool-result-intelligence.md), [context routing](docs/Assistant-Phases/19-context-aware-tool-guidance.md), and [evaluation framework](docs/Assistant-Phases/20-tool-use-evaluation-framework.md).

## Privacy and safety

- **Microphone audio** connects directly from the device to Gemini for the active session; Personal Voice does not proxy or permanently store it.
- **Camera Context** is user-initiated, uses device permissions, sends frames to Gemini Live and does not save frames in the Personal Voice backend. See [Camera Context](docs/Camera-Context-Phases/README.md).
- **Cloud storage is selective:** saved account content such as Notes, Handoffs, conversations and explicit memories may sync. Recent dictation **text** sync remains an independent opt-in setting. For newly created accounts, the four Assistant memory/recall settings default on: learning from newly saved Assistant user messages, semantic search, saved notes retrieval and synced dictation retrieval. Existing account settings, including prior opt-outs, are not overwritten. Turning on dictation retrieval alone never uploads local-only dictations.
- **Insights/analytics:** with Usage Intelligence enabled, Assistant Analytics captures metadata-only events (no prompts, transcriptions, tool arguments or screenshots) under an owner-scoped, epoch-protected Supabase table. Clearing Analytics deletes dictation, Assistant session, and tool-metadata events after both Phase A and Phase B migrations. Inspect and control what context is shared with Assistant in Settings. Assistant semantic Insights separately requires explicit per-run consent; at most 80 recent saved user-message excerpts are sent to the configured Gemini function, never in the background.
- **Remote actions and desktop controls** require the supported platform, a permitted target and applicable approvals. There is no general-purpose shell tool.
- **Evaluation capture** is off by default, available in development only, and records tool names/timing/outcome categories rather than text, arguments, audio, screenshots or credentials.
- Permanent Gemini credentials remain on the secure backend; clients receive short-lived tokens. Never commit API keys or Supabase service-role secrets.

## Getting started

### Install a release

See the [latest GitHub release](https://github.com/Danejw/personal-voice/releases/latest) for Windows installers and Android APKs. Windows uses the built-in signed updater after installation; Android updates are installed from the published APK. Release versions are defined in [`package.json`](package.json) and must agree with the Rust crate version—do not rely on a version number hard-coded in this README.

Full installation, signing, updater and release procedures: [`docs/RELEASING.md`](docs/RELEASING.md).

### Development — Windows

**Prerequisites:** Node.js **22.12+**, **pnpm 11.25.0**, Rust toolchain, MSVC Build Tools and WebView2. See [Windows setup](docs/WINDOWS.md) and the pinned toolchain/config files for native requirements.

```powershell
# Copy .env.example to .env.local and enter only your public Supabase client settings.
pnpm install --frozen-lockfile
pnpm tauri dev
```

`pnpm dev` runs the Vite frontend **without** the native Tauri shell; use `pnpm tauri dev` when testing actual microphone, overlay, window and OS integration.

Client `.env.local` values:

```dotenv
VITE_SUPABASE_URL=https://<project-ref>.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
```

A configured Supabase project and its expected functions/migrations are required for login, tokens and cloud-backed features. Do **not** put permanent Gemini keys or a Supabase service-role key in client variables.

### Development — Android

Requires Android Studio, Java/Android SDK, appropriate NDK, a configured emulator or device, and the Rust Android target. Detailed environment setup is in [`docs/ANDROID.md`](docs/ANDROID.md).

```powershell
rustup target add aarch64-linux-android
pnpm tauri android dev
# Or make a local debug APK:
pnpm tauri android build --debug --apk --target aarch64
```

For Android native builds from Windows, use a **filesystem with symlink support** (such as an NTFS checkout). An exFAT checkout can fail at Tauri's native-library symlink stage. Release builds are normally produced by GitHub Actions.

## Development and quality

### Checks

```powershell
pnpm check        # ESLint + TypeScript + Vitest
pnpm eval:tools   # Offline Assistant tool-use and catalog-drift regression tests
pnpm build        # Frontend typecheck + production Vite bundle
cargo check --locked --manifest-path src-tauri/Cargo.toml
cargo test --locked --manifest-path src-tauri/Cargo.toml
```

The GitHub **Validate** workflow runs Windows TypeScript/tests, the offline harness suite and Rust checks/tests, as well as an Android debug APK build and native tests. A green scripted eval does not substitute for actual on-device behavior or independently verified Assistant task completion.

For optional *real* Assistant evaluation, see [`docs/Assistant-Phases/20-tool-use-evaluation-framework.md`](docs/Assistant-Phases/20-tool-use-evaluation-framework.md). It describes the development-only `window.__pvToolEval` interface, sanitized JSON import, modality/platform breakdowns and explicit observed-goal checks. No real model calls or credits are used by the offline CI suite.

### Contributing and keeping tool guidance current

**Read the agent instructions before editing:**

- [Root `AGENTS.md`](AGENTS.md) — repository boundaries, feature architecture, security, PR acceptance and manual QA.
- [`src/assistant/harness/AGENTS.md`](src/assistant/harness/AGENTS.md) — mandatory **same-PR tool lifecycle checklist** for adding, changing, renaming or retiring any Assistant tool.
- [`docs/SPEC.md`](docs/SPEC.md) and [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — product and architecture references; when a historical document conflicts, verify the live implementation.

Every Assistant tool change must consider the **Live declaration → typed validation → platform executor/permissions → intelligence profile → playbooks/context → result interpretation → evaluation fixtures/tests** chain. The automated drift guard checks that tool declarations, router cases, intelligence profiles and base scenarios stay aligned. It cannot detect all semantic or platform regressions, so update targeted tests and manually verify real behavior.

Before merging a PR: run `pnpm check` and `pnpm eval:tools`, review **both** Windows and Android CI results, and provide a brief manual test procedure with expected outcomes.

## Documentation

| Topic | Reference |
| --- | --- |
| Product specification and architecture | [SPEC](docs/SPEC.md) · [ARCHITECTURE](docs/ARCHITECTURE.md) |
| Dictation and personal-voice features | [PV phase reports](docs/PV-Phases/README.md) |
| Assistant and the tool harness | [Assistant phase reports](docs/Assistant-Phases/) · [Tool evals](docs/Assistant-Phases/20-tool-use-evaluation-framework.md) · [Assistant Analytics Phase A](docs/Assistant-Phases/21-assistant-usage-analytics.md) · [Tool Reliability Phase B](docs/Assistant-Phases/22-assistant-tool-reliability.md) · [Assistant Insights Phase C](docs/Assistant-Phases/23-assistant-insights-and-playbook-drafts.md) |
| Cross-device insertion | [Remote Dictation](docs/Remote-Dictation-Phases/README.md) |
| Camera context | [Camera Context](docs/Camera-Context-Phases/README.md) |
| Windows/Android platform notes | [WINDOWS](docs/WINDOWS.md) · [ANDROID](docs/ANDROID.md) |
| Notes, handoffs, authentication and syncing | [Backend & Sync](docs/BACKEND_SYNC.md) |
| Snippet expansion | [SNIPPETS](docs/SNIPPETS.md) |
| Tests, installers and app updates | [TESTING_RELEASES](docs/TESTING_RELEASES.md) · [RELEASING](docs/RELEASING.md) |

---

This repository is a personal app under active development. GitHub release availability, platform requirements and feature readiness may differ from the current development branch; verify release notes before installing.
