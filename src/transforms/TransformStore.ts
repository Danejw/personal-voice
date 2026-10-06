import type { TransformProfilesApi } from "@/services/transformProfilesService";
import {
  BUILT_IN_TRANSFORMS,
  customTransformProblem,
  type TransformProfile,
} from "@/transforms/transformProfile";

export type TransformStatus = "signed-out" | "loading" | "synced" | "offline";

export interface TransformSnapshot {
  status: TransformStatus;
  profiles: TransformProfile[];
  error: string | null;
}

function messageOf(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}

function newestFirst(profiles: TransformProfile[]): TransformProfile[] {
  return [...profiles].sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? "")
    || a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
}

function sameName(a: string, b: string): boolean {
  return a.trim().localeCompare(b.trim(), undefined, { sensitivity: "base" }) === 0;
}

export class TransformStore {
  private snapshot: TransformSnapshot = { status: "signed-out", profiles: [], error: null };
  private listeners = new Set<() => void>();
  private userId: string | null = null;
  private generation = 0;

  constructor(private api: TransformProfilesApi) {}

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): TransformSnapshot => this.snapshot;

  async setUser(userId: string | null): Promise<void> {
    if (userId === this.userId) return;
    this.userId = userId;
    this.generation += 1;
    if (!userId) {
      this.publish({ status: "signed-out", profiles: [], error: null });
      return;
    }
    this.publish({ status: "loading", profiles: [], error: null });
    await this.load(userId, this.generation);
  }

  async reload(): Promise<void> {
    if (!this.userId) return;
    const generation = this.generation;
    this.publish({ ...this.snapshot, status: "loading", error: null });
    await this.load(this.userId, generation);
  }

  async create(name: string, instruction: string): Promise<void> {
    const userId = this.requireConnected();
    const cleanName = name.trim();
    const cleanInstruction = instruction.trim();
    this.validate(cleanName, cleanInstruction);
    const generation = this.generation;
    try {
      const profile = await this.api.create(userId, cleanName, cleanInstruction);
      if (generation === this.generation) {
        this.publish({
          status: "synced",
          profiles: newestFirst([profile, ...this.snapshot.profiles.filter((entry) => entry.id !== profile.id)]),
          error: null,
        });
      }
    } catch (reason) {
      this.reportFailure(generation, reason);
      throw reason;
    }
  }

  async update(id: string, name: string, instruction: string): Promise<void> {
    this.requireConnected();
    const cleanName = name.trim();
    const cleanInstruction = instruction.trim();
    this.validate(cleanName, cleanInstruction, id);
    const generation = this.generation;
    try {
      const profile = await this.api.update(id, cleanName, cleanInstruction);
      if (generation === this.generation) {
        this.publish({
          status: "synced",
          profiles: newestFirst(this.snapshot.profiles.map((entry) => entry.id === id ? profile : entry)),
          error: null,
        });
      }
    } catch (reason) {
      this.reportFailure(generation, reason);
      throw reason;
    }
  }

  async remove(id: string): Promise<void> {
    this.requireConnected();
    const generation = this.generation;
    try {
      await this.api.delete(id);
      if (generation === this.generation) {
        this.publish({
          status: "synced",
          profiles: this.snapshot.profiles.filter((entry) => entry.id !== id),
          error: null,
        });
      }
    } catch (reason) {
      this.reportFailure(generation, reason);
      throw reason;
    }
  }

  private validate(name: string, instruction: string, editingId?: string) {
    const problem = customTransformProblem(name, instruction);
    if (problem) throw new Error(problem);
    const occupied = [
      ...BUILT_IN_TRANSFORMS,
      ...this.snapshot.profiles.filter((profile) => profile.id !== editingId),
    ];
    if (occupied.some((profile) => sameName(profile.name, name))) {
      throw new Error("A transform with that name already exists.");
    }
  }

  private requireConnected(): string {
    if (!this.userId) throw new Error("Sign in to save and sync transforms.");
    if (this.snapshot.status !== "synced") throw new Error("Transforms are unavailable until sync reconnects.");
    return this.userId;
  }

  private async load(userId: string, generation: number) {
    try {
      const profiles = await this.api.list(userId);
      if (generation !== this.generation) return;
      this.publish({ status: "synced", profiles: newestFirst(profiles), error: null });
    } catch (reason) {
      if (generation !== this.generation) return;
      this.publish({ status: "offline", profiles: this.snapshot.profiles, error: messageOf(reason) });
    }
  }

  private reportFailure(generation: number, reason: unknown) {
    if (generation !== this.generation) return;
    this.publish({ ...this.snapshot, error: messageOf(reason) });
  }

  private publish(next: TransformSnapshot) {
    this.snapshot = next;
    for (const listener of this.listeners) listener();
  }
}
