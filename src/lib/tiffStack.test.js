import { describe, expect, it } from "vitest";
import { decodeTiffStack, normalizeGrayPageToRgba } from "./tiffStack.js";
import { makeClassicGrayTiff, makeClassicPaletteTiff, makeClassicRgbTiff } from "./tiffTestFixtures.js";

function findFirstIfdEntryOffset(buffer, targetTag) {
  const view = new DataView(buffer);
  const littleEndian = String.fromCharCode(view.getUint8(0), view.getUint8(1)) === "II";
  const ifdOffset = view.getUint32(4, littleEndian);
  const entryCount = view.getUint16(ifdOffset, littleEndian);

  for (let index = 0; index < entryCount; index += 1) {
    const entryOffset = ifdOffset + 2 + index * 12;
    if (view.getUint16(entryOffset, littleEndian) === targetTag) return entryOffset;
  }
  throw new Error(`Missing fixture tag ${targetTag}`);
}

function expectPixelsWithoutDescription(buffer, filename) {
  const stack = decodeTiffStack(buffer, filename);

  expect([...stack.pages[0].pixels]).toEqual([0, 64, 128, 255]);
  expect(stack.pages[0].imageDescription).toBeUndefined();
}

describe("TIFF stack decoding", () => {
  it("decodes each IFD as a one-based z-stack candidate", () => {
    const buffer = makeClassicGrayTiff({
      width: 2,
      height: 2,
      pages: [
        [0, 1, 2, 3],
        [4, 5, 6, 7]
      ]
    });

    const stack = decodeTiffStack(buffer, "scan.tif");

    expect(stack.stackCount).toBe(2);
    expect(stack.pages[1]).toMatchObject({
      stackNumber: 2,
      width: 2,
      height: 2,
      bitsPerSample: 8,
      samplesPerPixel: 1,
      photometric: 1
    });
    expect([...stack.pages[1].pixels]).toEqual([4, 5, 6, 7]);
  });

  it("treats a single-page TIFF as one stack", () => {
    const stack = decodeTiffStack(makeClassicGrayTiff(), "single.tiff");

    expect(stack.stackCount).toBe(1);
    expect(stack.pages[0].stackNumber).toBe(1);
  });

  it("ignores unrelated ASCII metadata tags while decoding pages", () => {
    const stack = decodeTiffStack(makeClassicGrayTiff({ description: "abc" }), "metadata.tif");

    expect(stack.stackCount).toBe(1);
    expect([...stack.pages[0].pixels]).toEqual([0, 64, 128, 255]);
  });

  it("ignores an ImageDescription with an unsupported TIFF type", () => {
    const buffer = makeClassicGrayTiff({
      metadataByPage: [[{ tag: 270, type: 7, values: [1, 2, 3, 4, 5] }]]
    });

    expectPixelsWithoutDescription(buffer, "undefined-description.tif");
  });

  it("ignores an ImageDescription with an invalid external offset", () => {
    const buffer = makeClassicGrayTiff({ description: "ImageJ=1.53e" });
    const view = new DataView(buffer);
    const imageDescriptionEntryOffset = findFirstIfdEntryOffset(buffer, 270);
    view.setUint32(imageDescriptionEntryOffset + 8, buffer.byteLength + 1, true);

    expectPixelsWithoutDescription(buffer, "invalid-description-offset.tif");
  });

  it("ignores an ImageDescription above the viewer metadata limit", () => {
    const buffer = makeClassicGrayTiff({ description: "abc" });
    const view = new DataView(buffer);
    const imageDescriptionEntryOffset = findFirstIfdEntryOffset(buffer, 270);
    view.setUint32(imageDescriptionEntryOffset + 4, 16 * 1024 * 1024 + 1, true);
    view.setUint32(imageDescriptionEntryOffset + 8, buffer.byteLength + 1, true);

    expectPixelsWithoutDescription(buffer, "oversized-description.tif");
  });

  it("normalizes 16-bit grayscale pages to RGBA for canvas display", () => {
    const stack = decodeTiffStack(
      makeClassicGrayTiff({ bitsPerSample: 16, pages: [[1000, 2000, 3000, 4000]] }),
      "depth.tif"
    );

    const rgba = normalizeGrayPageToRgba(stack.pages[0]);

    expect([...rgba]).toEqual([
      0, 0, 0, 255,
      85, 85, 85, 255,
      170, 170, 170, 255,
      255, 255, 255, 255
    ]);
  });

  it("decodes 8-bit RGB pages to RGBA for canvas display", () => {
    const stack = decodeTiffStack(makeClassicRgbTiff(), "rgb.tif");

    expect(stack.pages[0]).toMatchObject({
      bitsPerSample: 8,
      samplesPerPixel: 3,
      photometric: 2
    });
    expect([...stack.pages[0].pixels]).toEqual([
      255, 0, 0,
      0, 255, 0,
      0, 0, 255,
      255, 255, 255
    ]);
    expect([...normalizeGrayPageToRgba(stack.pages[0])]).toEqual([
      255, 0, 0, 255,
      0, 255, 0, 255,
      0, 0, 255, 255,
      255, 255, 255, 255
    ]);
  });

  it("decodes 8-bit palette-color pages to RGBA for canvas display", () => {
    const stack = decodeTiffStack(makeClassicPaletteTiff(), "palette.tif");

    expect(stack.pages[0]).toMatchObject({
      bitsPerSample: 8,
      samplesPerPixel: 1,
      photometric: 3
    });
    expect([...stack.pages[0].pixels]).toEqual([0, 1, 2, 3]);
    expect([...normalizeGrayPageToRgba(stack.pages[0])]).toEqual([
      0, 0, 0, 255,
      255, 0, 0, 255,
      0, 255, 0, 255,
      0, 0, 255, 255
    ]);
  });

  it("rejects compressed TIFF pages", () => {
    const buffer = makeClassicGrayTiff();
    new DataView(buffer).setUint16(8 + 2 + 3 * 12 + 8, 5, true);

    expect(() => decodeTiffStack(buffer, "compressed.tif")).toThrow(/uncompressed/i);
  });
});
