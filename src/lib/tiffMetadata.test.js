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
    const entries = new Map(metadata.firstIfd.entries.map((entry) => [entry.tag, entry]));
    const expectedRawBytes = byteOrder === "II"
      ? new Map([
        [65001, [1, 255]], [65002, [109, 105, 99, 114, 111, 115, 99, 111, 112, 101, 0]],
        [65003, [250, 255]], [65004, [0, 40, 107, 238]], [65005, [44, 1, 0, 0, 1, 0, 0, 0]],
        [65006, [254]], [65007, [0, 127, 255]], [65008, [46, 251]], [65009, [128, 123, 225, 255]],
        [65010, [253, 255, 255, 255, 2, 0, 0, 0]], [65011, [0, 0, 192, 63]],
        [65012, [24, 45, 68, 84, 251, 33, 9, 64]], [65013, [210, 4, 0, 0]]
      ])
      : new Map([
        [65001, [1, 255]], [65002, [109, 105, 99, 114, 111, 115, 99, 111, 112, 101, 0]],
        [65003, [255, 250]], [65004, [238, 107, 40, 0]], [65005, [0, 0, 1, 44, 0, 0, 0, 1]],
        [65006, [254]], [65007, [0, 127, 255]], [65008, [251, 46]], [65009, [255, 225, 123, 128]],
        [65010, [255, 255, 255, 253, 0, 0, 0, 2]], [65011, [63, 192, 0, 0]],
        [65012, [64, 9, 33, 251, 84, 68, 45, 24]], [65013, [0, 0, 4, 210]]
      ]);

    expect(metadata.byteOrder).toBe(byteOrder);
    expect(entries.get(65001).values).toEqual([1, 255]);
    expect(entries.get(65002).values).toBe("microscope");
    expect(entries.get(65003).values).toEqual([65530]);
    expect(entries.get(65004).values).toEqual([4_000_000_000]);
    expect(entries.get(65005).values).toEqual([{ numerator: 300, denominator: 1 }]);
    expect(entries.get(65006).values).toEqual([-2]);
    expect(entries.get(65007).values).toEqual([0, 127, 255]);
    expect(entries.get(65008).values).toEqual([-1234]);
    expect(entries.get(65009).values).toEqual([-2_000_000]);
    expect(entries.get(65010).values).toEqual([{ numerator: -3, denominator: 2 }]);
    expect(entries.get(65011).values).toEqual([1.5]);
    expect(entries.get(65012).values[0]).toBeCloseTo(Math.PI);
    expect(entries.get(65013).values).toEqual([1234]);
    expectedRawBytes.forEach((rawBytes, tag) => {
      expect([...entries.get(tag).rawBytes]).toEqual(rawBytes);
    });
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

  it("identifies the originating pointer tag when a nested IFD is out of bounds", () => {
    const source = makeClassicGrayTiff({
      metadataByPage: [[{ tag: 34665, type: 4, values: [0] }]]
    });
    const pointerValueOffset = 8 + 2 + 9 * 12 + 8;
    new DataView(source).setUint32(pointerValueOffset, source.byteLength + 1, true);

    expect(() =>
      readClassicTiffMetadata(source, { filename: "bad-nested.tif" })
    ).toThrow(/bad-nested\.tif.*stack 1.*tag 34665/i);
  });

  it("rejects tag values that point outside the TIFF file", () => {
    const source = makeClassicGrayTiff({
      metadataByPage: [[{ tag: 65001, type: 2, value: "metadata" }]]
    });
    const valueOffset = 8 + 2 + 9 * 12 + 8;
    new DataView(source).setUint32(valueOffset, source.byteLength + 1, true);

    expect(() =>
      readClassicTiffMetadata(source, { filename: "bad-value.tif" })
    ).toThrow(/bad-value\.tif.*stack 1.*tag 65001.*outside/i);
  });

  it("rejects aggregate metadata values above the configured file limit", () => {
    const source = makeClassicGrayTiff({
      metadataByPage: [[
        { tag: 65001, type: 1, values: [1, 2, 3, 4] },
        { tag: 65002, type: 1, values: [5, 6, 7, 8] }
      ]]
    });

    expect(() =>
      readClassicTiffMetadata(source, {
        filename: "file-limit.tif",
        limits: { maxTagBytes: 16, maxFileMetadataBytes: 35, maxIfdDepth: 8 }
      })
    ).toThrow(/file-limit\.tif.*stack 1.*tag 65002.*35 bytes file metadata limit/i);
  });

  it("rejects known metadata IFDs beyond the configured depth", () => {
    const source = makeClassicGrayTiff({
      metadataByPage: [[{
        tag: 34665,
        type: 4,
        nestedIfd: [{ tag: 330, type: 4, nestedIfd: [{ tag: 34665, type: 4, nestedIfd: [] }] }]
      }]]
    });

    expect(() =>
      readClassicTiffMetadata(source, {
        filename: "deep.tif",
        limits: { maxTagBytes: 16, maxFileMetadataBytes: 64, maxIfdDepth: 0 }
      })
    ).toThrow(/deep\.tif.*stack 1.*depth 0.*tag 34665/i);
  });

  it.each([0, 1.5])("rejects invalid selected stack number %s", (selectedStackNumber) => {
    expect(() =>
      readClassicTiffMetadata(makeClassicGrayTiff(), {
        filename: "invalid-stack.tif",
        selectedStackNumber
      })
    ).toThrow(/invalid-stack\.tif.*selected stack number/i);
  });
});
