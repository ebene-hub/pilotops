import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

// The original prototype shared a single global scope across <script> tags and
// passes components/data between modules via `window`. We keep that contract,
// so esbuild must treat the `.jsx` files as JSX. @vitejs/plugin-react handles
// the JSX transform (automatic runtime) + Fast Refresh.
//
// Multi-page app — four entry documents matching the original prototype's pages:
//   /                  → Pilot Ops dashboard   (index.html  → src/main.jsx)
//   /login.html        → Pilot Ops sign-in     (vanilla)
//   /admin.html        → Admin console         (admin.html  → src/admin-main.jsx)
//   /admin-login.html  → Admin sign-in (2FA)   (vanilla)
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    open: true,
  },
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
        login: resolve(__dirname, "login.html"),
        admin: resolve(__dirname, "admin.html"),
        adminLogin: resolve(__dirname, "admin-login.html"),
        adminSignup: resolve(__dirname, "admin-signup.html"),
        watch: resolve(__dirname, "watch.html"),
      },
    },
  },
});
