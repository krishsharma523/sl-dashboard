import React, { useEffect, useMemo, useState } from "react";
import {
  ResponsiveContainer,
  AreaChart, Area,
  LineChart, Line,
  BarChart, Bar,
  ComposedChart,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from "recharts";

import crest from "../assets/crest.png";
import flag from "../assets/flag.png";

// ✅ Use dynamic env var for production, not localhost
const API_BASE = (import.meta.env.VITE_API_BASE || "/api").replace(/\/$/, "");

/** Consistent series colours */
const COLORS = {
  actual: "#adbac3ff",
  forecast: "#e64709ff",
  ma: "#22c55e",
  band: "#0a0a0aff",
};

/** Helpers */
const fmtCurrency = (n) =>
  n == null || Number.isNaN(n)
    ? "—"
    : new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(Number(n));

const fmtPct = (v) =>
  v == null || Number.isNaN(v) ? "—" : `${v >= 0 ? "+" : ""}${Number(v).toFixed(1)}%`;

const pctChange = (future, base) =>
  Number.isFinite(future) && Number.isFinite(base) && base !== 0
    ? ((future - base) / base) * 100
    : null;

/** Tiny badge for +/- percent change */
function ChangeBadge({ pct }) {
  if (pct == null) return null;
  const up = pct >= 0;
  const bg = up ? "bg-emerald-600" : "bg-rose-600";
  const arrow = up ? "▲" : "▼";
  return (
    <span
      className={`ml-2 inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${bg} text-white`}
      title={up ? "Increase" : "Decrease"}
    >
      {arrow}&nbsp;{fmtPct(pct)}
    </span>
  );
}

/** Simple stat card */
function StatCard({ title, value, sub, changePct }) {
  return (
    <div className="rounded-2xl border bg-white shadow-sm p-4">
      <div className="text-sm text-muted-foreground">{title}</div>
      <div className="mt-1 flex items-baseline">
        <div className="text-2xl font-semibold">{value}</div>
        {changePct != null && <ChangeBadge pct={changePct} />}
      </div>
      {sub ? <div className="text-xs mt-1 text-muted-foreground">{sub}</div> : null}
    </div>
  );
}

export default function CustomerPlanner() {
  const [commodityList, setCommodityList] = useState(["Rice", "Fish", "Palm oil"]);
  const [commodity, setCommodity] = useState("Rice");

  const [hist, setHist] = useState([]); // [{date, y}]
  const [bundle, setBundle] = useState({ "1": [], "3": [], "6": [] });

  const [loading, setLoading] = useState(true);
  const [chartType, setChartType] = useState("area");
  const [showMA, setShowMA] = useState(false);
  const [changeView, setChangeView] = useState(false);

  /** Load commodities (if backend provides /options) */
  useEffect(() => {
    const ctrl = new AbortController();
    (async () => {
      try {
        const r = await fetch(`${API_BASE}/options`, { signal: ctrl.signal });
        if (!r.ok) return;
        const list = await r.json();
        if (Array.isArray(list?.commodities) && list.commodities.length)
          setCommodityList(list.commodities);
      } catch (_) {}
    })();
    return () => ctrl.abort();
  }, []);

  /** Load history + forecasts for selected commodity */
  useEffect(() => {
    const ctrl = new AbortController();
    (async () => {
      setLoading(true);
      try {
        // ✅ use /series and /predict endpoints
        const histResp = await fetch(
          `${API_BASE}/series?commodity=${encodeURIComponent(commodity)}&region=${encodeURIComponent("All")}&months=18`,
          { signal: ctrl.signal }
        );
        if (!histResp.ok) throw new Error(`HTTP ${histResp.status}`);
        const histData = await histResp.json();
        const points = Array.isArray(histData?.points) ? histData.points : [];
        setHist(points);

        // Fetch forecasts for 1, 3, 6 months from /predict
        const horizons = [1, 3, 6];
        const out = {};
        for (const h of horizons) {
          const r = await fetch(
            `${API_BASE}/predict?commodity=${encodeURIComponent(commodity)}&region=${encodeURIComponent("All")}&horizon=${h}`,
            { signal: ctrl.signal }
          );
          if (!r.ok) continue;
          const j = await r.json();
          const targetDate = j?.kpi?.future_dates?.[`${h}m`];
          const pred = j?.kpi?.[`pred_${h}m`];
          out[h.toString()] = [{ date: targetDate, yhat: pred, lo: null, hi: null }];
        }
        setBundle(out);
      } catch (_) {
        setHist([]);
        setBundle({ "1": [], "3": [], "6": [] });
      } finally {
        setLoading(false);
      }
    })();
    return () => ctrl.abort();
  }, [commodity]);

  /** Headline values */
  const currentPoint = useMemo(() => (hist?.length ? hist[hist.length - 1] : null), [hist]);
  const currentPrice = currentPoint?.y ?? null;

  const next1 = bundle["1"]?.[0];
  const next3 = bundle["3"]?.[0];
  const next6 = bundle["6"]?.[0];

  const pc1 = pctChange(next1?.yhat, currentPrice);
  const pc3 = pctChange(next3?.yhat, currentPrice);
  const pc6 = pctChange(next6?.yhat, currentPrice);

  /** Base chart rows: history + 6-month forecast */
  const chartData = useMemo(() => {
    const f6 = bundle["6"] || [];
    const histRows = (hist || []).map((p) => ({ date: p.date, actual: p.y }));
    const foreRows = f6.map((p) => ({
      date: p.date,
      forecast: p.yhat,
      lo: p.lo,
      hi: p.hi,
    }));
    return [...histRows, ...foreRows];
  }, [hist, bundle]);

  /** Moving Average + MoM Change View */
  const enrichedData = useMemo(() => {
    const movingAverage = (arr, k = 3) =>
      arr.map((_, i) => {
        const slice = arr.slice(Math.max(0, i - k + 1), i + 1);
        const nums = slice.filter((v) => Number.isFinite(v));
        return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null;
      });

    const data = chartData.map((d) => ({ ...d }));

    if (showMA) {
      const actuals = data.map((d) => (Number.isFinite(d.actual) ? Number(d.actual) : null));
      const ma3 = movingAverage(actuals, 3);
      data.forEach((d, i) => (d.ma3 = ma3[i]));
    }

    if (changeView) {
      for (let i = 1; i < data.length; i++) {
        const prev = data[i - 1].actual ?? data[i - 1].forecast;
        const curr = data[i].actual ?? data[i].forecast;
        data[i].mom =
          Number.isFinite(prev) && Number.isFinite(curr) ? curr - prev : null;
      }
    }
    return data;
  }, [chartData, showMA, changeView]);

  const xInterval = Math.max(0, Math.floor(Math.max(enrichedData.length, 1) / 8));

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div className="relative max-w-6xl mx-auto pt-6 pb-2">
        <img src={crest} alt="Sierra Leone Coat of Arms" className="absolute left-0 top-1 h-15 md:h-16" />
        <img src={flag} alt="Sierra Leone Flag" className="absolute right-0 top-1 h-15 md:h-16" />
        <div className="text-center">
          <h1 className="text-2xl md:text-3xl font-extrabold text-black">
            AI and Machine Learning Solutions for Retailer Food Price Forecasting in Sierra Leone – Dashboard
          </h1>
          <p className="text-sm mt-1 font-bold">
            Please pick a commodity and see predicted prices in 1, 3, and 6 months.
          </p>
        </div>
      </div>

      {/* Controls */}
      <div className="rounded-2xl border bg-white p-4 md:p-6">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="text-xs mb-1 block" htmlFor="commodity">Select commodity</label>
            <select
              id="commodity"
              className="w-full border rounded-lg p-2 bg-white"
              value={commodity}
              onChange={(e) => setCommodity(e.target.value)}
            >
              {commodityList.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-xs mb-1 block" htmlFor="chartType">Chart type</label>
            <select
              id="chartType"
              className="w-full border rounded-lg p-2 bg-white"
              value={chartType}
              onChange={(e) => setChartType(e.target.value)}
            >
              <option value="area">Area</option>
              <option value="line">Line</option>
              <option value="bar">Bar</option>
              <option value="composed">Composed (Line + Bars)</option>
            </select>
          </div>

          <div className="flex items-center gap-6">
            <label className="flex items-center gap-2">
              <input type="checkbox" className="h-4 w-4" checked={showMA} onChange={(e) => setShowMA(e.target.checked)} />
              <span className="text-sm">3-mo moving average</span>
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" className="h-4 w-4" checked={changeView} onChange={(e) => setChangeView(e.target.checked)} />
              <span className="text-sm">Show MoM change</span>
            </label>
          </div>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <StatCard title="Current price" value={currentPrice == null ? "…" : `${fmtCurrency(currentPrice)} SLL`} sub={currentPoint?.date ? `as of ${currentPoint.date}` : ""} />
        <StatCard title="Price in 1 month" value={next1 ? `${fmtCurrency(next1.yhat)} SLL` : "…"} changePct={pc1} />
        <StatCard title="Price in 3 months" value={next3 ? `${fmtCurrency(next3.yhat)} SLL` : "…"} changePct={pc3} />
        <StatCard title="Price in 6 months" value={next6 ? `${fmtCurrency(next6.yhat)} SLL` : "…"} changePct={pc6} />
      </div>

      {/* Chart */}
      <div className="rounded-2xl border bg-white p-4">
        <div className="text-sm font-medium mb-2">
          {changeView ? "Month-over-Month Change" : "Last 18 months & next 6 months"}
        </div>
        <div className="h-[360px] w-full">
          <ResponsiveContainer>
            {changeView ? (
              <BarChart data={enrichedData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date" interval={xInterval} />
                <YAxis tickFormatter={fmtCurrency} />
                <Tooltip formatter={(v, n) => [fmtCurrency(v), n]} />
                <Legend />
                <Bar dataKey="mom" name="MoM change" fill={COLORS.forecast} />
              </BarChart>
            ) : chartType === "line" ? (
              <LineChart data={enrichedData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date" interval={xInterval} />
                <YAxis tickFormatter={fmtCurrency} />
                <Tooltip formatter={(v, n) => [fmtCurrency(v), n]} />
                <Legend />
                <Line type="monotone" dataKey="actual" name="Actual" stroke={COLORS.actual} dot={false} />
                <Line type="monotone" dataKey="forecast" name="Forecast" stroke={COLORS.forecast} dot={false} />
                {showMA && <Line type="monotone" dataKey="ma3" name="3-mo MA" stroke={COLORS.ma} dot={false} />}
              </LineChart>
            ) : chartType === "bar" ? (
              <BarChart data={enrichedData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date" interval={xInterval} />
                <YAxis tickFormatter={fmtCurrency} />
                <Tooltip formatter={(v, n) => [fmtCurrency(v), n]} />
                <Legend />
                <Bar dataKey="actual" name="Actual" fill={COLORS.actual} />
                <Bar dataKey="forecast" name="Forecast" fill={COLORS.forecast} />
              </BarChart>
            ) : chartType === "composed" ? (
              <ComposedChart data={enrichedData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date" interval={xInterval} />
                <YAxis tickFormatter={fmtCurrency} />
                <Tooltip formatter={(v, n) => [fmtCurrency(v), n]} />
                <Legend />
                <Bar dataKey="actual" name="Actual" fill={COLORS.actual} />
                <Line type="monotone" dataKey="forecast" name="Forecast" stroke={COLORS.forecast} dot={false} />
                {showMA && <Line type="monotone" dataKey="ma3" name="3-mo MA" stroke={COLORS.ma} dot={false} />}
              </ComposedChart>
            ) : (
              <AreaChart data={enrichedData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date" interval={xInterval} />
                <YAxis tickFormatter={fmtCurrency} />
                <Tooltip formatter={(v, n) => [fmtCurrency(v), n]} />
                <Legend />
                <Area type="monotone" dataKey="actual" name="Actual" stroke={COLORS.actual} fillOpacity={0} dot={false} />
                <Area type="monotone" dataKey="forecast" name="Forecast" stroke={COLORS.forecast} fillOpacity={0.1} dot={false} />
                {showMA && <Line type="monotone" dataKey="ma3" name="3-mo MA" stroke={COLORS.ma} dot={false} />}
              </AreaChart>
            )}
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
