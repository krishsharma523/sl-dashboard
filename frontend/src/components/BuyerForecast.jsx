import React, { useEffect, useMemo, useState } from "react";
import {
  ResponsiveContainer, ComposedChart, Line, Area, XAxis, YAxis,
  CartesianGrid, Tooltip as RTooltip, Legend
} from "recharts";

const API_BASE = (import.meta.env.VITE_API_BASE || "/api").replace(/\/$/, "");
const nf0 = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 });
const fmt = (n) => (Number.isFinite(n) ? nf0.format(n) : "—");

function monthsBetween(d1, d2) {
  const a = new Date(d1);
  const b = new Date(d2);
  return Math.max(0, (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth()));
}

function QuickHorizons({ commodity, onPickDate }) {
  const [rows, setRows] = useState([]);
  const [meta, setMeta] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(null);

  useEffect(() => {
    let alive = true;
    async function go() {
      if (!commodity) return;
      setLoading(true); setErr(null);
      try {
        // 1) Last-known from /series
        const rr = await fetch(
          `${API_BASE}/series?commodity=${encodeURIComponent(commodity)}&region=${encodeURIComponent("All")}&months=24`
        );
        if (!rr.ok) throw new Error(`HTTP ${rr.status}`);
        const jj = await rr.json();
        const pts = Array.isArray(jj?.points) ? jj.points : [];
        const last = pts[pts.length - 1] || null;
        const lastKnown = last ? { date: last.date, price_sll: last.y } : null;

        // 2) Predict for 1, 3, 6 months
        const horizons = [1, 3, 6];
        const out = [];
        for (const h of horizons) {
          const pr = await fetch(
            `${API_BASE}/predict?commodity=${encodeURIComponent(commodity)}&region=${encodeURIComponent("All")}&horizon=${h}`
          );
          if (!pr.ok) throw new Error(`HTTP ${pr.status}`);
          const pj = await pr.json();
          out.push({
            h,
            target_date: pj?.kpi?.future_dates?.[`${h}m`] || "",
            predicted_price: pj?.kpi?.[`pred_${h}m`],
            lo: undefined,
            hi: undefined,
          });
        }

        if (!alive) return;
        setRows(out);
        setMeta({ last_known: lastKnown, model: "XGBoost" });
        setLoading(false);
      } catch (e) {
        if (!alive) return;
        setErr(e.message || String(e));
        setLoading(false);
      }
    }
    go();
    return () => { alive = false; };
  }, [commodity]);

  if (loading) return <div className="card">Loading 1/3/6-month forecasts…</div>;
  if (err) return <div className="card bg-red-50 border-red-200 text-red-700">Error: {err}</div>;
  if (!rows.length) return null;

  const lastPrice = meta?.last_known?.price_sll;

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-medium">Quick forecast at 1 / 3 / 6 months</h3>
        {meta?.last_known?.date && (
          <div className="text-xs text-muted-foreground">
            Last known ({meta.last_known.date}): <span className="font-medium">{fmt(lastPrice)}</span>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {rows.map((r) => {
          const delta = (lastPrice && r.predicted_price != null)
            ? ((r.predicted_price - lastPrice) / lastPrice) * 100
            : null;
          const arrow = delta != null ? (delta >= 0 ? "▲" : "▼") : "";
          const arrowColor = delta != null ? (delta >= 0 ? "text-red-600" : "text-emerald-600") : "text-ink";
          return (
            <div key={r.h} className="rounded-2xl border p-4 shadow-sm bg-white">
              <div className="text-xs text-muted-foreground">Horizon</div>
              <div className="text-lg font-semibold">{r.h} month{r.h > 1 ? "s" : ""}</div>

              <div className="mt-2 text-xs text-muted-foreground">Target date</div>
              <div className="text-base">{r.target_date}</div>

              <div className="mt-2 text-xs text-muted-foreground">Predicted price</div>
              <div className="text-2xl font-bold">{fmt(r.predicted_price)}</div>

              {(r.lo != null && r.hi != null) && (
                <div className="mt-1 text-xs text-muted-foreground">
                  Band: {fmt(r.lo)} – {fmt(r.hi)}
                </div>
              )}

              {delta != null && (
                <div className={`mt-2 text-sm ${arrowColor}`}>
                  {arrow} {delta >= 0 ? "+" : ""}{delta.toFixed(1)}%
                </div>
              )}

              <div className="mt-3">
                <button onClick={() => onPickDate?.(r.target_date)} className="btn-primary w-full">
                  Use this date
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function BuyerForecast() {
  const [commodity, setCommodity] = useState("Rice");
  const [buyDate, setBuyDate] = useState("");
  const [current, setCurrent] = useState(null);
  const [forecast, setForecast] = useState(null);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(null);

  const todayISO = useMemo(() => new Date().toISOString().slice(0, 10), []);

  // Load history from /series (last 60 months)
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await fetch(
          `${API_BASE}/series?commodity=${encodeURIComponent(commodity)}&region=${encodeURIComponent("All")}&months=60`
        );
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const j = await r.json();
        if (!alive) return;
        const points = Array.isArray(j?.points) ? j.points : [];
        setHistory(points.map(p => ({ date: p.date, price: p.y })));
      } catch {}
    })();
    return () => { alive = false; };
  }, [commodity]);

  // Use nearest horizon (1/3/6) to the chosen date and call /predict
  async function onSearch() {
    if (!commodity || !buyDate) return;
    setErr(null); setLoading(true); setCurrent(null); setForecast(null);
    try {
      const last = history[history.length - 1];
      const lastDate = last?.date;
      const lastPrice = last?.price;
      if (!lastDate) throw new Error("No history available yet.");

      const m = monthsBetween(lastDate, buyDate);
      const candidates = [1, 3, 6];
      const horizon = candidates.reduce((best, h) =>
        Math.abs(h - m) < Math.abs(best - m) ? h : best, candidates[0]);

      const url = `${API_BASE}/predict?commodity=${encodeURIComponent(commodity)}&region=${encodeURIComponent("All")}&horizon=${horizon}`;
      const r = await fetch(url);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = await r.json();

      setCurrent({ date: lastDate, price_sll: lastPrice });
      setForecast({
        target_date: j?.kpi?.future_dates?.[`${horizon}m`] || "",
        predicted_price: j?.kpi?.[`pred_${horizon}m`],
        last_known: { date: lastDate, price_sll: lastPrice },
        path: []
      });
    } catch (e) {
      setErr(e.message || String(e));
    } finally {
      setLoading(false);
    }
  }

  function handlePickDate(dateStr) {
    setBuyDate(dateStr);
    setTimeout(onSearch, 0);
    // intentionally not awaiting; UI remains responsive
  }

  const series = useMemo(() => {
    const obs = (history || []).map(d => ({ date: d.date, observed: d.price }));
    const fc = (forecast?.path || []).map(p => ({ date: p.date, forecast: p.predicted, lo: p.lo, hi: p.hi }));
    return [
      ...obs,
      ...fc,
      ...(forecast ? [{ date: forecast.target_date, forecast: forecast.predicted_price, lo: forecast.predicted_price, hi: forecast.predicted_price }] : [])
    ];
  }, [history, forecast]);

  return (
    <div className="min-h-screen app-gradient p-6 font-sans text-ink">
      <div className="max-w-5xl mx-auto space-y-6">
        <h1 className="font-brand text-3xl md:text-4xl tracking-tight">Plan Your Purchase</h1>
        <p className="text-sm text-muted-foreground">See today’s price and a forecast for your chosen date (XGBoost).</p>

        <div className="card">
          <div className="grid grid-cols-1 md:grid-cols-5 gap-4 items-end">
            <div className="md:col-span-3">
              <div className="text-xs text-muted-foreground mb-1">Food Commodity</div>
              <select className="w-full border rounded-lg p-2 bg-white" value={commodity} onChange={e => setCommodity(e.target.value)}>
                {["Rice","Fish","Palm oil"].map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div className="md:col-span-2">
              <div className="text-xs text-muted-foreground mb-1">Planned Purchase Date</div>
              <input type="date" min={todayISO} className="w-full border rounded-lg p-2" value={buyDate} onChange={e => setBuyDate(e.target.value)} />
            </div>
          </div>

          <div className="mt-4 flex gap-2">
            <button onClick={onSearch} disabled={loading || !buyDate} className="btn-primary disabled:opacity-60">
              {loading ? "Looking up…" : "Search Forecast"}
            </button>
            <button onClick={() => { setForecast(null); setCurrent(null); setErr(null); }} className="btn-outline">
              Reset
            </button>
          </div>

          {err && <div className="mt-4 rounded-xl border bg-red-50 text-red-700 px-4 py-3">Error: {err}</div>}
        </div>

        <QuickHorizons commodity={commodity} onPickDate={handlePickDate} />

        {(current || forecast) && !err && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="card">
              <div className="text-sm text-muted-foreground">Current Price ({current?.date || "—"})</div>
              <div className="font-brand text-3xl mt-1">{nf0.format(current?.price_sll || 0)}</div>
              <div className="text-xs text-muted-foreground mt-1">Commodity: {commodity}</div>
            </div>
            <div className="card">
              <div className="text-sm text-muted-foreground">Forecast for {forecast?.target_date || "—"}</div>
              <div className="font-brand text-3xl mt-1">{nf0.format(forecast?.predicted_price || 0)}</div>
              <div className="text-xs text-muted-foreground mt-1">Model: XGBoost</div>
            </div>
            <div className="card">
              <div className="text-sm text-muted-foreground">Last Known ({forecast?.last_known?.date || "—"})</div>
              <div className="font-brand text-3xl mt-1">{nf0.format(forecast?.last_known?.price_sll || 0)}</div>
            </div>
          </div>
        )}

        {series.length > 0 && (
          <div className="card">
            <h3 className="text-sm font-medium mb-2">Historical & Forecasted Prices</h3>
            <div className="h-[320px] w-full">
              <ResponsiveContainer>
                <ComposedChart data={series} margin={{ top: 10, right: 20, left: 0, bottom: 30 }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="date" tick={{ fontSize: 12, fill: "#64748b" }} angle={-30} textAnchor="end" height={50} />
                  <YAxis tickFormatter={(n)=>nf0.format(n)} tick={{ fill: "#64748b" }} />
                  <RTooltip formatter={(v, n) => [nf0.format(v), n]} />
                  <Legend iconType="line" />
                  <Area type="monotone" dataKey="hi" stroke="none" fill="#ef476f22" isAnimationActive={false} name="Uncertainty" />
                  <Area type="monotone" dataKey="lo" stroke="none" fill="#ffffff" fillOpacity={1} isAnimationActive={false} />
                  <Line name="Observed" type="monotone" dataKey="observed" stroke="#3c8422" dot={{ r: 2 }} strokeWidth={2} connectNulls />
                  <Line name="Forecast" type="monotone" dataKey="forecast" stroke="#e53935" dot={{ r: 3 }} strokeWidth={2.2} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        <div className="text-xs text-muted-foreground text-center py-4">
          Built for SL buyer planning • XGBoost model • Quick 1/3/6M cards
        </div>
      </div>
    </div>
  );
}
