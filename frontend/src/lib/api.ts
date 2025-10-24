// Prefer explicit API URL if provided; otherwise fall back to /api (proxy) or localhost in dev.
const explicit = import.meta.env.VITE_API_URL?.trim();
const fallback = import.meta.env.PROD ? "/api" : "http://localhost:8000";

export const API = (explicit || fallback).replace(/\/$/, "");

export async function getHealth() {
  console.log("API base:", API); // keep for one deploy to verify
  const r = await fetch(`${API}/health`);
  if (!r.ok) throw new Error(`API ${r.status}`);
  return r.json();
}
