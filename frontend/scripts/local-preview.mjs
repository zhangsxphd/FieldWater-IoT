import { access } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { preview } from "vite";

// The caller owns the API and its database. Never load the development API proxy here.
export async function startLocalPreview(app, port = 0) {
  try {
    await access(new URL("../dist/index.html", import.meta.url));
    await app.ready();
    return await preview({
      root: fileURLToPath(new URL("../", import.meta.url)),
      configFile: false,
      envDir: false,
      preview: { host: "127.0.0.1", port, strictPort: true, cors: false },
      plugins: [{
        name: "fieldwater-local-api",
        configurePreviewServer(server) {
          server.middlewares.use((req, res, next) => {
            const path = req.url.split("?")[0];
            if (path === "/api" || path.startsWith("/api/")) app.routing(req, res);
            else next();
          });
        },
        closePreviewServer: () => app.close(),
      }],
    });
  } catch (error) {
    await app.close();
    throw error;
  }
}
