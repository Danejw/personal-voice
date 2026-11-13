import type { MonitorRect } from "@/desktopBackground/layout";

export interface DesktopBackgroundStatus {
  phase: "disabled" | "starting" | "running" | "error";
  error: string | null;
  monitors: MonitorRect[];
  readySurfaces: number;
}
