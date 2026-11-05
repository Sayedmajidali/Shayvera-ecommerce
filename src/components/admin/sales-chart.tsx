"use client";

import { useState } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatINR } from "@/lib/money";

type Point = { date: string; sales: number; orders: number };

const short = (d: string) =>
  new Date(`${d}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
const compact = (paise: number) => {
  const r = paise / 100;
  if (r >= 1e5) return `₹${(r / 1e5).toFixed(1)}L`;
  if (r >= 1e3) return `₹${(r / 1e3).toFixed(r >= 1e4 ? 0 : 1)}k`;
  return `₹${Math.round(r)}`;
};

function ChartTooltip({ active, payload }: { active?: boolean; payload?: { payload: Point }[] }) {
  const p = payload?.[0]?.payload;
  if (!active || !p) return null;
  return (
    <div className="bg-popover shadow-lift rounded-lg border px-3 py-2 text-xs">
      <p className="text-muted-foreground">
        {new Date(`${p.date}T00:00:00`).toLocaleDateString("en-IN", {
          weekday: "short",
          day: "numeric",
          month: "short",
        })}
      </p>
      <p className="mt-1 flex items-center gap-2">
        <span className="bg-chart-1 h-0.5 w-3 rounded" aria-hidden />
        <span className="text-foreground text-sm font-semibold tabular-nums">
          {formatINR(p.sales)}
        </span>
        <span className="text-muted-foreground">sales</span>
      </p>
      <p className="text-muted-foreground mt-0.5 pl-5 tabular-nums">
        {p.orders} order{p.orders === 1 ? "" : "s"}
      </p>
    </div>
  );
}

/** Single-series daily sales (title names the series; no legend needed). Table view for accessibility. */
export function SalesChart({ data }: { data: Point[] }) {
  const [table, setTable] = useState(false);
  return (
    <div>
      <div className="mb-2 flex justify-end">
        <button
          type="button"
          onClick={() => setTable((t) => !t)}
          className="text-muted-foreground text-xs underline-offset-4 hover:underline"
          aria-pressed={table}
        >
          {table ? "Show chart" : "View as table"}
        </button>
      </div>
      {table ? (
        <div className="max-h-72 overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="bg-card text-muted-foreground sticky top-0 text-left text-xs">
              <tr>
                <th className="py-1.5">Date</th>
                <th className="py-1.5 text-right">Orders</th>
                <th className="py-1.5 text-right">Sales</th>
              </tr>
            </thead>
            <tbody>
              {[...data].reverse().map((d) => (
                <tr key={d.date} className="border-t">
                  <td className="py-1.5">{short(d.date)}</td>
                  <td className="py-1.5 text-right tabular-nums">{d.orders}</td>
                  <td className="py-1.5 text-right tabular-nums">{formatINR(d.sales)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="h-72" role="img" aria-label="Daily gross sales chart">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={data}
              margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
              barCategoryGap={2}
            >
              <CartesianGrid vertical={false} stroke="var(--border)" />
              <XAxis
                dataKey="date"
                tickFormatter={short}
                tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                axisLine={false}
                tickLine={false}
                minTickGap={28}
              />
              <YAxis
                tickFormatter={compact}
                tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                axisLine={false}
                tickLine={false}
                width={52}
              />
              <Tooltip content={<ChartTooltip />} cursor={{ fill: "var(--muted)" }} />
              <Bar
                dataKey="sales"
                fill="var(--chart-1)"
                radius={[4, 4, 0, 0]}
                maxBarSize={18}
                isAnimationActive={false}
                activeBar={{ fillOpacity: 0.8 }}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
