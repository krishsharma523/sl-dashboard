// frontend/src/components/ForecastDashboard.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ResponsiveContainer,
  AreaChart, Area,
  LineChart, Line,
  BarChart, Bar,
  ComposedChart,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ReferenceArea,
} from "recharts";

import crest from "../assets/crest.png";
import flag from "../assets/flag.png";

const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:8000";

// ✅ Fixed region list for the dropdown
const REGION_OPTIONS = [
  "All",
  "Eastern",
  "North Western",
  "Northern",
  "Southern",
  "Western Area",
];

const COLORS = { actual: "#0ea5e9", forecast: "#e64709", ma: "#22c55e" };

const fmt = (v) =>
  v == null || Number.isNaN(v)
    ? "—"
    : Number(v).toLocaleString(undefined, { maximumFractionDigits: 0 });

function Stat({ title, value, sub, pct }) {
  const up = typeof pct === "number" && pct >= 0;
  return (
    <div className="stat-card">
      <div className="stat-title">{title}</div>
      <div className="mt-1 flex items-baseline gap-2">
        <div className="stat-value">{value}</div>
        {typeof pct === "number" && Number.isFinite(pct) && (
          <span className={`badge ${up ? "badge--up" : "badge--down"}`}>
            {up ? "▲" : "▼"} {(up ? "+" : "") + pct.toFixed(1)}%
          </span>
        )}
      </div>
      {sub ? <div className="stat-sub">{sub}</div> : null}
    </div>
  );
}

export default function ForecastDashboard() {
  // options & selections (regions are fixed; we still fetch commodities)
  const [commodities, setCommodities] = useState([]);
  const [commodity, setCommodity] = useState("");
  const [region, setRegion] = useState(REGION_OPTIONS[0]);

  // data
  const [history, setHistory] = useState([]);
  const [kpi, setKpi] = useState({
    current_price: null,
    pred_1m: null, pred_3m: null, pred_6m: null,
    pct_change_1m: null, pct_change_3m: null, pct_change_6m: null,
    future_dates: {},
  });

  // UI toggles
  const [chartType, setChartType] = useState("area");
  const [showMA, setShowMA] = useState(false);
  const [changeView, setChangeView] = useState(false);

  // persist toggles
  useEffect(() => {
    try {
      const s = localStorage;
      const ct = s.getItem("chartType");
      if (ct) setChartType(ct);
      setShowMA(s.getItem("showMA") === "1");
      setChangeView(s.getItem("changeView") === "1");
    } catch {}
  }, []);
  useEffect(() => {
    try {
      const s = localStorage;
      s.setItem("chartType", chartType);
      s.setItem("showMA", showMA ? "1" : "0");
      s.setItem("changeView", changeView ? "1" : "0");
    } catch {}
  }, [chartType, showMA, changeView]);

  // helpers
  async function getJSON(url, signal) {
    const r = await fetch(url, { signal });
    if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
    return r.json();
  }

  // load options (only commodities from backend; regions are fixed)
  useEffect(() => {
    const ctrl = new AbortController();
    (async () => {
      try {
        const o = await getJSON(`${API_BASE}/options`, ctrl.signal);
        const list = Array.isArray(o?.commodities) ? o.commodities : [];
        setCommodities(list);
        if (!commodity && list.length) setCommodity(list[0]);
      } catch (e) {
        console.error("Failed to load options:", e);
        setCommodities([]);
      }
    })();
    return () => ctrl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // load KPI + history on selection change
  const latestReq = useRef(0);
  useEffect(() => {
    if (!commodity || !region) return;
    const ctrl = new AbortController();
    const reqId = ++latestReq.current;

    (async () => {
      try {
        const r1 = await getJSON(
          `${API_BASE}/predict?commodity=${encodeURIComponent(commodity)}&region=${encodeURIComponent(region)}&horizon=1`,
          ctrl.signal
        );
        if (reqId !== latestReq.current) return;
        const k = r1?.kpi || {};
        setKpi({
          current_price: r1?.current_price ?? null,
          pred_1m: k?.pred_1m ?? null,
          pred_3m: k?.pred_3m ?? null,
          pred_6m: k?.pred_6m ?? null,
          pct_change_1m: k?.pct_change_1m ?? null,
          pct_change_3m: k?.pct_change_3m ?? null,
          pct_change_6m: k?.pct_change_6m ?? null,
          future_dates: k?.future_dates ?? {},
        });
      } catch (e) {
        if (reqId !== latestReq.current) return;
        console.error("Predict fetch failed:", e);
        setKpi({
          current_price: null,
          pred_1m: null, pred_3m: null, pred_6m: null,
          pct_change_1m: null, pct_change_3m: null, pct_change_6m: null,
          future_dates: {},
        });
      }

      try {
        const hist = await getJSON(
          `${API_BASE}/series?commodity=${encodeURIComponent(commodity)}&region=${encodeURIComponent(region)}&months=24`,
          ctrl.signal
        );
        if (reqId !== latestReq.current) return;
        setHistory(Array.isArray(hist?.points) ? hist.points : []);
      } catch (e) {
        if (reqId !== latestReq.current) return;
        console.error("Series fetch failed:", e);
        setHistory([]);
      }
    })();

    return () => ctrl.abort();
  }, [commodity, region]);

  // chart data
  const current = history?.[history.length - 1] ?? null;
  const currentPrice = kpi.current_price != null ? kpi.current_price : current?.y ?? null;

  const futurePoints = useMemo(() => {
    const out = [];
    if (kpi.pred_1m != null && kpi.future_dates?.["1m"]) out.push({ date: kpi.future_dates["1m"], forecast: kpi.pred_1m });
    if (kpi.pred_3m != null && kpi.future_dates?.["3m"]) out.push({ date: kpi.future_dates["3m"], forecast: kpi.pred_3m });
    if (kpi.pred_6m != null && kpi.future_dates?.["6m"]) out.push({ date: kpi.future_dates["6m"], forecast: kpi.pred_6m });
    return out;
  }, [kpi]);

  const lastActualDate = history?.length ? history[history.length - 1].date : null;

  const chartData = useMemo(() => {
    const histRows = (history || []).map((p) => ({ date: p.date, actual: p.y, forecast: null }));
    const futRows = futurePoints.map((p) => ({ date: p.date, actual: null, forecast: p.forecast }));
    return [...histRows, ...futRows];
  }, [history, futurePoints]);

  const enriched = useMemo(() => {
    const data = chartData.map((d) => ({ ...d }));
    if (showMA) {
      const vals = data.map((d) => (Number.isFinite(d.actual) ? d.actual : null));
      const ma3 = vals.map((_, i) => {
        const s = vals.slice(Math.max(0, i - 2), i + 1).filter((v) => Number.isFinite(v));
        return s.length ? s.reduce((a, b) => a + b, 0) / s.length : null;
      });
      data.forEach((d, i) => (d.ma3 = ma3[i]));
    }
    if (changeView) {
      for (let i = 1; i < data.length; i++) {
        const prev = data[i - 1].actual ?? data[i - 1].forecast;
        const curr = data[i].actual ?? data[i].forecast;
        data[i].mom = Number.isFinite(prev) && Number.isFinite(curr) ? curr - prev : null;
      }
    }
    return data;
  }, [chartData, showMA, changeView]);

  const xInterval = Math.max(0, Math.floor(Math.max(enriched.length, 1) / 8));
  const forecastYear = futurePoints.length ? new Date(futurePoints[0].date).getFullYear() : null;
  const horizonParts = [
    kpi.pred_1m != null ? "1m" : null,
    kpi.pred_3m != null ? "3m" : null,
    kpi.pred_6m != null ? "6m" : null,
  ].filter(Boolean);
  const chartTitle = changeView
    ? "Month-over-Month Change"
    : `Last 18 months${forecastYear ? ` & Forecasts for ${forecastYear}` : ""}${horizonParts.length ? ` (${horizonParts.join(", ")})` : ""}`;

  return (
    <div className="app-wrap space-y-6">
      {/* Header */}
      <header className="app-header">
        <img src={crest} alt="Sierra Leone coat of arms" className="brand-left" />
        <div>
          <h1 className="title" style={{ color: "#fff" }}>
            AI and Machine Learning Solutions for Retailer Food Price Forecasting in Sierra Leone – Dashboard
          </h1>
          <p className="subtitle text-emerald-500">
            Please pick a commodity and market to see the predicted prices in 1, 3, and 6 months.
          </p>
        </div>
        <img src={flag} alt="Sierra Leone flag" className="brand-right" />
      </header>

      {/* Controls */}
      <section className="panel panel--pill">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <div>
            <label className="text-xs muted mb-1 block">Select commodity</label>
            <select
              className="select"
              aria-label="Select commodity"
              value={commodity}
              onChange={(e) => setCommodity(e.target.value)}
            >
              {commodities.length === 0 ? (
                <option>(loading…)</option>
              ) : (
                commodities.map((c) => <option key={c} value={c}>{c}</option>)
              )}
            </select>
          </div>

          <div>
            <label className="text-xs muted mb-1 block">Select market</label>
            <select
              className="select"
              aria-label="Select market"
              value={region}
              onChange={(e) => setRegion(e.target.value)}
            >
              {REGION_OPTIONS.map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-xs muted mb-1 block">Chart type</label>
            <select
              className="select"
              aria-label="Select chart type"
              value={chartType}
              onChange={(e) => setChartType(e.target.value)}
            >
              <option value="area">Area</option>
              <option value="line">Line</option>
              <option value="bar">Bar</option>
              <option value="composed">Composed</option>
            </select>
          </div>

          <div className="flex items-center gap-6">
            <label className="checkbox-label">
              <input type="checkbox" className="h-4 w-4" checked={showMA} onChange={(e) => setShowMA(e.target.checked)} />
              <span className="text-sm">3-mo moving average</span>
            </label>
            <label className="checkbox-label">
              <input type="checkbox" className="h-4 w-4" checked={changeView} onChange={(e) => setChangeView(e.target.checked)} />
              <span className="text-sm">Show MoM change</span>
            </label>
          </div>
        </div>
      </section>

      {/* KPI cards */}
      <section className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <Stat title="Current price" value={currentPrice == null ? "…" : `${fmt(currentPrice)} SLL`} sub={history?.length ? `as of ${history[history.length - 1].date}` : ""} />
        <Stat title="Price in 1 month" value={kpi.pred_1m == null ? "…" : `${fmt(kpi.pred_1m)} SLL`} pct={kpi.pct_change_1m} />
        <Stat title="Price in 3 months" value={kpi.pred_3m == null ? "…" : `${fmt(kpi.pred_3m)} SLL`} pct={kpi.pct_change_3m} />
        <Stat title="Price in 6 months" value={kpi.pred_6m == null ? "…" : `${fmt(kpi.pred_6m)} SLL`} pct={kpi.pct_change_6m} />
      </section>

      {/* Chart */}
      <section className="chart-card">
        <div className="chart-title">{chartTitle}</div>
        <div className="h-[400px] w-full">
          <ResponsiveContainer>
            {changeView ? (
              <BarChart data={enriched} margin={{ top: 6, right: 12, left: 4, bottom: 6 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date" interval={xInterval} />
                <YAxis tickFormatter={fmt} />
                <Tooltip formatter={(v, n) => [fmt(v), n]} />
                <Legend />
                <Bar dataKey="mom" name="MoM change" fill={COLORS.forecast} />
              </BarChart>
            ) : chartType === "line" ? (
              <LineChart data={enriched} margin={{ top: 6, right: 12, left: 4, bottom: 6 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date" interval={xInterval} />
                <YAxis tickFormatter={fmt} />
                <Tooltip formatter={(v, n) => [fmt(v), n]} />
                <Legend />
                {lastActualDate && enriched.length > 0 && (
                  <ReferenceArea x1={lastActualDate} x2={enriched[enriched.length - 1].date} fill="#000" fillOpacity={0.06} />
                )}
                <Line type="monotone" dataKey="actual" name="Actual" stroke={COLORS.actual} dot={false} connectNulls={false} />
                <Line type="monotone" dataKey="forecast" name="Forecast (1m/3m/6m)" stroke={COLORS.forecast} strokeDasharray="5 5" dot={{ r: 3 }} connectNulls={false} />
                {showMA && <Line type="monotone" dataKey="ma3" name="3-mo MA" stroke={COLORS.ma} dot={false} />}
              </LineChart>
            ) : chartType === "bar" ? (
              <BarChart data={enriched} margin={{ top: 6, right: 12, left: 4, bottom: 6 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date" interval={xInterval} />
                <YAxis tickFormatter={fmt} />
                <Tooltip formatter={(v, n) => [fmt(v), n]} />
                <Legend />
                <Bar dataKey="actual" name="Actual" fill={COLORS.actual} />
                <Bar dataKey="forecast" name="Forecast (1m/3m/6m)" fill={COLORS.forecast} />
              </BarChart>
            ) : (
              <ComposedChart data={enriched} margin={{ top: 6, right: 12, left: 4, bottom: 6 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date" interval={xInterval} />
                <YAxis tickFormatter={fmt} />
                <Tooltip formatter={(v, n) => [fmt(v), n]} />
                <Legend />
                <Bar dataKey="actual" name="Actual" fill={COLORS.actual} />
                <Line type="monotone" dataKey="forecast" name="Forecast (1m/3m/6m)" stroke={COLORS.forecast} dot />
              </ComposedChart>
            )}
          </ResponsiveContainer>
        </div>
      </section>
    </div>
  );
}
