import { describe, expect, it } from "vitest";
import { readClassicTiffMetadata } from "./tiffMetadata.js";
import { makeClassicGrayTiff } from "./tiffTestFixtures.js";

describe("classic TIFF metadata reader", () => {
  it.each(["II", "MM"])("decodes TIFF field types 1 through 13 in %s byte order", (byteOrder) => {
    const source = makeClassicGrayTiff({
      byteOrder,
      metadataByPage: [[
        { tag: 65001, type: 1, values: [1, 255] },
        { tag: 65002, type: 2, value: "microscope" },
        { tag: 65003, type: 3, values: [65530] },
        { tag: 65004, type: 4, values: [4_000_000_000] },
        { tag: 65005, type: 5, values: [[300, 1]] },
        { tag: 65006, type: 6, values: [-2] },
        { tag: 65007, type: 7, values: [0, 127, 255] },
        { tag: 65008, type: 8, values: [-1234] },
        { tag: 65009, type: 9, values: [-2_000_000] },
        { tag: 65010, type: 10, values: [[-3, 2]] },
        { tag: 65011, type: 11, values: [1.5] },
        { tag: 65012, type: 12, values: [Math.PI] },
        { tag: 65013, type: 13, values: [1234] }
      ]]
    });

    const metadata = readClassicTiffMetadata(source, { filename: "metadata.tif" });

    expect(metadata.byteOrder).toBe(byteOrder);
    expect(metadata.firstIfd.entries.find((entry) => entry.tag === 65002).values).toBe("microscope");
    expect(metadata.firstIfd.entries.find((entry) => entry.tag === 65005).values).toEqual([
      { numerator: 300, denominator: 1 }
    ]);
    expect(metadata.firstIfd.entries.find((entry) => entry.tag === 65010).values).toEqual([
      { numerator: -3, denominator: 2 }
    ]);
    expect(metadata.firstIfd.entries.find((entry) => entry.tag === 65012).values[0]).toBeCloseTo(Math.PI);
  });

  it("captures first, selected, and known nested metadata IFDs", () => {
    const source = makeClassicGrayTiff({
      pages: [[1, 2, 3, 4], [5, 6, 7, 8]],
      metadataByPage: [
        [
          { tag: 271, type: 2, value: "ScopeCo" },
          {
            tag: 34665,
            type: 4,
            nestedIfd: [{ tag: 36867, type: 2, value: "2026:07:28 10:11:12" }]
          }
        ],
        [{ tag: 274, type: 3, values: [6] }]
      ]
    });

    const metadata = readClassicTiffMetadata(source, {
      filename: "two-page.tif",
      selectedStackNumber: 2
    });

    expect(metadata.firstIfd.entries.find((entry) => entry.tag === 271).values).toBe("ScopeCo");
    expect(metadata.selectedIfd.entries.find((entry) => entry.tag === 274).values).toEqual([6]);
    expect(metadata.firstIfd.nestedIfds[0].ifd.entries[0].values).toBe("2026:07:28 10:11:12");
  });

  it("rejects metadata values above the configured limit", () => {
    const source = makeClassicGrayTiff({
      metadataByPage: [[{ tag: 270, type: 2, value: "12345" }]]
    });

    expect(() =>
      readClassicTiffMetadata(source, {
        filename: "large-metadata.tif",
        limits: { maxTagBytes: 4, maxFileMetadataBytes: 64, maxIfdDepth: 8 }
      })
    ).toThrow(/large-metadata\.tif.*tag 270.*4 bytes/i);
  });

  it("rejects cycles through known metadata pointers", () => {
    const source = makeClassicGrayTiff({
      metadataByPage: [[{ tag: 34665, type: 4, values: [8] }]]
    });

    expect(() =>
      readClassicTiffMetadata(source, { filename: "cycle.tif" })
    ).toThrow(/cycle\.tif.*cycle.*tag 34665/i);
  });
});
