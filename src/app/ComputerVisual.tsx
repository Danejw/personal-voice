import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";

type Activity = { label: string; phase: "inspect" | "action" | "complete" | "error" };
export default function ComputerVisual() {
  const [activity, setActivity] = useState<Activity>({label:"Inspecting active window",phase:"inspect"});
  useEffect(() => {
    const sub = listen<Activity>("computer-visual-activity", (event) => setActivity(event.payload));
    return () => { void sub.then((cancel) => cancel()); };
  }, []);
  return (
    <div className={`computer-visual-highlight computer-visual-${activity.phase}`} aria-hidden="true">
      <div className="computer-visual-label">
        <span className="computer-visual-dot" />
        Personal Voice · {activity.label}
      </div>
    </div>
  );
}
