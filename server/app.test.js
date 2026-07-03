import { afterEach, describe, expect, it } from "vitest";
import { makeClassicGrayTiff } from "../src/lib/tiffTestFixtures.js";
import { createApp } from "./app.js";

const servers = [];

function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, "127.0.0.1", () => {
      servers.push(server);
      const address = server.address();
      resolve(`http://127.0.0.1:${address.port}`);
    });
  });
}

describe("raw16 API", () => {
  afterEach(async () => {
    await Promise.all(
      servers.splice(0).map(
        (server) =>
          new Promise((resolve, reject) => {
            server.close((error) => (error ? reject(error) : resolve()));
          })
      )
    );
  });

  it("returns the requested TIFF stack page as grey16 raw bytes with display metadata", async () => {
    const app = createApp();
    const origin = await listen(app);
    const tiff = makeClassicGrayTiff({
      bitsPerSample: 16,
      description: "ImageJ=1.53e\nmin=1000.0\nmax=1010.0",
      pages: [
        [1, 2, 3, 4],
        [1000, 1005, 1010, 2000]
      ]
    });

    const response = await fetch(`${origin}/api/tiff/raw16?stackNumber=2`, {
      method: "POST",
      headers: { "Content-Type": "image/tiff" },
      body: tiff
    });
    const pixels = new Uint16Array(await response.arrayBuffer());

    expect(response.status).toBe(200);
    expect(response.headers.get("x-image-width")).toBe("2");
    expect(response.headers.get("x-image-height")).toBe("2");
    expect(response.headers.get("x-stack-count")).toBe("2");
    expect(response.headers.get("x-stack-number")).toBe("2");
    expect(response.headers.get("x-display-min")).toBe("1000");
    expect(response.headers.get("x-display-max")).toBe("1010");
    expect(response.headers.get("x-pixel-format")).toBe("uint16le");
    expect([...pixels]).toEqual([1000, 1005, 1010, 2000]);
  });
});

