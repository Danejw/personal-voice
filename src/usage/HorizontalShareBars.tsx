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

interface PlatformSplitBarProps {
  platforms: readonly { id: string; label: string; share: number; words: number }[];
}

/** One bar split by Windows and Android. Width is the share of words. */
export function PlatformSplitBar({ platforms }: PlatformSplitBarProps) {
  if (!platforms.length) return null;
  return (
    <section aria-labelledby="platform-heading" className="platform-split">
      <h2 id="platform-heading">Platforms</h2>
      <div className="platform-bar" role="img" aria-label={platforms.map((item) => `${item.label} ${item.share}%`).join(", ")}>
        {platforms.map((item) => (
          <Tooltip
            key={item.id}
            content={`${item.label}: ${item.share}% · ${item.words.toLocaleString()} words`}
          >
            <div
              className={`platform-segment is-${item.id}`}
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
