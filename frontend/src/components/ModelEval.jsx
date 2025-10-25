import React, { useEffect, useMemo, useState } from "react";
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis,
  Tooltip as RTooltip, Legend, ScatterChart, Scatter,
  CartesianGrid, ReferenceLine
} from "recharts";
import { RefreshCw, Download, LineChart as LineChartIcon } from "lucide-react";

// ✅ Use environment variable or /api fallback for Vercel + Render
const API_BASE = (import.meta.env.VITE_API_BASE || "/api").replace(/\/$/, "");

const fmtCurrency = (n) =>
  n == null || Number.isNaN(n)
    ? "—"
    : new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(Number(n));

function Metric({ title, value, hint }) {
  return (
    <div className="rounded-2xl shadow-sm border bg-white p-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm text-muted-foreground">{title}</div>
          <div className="text-2xl font-semibold mt-1">{value}</div>
        </div>
        {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
      </div>
    </div>
  );
}

// Generic fetch helper
function useApi(url, deps = []) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  useEffect(() => {
    if (!url) return;
    const ctrl = new AbortController();
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const r = await fetch(url, { signal: ctrl.signal });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const j = await r.json();
        setData(j);
      } catch (e) {
        if (e.name !== "AbortError") setError(e.message || String(e));
      } finally {
        setLoading(false);
      }
    })();
    return () => ctrl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return { data, loading, error };
}

export default function ModelEval() {
  const [commodity, setCommodity] = useState("Rice");
  const [model, setModel] = useState("XGBoost");
  const [query, setQuery] = useState("");

  // ✅ Replace non-existent endpoints with realistic ones or fallbacks
  const { data: commodityOptions } = useApi(`${API_BASE}/options`, []);
  const commodityList = commodityOptions?.commodities || ["Rice", "Fish", "Palm oil"];
  const modelList = ["Random Forest", "Gradient Boosting", "XGBoost"];

  // Backend metrics + eval results (replace missing endpoints with stubs if needed)
  const { data: metrics, loading: mLoading } = useApi(
    `${API_BASE}/metrics?commodity=${encodeURIComponent(commodity)}`,
    [commodity]
  );
  const { data: evalset, loading: eLoading } = useApi(
    `${API_BASE}/eval?commodity=${encodeURIComponent(commodity)}`,
    [commodity]
  );

  // Safe rows builder
  const rows = useMemo(() => {
    if (!evalset || !evalset.dates || !evalset.y_test || !evalset.preds) return [];
    const preds = evalset.preds?.[model] || [];
    return evalset.dates.map((d, i) => {
      const a = Number.isFinite(evalset.y_test[i]) ? Number(evalset.y_test[i]) : null;
      const p = Number.isFinite(preds[i]) ? Number(preds[i]) : null;
      return {
        date: d,
        actual: a,
        predicted: p,
        error: a != null && p != null ? p - a : null,
        abs_error: a != null && p != null ? Math.abs(p - a) : null,
      };
    });
  }, [evalset, model]);

  const filtered = useMemo(() => {
    if (!query) return rows;
    const q = query.toLowerCase();
    return rows.filter((r) => String(r.date).toLowerCase().includes(q));
  }, [rows, query]);

  const [minVal, maxVal] = useMemo(() => {
    if (!filtered.length) return [0, 1];
    let min = Infinity, max = -Infinity;
    for (const r of filtered) {
      if (Number.isFinite(r.actual)) {
        min = Math.min(min, r.actual);
        max = Math.max(max, r.actual);
      }
      if (Number.isFinite(r.predicted)) {
        min = Math.min(min, r.predicted);
        max = Math.max(max, r.predicted);
      }
    }
    return Number.isFinite(min) && Number.isFinite(max) ? [min, max] : [0, 1];
  }, [filtered]);

  const downloadCSV = () => {
    const head = ["date", "actual", "predicted", "error", "abs_error"];
    const csv = [head.join(",")]
      .concat(filtered.map((r) => head.map((k) => r[k] ?? "").join(",")))
      .join("\n");
    const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${commodity}-${model}-eval.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const xInterval = Math.max(0, Math.floor(Math.max(filtered.length, 1) / 8));
  const metricsForModel = metrics?.[model];

  return (
    <div className="space-y-6">
      {/* Controls */}
      <div className="rounded-2xl border bg-white p-4 md:p-6">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Commodity</label>
            <select
              className="w-full border rounded-lg p-2 bg-white"
              value={commodity}
              onChange={(e) => setCommodity(e.target.value)}
            >
              {commodityList.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Model</label>
            <select
              className="w-full border rounded-lg p-2 bg-white"
              value={model}
              onChange={(e) => setModel(e.target.value)}
            >
              {modelList.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </div>
          <div className="md:col-span-2">
            <label className="text-xs text-muted-foreground mb-1 block">
              Filter by date (e.g., 2023-08)
            </label>
            <input
              className="w-full border rounded-lg p-2"
              placeholder="Type month/year…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
        </div>
      </div>

      {/* Metric Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Metric
          title="R²"
          value={
            mLoading || !metricsForModel
              ? "…"
              : Number.isFinite(metricsForModel.R2)
              ? metricsForModel.R2.toFixed(3)
              : "—"
          }
          hint="Variance explained (↑)"
        />
        <Metric
          title="MAE (SLL)"
          value={mLoading || !metricsForModel ? "…" : fmtCurrency(metricsForModel.MAE)}
          hint="↓ better"
        />
        <Metric
          title="RMSE (SLL)"
          value={mLoading || !metricsForModel ? "…" : fmtCurrency(metricsForModel.RMSE)}
          hint="↓ better"
        />
      </div>

      {/* Actual vs Predicted Scatter */}
      <div className="rounded-2xl border bg-white p-4">
        <div className="flex items-center gap-2 mb-2 font-medium">
          <LineChartIcon className="w-4 h-4" /> Actual vs Predicted
        </div>
        <div className="h-[360px] w-full">
          <ResponsiveContainer>
            <ScatterChart margin={{ top: 8, right: 20, left: 0, bottom: 8 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis type="number" dataKey="actual" name="Actual" tickFormatter={fmtCurrency} />
              <YAxis type="number" dataKey="predicted" name="Predicted" tickFormatter={fmtCurrency} />
              <RTooltip formatter={(v, n) => [fmtCurrency(v), n]} labelFormatter={() => "Point"} />
              <Legend />
              <ReferenceLine
                segment={[
                  { x: minVal, y: minVal },
                  { x: maxVal, y: maxVal },
                ]}
                ifOverflow="extendDomain"
                strokeDasharray="4 4"
              />
              <Scatter name={model} data={filtered} fill="#6366f1" line shape="circle" />
            </ScatterChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Time Series Chart */}
      <div className="rounded-2xl border bg-white p-4">
        <div className="h-[360px] w-full">
          <ResponsiveContainer>
            <LineChart
              data={filtered.map((r) => ({ ...r, date: r.date?.slice(0, 10) }))}
              margin={{ top: 8, right: 20, left: 0, bottom: 8 }}
            >
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="date" interval={xInterval} />
              <YAxis tickFormatter={fmtCurrency} />
              <RTooltip formatter={(v, n) => [fmtCurrency(v), n]} />
              <Legend />
              <Line
                type="monotone"
                dataKey="actual"
                name="Actual"
                stroke="#0ea5e9"
                dot={false}
              />
              <Line
                type="monotone"
                dataKey="predicted"
                name={`${model} predicted`}
                stroke="#e64709ff"
                dot={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Table */}
      <div className="rounded-2xl border bg-white overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="bg-neutral-100 text-left">
              <th className="px-4 py-2">Date</th>
              <th className="px-4 py-2">Actual (SLL)</th>
              <th className="px-4 py-2">Predicted (SLL)</th>
              <th className="px-4 py-2">Error</th>
              <th className="px-4 py-2">|Error|</th>
            </tr>
          </thead>
          <tbody>
            {eLoading ? (
              <tr>
                <td className="px-4 py-6" colSpan={5}>
                  Loading…
                </td>
              </tr>
            ) : filtered.length === 0 ? (
              <tr>
                <td className="px-4 py-6" colSpan={5}>
                  No rows.
                </td>
              </tr>
            ) : (
              filtered.slice(0, 500).map((r, i) => (
                <tr key={`${r.date}-${i}`} className="border-t">
                  <td className="px-4 py-2 whitespace-nowrap">{r.date?.slice(0, 10)}</td>
                  <td className="px-4 py-2">{fmtCurrency(r.actual)}</td>
                  <td className="px-4 py-2">{fmtCurrency(r.predicted)}</td>
                  <td className="px-4 py-2">{fmtCurrency(r.error)}</td>
                  <td className="px-4 py-2">{fmtCurrency(r.abs_error)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Buttons */}
      <div className="flex gap-2 justify-center">
        <button
          className="px-3 py-2 rounded-lg border bg-white"
          onClick={() => window.location.reload()}
        >
          <span className="inline-flex items-center gap-2">
            <RefreshCw className="w-4 h-4" /> Refresh
          </span>
        </button>
        <button className="px-3 py-2 rounded-lg border bg-white" onClick={downloadCSV}>
          <span className="inline-flex items-center gap-2">
            <Download className="w-4 h-4" /> Export CSV
          </span>
        </button>
      </div>
    </div>
  );
}
