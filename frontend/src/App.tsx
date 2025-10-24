import { useEffect, useState } from "react";
import { getHealth } from "./lib/api";

export default function App() {
  const [status, setStatus] = useState("checking...");
  useEffect(() => {
    getHealth().then(d => setStatus(`OK: ${d.rows} rows`))
               .catch(e => setStatus(`Error: ${e.message}`));
  }, []);
  return <div>Backend status: {status}</div>;
}
