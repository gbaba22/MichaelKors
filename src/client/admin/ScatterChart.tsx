import { useMemo, useRef, useState } from 'react';
import { formatScore } from '../api.js';
import type { OpportunityAggregate } from '../../shared/types.js';

interface Props {
  points: OpportunityAggregate[];
  /** Draws the quadrant split; defaults to the midpoint of the 0-100 range. */
  midpoint?: number;
}

// A fixed viewBox scaled to the container, so one set of coordinates works at
// every width and tooltip positions can be expressed as percentages.
const VB_W = 840;
const VB_H = 600;
const PAD = { top: 28, right: 28, bottom: 52, left: 60 };
const PLOT_W = VB_W - PAD.left - PAD.right;
const PLOT_H = VB_H - PAD.top - PAD.bottom;

const TICKS = [0, 25, 50, 75, 100];
/** How many points carry a permanent label before the rest rely on hover. */
const LABELLED = 7;

/**
 * Impact (y) against feasibility (x), one mark per AI opportunity.
 *
 * A single hue throughout: the marks are one series, so colour carries no
 * meaning here and position does all the work. Identity comes from direct
 * labels on the standouts, hover for everything else, and the table below -
 * never from colour alone.
 */
export function ScatterChart({ points, midpoint = 50 }: Props) {
  const [hovered, setHovered] = useState<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const plotted = useMemo(
    () =>
      points
        .filter((p) => p.impact != null && p.feasibility != null)
        .map((p) => ({
          ...p,
          x: PAD.left + ((p.feasibility as number) / 100) * PLOT_W,
          y: PAD.top + (1 - (p.impact as number) / 100) * PLOT_H,
          r: radiusFor(p.respondentCount),
        }))
        // Draw the smallest marks last so a 1-respondent point is never buried.
        .sort((a, b) => b.r - a.r),
    [points],
  );

  // Label only the highest-scoring few, and drop any that would collide.
  const labelled = useMemo(() => {
    const candidates = [...plotted].sort((a, b) => (b.overall ?? 0) - (a.overall ?? 0));
    const placed: { x: number; y: number }[] = [];
    const chosen = new Set<number>();
    for (const point of candidates) {
      if (chosen.size >= LABELLED) break;
      if (placed.some((p) => Math.abs(p.x - point.x) < 110 && Math.abs(p.y - point.y) < 22)) continue;
      placed.push({ x: point.x, y: point.y });
      chosen.add(point.opportunityId);
    }
    return chosen;
  }, [plotted]);

  const active = plotted.find((p) => p.opportunityId === hovered) ?? null;
  const midX = PAD.left + (midpoint / 100) * PLOT_W;
  const midY = PAD.top + (1 - midpoint / 100) * PLOT_H;

  if (plotted.length === 0) {
    return (
      <p className="empty">
        Nothing to plot yet — the chart fills in as business users submit their scores.
      </p>
    );
  }

  return (
    <div ref={containerRef} style={{ position: 'relative' }}>
      <svg
        className="chart-surface"
        viewBox={`0 0 ${VB_W} ${VB_H}`}
        role="img"
        aria-label={`Impact against feasibility for ${plotted.length} AI opportunities. The table below lists the same values.`}
      >
        {/* Quadrants: a faint wash on the two that matter most, plus corner labels. */}
        <rect
          x={midX}
          y={PAD.top}
          width={PAD.left + PLOT_W - midX}
          height={midY - PAD.top}
          fill="var(--accent)"
          opacity={0.045}
        />
        <QuadrantLabel x={PAD.left + PLOT_W - 12} y={PAD.top + 18} anchor="end" text="Quick wins" />
        <QuadrantLabel x={PAD.left + 12} y={PAD.top + 18} anchor="start" text="Big bets" />
        <QuadrantLabel
          x={PAD.left + PLOT_W - 12}
          y={PAD.top + PLOT_H - 10}
          anchor="end"
          text="Fill-ins"
        />
        <QuadrantLabel
          x={PAD.left + 12}
          y={PAD.top + PLOT_H - 10}
          anchor="start"
          text="Deprioritise"
        />

        {/* Gridlines stay hairline and recessive. */}
        {TICKS.map((t) => {
          const x = PAD.left + (t / 100) * PLOT_W;
          const y = PAD.top + (1 - t / 100) * PLOT_H;
          return (
            <g key={t}>
              <line x1={x} y1={PAD.top} x2={x} y2={PAD.top + PLOT_H} stroke="var(--line)" strokeWidth={1} />
              <line x1={PAD.left} y1={y} x2={PAD.left + PLOT_W} y2={y} stroke="var(--line)" strokeWidth={1} />
              <text x={x} y={PAD.top + PLOT_H + 22} textAnchor="middle" className="axis-tick">
                {t}
              </text>
              <text x={PAD.left - 12} y={y + 4} textAnchor="end" className="axis-tick">
                {t}
              </text>
            </g>
          );
        })}

        {/* The quadrant split, drawn above the grid but below the marks. */}
        <line
          x1={midX}
          y1={PAD.top}
          x2={midX}
          y2={PAD.top + PLOT_H}
          stroke="var(--line-strong)"
          strokeWidth={1}
          strokeDasharray="4 4"
        />
        <line
          x1={PAD.left}
          y1={midY}
          x2={PAD.left + PLOT_W}
          y2={midY}
          stroke="var(--line-strong)"
          strokeWidth={1}
          strokeDasharray="4 4"
        />

        {/* Axes */}
        <line
          x1={PAD.left}
          y1={PAD.top + PLOT_H}
          x2={PAD.left + PLOT_W}
          y2={PAD.top + PLOT_H}
          stroke="var(--line-strong)"
          strokeWidth={1}
        />
        <line
          x1={PAD.left}
          y1={PAD.top}
          x2={PAD.left}
          y2={PAD.top + PLOT_H}
          stroke="var(--line-strong)"
          strokeWidth={1}
        />
        <text x={PAD.left + PLOT_W / 2} y={VB_H - 10} textAnchor="middle" className="axis-title">
          Feasibility score →
        </text>
        <text
          transform={`rotate(-90 16 ${PAD.top + PLOT_H / 2})`}
          x={16}
          y={PAD.top + PLOT_H / 2}
          textAnchor="middle"
          className="axis-title"
        >
          Impact score →
        </text>

        {/* Marks: a surface-coloured ring keeps overlapping points separable. */}
        {plotted.map((p) => {
          const isActive = p.opportunityId === hovered;
          return (
            <g
              key={p.opportunityId}
              onMouseEnter={() => setHovered(p.opportunityId)}
              onMouseLeave={() => setHovered((id) => (id === p.opportunityId ? null : id))}
              style={{ cursor: 'pointer' }}
            >
              {/* Invisible, generous hit target. */}
              <circle cx={p.x} cy={p.y} r={Math.max(p.r + 8, 16)} fill="transparent" />
              <circle
                cx={p.x}
                cy={p.y}
                r={p.r}
                fill="var(--series-impact)"
                fillOpacity={isActive ? 0.95 : 0.72}
                stroke="var(--surface)"
                strokeWidth={2}
              />
              {isActive && (
                <circle
                  cx={p.x}
                  cy={p.y}
                  r={p.r + 4}
                  fill="none"
                  stroke="var(--series-impact)"
                  strokeWidth={1.5}
                />
              )}
            </g>
          );
        })}

        {/* Direct labels on the standouts, plus whatever is hovered. */}
        {plotted.map((p) => {
          if (!labelled.has(p.opportunityId) && p.opportunityId !== hovered) return null;
          const flip = p.x > PAD.left + PLOT_W * 0.72;
          return (
            <text
              key={`label-${p.opportunityId}`}
              x={flip ? p.x - p.r - 7 : p.x + p.r + 7}
              y={p.y + 4}
              textAnchor={flip ? 'end' : 'start'}
              className="point-label"
            >
              {p.name}
            </text>
          );
        })}
      </svg>

      {active && (
        <div
          className="chart-tooltip"
          style={{
            left: `${(active.x / VB_W) * 100}%`,
            top: `${(active.y / VB_H) * 100}%`,
            transform: `translate(${active.x > VB_W * 0.6 ? 'calc(-100% - 14px)' : '14px'}, -50%)`,
          }}
        >
          <div className="t-name">{active.name}</div>
          <div className="muted small">
            {active.businessArea}
            {active.businessGoal ? ` · ${active.businessGoal}` : ''}
          </div>
          <dl>
            <dt>Impact</dt>
            <dd>{formatScore(active.impact)}</dd>
            <dt>Feasibility</dt>
            <dd>{formatScore(active.feasibility)}</dd>
            <dt>Overall</dt>
            <dd>{formatScore(active.overall)}</dd>
            <dt>Respondents</dt>
            <dd>{active.respondentCount}</dd>
          </dl>
        </div>
      )}

      <div className="legend" style={{ padding: '4px 8px 12px' }}>
        <span>
          <span className="swatch" style={{ background: 'var(--series-impact)' }} />
          One mark per AI opportunity
        </span>
        <span className="muted">Larger marks were scored by more people</span>
        <span className="muted">Hover a mark for its numbers</span>
      </div>

      <style>{`
        .axis-tick { fill: var(--ink-muted); font-size: 12px; font-variant-numeric: tabular-nums; }
        .axis-title { fill: var(--ink-secondary); font-size: 13px; font-weight: 500; }
        .point-label { fill: var(--ink-secondary); font-size: 12.5px; paint-order: stroke;
                       stroke: var(--surface); stroke-width: 3px; stroke-linejoin: round; }
        .quadrant-label { fill: var(--ink-muted); font-size: 11px; font-weight: 600;
                          letter-spacing: 0.07em; text-transform: uppercase; }
      `}</style>
    </div>
  );
}

function QuadrantLabel({
  x,
  y,
  anchor,
  text,
}: {
  x: number;
  y: number;
  anchor: 'start' | 'end';
  text: string;
}) {
  return (
    <text x={x} y={y} textAnchor={anchor} className="quadrant-label">
      {text}
    </text>
  );
}

/** Area grows with the number of respondents, with a readable floor. */
function radiusFor(respondents: number): number {
  return Math.min(22, 7 + Math.sqrt(Math.max(respondents, 1) - 1) * 4);
}
