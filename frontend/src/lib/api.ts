export const API = "/api"; // use the Vercel proxy

export async function getHealth() {
  const r = await fetch(`${API}/health`);
  if (!r.ok) throw new Error(`API ${r.status}`);
  return r.json();
}
