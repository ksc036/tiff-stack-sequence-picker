import { describe, expect, it } from "vitest";
import { makeClassicGrayTiff } from "../src/lib/tiffTestFixtures.js";
import { readGrey16RawFromTiffBuffer } from "./imageProcessing.js";

function uint16Values(buffer) {
  return [
    ...new Uint16Array(
      buffer.buffer,
      buffer.byteOffset,
      buffer.byteLength / Uint16Array.BYTES_PER_ELEMENT
    )
  ];
}

describe("server TIFF raw16 processing", () => {
  it("reads the clamped stack page as grey16 raw with ImageJ display min and max", async () => {
    const tiff = Buffer.from(
      makeClassicGrayTiff({
        bitsPerSample: 16,
        description: "ImageJ=1.53e\nimages=2\nslices=2\nmin=1000.0\nmax=1010.0",
        pages: [
          [1, 2, 3, 4],
          [1000, 1005, 1010, 2000]
        ]
      })
    );

    const raw = await readGrey16RawFromTiffBuffer(tiff, { stackNumber: 99 });

    expect(raw).toMatchObject({
      width: 2,
      height: 2,
      stackCount: 2,
      stackNumber: 2,
      min: 1000,
      max: 1010,
      pixelFormat: "uint16le"
    });
    expect(uint16Values(raw.buffer)).toEqual([1000, 1005, 1010, 2000]);
  });

  it("falls back to the selected page pixel range when ImageJ display range is absent", async () => {
    const tiff = Buffer.from(
      makeClassicGrayTiff({
        bitsPerSample: 16,
        pages: [[25, 50, 75, 100]]
      })
    );

    const raw = await readGrey16RawFromTiffBuffer(tiff, { stackNumber: 1 });

    expect(raw.min).toBe(25);
    expect(raw.max).toBe(100);
  });
});

