import { describe, expect, it } from "vitest";
import { classifyResultPageMetadata, serializeSourceMetadataJson } from "./resultTiffMetadata.js";
import { readClassicTiffMetadata } from "./tiffMetadata.js";
import { makeClassicGrayTiff } from "./tiffTestFixtures.js";

function readTwoPageMetadata() {
  const source = makeClassicGrayTiff({
    pages: [[1, 2, 3, 4], [5, 6, 7, 8]],
    metadataByPage: [
      [
        { tag: 270, type: 2, value: "ImageJ=1.53e\nimages=2" },
        { tag: 271, type: 2, value: "ScopeCo" },
        { tag: 274, type: 3, values: [1] },
        { tag: 282, type: 5, values: [[300, 1]] },
        { tag: 283, type: 5, values: [[300, 1]] },
        { tag: 296, type: 3, values: [2] },
        { tag: 305, type: 2, value: "Acquisition Suite" },
        { tag: 306, type: 2, value: "2026:07:28 10:11:12" },
        { tag: 315, type: 2, value: "Lab" },
        { tag: 316, type: 2, value: "Scope-PC" },
        { tag: 700, type: 1, values: [60, 120, 109, 112, 62] },
        { tag: 33432, type: 2, value: "Copyright Lab" },
        { tag: 34675, type: 7, values: [1, 2, 3, 4] },
        { tag: 330, type: 4, values: [0] },
        { tag: 65000, type: 7, values: [9, 8, 7] },
        {
          tag: 34665,
          type: 4,
          nestedIfd: [{ tag: 36867, type: 2, value: "2026:07:28 10:11:12" }]
        },
        { tag: 34853, type: 4, values: [0] },
        { tag: 40965, type: 4, values: [0] }
      ],
      [{ tag: 274, type: 3, values: [6] }]
    ]
  });

  return readClassicTiffMetadata(source, {
    filename: "source.tif",
    selectedStackNumber: 2
  });
}

function classifyTwoPageMetadata() {
  return classifyResultPageMetadata({
    metadata: readTwoPageMetadata(),
    filename: "source.tif",
    selectedStack: 2,
    stackCount: 2,
    outputPage: 1
  });
}

function classifySelectedEntry(entry) {
  const source = makeClassicGrayTiff({
    pages: [[1, 2, 3, 4], [5, 6, 7, 8]],
    metadataByPage: [[], [entry]]
  });
  const metadata = readClassicTiffMetadata(source, {
    filename: "malformed.tif",
    selectedStackNumber: 2
  });

  return () => classifyResultPageMetadata({
    metadata,
    filename: "malformed.tif",
    selectedStack: 2,
    stackCount: 2,
    outputPage: 1
  });
}

describe("result TIFF metadata", () => {
  it("embeds selected-page entries and only file-level first-IFD fallbacks", () => {
    const result = classifyTwoPageMetadata();

    expect(result.embeddedEntries.map((entry) => entry.tag)).toEqual([
      271, 274, 305, 315, 316, 700, 33432
    ]);
    expect(result.embeddedEntries.find((entry) => entry.tag === 274).values).toEqual([6]);
    expect(result.sourceRecord.tagClassifications).toHaveLength(
      readTwoPageMetadata().firstIfd.entries.length
        + readTwoPageMetadata().firstIfd.nestedIfds[0].ifd.entries.length
        + readTwoPageMetadata().selectedIfd.entries.length
    );
    expect(result.sourceRecord.tagClassifications).toEqual(expect.arrayContaining([
      expect.objectContaining({ sourceIfd: "selected", tag: 274, destination: "embedded" }),
      expect.objectContaining({ sourceIfd: "first", tag: 270, destination: "regenerated" }),
      expect.objectContaining({ sourceIfd: "first", tag: 273, destination: "regenerated" }),
      expect.objectContaining({ sourceIfd: "first", tag: 65000, destination: "sidecar-only" }),
      expect.objectContaining({ sourceIfd: "first/34665", tag: 36867, destination: "sidecar-only" }),
      expect.objectContaining({
        sourceIfd: "first",
        tag: 282,
        destination: "sidecar-only",
        reason: "not-file-level-fallback"
      }),
      expect.objectContaining({
        sourceIfd: "first",
        tag: 274,
        destination: "sidecar-only",
        reason: "shadowed-by-selected-ifd"
      })
    ]));
    expect(result.sourceRecord.tagClassifications.filter(({ tag }) =>
      [330, 34665, 34853, 40965].includes(tag)
    )).toEqual([
      { sourceIfd: "first", tag: 330, destination: "sidecar-only", reason: "source-relative-pointer" },
      { sourceIfd: "first", tag: 34665, destination: "sidecar-only", reason: "source-relative-pointer" },
      { sourceIfd: "first", tag: 34853, destination: "sidecar-only", reason: "source-relative-pointer" },
      { sourceIfd: "first", tag: 40965, destination: "sidecar-only", reason: "source-relative-pointer" }
    ]);
  });

  it.each([
    {
      name: "ASCII descriptive tag with the wrong type",
      entry: { tag: 271, type: 7, values: [1] },
      expected: /tag 271 must use TIFF field type 2/
    },
    {
      name: "Orientation with the wrong type",
      entry: { tag: 274, type: 2, value: "sideways" },
      expected: /tag 274 must use TIFF field type 3/
    },
    {
      name: "Orientation with the wrong count",
      entry: { tag: 274, type: 3, values: [1, 2] },
      expected: /tag 274 must have count 1/
    },
    {
      name: "Orientation outside its domain",
      entry: { tag: 274, type: 3, values: [9] },
      expected: /tag 274 must contain an integer from 1 through 8/
    },
    {
      name: "ResolutionUnit outside its domain",
      entry: { tag: 296, type: 3, values: [4] },
      expected: /tag 296 must contain 1, 2, or 3/
    },
    {
      name: "RATIONAL with a zero denominator",
      entry: { tag: 282, type: 5, values: [[300, 0]] },
      expected: /tag 282 must have a nonzero denominator/
    },
    {
      name: "XMP with the wrong byte type",
      entry: { tag: 700, type: 7, values: [1] },
      expected: /tag 700 must use TIFF field type 1/
    },
    {
      name: "ICC profile with the wrong byte type",
      entry: { tag: 34675, type: 1, values: [1] },
      expected: /tag 34675 must use TIFF field type 7/
    }
  ])("rejects $name", ({ entry, expected }) => {
    const classify = classifySelectedEntry(entry);

    expect(classify).toThrow(new RegExp(`malformed\\.tif: stack 2 tag ${entry.tag}`));
    expect(classify).toThrow(expected);
  });

  it("serializes deterministic provenance without typed arrays", () => {
    const result = classifyTwoPageMetadata();
    const metadata = readTwoPageMetadata();
    metadata.selectedIfd.entries.push({
      tag: 65002,
      type: 11,
      count: 3,
      values: [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY],
      rawBytes: new Uint8Array([0, 0, 192, 127, 0, 0, 128, 127, 0, 0, 128, 255])
    });
    const secondResult = classifyResultPageMetadata({
      metadata,
      filename: "another-source.tif",
      selectedStack: 2,
      stackCount: 2,
      outputPage: 2
    });

    const json = serializeSourceMetadataJson({
      tiffFilename: "cell-a.tif",
      pageRecords: [secondResult.sourceRecord, result.sourceRecord]
    });
    const sidecar = JSON.parse(json);

    expect(sidecar).toMatchObject({
      schemaVersion: 1,
      output: {
        tiffFilename: "cell-a.tif",
        pageCount: 2,
        ordering: "filename-ascending"
      }
    });
    expect(sidecar.pages.map((page) => page.source.filename)).toEqual([
      "another-source.tif", "source.tif"
    ]);
    const unicodeOrdering = JSON.parse(serializeSourceMetadataJson({
      tiffFilename: "unicode.tif",
      pageRecords: [
        {
          ...result.sourceRecord,
          outputPage: 4,
          source: { ...result.sourceRecord.source, filename: "\u00e4-source.tif" }
        },
        {
          ...result.sourceRecord,
          outputPage: 3,
          source: { ...result.sourceRecord.source, filename: "z-source.tif" }
        }
      ]
    }));
    expect(unicodeOrdering.pages.map((page) => page.source.filename)).toEqual([
      "z-source.tif", "\u00e4-source.tif"
    ]);
    expect(sidecar.pages[1].firstIfd.entries[0]).toEqual(expect.objectContaining({
      tag: expect.any(Number),
      type: expect.any(Number),
      count: expect.any(Number),
      rawValueBase64: expect.any(String)
    }));
    expect(sidecar.pages[1].firstIfd.entries.map((entry) => entry.tag)).toEqual([
      ...sidecar.pages[1].firstIfd.entries.map((entry) => entry.tag)
    ].sort((left, right) => left - right));
    expect(sidecar.pages[0].selectedIfd.entries.find((entry) => entry.tag === 65002)).toMatchObject({
      values: ["NaN", "Infinity", "-Infinity"],
      rawValueBase64: "AADAfwAAgH8AAID/"
    });
    expect(sidecar.pages[1].firstIfd.entries.find((entry) => entry.tag === 282).values).toEqual([
      { numerator: 300, denominator: 1 }
    ]);
    expect(sidecar.pages[1].tagClassifications).toEqual([
      ...sidecar.pages[1].tagClassifications
    ].sort((left, right) => left.sourceIfd.localeCompare(right.sourceIfd) || left.tag - right.tag));
    expect(json).toBe(`${JSON.stringify(sidecar, null, 2)}\n`);
  });
});
