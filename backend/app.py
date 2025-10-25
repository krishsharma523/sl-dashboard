from pathlib import Path
from typing import Dict, List, Optional, Tuple
import os

import numpy as np
import pandas as pd
from fastapi import FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware

# ---------------- Paths & dataset candidates ----------------
ROOT = Path(__file__).resolve().parent
DATA_DIR = ROOT / "data"
DATA_DIR.mkdir(parents=True, exist_ok=True)
DATA_CANDIDATES = [
    DATA_DIR / "SL_food_prices_prepared.csv",
    DATA_DIR / "SL_food_prices_prepared.csv.csv",
    DATA_DIR / "SL_food_prices_prepared..csv",
    DATA_DIR / "SL_food_prices_cleaned2.xls",
    DATA_DIR / "SL_food_prices_cleaned2.xlsx",
]

# ---------------- Globals ----------------
DF: Optional[pd.DataFrame] = None
DATE_COL: Optional[str] = None
PRICE_COL: Optional[str] = None
REGION_COL: Optional[str] = None            # resolved region/market column (real or synthesized)
TIDY_COMMODITY_COL: Optional[str] = None
WIDE_COMMODITY_MAP: Dict[str, str] = {}     # friendly name -> 'commodity_*' column

CANON_REGIONS_ORDER = ["Eastern", "North Western", "Northern", "Southern", "Western Area"]
CANON_COMMODITIES = ["Fish (bonga)", "Rice (imported)", "Oil (palm)"]

# ---------------- Utils ----------------
def _read_any(p: Path) -> pd.DataFrame:
    return pd.read_excel(p) if p.suffix.lower() in (".xls", ".xlsx") else pd.read_csv(p, encoding="utf-8")

def _norm(s: Optional[str]) -> str:
    return "" if s is None else str(s).strip().lower()

def _norm_series(s: pd.Series) -> pd.Series:
    return s.astype(str).str.strip().str.lower()

def _label_from_region_flag_col(colname: str) -> str:
    # colname like "region_north western" -> "North Western"
    label = colname[len("region_"):].strip()
    label = label.replace("_", " ")
    # title case, but fix known proper nouns
    label = " ".join(w.capitalize() for w in label.split())
    # canonical fixes
    fixes = {
        "North Western": "North Western",
        "Western Area": "Western Area",
        "Eastern": "Eastern",
        "Northern": "Northern",
        "Southern": "Southern",
    }
    # Best-effort normalization
    for k, v in fixes.items():
        if _norm(label) == _norm(k):
            return v
    return label

def _detect_columns_and_prepare(df: pd.DataFrame) -> Tuple[pd.DataFrame, str, str, str, Optional[str], Dict[str, str]]:
    cols = [str(c).strip() for c in df.columns]
    low = [c.lower() for c in cols]

    # date
    date_col = None
    for k in ["date", "month", "period", "obs_date"]:
        if k in low:
            date_col = cols[low.index(k)]
            break
    if not date_col:
        raise RuntimeError("Could not find a date/period column")

    # price
    price_col = None
    for k in ["price_sll", "retail_price_sll", "price_slll", "price"]:
        if k in low:
            price_col = cols[low.index(k)]
            break
    if not price_col:
        for i, c in enumerate(low):
            if "price" in c:
                price_col = cols[i]
                break
    if not price_col:
        raise RuntimeError("Could not find a price column")

    # region: prefer explicit market/region/pop_region
    region_col = None
    for k in ["market", "region", "pop_region", "district", "area", "market_name", "select market"]:
        if k in low:
            region_col = cols[low.index(k)]
            break

    df = df.copy()
    # if no explicit region, try one-hot region_* columns and synthesize one
    if region_col is None:
        region_flag_cols = [c for c in cols if c.lower().startswith("region_")]
        if region_flag_cols:
            # build a new column 'region_synth' with the first true/1/>0 flag translated to a label
            def synth_region(row) -> Optional[str]:
                for c in region_flag_cols:
                    val = row.get(c)
                    # treat numeric >0, "1", "true", True as active
                    try:
                        num = float(val)
                        active = num > 0
                    except Exception:
                        active = str(val).strip().lower() in ("1", "true", "yes")
                    if active:
                        return _label_from_region_flag_col(c)
                return None

            df["region_synth"] = df.apply(synth_region, axis=1)
            region_col = "region_synth"

    if region_col is None:
        raise RuntimeError("Could not detect a region/market column")

    # commodity: tidy or wide
    tidy_commodity_col = None
    for k in ["commodity", "item", "product"]:
        if k in low:
            tidy_commodity_col = cols[low.index(k)]
            break

    wide_map: Dict[str, str] = {}
    if tidy_commodity_col is None:
        for c in cols:
            lc = c.lower()
            if lc.startswith("commodity_"):
                raw = c[len("commodity_") :].strip()
                friendly = (
                    "Fish (bonga)" if _norm(raw) in ["fish (bonga)", "fish(bonga)", "bonga"] else
                    "Rice (imported)" if _norm(raw) in ["rice (imported)", "rice(imported)", "imported rice"] else
                    "Oil (palm)" if _norm(raw) in ["oil (palm)", "oil(palm)", "palm oil"] else
                    raw
                )
                wide_map[friendly] = c

    # keep only usable rows
    df[date_col] = pd.to_datetime(df[date_col], errors="coerce")
    df = df.dropna(subset=[date_col, price_col, region_col]).reset_index(drop=True)
    df[region_col] = df[region_col].astype(str).str.strip()

    return df.sort_values(date_col).reset_index(drop=True), date_col, price_col, region_col, tidy_commodity_col, wide_map

def _load_dataset() -> None:
    global DF, DATE_COL, PRICE_COL, REGION_COL, TIDY_COMMODITY_COL, WIDE_COMMODITY_MAP
    last_err = None
    for p in DATA_CANDIDATES:
        if not p.exists():
            continue
        try:
            raw = _read_any(p)
            raw.columns = [str(c).strip() for c in raw.columns]
            df, date_col, price_col, region_col, tidy_col, wide_map = _detect_columns_and_prepare(raw)
            DF, DATE_COL, PRICE_COL, REGION_COL = df, date_col, price_col, region_col
            TIDY_COMMODITY_COL, WIDE_COMMODITY_MAP = tidy_col, dict(wide_map)
            print(
                f"[INFO] Loaded {len(DF)} rows. "
                f"date_col={DATE_COL} price_col={PRICE_COL} region_col={REGION_COL} "
                f"mode={'tidy' if TIDY_COMMODITY_COL else ('wide' if WIDE_COMMODITY_MAP else 'single')}"
            )
            return
        except Exception as e:
            last_err = e
            print(f"[WARN] Failed reading {p.name}: {e}")
    raise SystemExit(f"[FATAL] No usable dataset found in {DATA_DIR}. Last error: {last_err}")

def _available_commodities() -> List[str]:
    if TIDY_COMMODITY_COL:
        vals = DF[TIDY_COMMODITY_COL].dropna().astype(str).unique().tolist()  # type: ignore
        ordered = [c for c in CANON_COMMODITIES if c in vals]
        for v in vals:
            if v not in ordered:
                ordered.append(v)
        return ordered
    if WIDE_COMMODITY_MAP:
        ordered = [c for c in CANON_COMMODITIES if c in WIDE_COMMODITY_MAP]
        for v in WIDE_COMMODITY_MAP:
            if v not in ordered:
                ordered.append(v)
        return ordered
    return ["price"]

def _filter_by_selection(df: pd.DataFrame, commodity: str, region: str) -> pd.DataFrame:
    out = df

    # commodity
    if TIDY_COMMODITY_COL:
        if commodity and _norm(commodity) != "price":
            s = _norm_series(out[TIDY_COMMODITY_COL])  # type: ignore
            out = out[s == _norm(commodity)]
    elif WIDE_COMMODITY_MAP and commodity and _norm(commodity) != "price":
        col = WIDE_COMMODITY_MAP.get(commodity)
        if col and col in out.columns:
            s = pd.to_numeric(out[col], errors="coerce")
            if s.notna().any():
                out = out[s.fillna(0) > 0]
            else:
                out = out[out[col].astype(str).str.lower().isin(["1", "true", "yes"])]

    # region
    if region and _norm(region) not in ["", "all"]:
        s = _norm_series(out[REGION_COL])  # type: ignore
        out = out[s == _norm(region)]

    return out

# --------------- Forecast ----------------
def _holt_winters_forecast(y: pd.Series, periods: int) -> np.ndarray:
    try:
        from statsmodels.tsa.holtwinters import ExponentialSmoothing
        if len(y.dropna()) >= 18:
            fit = ExponentialSmoothing(
                y.astype(float), trend="add", seasonal="add", seasonal_periods=12, initialization_method="estimated"
            ).fit(optimized=True)
            return fit.forecast(periods).astype(float).to_numpy()
    except Exception:
        pass
    vals = y.dropna().astype(float).values
    if len(vals) == 0:
        return np.full(periods, np.nan)
    last = vals[-1]
    slope = (vals[-1] - vals[-7]) / 6.0 if len(vals) >= 7 else 0.0
    return np.array([last + slope * (i + 1) for i in range(periods)], dtype=float)

# --------------- API ----------------
app = FastAPI()

# ---- CORS (Vercel + Localhost) ----
# Add more comma-separated origins via env var ALLOWED_ORIGINS if needed.
extra_origins = [o.strip() for o in os.getenv("ALLOWED_ORIGINS", "").split(",") if o.strip()]
allowed_origins = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
] + extra_origins

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,                  # explicit list (safe with credentials)
    allow_origin_regex=r"https://.*\.vercel\.app$", # any vercel.app deployment
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/health")
def health():
    return {
        "ok": DF is not None,
        "rows": 0 if DF is None else len(DF),
        "date_col": DATE_COL,
        "price_col": PRICE_COL,
        "region_col": REGION_COL,
        "regions_present": [] if DF is None else sorted(DF[REGION_COL].astype(str).unique()),
        "commodities_present": _available_commodities(),
        "mode": "tidy" if TIDY_COMMODITY_COL else ("wide" if WIDE_COMMODITY_MAP else "single"),
    }

@app.get("/options")
def options():
    commodities = _available_commodities()
    regions = [] if DF is None else sorted(DF[REGION_COL].dropna().astype(str).unique())
    ordered_regions = [r for r in CANON_REGIONS_ORDER if r in regions]
    for r in regions:
        if r not in ordered_regions:
            ordered_regions.append(r)
    return {"commodities": commodities, "regions": ["All"] + ordered_regions}

@app.get("/series")
def series(commodity: str = Query("price"), region: str = Query("All"), months: int = Query(18)):
    sub = _filter_by_selection(DF, commodity, region)  # type: ignore
    sub = sub.sort_values(DATE_COL)
    if months and months > 0:
        sub = sub.tail(months)
    pts = [{"date": pd.to_datetime(d).date().isoformat(), "y": float(v)}
           for d, v in zip(sub[DATE_COL], sub[PRICE_COL])]
    return {"points": pts}

@app.get("/predict")
def predict(commodity: str, region: str = Query("All"), horizon: int = Query(1)):
    sub = _filter_by_selection(DF, commodity, region)  # type: ignore
    sub = sub.dropna(subset=[PRICE_COL, DATE_COL]).sort_values(DATE_COL)
    if sub.empty:
        return {"error": "no data for selection"}, 404

    current_price = float(sub[PRICE_COL].iloc[-1])
    last_date = pd.to_datetime(sub[DATE_COL].iloc[-1])
    fc6 = _holt_winters_forecast(sub[PRICE_COL], 6)
    fdates = [(last_date + pd.DateOffset(months=i)).date().isoformat() for i in range(1, 7)]

    def pct(v):
        return None if (v is None or not np.isfinite(v) or abs(current_price) < 1e-9) else (float(v) - current_price) / current_price * 100.0

    bundle = {
        "pred_1m": float(fc6[0]) if np.isfinite(fc6[0]) else None,
        "pred_3m": float(fc6[2]) if np.isfinite(fc6[2]) else None,
        "pred_6m": float(fc6[5]) if np.isfinite(fc6[5]) else None,
        "pct_change_1m": pct(fc6[0]),
        "pct_change_3m": pct(fc6[2]),
        "pct_change_6m": pct(fc6[5]),
        "future_dates": {"1m": fdates[0], "3m": fdates[2], "6m": fdates[5]},
        "future_path": [{"date": fdates[i], "forecast": float(fc6[i]) if np.isfinite(fc6[i]) else None} for i in range(6)],
    }

    snap = {1: ("pred_1m", "1m"), 3: ("pred_3m", "3m"), 6: ("pred_6m", "6m")}.get(horizon, ("pred_1m", "1m"))
    key, tag = snap
    return {
        "commodity": commodity,
        "region": region,
        "horizon": horizon,
        "forecast_price": bundle[key],
        "current_price": current_price,
        "pct_change": bundle[f"pct_change_{tag}"],
        "future_date": bundle["future_dates"][tag],
        "kpi": bundle,
    }

# Load once
_load_dataset()
