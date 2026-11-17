# Agency MCP Phase 1: implementation and verification

Status: **Implemented on feature branch; live database and OAuth handshake pending verification**

## Scope

- Public protocol: stateless Streamable HTTP MCP at \`/functions/v1/agency-mcp\`
- Auth: OAuth Protected Resource discovery + \`withSupabase({auth:'user'})\` from Supabase, with gateway \`verify_jwt=false\` for OAuth discovery only. All tool calls still require a valid end-user token.
- Tools: \`agency_record_experience\`, \`agency_find_experiences\`
- Storage: \`public.agency_experiences\` migration; RLS owner-only SELECT/INSERT. No public read, no client UPDATE/DELETE.
- Every record begins as \`verification_status='unverified'\`. A reported success is not independently verified.
- Idempotency is scoped by (\`user_id\`, \`idempotency_key\`). Repeats return the originally stored record; they do not overwrite it.
- Search uses a generated PostgreSQL \`tsvector\` and default recent ordering. Empty query returns recent records.

## Prerequisites before connecting from ChatGPT or other OAuth MCP clients

1. Apply the reviewed additive database migration from this branch to the intended Supabase project.
2. Deploy \`agency-mcp\` with \`verify_jwt=false\` (the function performs JWT verification itself through Supabase middleware).
3. Enable the Supabase OAuth 2.1 server and configure the human-facing consent/authorization route and permitted client registration. Do not claim OAuth client sign-in works until a real client completes the flow.
4. Confirm OAuth Protected Resource metadata advertises the canonical function URL and correct issuer.
5. Connect an MCP Inspector or equivalent client; confirm \`initialize\`, \`tools/list\`, signed-in \`tools/call\` success and negative cases.

## Acceptance tests and evidence

- [ ] Deno check + Deno contract test from CI (pending actual workflow results).
- [ ] Database migration applied; row exists; RLS restricted to owner.
- [ ] Unauthenticated MCP call returns 401 + WWW-Authenticate resource metadata.
- [ ] OAuth resource metadata and authorization server issuer match.
- [ ] Tool discovery lists exactly the two intended tools.
- [ ] User A records an experience and searches for it from a fresh session.
- [ ] Repeating the same idempotency key produces one row, not two.
- [ ] Invalid arguments, excess evidence, and owner/verification spoofing are rejected.
- [ ] User B cannot read or mutate User A's record.
- [ ] External model client connection tested separately; do not infer compatibility from MCP Inspector alone.

## Deployment notes

MCP URL once deployed:
\`https://dlovrtlkniolcovfgvvj.supabase.co/functions/v1/agency-mcp\`

Important: this URL is an endpoint location, **not a claim of live functionality**. Real availability, database migration state, and OAuth provisioning must be verified after deployment.

## Follow-up scope

Do not implement capabilities or Personal Voice assistant integration in Phase 1. Proceed to Phase 2 only after the end-to-end gate passes.
