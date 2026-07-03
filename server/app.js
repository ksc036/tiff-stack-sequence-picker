import express from "express";
import { readGrey16RawFromTiffBuffer, resolveMaxImagePixels } from "./imageProcessing.js";

const DEFAULT_MAX_UPLOAD_BYTES = 1024 * 1024 * 1024;

function positiveInteger(value, fallback) {
  const number = Number.parseInt(value, 10);
  return Number.isSafeInteger(number) && number > 0 ? number : fallback;
}

function resolveMaxUploadBytes(maxUploadBytes = process.env.MAX_UPLOAD_BYTES) {
  return positiveInteger(maxUploadBytes, DEFAULT_MAX_UPLOAD_BYTES);
}

function parseStackNumber(value) {
  return positiveInteger(value, 1);
}

export function createApp({ maxUploadBytes, maxImagePixels } = {}) {
  const app = express();
  const uploadLimit = resolveMaxUploadBytes(maxUploadBytes);
  const pixelLimit = maxImagePixels === undefined ? resolveMaxImagePixels() : resolveMaxImagePixels(maxImagePixels);

  app.post("/api/tiff/raw16", express.raw({ type: "*/*", limit: uploadLimit }), async (request, response) => {
    if (!Buffer.isBuffer(request.body) || request.body.length === 0) {
      return response.status(400).json({ error: "Upload a TIFF file as the request body." });
    }

    try {
      const raw = await readGrey16RawFromTiffBuffer(request.body, {
        stackNumber: parseStackNumber(request.query.stackNumber),
        maxImagePixels: pixelLimit
      });

      return response
        .set({
          "Cache-Control": "no-store",
          "X-Image-Width": String(raw.width),
          "X-Image-Height": String(raw.height),
          "X-Stack-Count": String(raw.stackCount),
          "X-Stack-Number": String(raw.stackNumber),
          "X-Display-Min": String(raw.min),
          "X-Display-Max": String(raw.max),
          "X-Pixel-Format": raw.pixelFormat
        })
        .type("application/octet-stream")
        .send(raw.buffer);
    } catch (error) {
      return response.status(400).json({ error: error.message });
    }
  });

  app.use((error, _request, response, next) => {
    if (error?.type === "entity.too.large") {
      return response.status(413).json({
        error: `Upload is too large. Maximum upload size is ${uploadLimit} bytes.`
      });
    }

    return next(error);
  });

  return app;
}
