"use client";

import { useState } from "react";

type Point = { date: string; value: number };

/**
 * A single-series daily bar chart — no legend needed (the card title
 * names the series, per the dataviz skill's mark rules). Bars <=24px
 * thick, 4px rounded data-end, 2px surface gaps, hairline gridlines,
 * per-bar hover tooltip with a hit target larger than the bar itself.
 */
export function TimeSeriesChart({
  data,
  color,
  unit,
}: {
  data: Point[];
  color: string;
  unit: string;
}) {
  const [hovered, setHovered] = useState<number | null>(null);

  const width = 600;
  const height = 160;
  const paddingLeft = 36;
  const paddingBottom = 20;
  const paddingTop = 8;
  const plotWidth = width - paddingLeft;
  const plotHeight = height - paddingBottom - paddingTop;

  const maxValue = Math.max(1, ...data.map((d) => d.value));
  // Round the axis max to a clean step above the data max.
  const axisMax = Math.ceil(maxValue / 5) * 5 || 5;

  const bandWidth = plotWidth / data.length;
  const barWidth = Math.min(24, bandWidth - 4);

  function yFor(value: number): number {
    return paddingTop + plotHeight - (value / axisMax) * plotHeight;
  }

  const ticks = [0, axisMax / 2, axisMax].map((t) => Math.round(t));

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="h-40 w-full overflow-visible"
        role="img"
        aria-label={`Daily ${unit} over the last ${data.length} days`}
      >
        {/* Gridlines */}
        {ticks.map((t) => (
          <line
            key={t}
            x1={paddingLeft}
            x2={width}
            y1={yFor(t)}
            y2={yFor(t)}
            stroke="currentColor"
            strokeWidth={1}
            className="text-border"
          />
        ))}
        {/* Y-axis ticks */}
        {ticks.map((t) => (
          <text
            key={t}
            x={paddingLeft - 8}
            y={yFor(t)}
            textAnchor="end"
            dominantBaseline="middle"
            className="fill-muted-foreground text-[9px] tabular-nums"
          >
            {t}
          </text>
        ))}
        {/* Bars */}
        {data.map((d, i) => {
          const barHeight = (d.value / axisMax) * plotHeight;
          const x = paddingLeft + i * bandWidth + (bandWidth - barWidth) / 2;
          const y = paddingTop + plotHeight - barHeight;
          const isHovered = hovered === i;
          return (
            <g key={d.date}>
              {/* Hit target: the full band, bigger than the painted bar */}
              <rect
                x={paddingLeft + i * bandWidth}
                y={paddingTop}
                width={bandWidth}
                height={plotHeight}
                fill="transparent"
                onPointerEnter={() => setHovered(i)}
                onPointerLeave={() => setHovered(null)}
                onFocus={() => setHovered(i)}
                onBlur={() => setHovered(null)}
                tabIndex={0}
                role="button"
                aria-label={`${d.date}: ${d.value} ${unit}`}
              />
              <rect
                x={x}
                y={d.value === 0 ? y - 1 : y}
                width={barWidth}
                height={d.value === 0 ? 1 : barHeight}
                rx={4}
                fill={color}
                opacity={isHovered ? 1 : 0.85}
                className="pointer-events-none transition-opacity"
              />
              {/* Date label every few bars to avoid collision */}
              {i % Math.ceil(data.length / 7) === 0 ? (
                <text
                  x={paddingLeft + i * bandWidth + bandWidth / 2}
                  y={height - 4}
                  textAnchor="middle"
                  className="fill-muted-foreground text-[9px]"
                >
                  {new Date(d.date).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                </text>
              ) : null}
            </g>
          );
        })}
      </svg>

      {hovered !== null ? (
        <div
          className="pointer-events-none absolute -translate-x-1/2 -translate-y-full rounded-lg border bg-popover px-2.5 py-1.5 text-xs shadow-md"
          style={{
            left: `${((paddingLeft + hovered * bandWidth + bandWidth / 2) / width) * 100}%`,
            top: `${(yFor(data[hovered].value) / height) * 100}%`,
          }}
        >
          <p className="font-semibold tabular-nums">
            {data[hovered].value} {unit}
          </p>
          <p className="text-muted-foreground">
            {new Date(data[hovered].date).toLocaleDateString(undefined, {
              month: "short",
              day: "numeric",
              year: "numeric",
            })}
          </p>
        </div>
      ) : null}
    </div>
  );
}
