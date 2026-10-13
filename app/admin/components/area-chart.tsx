import { useEffect, useRef, useState } from "react";

type Point = { label: string; tick: string; value: number };

const HEIGHT = 240;
const PAD = { top: 12, right: 16, bottom: 28, left: 48 };

/** Fondo scala "tondo" (1, 2, 5 × 10ⁿ) con 4 linee di griglia, passo minimo 1. */
function scale(max: number) {
  const raw = Math.max(max, 4) / 4;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / magnitude;
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10) * magnitude;
  return { step, top: step * 4 };
}

/** Grafico ad area di una serie, con crosshair e tooltip al passaggio del mouse. */
export function AreaChart({
  data,
  label,
  format,
}: {
  data: Point[];
  label: string;
  format: (value: number) => string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [hover, setHover] = useState<number | null>(null);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const { step, top } = scale(Math.max(...data.map((d) => d.value)));
  const plotW = Math.max(width - PAD.left - PAD.right, 1);
  const plotH = HEIGHT - PAD.top - PAD.bottom;
  const x = (i: number) => PAD.left + (data.length <= 1 ? plotW / 2 : (i / (data.length - 1)) * plotW);
  const y = (v: number) => PAD.top + plotH - (v / top) * plotH;
  const line = data.map((d, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(d.value).toFixed(1)}`).join("");
  const area = data.length ? `${line}L${x(data.length - 1)},${y(0)}L${x(0)},${y(0)}Z` : "";
  const tickEvery = Math.max(1, Math.ceil(data.length / Math.max(2, Math.floor(plotW / 90))));
  const active = hover === null ? null : data[hover];

  const onMove = (event: React.PointerEvent<SVGSVGElement>) => {
    if (!data.length) return;
    const left = event.currentTarget.getBoundingClientRect().left;
    const ratio = (event.clientX - left - PAD.left) / plotW;
    setHover(Math.min(data.length - 1, Math.max(0, Math.round(ratio * (data.length - 1)))));
  };

  return (
    <div ref={ref} className="relative w-full" style={{ height: HEIGHT }}>
      {width > 0 && (
        <svg
          width={width}
          height={HEIGHT}
          role="img"
          aria-label={label}
          onPointerMove={onMove}
          onPointerLeave={() => setHover(null)}
          className="touch-pan-y"
        >
          {[0, 1, 2, 3, 4].map((i) => (
            <g key={i}>
              <line
                x1={PAD.left}
                x2={width - PAD.right}
                y1={y(step * i)}
                y2={y(step * i)}
                stroke="var(--border)"
                strokeDasharray={i ? "2 3" : undefined}
              />
              <text
                x={PAD.left - 8}
                y={y(step * i)}
                dy="0.32em"
                textAnchor="end"
                fontSize={11}
                fill="var(--muted-foreground)"
                className="tabular-nums"
              >
                {format(step * i)}
              </text>
            </g>
          ))}
          {data.map((d, i) =>
            i % tickEvery === 0 ? (
              <text
                key={d.label}
                x={x(i)}
                y={HEIGHT - 8}
                textAnchor="middle"
                fontSize={11}
                fill="var(--muted-foreground)"
              >
                {d.tick}
              </text>
            ) : null,
          )}
          <path d={area} fill="var(--primary)" fillOpacity={0.08} />
          <path
            d={line}
            fill="none"
            stroke="var(--primary)"
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
          {active && hover !== null && (
            <g pointerEvents="none">
              <line
                x1={x(hover)}
                x2={x(hover)}
                y1={PAD.top}
                y2={y(0)}
                stroke="var(--muted-foreground)"
                strokeDasharray="3 3"
              />
              <circle
                cx={x(hover)}
                cy={y(active.value)}
                r={4.5}
                fill="var(--primary)"
                stroke="var(--card)"
                strokeWidth={2}
              />
            </g>
          )}
        </svg>
      )}
      {active && hover !== null && (
        <div
          className="pointer-events-none absolute z-10 rounded-md border bg-popover px-2.5 py-1.5 text-xs text-popover-foreground shadow-md"
          style={{
            left: Math.min(Math.max(x(hover), 70), width - 70),
            top: Math.max(y(active.value) - 12, 0),
            transform: "translate(-50%, -100%)",
          }}
        >
          <div className="text-muted-foreground">{active.label}</div>
          <div className="font-medium tabular-nums">{format(active.value)}</div>
        </div>
      )}
      <table className="sr-only">
        <caption>{label}</caption>
        <tbody>
          {data.map((d) => (
            <tr key={d.label}>
              <th scope="row">{d.label}</th>
              <td>{format(d.value)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
