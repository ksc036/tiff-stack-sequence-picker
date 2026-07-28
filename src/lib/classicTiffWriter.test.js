import { describe, expect, it } from "vitest";
import { writeClassicGrayTiff } from "./classicTiffWriter.js";
import { readClassicTiffMetadata } from "./tiffMetadata.js";
import { decodeTiffStack, normalizeGrayPageToRgba } from "./tiffStack.js";
import { makeClassicPaletteTiff } from "./tiffTestFixtures.js";

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

  it("writes uncompressed RGB IFDs", () => {
    const pixels = Uint8Array.from([
      255, 0, 0,
      0, 255, 0,
      0, 0, 255,
      255, 255, 255
    ]);
    const output = writeClassicGrayTiff([
      {
        width: 2,
        height: 2,
        bitsPerSample: 8,
        samplesPerPixel: 3,
        photometric: 2,
        pixels
      }
    ]);

    const decoded = decodeTiffStack(output.buffer, "rgb-result.tif");

    expect(decoded.pages[0]).toMatchObject({
      bitsPerSample: 8,
      samplesPerPixel: 3,
      photometric: 2
    });
    expect([...decoded.pages[0].pixels]).toEqual([...pixels]);
  });

  it("writes uncompressed palette-color IFDs", () => {
    const source = decodeTiffStack(makeClassicPaletteTiff(), "palette-source.tif");

    const output = writeClassicGrayTiff([source.pages[0]]);
    const decoded = decodeTiffStack(output.buffer, "palette-result.tif");

    expect(decoded.pages[0]).toMatchObject({
      bitsPerSample: 8,
      samplesPerPixel: 1,
      photometric: 3
    });
    expect([...decoded.pages[0].pixels]).toEqual([0, 1, 2, 3]);
    expect([...normalizeGrayPageToRgba(decoded.pages[0])]).toEqual([
      0, 0, 0, 255,
      255, 0, 0, 255,
      0, 255, 0, 255,
      0, 0, 255, 255
    ]);
  });

  it("writes safe per-page metadata with correct field types", () => {
    const output = writeClassicGrayTiff([{
      width: 2,
      height: 2,
      bitsPerSample: 16,
      samplesPerPixel: 1,
      photometric: 1,
      pixels: Uint16Array.from([1000, 1001, 1002, 1003]),
      imageDescription: "ImageJ=1.53e\nmin=1000\nmax=1003",
      metadataEntries: [
        { tag: 274, type: 3, count: 1, values: [6], rawBytes: Uint8Array.of(0, 6) },
        {
          tag: 282,
          type: 5,
          count: 1,
          values: [{ numerator: 300, denominator: 1 }],
          rawBytes: Uint8Array.of(0, 0, 1, 44, 0, 0, 0, 1)
        },
        { tag: 296, type: 3, count: 1, values: [2], rawBytes: Uint8Array.of(0, 2) },
        { tag: 34675, type: 7, count: 4, values: [1, 2, 3, 4], rawBytes: Uint8Array.of(1, 2, 3, 4) }
      ]
    }]);

    const metadata = readClassicTiffMetadata(output, { filename: "result.tif" });
    expect(metadata.firstIfd.entries.find((entry) => entry.tag === 274).values).toEqual([6]);
    expect(metadata.firstIfd.entries.find((entry) => entry.tag === 282).values).toEqual([
      { numerator: 300, denominator: 1 }
    ]);
    expect(metadata.firstIfd.entries.find((entry) => entry.tag === 34675).rawBytes).toEqual(
      Uint8Array.of(1, 2, 3, 4)
    );
    expect(metadata.firstIfd.entries.map((entry) => entry.tag)).toEqual(
      [...metadata.firstIfd.entries.map((entry) => entry.tag)].sort((a, b) => a - b)
    );
    expect(metadata.firstIfd.entries.find((entry) => entry.tag === 339).values).toEqual([1]);
    expect([...decodeTiffStack(output, "result.tif").pages[0].pixels]).toEqual([
      1000, 1001, 1002, 1003
    ]);
  });

  it("chains pages with variable IFD and metadata value sizes", () => {
    const basePage = {
      width: 2,
      height: 2,
      bitsPerSample: 8,
      samplesPerPixel: 1,
      photometric: 1
    };
    const output = writeClassicGrayTiff([
      {
        ...basePage,
        pixels: Uint8Array.from([1, 2, 3, 4]),
        imageDescription: "ImageJ=1.53e\nmin=1\nmax=4",
        metadataEntries: [
          { tag: 274, type: 3, count: 1, values: [1], rawBytes: Uint8Array.of(0, 1) }
        ]
      },
      {
        ...basePage,
        pixels: Uint8Array.from([5, 6, 7, 8]),
        imageDescription: "ImageJ=1.53e\nmin=5\nmax=8\nunit=micron",
        metadataEntries: [
          {
            tag: 305,
            type: 2,
            count: 16,
            values: "Acquisition App",
            rawBytes: Uint8Array.from("Acquisition App\0", (character) => character.charCodeAt(0))
          },
          { tag: 34675, type: 7, count: 5, values: [9, 8, 7, 6, 5], rawBytes: Uint8Array.of(9, 8, 7, 6, 5) }
        ]
      }
    ]);

    const firstMetadata = readClassicTiffMetadata(output, { filename: "result.tif" });
    const secondMetadata = readClassicTiffMetadata(output, {
      filename: "result.tif",
      selectedStackNumber: 2
    });
    const decoded = decodeTiffStack(output, "result.tif");

    expect(firstMetadata.firstIfd.entries.find((entry) => entry.tag === 274).values).toEqual([1]);
    expect(secondMetadata.selectedIfd.entries.find((entry) => entry.tag === 305).values).toBe("Acquisition App");
    expect(secondMetadata.selectedIfd.entries.find((entry) => entry.tag === 34675).rawBytes).toEqual(
      Uint8Array.of(9, 8, 7, 6, 5)
    );
    expect(decoded.pages.map((page) => page.imageDescription)).toEqual([
      "ImageJ=1.53e\nmin=1\nmax=4",
      "ImageJ=1.53e\nmin=5\nmax=8\nunit=micron"
    ]);
    expect(decoded.pages.map((page) => [...page.pixels])).toEqual([
      [1, 2, 3, 4],
      [5, 6, 7, 8]
    ]);
  });

  it("rejects metadata that tries to override generated structure", () => {
    const basePage = {
      width: 2,
      height: 2,
      bitsPerSample: 8,
      samplesPerPixel: 1,
      photometric: 1,
      pixels: Uint8Array.from([1, 2, 3, 4])
    };

    expect(() => writeClassicGrayTiff([{
      ...basePage,
      metadataEntries: [
        { tag: 273, type: 4, count: 1, values: [123], rawBytes: Uint8Array.of(123, 0, 0, 0) }
      ]
    }])).toThrow(/writer-owned TIFF tag 273/i);
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
    expect(() => writeClassicGrayTiff([{ ...base, samplesPerPixel: 3 }])).toThrow(/photometric interpretation is 2/i);
  });
});
