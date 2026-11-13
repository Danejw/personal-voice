import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabase } from "./supabase";
import { DEFAULT_WORLD, parseWorldConfig, type WorldConfig } from "@/desktopBackground/worldConfig";

export interface SpatialEnvironment {
  id: string;
  owner_id: string;
  name: string;
  scene_config: WorldConfig;
  created_at: string;
}
export interface EnvironmentSnapshot {
  environments: SpatialEnvironment[];
  activeId: string | null;
}
async function authenticated() {
  // The generated Database type predates this migration. Keep new tables isolated here.
  const db = getSupabase() as unknown as SupabaseClient | null;
  if (!db) throw new Error("Supabase is not configured.");
  const { data, error } = await db.auth.getUser();
  if (error || !data.user) throw new Error("Sign in to manage your environments.");
  return { db, userId: data.user.id };
}
function checkedName(name: string) {
  const trimmed = name.trim();
  if (trimmed.length < 1 || trimmed.length > 80) throw new Error("Environment names must be 1 to 80 characters.");
  return trimmed;
}
export async function listEnvironments(): Promise<EnvironmentSnapshot> {
  const { db, userId } = await authenticated();
  const [worlds, selection] = await Promise.all([
    db.from("spatial_environments").select("id,owner_id,name,scene_config,created_at").eq("owner_id", userId).order("created_at"),
    db.from("spatial_environment_selection").select("environment_id").eq("owner_id", userId).maybeSingle(),
  ]);
  if (worlds.error) throw worlds.error;
  if (selection.error) throw selection.error;
  const environments = (worlds.data ?? []).map(row => ({
    id: row.id as string, owner_id: row.owner_id as string, name: row.name as string,
    scene_config: parseWorldConfig(row.scene_config), created_at: row.created_at as string,
  }));
  const selected = selection.data?.environment_id as string | undefined;
  return { environments, activeId: environments.some(x => x.id === selected) ? selected! : null };
}
export async function createEnvironment(name: string, config: WorldConfig = DEFAULT_WORLD): Promise<SpatialEnvironment> {
  const { db, userId } = await authenticated();
  const { data, error } = await db.from("spatial_environments")
    .insert({ owner_id: userId, name: checkedName(name), scene_config: parseWorldConfig(config) })
    .select("id,owner_id,name,scene_config,created_at").single();
  if (error || !data) throw error ?? new Error("Could not create environment.");
  return { id: data.id as string, owner_id: data.owner_id as string,
    name: data.name as string, scene_config: parseWorldConfig(data.scene_config), created_at: data.created_at as string };
}
export async function renameEnvironment(id: string, name: string) {
  const { db, userId } = await authenticated();
  const { data, error } = await db.from("spatial_environments")
    .update({ name: checkedName(name) }).eq("id", id).eq("owner_id", userId).select("id").maybeSingle();
  if (error || !data) throw error ?? new Error("Environment unavailable.");
}
export async function selectEnvironment(id: string) {
  const { db, userId } = await authenticated();
  const { data, error } = await db.from("spatial_environment_selection")
    .upsert({ owner_id: userId, environment_id: id }, { onConflict: "owner_id" })
    .select("environment_id").single();
  if (error || !data) throw error ?? new Error("Could not select environment.");
}
export async function deleteEnvironment(id: string) {
  const { db, userId } = await authenticated();
  const { data, error } = await db.from("spatial_environments")
    .delete().eq("id", id).eq("owner_id", userId).select("id").maybeSingle();
  if (error || !data) throw error ?? new Error("Environment unavailable.");
}
export async function setEnvironmentPalette(id: string, palette: WorldConfig["palette"]) {
  const { db, userId } = await authenticated();
  const { data, error } = await db.from("spatial_environments")
    .update({ scene_config: parseWorldConfig({ kind: "terrain", palette }) })
    .eq("id", id).eq("owner_id", userId).select("id").maybeSingle();
  if (error || !data) throw error ?? new Error("Environment unavailable.");
}
