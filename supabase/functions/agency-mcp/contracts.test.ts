import { assert, assertEquals } from "jsr:@std/assert@1.0.16";
import { recordInput, searchInput } from "./contracts.ts";

const valid = {
  idempotency_key: "a8f2e588-6976-45d4-9610-a0bebd5725ee",
  objective: "Document reliable note export",
  attempted_action: "Read the note and save a markdown export",
  environment: "personal-voice-windows",
  reported_outcome: "success",
  observation: "Saved file was reopened and its contents matched",
  source_platform: "personal-voice",
  evidence_refs: ["https://example.org/test-evidence"],
};

Deno.test("accepts a bounded record and defaults no verified status", () => {
  const result = recordInput.safeParse(valid);
  assert(result.success);
  assertEquals(result.data.evidence_refs.length, 1);
  assert(!("verification_status" in result.data));
  assert(!("user_id" in result.data));
});

Deno.test("rejects client-selected ownership and verification claims", () => {
  assert(!recordInput.safeParse({ ...valid, user_id: "another-user" }).success);
  assert(!recordInput.safeParse({ ...valid, verification_status: "verified" }).success);
});

Deno.test("rejects invalid outcome, idempotency and oversized evidence", () => {
  assert(!recordInput.safeParse({ ...valid, reported_outcome: "verified" }).success);
  assert(!recordInput.safeParse({ ...valid, idempotency_key: "repeat" }).success);
  assert(!recordInput.safeParse({ ...valid, evidence_refs: Array(9).fill("https://example.org") }).success);
  assert(!recordInput.safeParse({ ...valid, objective: "x".repeat(501) }).success);
});

Deno.test("search defaults to a bounded result and rejects unknown filters", () => {
  const parsed = searchInput.parse({});
  assertEquals(parsed.limit, 10);
  assert(!searchInput.safeParse({ limit: 31 }).success);
  assert(!searchInput.safeParse({ user_id: "someone-else" }).success);
});
