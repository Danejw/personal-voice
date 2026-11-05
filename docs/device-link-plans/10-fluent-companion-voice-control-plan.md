# PR3 plan: Fluent Companion conversation with live Windows task control

Status: planning only. Follow PR1 paired connection and PR2 Windows-owned durable tasks. No new assistant brain.

## User experience
Talk naturally to Gemini Live on Android while the selected Windows computer works. The Companion can answer other questions immediately, report actual task progress, accept follow-up instructions, interrupt, pause or stop a task, and reconnect later without losing the job. No need to end the voice conversation to use computer tools. The PC executes; phone converses.

## Reuse
- Existing Gemini Live `AssistantSession` and `AssistantController`; platform-neutral `src/assistant/tools.ts` declarations and the existing harness intelligence, result classification and eval fixtures.
- Existing signed `remote_action` dispatch and target selection; Companion animated character and cursor/gaze view; current Android lifecycle/reconnect behavior.
- PR1 authenticated delivery and PR2 persistent Windows-owned job status, signed events, approvals and goal control.
- Bluey reference idea: model function call → paired computer tool execution → return structured result. Do not port Swift code or route Windows tool activity through the phone's continued voice socket.

## Source audit
Map the actual Android Assistant tool declarations, tool decision paths, speech interruption behavior, Companion UI, pairing selected target, conversation history and signed remote controls. Identify unsupported capabilities honestly; current main code and tests override phase documents.

## Planned changes
1. Android Gemini Live owns fluent realtime speech and conversation. Its computer-task delegation tool should send one bounded, structured `start_computer_goal` to a named paired PC and return promptly with a durable job ID and accepted status. Windows model owns the ongoing multi-step execution and tool calls.
2. Expose a minimal set of functions to the voice model: start task, query task, send follow-up instruction, pause/resume, cancel. Reuse existing tool names/routes where possible and update `tools.ts`, harness registry, result rules, playbooks and evals in the same implementation PR when semantics change.
3. Separate the conversational turn from execution: long Windows tasks never block Gemini Live microphone/replies. Keep direct provider voice streaming; no phone-side screenshot proxy and no raw model reasoning stream.
4. Use the PR2 job record and signed event snapshots to populate a single minimal Companion job view: selected PC, concise goal, status, latest verified activity, and Pause/Resume/Stop. Show confirmation requests with precise operation and source PC, deadline, explicit accept/deny; no approval from another paired phone without explicit matching authorization.
5. Handle conversational redirection: 'also check GitHub issues' targets the current job only when uniquely identified and owner-authorized. Append instruction to existing job at a safe boundary; the Windows model incorporates it in its next reasoning step. If ambiguous, ask which task/PC; if irrevocable side effect already underway, clarify what cannot be undone.
6. Updates should be low-volume and relevant: started, significant milestone, waiting approval, blocked, verified done; don't narrate every mouse movement. Verbal completion only on signed, verified terminal outcome. Reconnect reads authoritative persisted job instead of cached voice memory.
7. Multiple computers: require explicit selected target with clear handoff; one active desktop-control goal per PC. No silent switching to a different machine and no simultaneous competing controllers on the same desktop.
8. Preserve existing Companion visual style and animations, avoid extra dashboards, badges and redundant microcopy, and use the current settings/permission system.

## Safety and operational contract
- Never tell user 'done' merely from accepted command, tool ACK or model's narration.
- PC-locked/offline, phone disconnected, user approval pending, worker restarting and goal unverified must be distinguishable.
- No cloud microphone/audio relay; no unsolicited screen pixel transfer, no permanent API keys; no remote approval bypass.
- Cancel is cooperative with clear acknowledgement; report if an already committed action cannot be rolled back.

## Acceptance tests
- Android asks to open application and inspect an error; Gemini replies promptly as Windows takes actions.
- User asks an unrelated conversational question during Windows task; speech remains fluent and task continues.
- User redirects the current task; instruction is delivered once, integrated by Windows reasoning model; no duplicate job.
- Android voice socket drops/restarts; Companion resumes same job and correct progress.
- Win PC disconnects, locks, or revokes pairing; phone reports blocked/interrupted rather than completed.
- User pauses, resumes, stops; request signatures, origin, expiry and target are verified; tests for second-phone denial.
- Physical tests include real Android speech barge-in, backgrounding, two PCs and independently verified multi-step final result.
- Automated tests include tool/harness parity, confirmations, result classification, race/interruption, and Android/Windows CI. Run `pnpm check` and `pnpm eval:tools`; record exact SHA and real-device evidence.

## Out of scope
No new planner, multi-agent management framework, model provider, event bus, large dashboard, or replacement assistant UI. Do not implement PR2 persistence inside PR3. Planning-only PR; no app code, migrations or tests run and not ready as a released feature.
