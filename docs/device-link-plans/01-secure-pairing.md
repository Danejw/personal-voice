# DeviceLink 1/6: Secure device pairing

**Status:** Planned only. No implementation authorized.
**Working branch:** `plan/device-link-01-secure-pairing`
**Merge target:** `feature/device-link-companion-mode`
**Depends on:** Base feature branch only. Must merge before PR 2.

## Objective
Add explicit and revocable trust between existing signed-in Personal Voice devices without changing the existing account-based sync UX.

### Scope and approach
1. Audit `src/devices/DeviceStore.ts`, `DevicesPanel.tsx`, `src/services/deviceService.ts`, device identity storage, and relevant Supabase migrations. Distinguish existing signed-in account registration from a *paired, authorized* device.
2. Add **Pair device** to the existing Connected Devices UI. Desktop opens a short-lived one-time QR invitation; Android scans it or enters a temporary fallback numeric code. Show both device names and require deliberate approval on the desktop before granting trust.
3. Design a compact pair-invitation exchange through authenticated, RLS-protected Supabase RPCs. Both devices must be signed in to the **same account**. Invitations expire quickly, can be consumed once, and have rate limits and attempt bounds. Reject wrong-account, expired, reused, and self-pair attempts.
4. Establish per-install cryptographic device identity, proof of private-key possession through signed challenges, and an authenticated pairing result. Prefer Android Keystore and Windows DPAPI/OS-protected storage for private keys; never store secrets in web localStorage, SQL rows, QR history, application logs, or analytics. Document key rotation and reinstall behavior.
5. Persist authorized device-pair records with minimal status, credential fingerprints/public keys, created/last verified timestamps, and revocation. Define the owner-scoped database policy and clean revocation propagation.
6. Extend the current Devices panel to identify paired vs. merely signed-in devices; support unpair/revoke. Keep the existing device rename/remove and account synchronization behavior intact.
7. Define the transport-neutral trust verification API needed by PR 2; do not implement the transport yet.

### Security decisions to enforce
- A QR code or numeric code is an invitation, never a reusable permanent login key. Numeric code lookup must be resistant to guessing.
- No direct permissions for computer control are granted just by pairing. A separately authorized control grant is handled by PR 5.
- Device removal or sign-out cannot leave a stale powerful session usable. Reject fresh requests from revoked devices server-side and receiver-side.
- Limit pairing UI to a visible, user-initiated flow; no always-open discoverable pairing mode.

### Tests / acceptance gate
- Pair Android to desktop and laptop under the same account; show both devices by the friendly names.
- Automatic recognition after app restart, with key material still OS-protected.
- Wrong account, expired token, wrong code, replay, repeated use, revoked and stale pairing all fail.
- Revoking one pair does not affect other pairs or ordinary account sync.
- Windows/Android builds plus Supabase SQL/RLS negative tests must pass. Manual physical-device pairing is required before merge.

### Out of scope
Transport, cursor streaming, AI tool routing, remote computer control, character UI, background wake-up.

## Project rules
- Follow `AGENTS.md`, `docs/SPEC.md`, `docs/ARCHITECTURE.md`, and the current implementation before changing code. The checked-in code is authoritative where reports disagree.
- Preserve the single Tauri 2/React/TypeScript app with Windows Rust and Android Kotlin behind platform boundaries. Do not build a second companion app or another AI stack.
- Keep UI minimal, borderless, and accessible. Keep existing dictation, handoffs, clipboard, Assistant, and account sync working.
- Add focused tests, document meaningful architecture decisions, and update README when user-visible capabilities or security change.
- Never claim tests or live-device validation ran until results are recorded.
- This draft PR is **PLAN ONLY**. Do not implement code or migrations until explicitly instructed.

## PR completion report required
When implementation is authorized, report (1) actual changes, (2) automated checks and CI, (3) 3–5 manual tests with expected/actual results, (4) blockers, and (5) readiness to merge.
