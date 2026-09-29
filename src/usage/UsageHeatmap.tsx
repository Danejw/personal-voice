import { useMemo } from "react";
import { Tooltip } from "@/components/Tooltip";
import type { DayBar } from "@/usage/analytics";

interface UsageHeatmapProps {
  days: readonly DayBar[];
  streak: number;
  longestStreak: number;
  today: string;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

function intensity(words: number, maxWords: number): 0 | 1 | 2 | 3 | 4 {
  if (words <= 0 || maxWords <= 0) return 0;
  const ratio = words / maxWords;
  if (ratio <= 0.2) return 1;
  if (ratio <= 0.45) return 2;
  if (ratio <= 0.75) return 3;
  return 4;
}

function monthLabel(day: string): string {
  const [year, month] = day.split("-").map(Number);
  return new Date(year ?? 1970, (month ?? 1) - 1, 1).toLocaleString(undefined, { month: "short" });
}

/** Contribution calendar that stretches to the width of the page. */
export function UsageHeatmap({ days, streak, longestStreak, today }: UsageHeatmapProps) {
  const maxWords = Math.max(1, ...days.filter((day) => day.day <= today).map((day) => day.words));
  const weeks = useMemo(() => {
    const columns: DayBar[][] = [];
    for (let index = 0; index < days.length; index += 7) {
      columns.push([...days.slice(index, index + 7)]);
    }
    return columns;
  }, [days]);

  const monthMarks = useMemo(() => {
    const marks: string[] = [];
    let previous = "";
    for (const week of weeks) {
      const label = week[0] ? monthLabel(week[0].day) : "";
      if (label && label !== previous) {
        marks.push(label);
        previous = label;
      } else {
        marks.push("");
      }
    }
    return marks;
  }, [weeks]);

  return (
    <div className="heatmap">
      <div className="heatmap-head">
        <h2 id="trend-heading">{streak} day streak</h2>
        <p className="heatmap-meta">Longest {longestStreak}</p>
      </div>
      <div
        className="heatmap-plot"
        style={{ gridTemplateColumns: `32px repeat(${weeks.length}, minmax(10px, 1fr))` }}
        role="img"
        aria-label="Dictation activity by day. Darker squares mean more words."
      >
        <span />
        {monthMarks.map((label, index) => (
          <span key={`month-${weeks[index]?.[0]?.day ?? index}`} className="heatmap-month">{label}</span>
        ))}
        {WEEKDAYS.map((weekday, row) => (
          <WeekdayRow key={weekday} label={weekday} row={row} weeks={weeks} today={today} maxWords={maxWords} />
        ))}
      </div>
      <div className="heatmap-legend" aria-hidden="true">
        <span>Less</span>
        <span className="heatmap-swatch level-0" />
        <span className="heatmap-swatch level-1" />
        <span className="heatmap-swatch level-2" />
        <span className="heatmap-swatch level-3" />
        <span className="heatmap-swatch level-4" />
        <span>More</span>
      </div>
    </div>
  );
}

function WeekdayRow({
  label,
  row,
  weeks,
  today,
  maxWords,
}: {
  label: string;
  row: number;
  weeks: DayBar[][];
  today: string;
  maxWords: number;
}) {
  return (
    <>
      <span className="heatmap-weekday">{label}</span>
      {weeks.map((week) => {
        const cell = week[row];
        if (!cell) return <span key={`${label}-empty`} />;
        const future = cell.day > today;
        const level = future ? 0 : intensity(cell.words, maxWords);
        const className = future ? "heatmap-cell is-future" : `heatmap-cell level-${level}`;
        if (future) return <span key={cell.day} className={className} />;
        return (
          <Tooltip key={cell.day} content={`${cell.day}: ${cell.words.toLocaleString()} words`}>
            <span className={className} />
          </Tooltip>
        );
      })}
    </>
  );
}
