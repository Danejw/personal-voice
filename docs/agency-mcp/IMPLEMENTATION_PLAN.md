# Agency MCP: Collective Learning Loop

Status: **Phase 0 architecture baseline; implementation not started**  
Working branch: `feature/agency-mcp-learning-loop`  
Baseline: `main` at `4eb9334721090fdf82911a7293f5aa5ad52b808e`

## Objective

Extend the existing Personal Voice repository with an account-scoped, evidence-backed agent experience and reusable-capability system exposed to other model hosts by a standard remote MCP endpoint. No new frontend, new application, replacement assistant model, or separate product repository.

Develop **one feature branch** for this bounded initiative. Complete and verify each phase before beginning the next. Make phase-sized commits with explicit acceptance results. Leave `main` untouched until reviewed and approved. Do not deploy or merge merely because code has been written.

## Confirmed source-of-truth boundaries

| Current component | Location | Constraint |
| --- | --- | --- |
| Personal memories and versioning | `supabase/migrations/20260930230000_assistant_memories.sql` | Do not repurpose `assistant_memories` for operational experiences |
| Personal memory extraction | `supabase/migrations/20260930240000_assistant_memory_learning.sql`, `supabase/functions/memory-learn/` | Separate personal facts/preferences from learned procedures |
| Tool attempt metrics | `supabase/migrations/20261009150000_assistant_tool_reliability.sql`, `src/usage/AssistantToolMetricsStore.ts` | Metrics intentionally omit prompts/arguments/results and are not proof of goal completion |
| Personal playbook drafts | `supabase/migrations/20261009163000_assistant_insights_playbook_drafts.sql` | Explicitly non-executable; do not silently promote them |
| Gemini Live tools | `src/assistant/tools.ts` and `src/assistant/AssistantController.ts` | Existing typed validation/approval/dispatch contract is authoritative |
| Harness | `src/assistant/harness/AGENTS.md`, `toolIntelligence.ts`, `toolResults.ts`, `evals/` | Preserve outcomes: acknowledged != independently verified; any changed Live tool requires full harness parity |
| Backend | `supabase/functions/` and `supabase/migrations/` | Reuse Supabase project/auth model, not a parallel app or second identity database |

Documentation can be stale. Check implementation, tests, actual deployed migrations, and function versions before changing behavior.

## Reserved naming and placement

- MCP endpoint folder: `supabase/functions/agency-mcp/`.
- Proposed new tables: `public.agency_experiences`; later `public.agency_capabilities` and version/test records only when needed.
- Public MCP tool names **prefixed** to avoid ambiguous collisions with other connected apps, particularly the Construction OS experience tools:
  - Phase 1: `agency_record_experience`, `agency_find_experiences`.
  - Later, when real implementations exist: `agency_create_capability`, `agency_discover_capabilities`, `agency_test_capability`, `agency_execute_capability`.
- Shared domain code, if needed: `src/agency/` for application-client integration, or scoped Edge Function code for server-only logic. Do not add to `src/assistant/` merely because the feature concerns agents.
- Distinguish `reported_outcome` (`success|failure|uncertain`) from `verification_status` (`unverified|verified|disputed`). A self-reported success is **not** independently verified.
- Use stable `source_platform`, `environment`, `source_tool`, `agent_id`, `evidence_refs`, `idempotency_key`, timestamps, provenance and revision/version fields in the eventual contract. Bound all free text and evidence references. Avoid storing raw credentials, user prompts, full tool traces or screenshots by default.
- Treat all experience descriptions and externally supplied artifacts as untrusted data, never instructions or authorization grants.

Names and column details remain proposals until reviewed in Phase 1. Verify schema, endpoint compatibility, and tool names against the live environment before implementation.

## Phase gates

### Phase 0: Ground-truth audit (this document)
- Check source of truth, current main/branch, schemas, existing assistant tools, deployment state and privacy contracts.
- Reconcile live DB migrations and existing Edge Functions where connector access permits; document any gap.
- Establish naming, permission, evidence and acceptance contracts.
- **Gate:** documented audit and no name collisions; phase 1 implementation scope agreed.

### Phase 1: Experience MCP, isolated from existing memories
- Add one additive migration with owner-scoped `agency_experiences`, strict validation, RLS, deduplication/idempotency, source provenance and bounded evidence references.
- Add one authenticated Streamable HTTP MCP Edge Function with `agency_record_experience` and `agency_find_experiences`.
- Use verifiable user authorization. Do not assume the Supabase browser client JWT flow is automatically equivalent to a remote MCP OAuth connection.
- Keep endpoints disabled in production until tests and a release decision. No paid inference required.
- **Gate:** MCP handshake/discovery; authenticated record + fresh-session retrieval; duplicate write handling; invalid payload rejection; isolation between two users; unauthorized requests denied; structured errors; repeatable tests.

### Phase 2: Two-model, one-account learning
- Wire an explicit, consent-aware experience submission path from existing Personal Voice tool results where appropriate. Do **not** repurpose opt-in usage metrics or silently copy raw tool arguments.
- Test one host writing and another authorized MCP client reading the same experience; record exact client, tool, request, and retrieved record.
- External MCP clients do not automatically grant this server access to their other connectors.
- **Gate:** successful cross-client retrieval, provenance retained, and account isolation verified; if ChatGPT connection is unavailable use a standard MCP test client and record the blocker without declaring a ChatGPT pass.

### Phase 3: Candidate capability compilation
- Add versioned candidate capability schema and `agency_create_capability` + `agency_discover_capabilities`.
- Derive a declarative procedure from relevant evidence and explicitly listed authorized prerequisites. No arbitrary code execution and no automatic publication.
- **Gate:** new model/session can discover a candidate that traces to real experiences; rejects fabricated tools and untrusted instructions.

### Phase 4: Capability testing and execution
- Add `agency_test_capability` and `agency_execute_capability` only after defining the executor contract.
- Prefer host-assisted steps using tools the model host already has; add a standalone worker only for verified independent-execution needs.
- Distinguish test receipts, action acknowledgments, and independent end-state observations; apply existing consent and approval rules.
- **Gate:** another client runs a skill with a changed input, reports externally observable evidence, and fails safely if permissions or tools are unavailable.

### Phase 5: Learning improvements
- Record real capability executions, evaluate failed/successful versions, propose candidate revisions, test regressions and promote only verified improvements.
- **Gate:** one demonstrated improvement on a new case, with rollback and provenance.

### Phase 6: Optional collective sharing across accounts
- Private by default. User-opt-in sharing of sanitized, licensed, provenance-preserving capabilities; never share private source records by default.
- **Gate:** cross-account reuse without reading another account's private experiences.

## Delivery workflow (all phases)

1. Inspect the authoritative files and contracts before editing; use the *same feature branch*, not a new branch per phase.
2. Make a small scoped commit or set of commits for one phase.
3. Run targeted unit/integration/security tests, `pnpm check`, `pnpm eval:tools` when touching the Assistant, and existing relevant CI. A green mock evaluation is not proof of live model behavior.
4. Run the MCP protocol/client tests in an isolated environment. Record exact code commit, database migration version, Edge Function version, MCP client, tool names and verified results.
5. Publish or deploy only after review of security and migration impacts; do not use the production database as a disposable test fixture.
6. Report observed successes, failures, blockers, costs, remaining manual tests, and a Go/No-Go decision before progressing.

## First executable milestone

Only **Phase 1** is the next implementation scope: authenticated `agency_record_experience` + `agency_find_experiences`, additive private persistence, tests and a callable real MCP endpoint. Everything else is design-only until that gate passes.

## Explicit non-goals

No frontend/dashboard, no universal agent kernel, no new chat/model service, no broad automatic capture of personal activity, no autonomous cross-platform execution worker, no unrelated refactor, no deployment or merge without authorization, and no new branch for each development phase.
