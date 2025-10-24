<header className="app-header">
  <h1 className="app-title">AI and Machine Learning Solutions for Retailer Food Price Forecasting in Sierra Leone – Dashboard</h1>
  <p className="app-subtitle">
    Please pick a commodity from the drop-down and see the predicted prices in 1, 3, and 6 months.
  </p>
  <nav className="mt-3 inline-flex rounded-xl border bg-white p-1 shadow-sm">
    {/* ...tab buttons... */}
  </nav>
</header>

import React, { useState } from "react";
import ForecastDashboard from "./components/ForecastDashboard.jsx";
import ModelEval from "./components/ModelEval.jsx";

export default function App() {
  const [tab, setTab] = useState("forecast");

  return (
    <div className="min-h-screen app-gradient">
      {/* 50% centered shell (defined in index.css) */}
      <div className="app-shell">
       

        <main className="mt-6">
          {tab === "forecast" ? <ForecastDashboard /> : <ModelEval />}
        </main>

        <footer className="text-center text-xs text-muted-foreground mt-8">
          Built by Karim for SL food price-forecasting research.
        </footer>
      </div>
    </div>
  );
}



