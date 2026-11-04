# DeviceLink real-device acceptance

**Release gate:** Pending physical validation. This document is a test plan and evidence log, not a claim that tests passed.

**Test build:** DeviceLink integration plus PR #41 commits. Record the tested Windows executable, Android APK, Windows OS version, Android version, Wi-Fi/network and date in the PR before sign-off.

## Prerequisites

1. Install matching development builds on one Android phone and two Windows computers. Sign in to the same authorized account.
2. Apply the signing migration (`20261105010000_remote_voice_proofs.sql`) **before** the trusted grants migration (`20261106010000_trusted_remote_grants.sql`); deploy the matching `device-pairing` Edge Function. Do not use signed-v2 clients with the older database.
3. Confirm the Windows **Remote computer actions** master switch is off by default. Trusted control requires a separate PC-originated grant and a running, unlocked interactive desktop.
4. Keep application logs free of signing keys, raw audio, screenshots, cursor histories and the contents of remote commands.

## Required physical test evidence

| ID | On real devices | Expected result | Actual |
| --- | --- | --- | --- |
| P1 | Pair Android to laptop via QR/code, then to desktop; restart each app | Both pairings remain cryptographically verified; no duplicate link or arbitrary default | **NOT RUN** |
| P2 | With both PCs paired, enter Companion before selecting a PC | Phone asks for exact PC; neither computer sends cursor samples | **NOT RUN** |
| P3 | Select desktop in Companion and move pointer across left/center/right monitors with mixed DPI and negative coordinates | Only the desktop drives gaze, with correct monitor placement and no screen pixels sent | **NOT RUN** |
| P4 | Switch to laptop, background Android, foreground it, then exit Companion | Old desktop stops; only laptop streams when visible; no stale gaze after reconnect | **NOT RUN** |
| P5 | Change Wi-Fi, disable local network, enable mobile data and ask Assistant to open Calculator on specifically named PC | Cloud wake/authoritative request works where online, execution is verified by signed PC receipt; no Companion gaze over cellular | **NOT RUN** |
| P6 | Ask for Notepad without a trusted grant and with the Windows master switch enabled | Windows shows per-action approval; denial does not execute | **NOT RUN** |
| P7 | Grant trusted control *on Windows* to one paired phone, then open Calculator and press Escape/Tab | Only that paired phone can run those allowlisted actions without per-action PC approval; grant expires | **NOT RUN** |
| P8 | Ask to type text, paste, send email, delete, run a shell or control arbitrary UI while a trusted grant is active | No trusted bypass; manual confirmation or explicit refusal according to original tool policy | **NOT RUN** |
| P9 | Lock Windows with Win+L, revoke pairing, stop grant, sign out and allow expiry; re-issue a pending request after each | No unattended execution; no fallback to another PC; locked/revoked/expired responses are honest | **NOT RUN** |
| P10 | Interrupt the PC network during an action, reconnect, repeat same request ID, restart tray and reopen Android app | No duplicate execution; pending actions recover or expire safely | **NOT RUN** |
| P11 | On both platforms exercise normal dictation, remote dictation, clipboard, handoffs, notes and Assistant conversation recall | Existing workflows unchanged, with no new prompts or privacy regressions | **NOT RUN** |
| P12 | Test screenshots, Windows accessibility actions, foreground/background battery usage, CPU and pointer frame pacing | Consent and safety boundaries preserved; no material performance regression | **NOT RUN** |

For every executed test, replace **NOT RUN** with PASS/FAIL and attach exact observation, device build, date, and any issue link. Do not mark PASS because a simulator, unit test, or CI job passed.

## Failure triage

- **Pairing:** Check both apps are signed in, the invitation is unexpired, and approval happened on the correct Windows PC. A trusted grant is not a substitute for pairing.
- **Companion:** Requires a visible Android Companion screen and direct local Wi-Fi. Select the exact PC. Cloud signaling never carries gaze, screen pixels, audio or cursor histories.
- **Remote voice:** Verify both migrations and the matching Edge Function are deployed, and that the target PC is running, online and unlocked. A queued wake is not an execution receipt.
- **Trusted control:** Enable the Windows master switch first; create the separate short-lived grant on that PC. Only Notepad/Calculator and Escape/Tab are grant-eligible. Everything else remains manually approved or unavailable.
- **Connection change:** After network switch, refresh Devices or re-open Companion. Never assume a different device becomes the target automatically.

## Release decision

- **Automated tests:** Record exact head SHA, Windows/Android CI links and results in PR #41.
- **Backend rollout:** NOT DEPLOYED as of this checklist's creation; verify again before claiming readiness.
- **Physical tests:** NOT RUN. No Windows/Android hardware sessions are accessible through GitHub CI.
- **Main-branch merge:** BLOCKED until P1–P12 are executed with recorded evidence, required backend is available and no critical security or connection regressions remain.
