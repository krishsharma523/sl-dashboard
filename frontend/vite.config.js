import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5174,
    strictPort: false,       // ← Vite will bump to 5175, 5176, ...
  },
});
