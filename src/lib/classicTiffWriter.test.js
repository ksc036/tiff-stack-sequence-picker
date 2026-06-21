import { describe, expect, it } from "vitest";
import { writeClassicGrayTiff } from "./classicTiffWriter.js";
import { decodeTiffStack } from "./tiffStack.js";

describe("classic TIFF writer", () => {
  it("writes chained uncompressed grayscale IFDs", () => {
    const output = writeClassicGrayTiff([
      {
        width: 2,
        height: 2,
        bitsPerSample: 8,
        samplesPerPixel: 1,
        photometric: 1,
        pixels: Uint8Array.from([1, 2, 3, 4])
      },
      {
        width: 2,
        height: 2,
        bitsPerSample: 8,
        samplesPerPixel: 1,
        photometric: 1,
        pixels: Uint8Array.from([5, 6, 7, 8])
      }
    ]);

    const decoded = decodeTiffStack(output.buffer, "result.tif");

    expect(decoded.stackCount).toBe(2);
    expect([...decoded.pages[0].pixels]).toEqual([1, 2, 3, 4]);
    expect([...decoded.pages[1].pixels]).toEqual([5, 6, 7, 8]);
  });

  it("rejects pages with incompatible dimensions or sample format", () => {
    const base = {
      width: 2,
      height: 2,
      bitsPerSample: 8,
      samplesPerPixel: 1,
      photometric: 1,
      pixels: Uint8Array.from([1, 2, 3, 4])
    };

    expect(() =>
      writeClassicGrayTiff([base, { ...base, width: 1, pixels: Uint8Array.from([1, 2]) }])
    ).toThrow(/same width/i);
    expect(() => writeClassicGrayTiff([{ ...base, samplesPerPixel: 3 }])).toThrow(/grayscale/i);
  });
});
