# Contributing to Personal Voice

Thanks for considering a contribution. Personal Voice is an independent open-source project for Windows and Android.

Start with [`README.md`](README.md), [`AGENTS.md`](AGENTS.md), the relevant platform docs, and [`docs/OPEN_SOURCE.md`](docs/OPEN_SOURCE.md) for backend requirements. The source code and regression tests are the authority when older phase notes disagree with current behavior.

For a code contribution, make a focused branch and pull request. Explain the behavior changed, any platform limitations, and the manual steps used to verify it. For Assistant tool modifications, follow [`src/assistant/harness/AGENTS.md`](src/assistant/harness/AGENTS.md) and update the declaration, validation, execution, permission and evaluation paths together.

Run `pnpm check` and `pnpm eval:tools` where possible. For Rust modifications run `cargo check --locked --manifest-path src-tauri/Cargo.toml` and relevant tests. Windows and Android changes also need on-device validation; passing mocks are not evidence that live API or device interactions work.

Do not commit API keys, signing keys, account data or personal transcription content. Report potential vulnerabilities privately through GitHub's security advisory mechanism if enabled; do not post working exploit details or credentials in a public issue.

This project is not affiliated with Wispr Inc. or Wispr Flow.
