import type { TransformProfilesApi } from "@/services/transformProfilesService";
import {
  BUILT_IN_TRANSFORMS,
  transformInstructionProblem,
  transformNameProblem,
} from "@/transforms/transformProfile";
import type { TransformProfile } from "@/transforms/transformProfile";

export type TransformStatus = "signed-out" | "loading" | "synced" | "offline";

export interface TransformSnapshot {
  status: TransformStatus;
  profiles: TransformProfile[];
  error: string | null;
}

function messageOf(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}

function withBuiltIns(custom: TransformProfile[]): TransformProfile[] {
  return [...BUILT_IN_TRANSFORMS, ...custom];
}

export class TransformStore {
  private snapshot: TransformSnapshot = { status: "signed-out", profiles: withBuiltIns([]), error: null };
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
      this.publish({ status: "signed-out", profiles: withBuiltIns([]), error: null });
      return;
    }
    this.publish({ status: "loading", profiles: withBuiltIns([]), error: null });
    await this.load(userId, this.generation);
  }

  async reload(): Promise<void> {
    if (!this.userId) return;
    const generation = this.generation;
    this.publish({ ...this.snapshot, status: "loading", error: null });
    await this.load(this.userId, generation);
  }

  async create(name: string, instruction: string): Promise<TransformProfile> {
    const userId = this.requireConnected();
    const cleanName = name.trim();
    const cleanInstruction = instruction.trim();
    const problem = transformNameProblem(cleanName) ?? transformInstructionProblem(cleanInstruction);
    if (problem) throw new Error(problem);
    const generation = this.generation;
    try {
      const profile = await this.api.create(userId, cleanName, cleanInstruction);
      if (generation === this.generation) {
        this.publish({ status: "synced", profiles: [...this.snapshot.profiles, profile], error: null });
      }
      return profile;
    } catch (reason) {
      this.report(generation, reason);
      throw reason;
    }
  }

  async update(id: string, name: string, instruction: string): Promise<TransformProfile> {
    this.requireConnected();
    if (id.startsWith("builtin:")) throw new Error("Built-in transforms cannot be edited.");
    const cleanName = name.trim();
    const cleanInstruction = instruction.trim();
    const problem = transformNameProblem(cleanName) ?? transformInstructionProblem(cleanInstruction);
    if (problem) throw new Error(problem);
    const generation = this.generation;
    try {
      const profile = await this.api.update(id, cleanName, cleanInstruction);
      if (generation === this.generation) {
        this.publish({
          status: "synced",
          profiles: this.snapshot.profiles.map((item) => item.id === id ? profile : item),
          error: null,
        });
      }
      return profile;
    } catch (reason) {
      this.report(generation, reason);
      throw reason;
    }
  }

  async remove(id: string): Promise<void> {
    this.requireConnected();
    if (id.startsWith("builtin:")) throw new Error("Built-in transforms cannot be deleted.");
    const generation = this.generation;
    try {
      await this.api.delete(id);
      if (generation === this.generation) {
        this.publish({
          status: "synced",
          profiles: this.snapshot.profiles.filter((item) => item.id !== id),
          error: null,
        });
      }
    } catch (reason) {
      this.report(generation, reason);
      throw reason;
    }
  }

  private requireConnected(): string {
    if (!this.userId) throw new Error("Sign in to sync transform profiles.");
    if (this.snapshot.status !== "synced") throw new Error("Transforms are unavailable until sync reconnects.");
    return this.userId;
  }

  private async load(userId: string, generation: number): Promise<void> {
    try {
      const custom = await this.api.list(userId);
      if (generation !== this.generation) return;
      this.publish({ status: "synced", profiles: withBuiltIns(custom), error: null });
    } catch (reason) {
      if (generation !== this.generation) return;
      this.publish({ status: "offline", profiles: withBuiltIns([]), error: messageOf(reason) });
    }
  }

  private report(generation: number, reason: unknown) {
    if (generation !== this.generation) return;
    this.publish({ ...this.snapshot, error: messageOf(reason) });
  }

  private publish(snapshot: TransformSnapshot) {
    this.snapshot = snapshot;
    for (const listener of this.listeners) listener();
  }
}
