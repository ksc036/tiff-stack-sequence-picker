import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchRaw16TiffPage } from "./raw16Client.js";

function uint16ArrayBuffer(values) {
  const buffer = new ArrayBuffer(values.length * Uint16Array.BYTES_PER_ELEMENT);
  const view = new DataView(buffer);
  values.forEach((value, index) => view.setUint16(index * 2, value, true));
  return buffer;
}

describe("raw16 TIFF client", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("streams the selected file to the server and parses raw16 display metadata", async () => {
    const file = {
      name: "frame.tif",
      type: "image/tiff",
      arrayBuffer: vi.fn(() => {
        throw new Error("client should not decode the TIFF into an ArrayBuffer");
      })
    };
    const responseBuffer = uint16ArrayBuffer([1000, 1005, 1010, 2000]);
    const fetchMock = vi.fn(async () => ({
      ok: true,
      headers: new Headers({
        "x-image-width": "2",
        "x-image-height": "2",
        "x-stack-count": "2",
        "x-stack-number": "2",
        "x-display-min": "1000",
        "x-display-max": "1010",
        "x-pixel-format": "uint16le"
      }),
      arrayBuffer: async () => responseBuffer
    }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchRaw16TiffPage(file, 4);

    expect(fetchMock).toHaveBeenCalledWith("/api/tiff/raw16?stackNumber=4", {
      method: "POST",
      headers: { "Content-Type": "image/tiff" },
      body: file
    });
    expect(file.arrayBuffer).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      filename: "frame.tif",
      stackCount: 2,
      page: {
        width: 2,
        height: 2,
        bitsPerSample: 16,
        stackNumber: 2,
        displayMin: 1000,
        displayMax: 1010,
        pixelFormat: "uint16le"
      }
    });
    expect([...result.page.pixels]).toEqual([1000, 1005, 1010, 2000]);
  });
});

