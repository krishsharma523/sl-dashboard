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

const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:8000";

/** Consistent series colours */
const COLORS = {
  actual: "#adbac3ff",     // cyan
  forecast: "#e64709ff", // orange/violet
  ma: "#22c55e",         // green
  band: "#0a0a0aff",     // neutral for CI fill
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
  const [bundle, setBundle] = useState({ "1": [], "3": [], "6": [] }); // {"1":[{date,yhat,lo,hi}],...}

  const [loading, setLoading] = useState(true);
  const [chartType, setChartType] = useState("area");
  const [showMA, setShowMA] = useState(false);
  const [changeView, setChangeView] = useState(false);

  /** Load commodity list once */
  useEffect(() => {
    const ctrl = new AbortController();
    (async () => {
      try {
        const r = await fetch(`${API_BASE}/api/commodities`, { signal: ctrl.signal });
        if (!r.ok) return;
        const list = await r.json();
        if (Array.isArray(list) && list.length) setCommodityList(list);
      } catch (_) {
        /* ignore */
      }
    })();
    return () => ctrl.abort();
  }, []);

  /** Load history + forecasts for selected commodity */
  useEffect(() => {
    const ctrl = new AbortController();
    (async () => {
      setLoading(true);
      try {
        const [h, f] = await Promise.all([
          fetch(
            `${API_BASE}/api/history?commodity=${encodeURIComponent(commodity)}&months=18`,
            { signal: ctrl.signal }
          ).then((r) => (r.ok ? r.json() : null)),
          fetch(
            `${API_BASE}/api/forecast_bundle?commodity=${encodeURIComponent(commodity)}`,
            { signal: ctrl.signal }
          ).then((r) => (r.ok ? r.json() : null)),
        ]);

        setHist(h?.points ?? []);
        setBundle(f?.forecasts ?? { "1": [], "3": [], "6": [] });
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
  const currentPoint = useMemo(
    () => (hist?.length ? hist[hist.length - 1] : null),
    [hist]
  );
  const currentPrice = currentPoint?.y ?? null;

  const next1 = bundle["1"]?.[bundle["1"].length - 1];
  const next3 = bundle["3"]?.[bundle["3"].length - 1];
  const next6 = bundle["6"]?.[bundle["6"].length - 1];

  const pc1 = pctChange(next1?.yhat, currentPrice);
  const pc3 = pctChange(next3?.yhat, currentPrice);
  const pc6 = pctChange(next6?.yhat, currentPrice);

  /** Base chart rows: history + 6-month forecast band */
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

  /** SMA(3) and optional month-over-month change view */
  const enrichedData = useMemo(() => {
    const movingAverage = (arr, k = 3) =>
      arr.map((_, i) => {
        const slice = arr.slice(Math.max(0, i - k + 1), i + 1);
        const nums = slice.filter((v) => Number.isFinite(v));
        return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null;
      });

    const data = chartData.map((d) => ({ ...d }));

    if (showMA) {
      const actuals = data.map((d) =>
        Number.isFinite(d.actual) ? Number(d.actual) : null
      );
      const ma3 = movingAverage(actuals, 3);
      data.forEach((d, i) => {
        d.ma3 = ma3[i];
      });
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

  /** X ticks: aim for ~8 labels */
  const xInterval = Math.max(0, Math.floor(Math.max(enrichedData.length, 1) / 8));

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div className="relative max-w-6xl mx-auto pt-6 pb-2">
        <img
          src={crest}
          alt="Sierra Leone Coat of Arms"
          className="pointer-events-none select-none absolute left-0 top-1 h-15 w-auto md:h-16"
        />
        <img
          src={flag}
          alt="Sierra Leone Flag"
          className="pointer-events-none select-none absolute right-0 top-1 h-15 w-auto md:h-16"
        />
        <div className="text-center">
          <h1 className="text-2xl md:text-3xl font-extrabold text-black">
            AI and Machine Learning Solutions for Retailer Food Price Forecasting in Sierra Leone – Dashboard
          </h1>
          <p className="text-sm mt-1 font-bold">
            Please pick a commodity from the drop-down and see the predicted prices in 1, 3, and 6 months.
          </p>
        </div>
      </div>

      {/* Controls */}
      <div className="rounded-2xl border bg-white p-4 md:p-6">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="text-xs text-muted-foreground mb-1 block" htmlFor="commodity">
              Select commodity
            </label>
            <select
              id="commodity"
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
            <label className="text-xs text-muted-foreground mb-1 block" htmlFor="chartType">
              Chart type
            </label>
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
              <input
                type="checkbox"
                className="h-4 w-4"
                checked={showMA}
                onChange={(e) => setShowMA(e.target.checked)}
              />
              <span className="text-sm">3-mo moving average</span>
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                className="h-4 w-4"
                checked={changeView}
                onChange={(e) => setChangeView(e.target.checked)}
              />
              <span className="text-sm">Show MoM change</span>
            </label>
          </div>
        </div>
      </div>

      {/* Summary tiles */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <StatCard
          title="Current price"
          value={currentPrice == null ? "…" : `${fmtCurrency(currentPrice)} SLL`}
          sub={currentPoint?.date ? `as of ${currentPoint.date}` : ""}
        />
        <StatCard
          title="Price in 1 month"
          value={loading || !next1 ? "…" : `${fmtCurrency(next1.yhat)} SLL`}
          sub={
            loading || !next1
              ? ""
              : `around ${next1.date} (≈ ${fmtCurrency(next1.lo)}–${fmtCurrency(next1.hi)})`
          }
          changePct={pc1}
        />
        <StatCard
          title="Price in 3 months"
          value={loading || !next3 ? "…" : `${fmtCurrency(next3.yhat)} SLL`}
          sub={
            loading || !next3
              ? ""
              : `around ${next3.date} (≈ ${fmtCurrency(next3.lo)}–${fmtCurrency(next3.hi)})`
          }
          changePct={pc3}
        />
        <StatCard
          title="Price in 6 months"
          value={loading || !next6 ? "…" : `${fmtCurrency(next6.yhat)} SLL`}
          sub={
            loading || !next6
              ? ""
              : `around ${next6.date} (≈ ${fmtCurrency(next6.lo)}–${fmtCurrency(next6.hi)})`
          }
          changePct={pc6}
        />
      </div>

      {/* Chart */}
      <div className="rounded-2xl border bg-white p-4">
        <div className="text-sm font-medium mb-2">
          {changeView ? "Month-over-Month Change" : "Last 18 months & next 6 months"}
        </div>
        <div className="h-[360px] w-full">
          <ResponsiveContainer>
            {changeView ? (
              <BarChart data={enrichedData} margin={{ top: 8, right: 16, left: 0, bottom: 8 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date" interval={xInterval} />
                <YAxis tickFormatter={(v) => (v > 0 ? `+${fmtCurrency(v)}` : fmtCurrency(v))} />
                <Tooltip formatter={(v, n) => [fmtCurrency(v), n]} />
                <Legend />
                <Bar dataKey="mom" name="MoM change" fill={COLORS.forecast} />
              </BarChart>
            ) : chartType === "line" ? (
              <LineChart data={enrichedData} margin={{ top: 8, right: 16, left: 0, bottom: 8 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date" interval={xInterval} />
                <YAxis tickFormatter={fmtCurrency} />
                <Tooltip formatter={(v, n) => [fmtCurrency(v), n]} />
                <Legend />
                <Line type="monotone" dataKey="actual" name="Actual" stroke={COLORS.actual} dot={false} />
                <Line type="monotone" dataKey="forecast" name="Forecast" stroke={COLORS.forecast} dot={false} />
                {showMA && (
                  <Line type="monotone" dataKey="ma3" name="3-mo MA" stroke={COLORS.ma} dot={false} />
                )}
              </LineChart>
            ) : chartType === "bar" ? (
              <BarChart data={enrichedData} margin={{ top: 8, right: 16, left: 0, bottom: 8 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date" interval={xInterval} />
                <YAxis tickFormatter={fmtCurrency} />
                <Tooltip formatter={(v, n) => [fmtCurrency(v), n]} />
                <Legend />
                <Bar dataKey="actual" name="Actual" fill={COLORS.actual} />
                <Bar dataKey="forecast" name="Forecast" fill={COLORS.forecast} />
              </BarChart>
            ) : chartType === "composed" ? (
              <ComposedChart data={enrichedData} margin={{ top: 8, right: 16, left: 0, bottom: 8 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date" interval={xInterval} />
                <YAxis tickFormatter={fmtCurrency} />
                <Tooltip formatter={(v, n) => [fmtCurrency(v), n]} />
                <Legend />
                <Bar dataKey="actual" name="Actual" fill={COLORS.actual} />
                <Line type="monotone" dataKey="forecast" name="Forecast" stroke={COLORS.forecast} dot={false} />
                {showMA && (
                  <Line type="monotone" dataKey="ma3" name="3-mo MA" stroke={COLORS.ma} dot={false} />
                )}
              </ComposedChart>
            ) : (
              <AreaChart data={enrichedData} margin={{ top: 8, right: 16, left: 0, bottom: 8 }}>
                <defs>
                  <linearGradient id="gForecast" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={COLORS.forecast} stopOpacity={0.25} />
                    <stop offset="95%" stopColor={COLORS.forecast} stopOpacity={0.02} />
                  </linearGradient>
                  <linearGradient id="gBand" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={COLORS.band} stopOpacity={0.2} />
                    <stop offset="95%" stopColor={COLORS.band} stopOpacity={0.04} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date" interval={xInterval} />
                <YAxis tickFormatter={fmtCurrency} />
                <Tooltip formatter={(v, n) => [fmtCurrency(v), n]} />
                <Legend />
                <Area type="monotone" dataKey="actual" name="Actual" stroke={COLORS.actual} fillOpacity={0} dot={false} />
                <Area
                  type="monotone"
                  dataKey="forecast"
                  name="Forecast"
                  stroke={COLORS.forecast}
                  fill="url(#gForecast)"
                  dot={false}
                />
                <Area type="monotone" dataKey="hi" stroke="transparent" fillOpacity={0.4} fill="url(#gBand)" />
                <Area type="monotone" dataKey="lo" stroke="transparent" fillOpacity={0.4} fill="url(#gBand)" />
                {showMA && (
                  <Line type="monotone" dataKey="ma3" name="3-mo MA" stroke={COLORS.ma} dot={false} />
                )}
              </AreaChart>
            )}
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}

