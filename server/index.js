import fs from "node:fs/promises";
import path from "node:path";
import express from "express";
import { createServer as createViteServer } from "vite";
import { createApp } from "./app.js";

const rootDir = process.cwd();
const port = Number.parseInt(process.env.PORT ?? "5173", 10);
const host = process.env.HOST ?? "0.0.0.0";
const app = createApp();

if (process.env.NODE_ENV === "production") {
  const distDir = path.join(rootDir, "dist");
  const distIndex = path.join(distDir, "index.html");

  app.use(express.static(distDir));
  app.get(/^\/(?!api(?:\/|$)).*/, async (_request, response, next) => {
    try {
      await fs.access(distIndex);
      return response.sendFile(distIndex);
    } catch (error) {
      return next(error);
    }
  });
} else {
  const vite = await createViteServer({
    root: rootDir,
    appType: "spa",
    server: {
      middlewareMode: true,
      host
    }
  });
  app.use(vite.middlewares);
}

app.listen(port, host, () => {
  console.log(`TIFF stack sequence picker listening on http://${host}:${port}`);
});

