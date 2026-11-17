// Public MCP tool input contracts, independent of the database and transport.
import { z } from "npm:zod@^4.3.6";

export const recordInput = z.object({
  idempotency_key: z.string().uuid().describe("Fresh UUID for this logical write; repeat the same key to avoid duplicates"),
  objective: z.string().trim().min(5).max(500),
  attempted_action: z.string().trim().min(5).max(1000),
  environment: z.string().trim().min(2).max(120),
  reported_outcome: z.enum(["success", "failure", "uncertain"]),
  observation: z.string().trim().min(5).max(1500).describe("What was actually observed; not a claim of verification"),
  workaround: z.string().trim().min(5).max(1000).optional(),
  source_platform: z.string().trim().min(2).max(80).describe("E.g. chatgpt, gemini, personal-voice"),
  source_tool: z.string().trim().min(2).max(120).optional(),
  agent_id: z.string().trim().min(2).max(120).optional(),
  evidence_refs: z.array(z.string().trim().min(1).max(500)).max(8).default([]),
}).strict();

export const searchInput = z.object({
  query: z.string().trim().min(2).max(180).optional().describe("English-language search terms; omit for recent"),
  reported_outcome: z.enum(["success", "failure", "uncertain"]).optional(),
  environment: z.string().trim().min(2).max(120).optional(),
  limit: z.number().int().min(1).max(30).default(10),
}).strict();
