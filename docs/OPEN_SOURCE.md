# Open source and independent deployment

Personal Voice is an independently developed **open-source replacement for Wispr Flow** on **Windows and Android**. Wispr Inc. is not affiliated with the project. Supported platforms and individual features differ; macOS and iOS apps have not been implemented.

## What is open source?

The application code, Windows/Rust integration, Android integration, Supabase SQL migrations and Edge Functions live in this repository under the [MIT License](../LICENSE). Third-party dependencies retain their own licenses. A self-hosted deployment requires services that may incur charges.

## What is required?

- A working Node.js, pnpm, Rust, Tauri and Android/Windows build environment. See [README](../README.md) and the platform docs.
- A **separate Supabase project** for authentication, stored data and Edge Functions. Apply the repository's `supabase/migrations/` in order and deploy the functions needed by your chosen features.
- A Google Gemini API project and an API key held **only in server-side secrets**, not in the client build.
- Build-time public `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` values for your Supabase project.

The app's dictation and Assistant models currently depend on Gemini's hosted Live APIs. It is **not offline-first transcription**, does not bundle free inference, and is not currently a drop-in, one-command self-hosted deployment.

## Backend and build isolation

Before distributing a fork, review [`src-tauri/tauri.conf.json`](../src-tauri/tauri.conf.json). The current CSP `connect-src` allowlist contains the maintainer's deployed Supabase origin. Point it at **your own** backend origin; changing only `.env.local` is not sufficient. The Windows updater and GitHub release endpoints are likewise configured for the upstream repository and should be reviewed before distributing forked installers.

Check all of the authentication, Edge Function deployment, RLS policies, CORS handling and storage configurations for your environment. The `gemini-token` function verifies Supabase authentication but does **not** implement application-level subscription checks, per-user quotas or billing isolation. If you permit unrestricted public signups, users of your instance may consume your Gemini API credits. Add appropriate service controls before opening registration.

Never commit `GEMINI_API_KEY`, service-role secrets, signing material, or personal user data. The checked-in `.env.example` describes client-safe settings only.

## Practical build notes

Use [`docs/WINDOWS.md`](WINDOWS.md), [`docs/ANDROID.md`](ANDROID.md), [`docs/BACKEND_SYNC.md`](BACKEND_SYNC.md) and [`docs/RELEASING.md`](RELEASING.md) for platform and server details. Existing GitHub release installers were built against the publisher's configured backend, not your independent instance.

Self-hosters should validate sign-in, dictation, Assistant token issuance, RLS boundaries, and model API charges before onboarding users. The ability to compile the source does not mean every cloud feature works without setup.
