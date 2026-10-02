import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  base: "./",
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("recharts") || id.includes("d3-")) return "charts";
          if (id.includes("motion")) return "motion";
          if (id.includes("react-grid-layout") || id.includes("react-resizable") || id.includes("react-draggable")) return "layout";
          if (id.includes("@phosphor-icons")) return "icons";
          if (id.includes("node_modules/react")) return "react";
        },
      },
    },
  },
  server: {
    host: "127.0.0.1",
    port: 4173,
  },
});
