// Use proxy in production; keep dev override if you want.
const DEV_BASE = import.meta.env.VITE_API_URL || "http://localhost:8000";
export const API = import.meta.env.PROD ? "/api" : DEV_BASE.replace(/\/$/, "");

export async function getHealth() {
  const r = await fetch(`${API}/health`);
  if (!r.ok) throw new Error(`API ${r.status}`);
  return r.json();
}
