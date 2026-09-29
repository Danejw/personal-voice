import type { ProfileFact } from "@/assistant/personalContext";

interface PersonalContextPanelProps {
  enabled: boolean;
  deviceLine: string;
  facts: readonly ProfileFact[];
}

/** Device line and analytics facts, collapsed beside the conversation. The switch lives in Settings. */
export function PersonalContextPanel({ enabled, deviceLine, facts }: PersonalContextPanelProps) {
  return (
    <details className="fold">
      <summary>Personal context{enabled ? "" : " · not sent"}</summary>
      <p>{deviceLine}</p>
      {facts.length === 0 ? (
        <p>No analytics facts yet. Assistant will not guess a share, trigger, app, term, or pace.</p>
      ) : (
        <ul className="profile-facts">
          {facts.map((fact) => <li key={fact.id}>{fact.text}</li>)}
        </ul>
      )}
      {!enabled && <p>Assistant is not using the analytics profile.</p>}
    </details>
  );
}
