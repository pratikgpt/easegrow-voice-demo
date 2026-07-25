import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Plugin order matters: Tailwind first, then TanStack Start, Nitro (build only), and React last.
export default defineConfig(async ({ command }) => {
  const plugins = [
    tailwindcss(),
    tanstackStart({
      // src/server.ts wraps TanStack Start's server entry with a friendly error page.
      server: { entry: "server" },
    }),
  ];

  // Nitro only runs at build time. It detects the host (Vercel, Netlify, …) and falls back to Cloudflare.
  if (command === "build") {
    const { nitro } = await import("nitro/vite");
    plugins.push(nitro({ defaultPreset: "cloudflare-module" }));
  }

  plugins.push(viteReact());

  return {
    resolve: {
      tsconfigPaths: true,
      alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
      dedupe: ["react", "react-dom", "react/jsx-runtime", "react/jsx-dev-runtime"],
    },
    server: { host: "::", port: 8080 },
    plugins,
  };
});
