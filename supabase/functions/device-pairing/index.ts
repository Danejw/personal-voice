import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.58.0";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, x-client-info, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};
type JsonRecord = Record<string, unknown>;
const operations = new Set(["register", "invite", "claim", "read", "approve", "cancel", "list", "revoke", "signal", "trusted_start", "trusted_stop", "trusted_list", "trusted_claim", "trusted_validate", "trusted_seen", "auto_claim", "auto_validate", "auto_seen"]);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const proofPattern = /^[A-Za-z0-9_-]{86}$/;
const keyPart = /^[A-Za-z0-9_-]{43}$/;

function reply(status: number, payload: JsonRecord) {
  return new Response(JSON.stringify(payload), { status, headers: cors });
}
function object(value: unknown): JsonRecord | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord : null;
}
function string(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}
function normalizedKey(value: unknown): JsonRecord | null {
  const row = object(value);
  if (!row || row.kty !== "EC" || row.crv !== "P-256" || !keyPart.test(string(row.x) ?? "")
    || !keyPart.test(string(row.y) ?? "") || Object.keys(row).sort().join() !== "crv,kty,x,y") {
    return null;
  }
  return { kty: "EC", crv: "P-256", x: row.x, y: row.y };
}
function decodeBase64Url(value: string): Uint8Array {
  const decoded = atob(value.replace(/-/g, "+").replace(/_/g, "/") + "==");
  return Uint8Array.from(decoded, c => c.charCodeAt(0));
}
async function verify(key: JsonRecord, message: string, signature: string): Promise<boolean> {
  try {
    if (!proofPattern.test(signature)) return false;
    const imported = await crypto.subtle.importKey("jwk", { ...key, ext: true },
      { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
    return await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" },
      imported, decodeBase64Url(signature), new TextEncoder().encode(message));
  } catch { return false; }
}
function approvalMessage(id: string, issuer: string, claimant: string, key: JsonRecord): string {
  return `personal-voice:approve:v1:${id}:${issuer}:${claimant}:${key.x}:${key.y}`;
}
function uuidArg(value: unknown): string | null {
  const val = string(value);
  return val && uuid.test(val) ? val : null;
}
function dataError(error: unknown): boolean { return !!error; }

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response(null, { headers: cors });
  if (request.method !== "POST") return reply(405, { error: "method" });
  const auth = request.headers.get("Authorization")?.match(/^Bearer (.+)$/i)?.[1];
  if (!auth) return reply(401, { error: "auth" });
  const url = Deno.env.get("SUPABASE_URL");
  const secret = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !secret) return reply(503, { error: "unavailable" });

  // The service-role credential never leaves this function. Every operation must
  // authenticate a real user, verify the native device signature, then check owner IDs.
  const admin = createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: authData, error: authError } = await admin.auth.getUser(auth);
  const userId = authData.user?.id;
  if (authError || !userId) return reply(401, { error: "auth" });

  let body: JsonRecord | null;
  try { body = object(await request.json()); } catch { return reply(400, { error: "bad_request" }); }
  const payload = string(body?.payload);
  const signature = string(body?.signature);
  if (!payload || payload.length > 4096 || !signature || !proofPattern.test(signature)) {
    return reply(400, { error: "bad_request" });
  }

  let command: JsonRecord | null;
  try { command = object(JSON.parse(payload)); } catch { return reply(400, { error: "bad_request" }); }
  const op = string(command?.op);
  const deviceId = uuidArg(command?.deviceId);
  const nonce = uuidArg(command?.nonce);
  const issuedAt = command?.issuedAt;
  const args = object(command?.args);
  if (command?.v !== 1 || !op || !operations.has(op) || !deviceId || !nonce
    || typeof issuedAt !== "number" || !Number.isSafeInteger(issuedAt) || Math.abs(Date.now() - issuedAt) > 120000
    || !args || Object.keys(command ?? {}).sort().join() !== "args,deviceId,issuedAt,nonce,op,v") {
    return reply(400, { error: "bad_request" });
  }
  // Reject rewritten JSON or a request with unexpected unsigned fields.
  if (payload !== JSON.stringify({ v: 1, op, deviceId, nonce, issuedAt, args })) {
    return reply(400, { error: "bad_request" });
  }
  const { data: device, error: deviceError } = await admin
    .from("devices").select("id,platform").eq("id", deviceId).eq("user_id", userId).maybeSingle();
  if (deviceError || !device) return reply(403, { error: "device" });

  let identityKey: JsonRecord | null;
  if (op === "register") {
    identityKey = normalizedKey(args.publicJwk);
  } else {
    const { data: identity, error: identityError } = await admin
      .from("device_pair_identities").select("public_jwk")
      .eq("device_id", deviceId).eq("user_id", userId).maybeSingle();
    if (identityError || !identity) return reply(403, { error: "identity" });
    identityKey = normalizedKey(identity.public_jwk);
  }
  if (!identityKey || !await verify(identityKey, payload, signature)) {
    return reply(403, { error: "proof" });
  }

  // The DB primary key atomically rejects repeated signed requests on reconnect.
  // Even a verified signature cannot bypass this one-time check.
  const { error: replay } = await admin.from("device_pair_proofs")
    .insert({ user_id: userId, device_id: deviceId, nonce });
  // Nonces older than the maximum signed-request time window can never be replayed.
  // Expire old metadata without retaining a permanent per-command history.
  if (!replay && Math.random() < 0.02) {
    await admin.from("device_pair_proofs").delete().eq("user_id", userId)
      .lt("created_at", new Date(Date.now() - 86_400_000).toISOString());
  }
  if (replay) return reply(409, { error: "replay" });

  const params = { p_user_id: userId, p_device_id: deviceId };
  let result: { data: unknown; error: unknown };
  if (op === "register") {
    result = await admin.rpc("pair_register_identity", { ...params, p_public_jwk: identityKey });
  } else if (op === "invite") {
    result = await admin.rpc("pair_create_invite", params);
  } else if (op === "claim") {
    const code = string(args.code);
    const claimSignature = string(args.claimSignature);
    if (!code || !/^[0-9]{8}$/.test(code) || !claimSignature
      || !await verify(identityKey, `personal-voice:claim:v1:${code}:${deviceId}`, claimSignature)) {
      return reply(400, { error: "invalid" });
    }
    result = await admin.rpc("pair_claim_invite", {
      ...params, p_code: code, p_signature: claimSignature,
    });
    const value = object(result.data);
    if (value?.error === "invalid") return reply(400, { error: "invalid" });
    if (value?.error === "rate_limited") return reply(429, { error: "rate_limited" });
  } else if (op === "read") {
    const id = uuidArg(args.id);
    if (!id) return reply(400, { error: "bad_request" });
    result = await admin.rpc("pair_get_invite", { ...params, p_id: id });
  } else if (op === "approve") {
    const id = uuidArg(args.id);
    const approvalSignature = string(args.approvalSignature);
    if (!id || !approvalSignature) return reply(400, { error: "bad_request" });
    const { data: invite, error: inviteError } = await admin.rpc("pair_get_invite", { ...params, p_id: id });
    const state = object(invite);
    const claimantId = uuidArg(state?.claimant_device_id);
    const claimantKey = normalizedKey(state?.claimant_key);
    if (inviteError || state?.status !== "claimed" || state?.issuer_device_id !== deviceId
      || !claimantId || !claimantKey ||
      !await verify(identityKey, approvalMessage(id, deviceId, claimantId, claimantKey), approvalSignature)) {
      return reply(403, { error: "approval" });
    }
    result = await admin.rpc("pair_approve_invite", { ...params, p_id: id, p_signature: approvalSignature });
  } else if (op === "signal") {
    const targetId = uuidArg(args.targetId);
    const requestId = uuidArg(args.requestId);
    const family = string(args.family);
    if (!targetId || !requestId ||
        !["remote-dictation","computer-action","remote-read"].includes(family ?? "")) {
      return reply(400, { error: "bad_request" });
    }
    result = await admin.rpc("device_link_send_signal", {
      p_user_id: userId, p_sender: deviceId, p_target: targetId,
      p_request: requestId, p_family: family,
    });
    if (result.data !== true) return reply(403, { error: "not_paired" });
  } else if (op === "auto_claim" || op === "auto_validate" || op === "auto_seen") {
    // Only a signed, registered native Windows identity can claim a paired request.
    // The RPC atomically verifies the exact request, pairing and allowed command.
    if (device.platform !== "windows") return reply(403, { error: "windows_only" });
    const requestId = uuidArg(args.requestId);
    if (!requestId || Object.keys(args).sort().join() !== "requestId") {
      return reply(400, { error: "bad_request" });
    }
    result = await admin.rpc(op === "auto_claim" ? "remote_auto_claim"
      : op === "auto_validate" ? "remote_auto_validate" : "remote_auto_seen", {
      p_user_id: userId, p_pc_id: deviceId, p_request_id: requestId,
    });
  } else if (op.startsWith("trusted_")) {
    // All trust operations require proof of the PC's native private key.
    // A phone JWT cannot authorize itself as a trusted source.
    if (device.platform !== "windows") return reply(403, { error: "windows_only" });
    if (op === "trusted_start") {
      const phoneId = uuidArg(args.phoneId);
      if (!phoneId || phoneId === deviceId || Object.keys(args).sort().join() !== "phoneId") {
        return reply(400, { error: "bad_request" });
      }
      const { data: phone, error: phoneError } = await admin.from("devices")
        .select("id,platform").eq("id", phoneId).eq("user_id", userId).maybeSingle();
      const [left, right] = [deviceId, phoneId].sort();
      const { data: pairing, error: pairError } = await admin.from("device_pair_links")
        .select("id").eq("user_id", userId).eq("left_device_id", left)
        .eq("right_device_id", right).is("revoked_at", null).limit(1);
      if (phoneError || pairError || phone?.platform !== "android" || !pairing?.length) {
        return reply(403, { error: "not_paired" });
      }
      const { data, error } = await admin.from("device_trusted_grants").insert({
        user_id: userId, pc_device_id: deviceId, phone_device_id: phoneId,
        scopes: ["open_app", "press_shortcut"],
        expires_at: new Date(Date.now() + 14 * 60_000).toISOString(),
      }).select("id,phone_device_id,created_at,expires_at,stopped_at").single();
      result = { data, error };
    } else if (op === "trusted_stop") {
      const grantId = uuidArg(args.grantId);
      if (!grantId || Object.keys(args).sort().join() !== "grantId") {
        return reply(400, { error: "bad_request" });
      }
      const { data, error } = await admin.from("device_trusted_grants")
        .update({ stopped_at: new Date().toISOString() })
        .eq("user_id", userId).eq("pc_device_id", deviceId)
        .eq("id", grantId).is("stopped_at", null)
        .select("id").maybeSingle();
      result = { data: data !== null, error };
    } else if (op === "trusted_list") {
      if (Object.keys(args).length !== 0) return reply(400, { error: "bad_request" });
      result = await admin.from("device_trusted_grants")
        .select("id,phone_device_id,created_at,expires_at,stopped_at")
        .eq("user_id", userId).eq("pc_device_id", deviceId)
        .is("stopped_at", null).gt("expires_at", new Date().toISOString())
        .order("created_at", { ascending: false });
    } else {
      const requestId = uuidArg(args.requestId);
      if (!requestId || Object.keys(args).sort().join() !== "requestId") {
        return reply(400, { error: "bad_request" });
      }
      result = await admin.rpc(op === "trusted_claim" ? "trusted_remote_claim"
        : op === "trusted_seen" ? "trusted_remote_seen" : "trusted_remote_validate", {
        p_user_id: userId, p_pc_id: deviceId, p_request_id: requestId,
      });
    }
  } else if (op === "cancel") {
    const id = uuidArg(args.id);
    if (!id) return reply(400, { error: "bad_request" });
    result = await admin.rpc("pair_cancel_invite", { ...params, p_id: id });
  } else if (op === "revoke") {
    const id = uuidArg(args.linkId);
    if (!id) return reply(400, { error: "bad_request" });
    result = await admin.rpc("pair_revoke_link", { ...params, p_link_id: id });
  } else {
    result = await admin.rpc("pair_list_links", params);
  }

  if (dataError(result.error)) return reply(400, { error: "operation_failed" });
  return reply(200, { data: result.data });
});
