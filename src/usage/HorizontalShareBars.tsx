import { Tooltip } from "@/components/Tooltip";

interface ShareBarItem {
  id: string;
  label: string;
  share: number;
  detail: string;
}

interface HorizontalShareBarsProps {
  title: string;
  empty?: string;
  items: readonly ShareBarItem[];
  headingId: string;
}

/** Ranked rows: name, a bar you can compare, then the count. */
export function HorizontalShareBars({ title, empty, items, headingId }: HorizontalShareBarsProps) {
  if (!items.length && !empty) return null;
  return (
    <section aria-labelledby={headingId} className="share-bars">
      <h2 id={headingId}>{title}</h2>
      {items.length === 0 ? (
        <p className="hint">{empty}</p>
      ) : (
        <ul className="share-bar-list">
          {items.map((item, index) => (
            <li key={item.id} className="share-bar-row">
              <span className="share-bar-name">{item.label}</span>
              <div className="share-bar-rail">
                <div
                  className={index === 0 ? "share-bar-fill is-top" : "share-bar-fill"}
                  style={{ width: `${Math.max(item.share, item.share > 0 ? 6 : 0)}%` }}
                >
                  {item.share >= 14 ? <span>{item.share}%</span> : null}
                </div>
                {item.share < 14 && item.share > 0 ? (
                  <span className="share-bar-pct-out">{item.share}%</span>
                ) : null}
              </div>
              <span className="share-bar-detail">{item.detail}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

interface SplitSegment {
  id: string;
  label: string;
  share: number;
  /** Segment fill, such as `is-windows` or `is-rank-0`. */
  tone: string;
  tooltip: string;
}

/** One bar split into labeled shares. A narrow slice keeps a minimum width and ellipsizes. */
function ShareSplitBar({ headingId, title, segments }: {
  headingId: string;
  title: string;
  segments: readonly SplitSegment[];
}) {
  if (!segments.length) return null;
  return (
    <section aria-labelledby={headingId} className="platform-split">
      <h2 id={headingId}>{title}</h2>
      <div className="platform-bar" role="img" aria-label={segments.map((item) => `${item.label} ${item.share}%`).join(", ")}>
        {segments.map((item) => (
          <Tooltip key={item.id} content={item.tooltip}>
            <div
              className={`platform-segment ${item.tone}`}
              style={{ flexGrow: Math.max(item.share, 8), flexBasis: 0 }}
            >
              <span>{item.label}</span>
              <span className="platform-share">{item.share}%</span>
            </div>
          </Tooltip>
        ))}
      </div>
    </section>
  );
}

interface PlatformSplitBarProps {
  platforms: readonly { id: string; label: string; share: number; words: number }[];
}

/** One bar split by Windows and Android. Width is the share of words. */
export function PlatformSplitBar({ platforms }: PlatformSplitBarProps) {
  return (
    <ShareSplitBar
      headingId="platform-heading"
      title="Platforms"
      segments={platforms.map((item) => ({
        id: item.id,
        label: item.label,
        share: item.share,
        tone: `is-${item.id}`,
        tooltip: `${item.label}: ${item.share}% · ${item.words.toLocaleString()} words`,
      }))}
    />
  );
}

const DEVICE_TONES = ["is-rank-0", "is-rank-1", "is-rank-2"] as const;

interface DeviceSplitBarProps {
  devices: readonly { id: string; label: string; share: number; count: number }[];
  headingId?: string;
  unitLabel?: string;
}

/** One bar split by device using the caller's measured activity unit. */
export function DeviceSplitBar({ devices, headingId = "device-heading", unitLabel = "dictations" }: DeviceSplitBarProps) {
  return (
    <ShareSplitBar
      headingId={headingId}
      title="Devices"
      segments={devices.map((device, index) => ({
        id: device.id,
        label: device.label,
        share: device.share,
        tone: DEVICE_TONES[index % DEVICE_TONES.length] ?? "is-rank-0",
        tooltip: `${device.label}: ${device.share}% · ${device.count.toLocaleString()} ${unitLabel}`,
      }))}
    />
  );
}
