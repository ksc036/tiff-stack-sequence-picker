# TIFF Result Metadata Preservation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve reconstruction-relevant metadata in generated TIFF pages and archive complete source metadata provenance in `result/source-metadata.json`.

**Architecture:** Keep the existing selective pixel decoder tolerant and add a separate strict classic-TIFF metadata reader for result generation. Classify parsed tags through a dedicated preservation policy, pass safe standard tags to a generalized TIFF writer, regenerate structural tags and ImageJ sequence metadata, and serialize all first-IFD, selected-IFD, and known nested metadata into a deterministic JSON sidecar.

**Tech Stack:** JavaScript ES modules, React 18, browser File System Access API, Vitest, Vite, custom classic-TIFF parser/writer.

## Global Constraints

- Preserve the current uncommitted 16-bit pixel and ImageJ display min/max work; do not revert or overwrite it.
- Continue rendering 16-bit TIFFs through server `grey16` raw pixels and browser WebGL2 display min/max with the existing 2D fallback.
- Produce exactly `result/<editable-result-name>.tif`, `result/stack-selections.csv`, and `result/source-metadata.json`.
- Preserve numeric pixel samples without rescaling, clipping, or 8-bit conversion.
- Keep output as uncompressed classic TIFF supporting the current 8-bit or 16-bit unsigned grayscale, RGB, and palette pixel formats.
- Do not add BigTIFF, compressed-page, signed-pixel, floating-pixel, or planar-RGB support.
- Regenerate physical offsets, strip layout, IFD links, output page count, and result sequence dimensions.
- Do not embed unknown/private tags or source-relative pointer tags in the rebuilt TIFF; archive them in the sidecar.
- Capture at most 16 MiB for one metadata tag and 64 MiB of metadata per source file; fail clearly when a limit is exceeded.
- Keep normal TIFF viewing tolerant of unknown metadata; make result generation strict and non-silent.
- Add no runtime dependency for TIFF metadata handling.

---

### Task 1: Commit The Existing Display-Range Baseline

**Files:**
- Modify: `server/imageProcessing.js`
- Modify: `src/lib/classicTiffWriter.js`
- Modify: `src/lib/resultSequence.js`
- Modify: `src/lib/resultSequence.test.js`
- Modify: `src/lib/tiffStack.js`
- Create: `src/lib/tiffDisplayRange.js`
- Create: `docs/solutions/logic-errors/preserve-imagej-display-range-in-rebuilt-tiff.md`

**Interfaces:**
- Produces: `parseImageJDisplayRange(description)` and `formatImageJDisplayRange(range)` in `src/lib/tiffDisplayRange.js`.
- Produces: selected output pages with page-specific tag 270 descriptions and unchanged numeric pixels.
- Consumes: existing `decodeTiffStack()` and `writeClassicGrayTiff()` APIs.

- [ ] **Step 1: Inspect the existing patch and confirm its scope**

Run:

```bash
git diff -- server/imageProcessing.js src/lib/classicTiffWriter.js src/lib/resultSequence.js src/lib/resultSequence.test.js src/lib/tiffStack.js src/lib/tiffDisplayRange.js docs/solutions/logic-errors/preserve-imagej-display-range-in-rebuilt-tiff.md
```

Expected: only shared ImageJ min/max parsing, tag 270 decoding/writing, the result integration regression test, and its durable solution note.

- [ ] **Step 2: Run the focused display-range regression**

Run:

```bash
npm test -- src/lib/resultSequence.test.js server/imageProcessing.test.js src/lib/tiffStack.test.js src/lib/classicTiffWriter.test.js
```

Expected: PASS, including `preserves each selected source page's ImageJ display min and max`.

- [ ] **Step 3: Run the production build and whitespace check**

Run:

```bash
npm run build
git diff --check
```

Expected: both commands exit successfully.

- [ ] **Step 4: Commit only the display-range baseline**

```bash
git add server/imageProcessing.js src/lib/classicTiffWriter.js src/lib/resultSequence.js src/lib/resultSequence.test.js src/lib/tiffStack.js src/lib/tiffDisplayRange.js docs/solutions/logic-errors/preserve-imagej-display-range-in-rebuilt-tiff.md
git commit -m "fix: preserve TIFF display ranges in results"
```

### Task 2: Read Complete Classic-TIFF Metadata Safely

**Files:**
- Create: `src/lib/tiffMetadata.js`
- Create: `src/lib/tiffMetadata.test.js`
- Modify: `src/lib/tiffTestFixtures.js`

**Interfaces:**
- Produces:

```js
readClassicTiffMetadata(input, {
  filename = "TIFF file",
  selectedStackNumber = 1,
  limits = {
    maxTagBytes: 16 * 1024 * 1024,
    maxFileMetadataBytes: 64 * 1024 * 1024,
    maxIfdDepth: 8
  }
})
```

- Returns:

```js
{
  byteOrder: "II" | "MM",
  firstIfd: TiffMetadataIfd,
  selectedIfd: TiffMetadataIfd
}
```

- Defines:

```js
// ASCII uses a string. RATIONAL/SRATIONAL use
// { numerator, denominator } objects. Other types use number arrays.
{
  tag: Number,
  type: Number,
  count: Number,
  values: String | Number[] | Array<{ numerator: Number, denominator: Number }>,
  rawBytes: Uint8Array
}

{
  offset: Number,
  entries: TiffMetadataEntry[],
  nestedIfds: Array<{ pointerTag: Number, ifd: TiffMetadataIfd }>
}
```

- Consumes: an `ArrayBuffer` or typed-array view already loaded for pixel decoding.
- Produces test-fixture support for `byteOrder`, `metadataByPage`, and nested metadata IFD entries without changing existing fixture defaults.

- [ ] **Step 1: Add failing field-type and byte-order tests**

Add this shape to `src/lib/tiffMetadata.test.js`:

```js
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
});
```

- [ ] **Step 2: Run the metadata reader test to verify it fails**

Run:

```bash
npm test -- src/lib/tiffMetadata.test.js
```

Expected: FAIL because `tiffMetadata.js` and generalized fixture options do not exist.

- [ ] **Step 3: Generalize the TIFF fixture encoder**

Extend `makeClassicGrayTiff()` with these optional inputs:

```js
{
  byteOrder = "II",
  metadataByPage = [],
  // A metadata entry may include:
  // { tag: 34665, type: 4, nestedIfd: [{ tag, type, values/value }] }
}
```

Implement one field encoder used only by fixtures:

```js
function encodeFixtureValues(entry, littleEndian) {
  // Type 2 reads entry.value and appends one NUL byte.
  // Types 5 and 10 read [numerator, denominator] pairs.
  // Types 1, 3, 4, 6, 7, 8, 9, 11, 12, and 13 read entry.values.
  // Return exactly { count, bytes }.
}
```

Lay out variable-sized IFDs, nested IFDs, external values, and pixel strips before writing offsets. Keep the existing default little-endian output and existing fixture call signatures unchanged.

- [ ] **Step 4: Implement the strict metadata reader**

Create `src/lib/tiffMetadata.js` with:

```js
export const DEFAULT_TIFF_METADATA_LIMITS = Object.freeze({
  maxTagBytes: 16 * 1024 * 1024,
  maxFileMetadataBytes: 64 * 1024 * 1024,
  maxIfdDepth: 8
});

const TYPE_SIZES = new Map([
  [1, 1], [2, 1], [3, 2], [4, 4], [5, 8], [6, 1], [7, 1],
  [8, 2], [9, 4], [10, 8], [11, 4], [12, 8], [13, 4]
]);

const NESTED_IFD_POINTER_TAGS = new Set([330, 34665, 34853, 40965]);

export function readClassicTiffMetadata(input, options = {}) {
  // Validate classic TIFF byte order and magic 42.
  // Walk the top-level IFD chain to selectedStackNumber.
  // Parse the first and selected IFD, preserving raw value bytes.
  // Follow only NESTED_IFD_POINTER_TAGS.
  // Enforce per-tag, per-file, depth, bounds, and cycle limits.
  // Throw messages containing filename, stack number, and tag when relevant.
}
```

Decode all numeric values using the source byte order. Copy only the tag value bytes into `rawBytes`; never copy the pixel regions referenced by strip or tile offsets.

- [ ] **Step 5: Add failing nested-IFD and allocation-limit tests**

Add:

```js
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
```

- [ ] **Step 6: Run focused and existing TIFF decoder tests**

Run:

```bash
npm test -- src/lib/tiffMetadata.test.js src/lib/tiffStack.test.js
```

Expected: PASS. Existing page decoding remains unchanged for fixtures without metadata options.

- [ ] **Step 7: Commit the metadata reader**

```bash
git add src/lib/tiffMetadata.js src/lib/tiffMetadata.test.js src/lib/tiffTestFixtures.js
git commit -m "feat: read complete classic TIFF metadata"
```

### Task 3: Classify Embedded And Sidecar Metadata

**Files:**
- Create: `src/lib/resultTiffMetadata.js`
- Create: `src/lib/resultTiffMetadata.test.js`

**Interfaces:**
- Consumes: `readClassicTiffMetadata()` output.
- Produces:

```js
classifyResultPageMetadata({
  metadata,
  filename,
  selectedStack,
  stackCount,
  outputPage
})
```

- Returns:

```js
{
  embeddedEntries: TiffMetadataEntry[],
  sourceRecord: {
    outputPage: Number,
    source: {
      filename: String,
      stackNumber: Number,
      stackCount: Number,
      byteOrder: "II" | "MM"
    },
    firstIfd: TiffMetadataIfd,
    selectedIfd: TiffMetadataIfd,
    tagClassifications: Array<{
      sourceIfd: String,
      tag: Number,
      destination: "embedded" | "regenerated" | "sidecar-only",
      reason: String
    }>
  }
}
```

- Produces:

```js
serializeSourceMetadataJson({
  tiffFilename,
  pageRecords
})
```

- Returns stable, two-space-indented JSON with `schemaVersion: 1`, filename-ascending ordering, base64 raw tag values, and no typed arrays.

- [ ] **Step 1: Write failing classification tests**

Create tests that parse a two-page fixture and assert the exact policy:

```js
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
      { tag: 65000, type: 7, values: [9, 8, 7] },
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
  filename: "source.tif",
  selectedStackNumber: 2
});
const result = classifyResultPageMetadata({
  metadata,
  filename: "source.tif",
  selectedStack: 2,
  stackCount: 2,
  outputPage: 1
});

expect(result.embeddedEntries.map((entry) => entry.tag)).toEqual([
  271, 274, 282, 283, 296, 305, 306, 315, 316, 700, 33432, 34675
]);
expect(result.sourceRecord.tagClassifications).toEqual(expect.arrayContaining([
  expect.objectContaining({ sourceIfd: "selected", tag: 274, destination: "embedded" }),
  expect.objectContaining({ sourceIfd: "first", tag: 270, destination: "regenerated" }),
  expect.objectContaining({ sourceIfd: "first", tag: 273, destination: "regenerated" }),
  expect.objectContaining({ sourceIfd: "first", tag: 65000, destination: "sidecar-only" }),
  expect.objectContaining({ sourceIfd: "first/34665", tag: 36867, destination: "sidecar-only" })
]));
```

Use a duplicate orientation tag in both first and selected IFDs and assert the selected value wins while the first value is classified `sidecar-only` with reason `shadowed-by-selected-ifd`.

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
npm test -- src/lib/resultTiffMetadata.test.js
```

Expected: FAIL because `resultTiffMetadata.js` does not exist.

- [ ] **Step 3: Implement the preservation policy**

Define exact tag groups:

```js
const EMBEDDED_STANDARD_TAGS = new Set([
  269, 271, 272, 274, 282, 283, 285, 286, 287, 296,
  305, 306, 315, 316, 33432, 34675, 700
]);

const WRITER_OWNED_TAGS = new Set([
  256, 257, 258, 259, 262, 270, 273, 277, 278, 279,
  284, 320, 338, 339
]);
```

Merge first-IFD and selected-IFD standard fields with selected values taking
precedence. Never embed nested, private, pointer, tile, thumbnail, EXIF pointer,
GPS pointer, SubIFD pointer, or unknown tags. Emit one classification record
for every entry in every captured IFD.

- [ ] **Step 4: Add and satisfy deterministic sidecar tests**

Add:

```js
const json = serializeSourceMetadataJson({
  tiffFilename: "cell-a.tif",
  pageRecords: [result.sourceRecord]
});
const sidecar = JSON.parse(json);

expect(sidecar).toMatchObject({
  schemaVersion: 1,
  output: {
    tiffFilename: "cell-a.tif",
    pageCount: 1,
    ordering: "filename-ascending"
  }
});
expect(sidecar.pages[0].firstIfd.entries[0]).toEqual(expect.objectContaining({
  tag: expect.any(Number),
  type: expect.any(Number),
  count: expect.any(Number),
  rawValueBase64: expect.any(String)
}));
expect(json.endsWith("\n")).toBe(true);
```

Serialize rationals as `{ "numerator": 300, "denominator": 1 }`, finite numeric
arrays as JSON numbers, and exact raw bytes as `rawValueBase64`. Sort entries by
tag, nested IFDs by pointer tag then offset, and classification records by
source path then tag.

Use a browser-safe chunked encoder whose chunk size is divisible by three so
large values do not create one extra full-size binary string:

```js
function bytesToBase64(bytes) {
  const parts = [];
  const chunkSize = 24_576;
  for (let start = 0; start < bytes.length; start += chunkSize) {
    let binary = "";
    for (const byte of bytes.subarray(start, start + chunkSize)) {
      binary += String.fromCharCode(byte);
    }
    parts.push(btoa(binary));
  }
  return parts.join("");
}
```

Represent decoded `NaN`, positive infinity, and negative infinity as the
strings `"NaN"`, `"Infinity"`, and `"-Infinity"` while keeping raw bytes
authoritative.

- [ ] **Step 5: Run the policy tests**

Run:

```bash
npm test -- src/lib/resultTiffMetadata.test.js src/lib/tiffMetadata.test.js
```

Expected: PASS.

- [ ] **Step 6: Commit the metadata policy**

```bash
git add src/lib/resultTiffMetadata.js src/lib/resultTiffMetadata.test.js
git commit -m "feat: classify TIFF result metadata"
```

### Task 4: Generalize The Classic-TIFF Writer

**Files:**
- Modify: `src/lib/classicTiffWriter.js`
- Modify: `src/lib/classicTiffWriter.test.js`

**Interfaces:**
- Consumes: the existing `writeClassicGrayTiff(pages)` call.
- Extends each page with:

```js
{
  imageDescription: String | undefined,
  metadataEntries: TiffMetadataEntry[]
}
```

- Maintains: exact existing pixel page properties and return type `Uint8Array`.
- Uses decoded `values` to re-encode multi-byte numeric metadata in little-endian output; uses exact raw bytes only for BYTE, ASCII, SBYTE, and UNDEFINED values.
- Rejects any `metadataEntries` member whose tag is owned by the writer.

- [ ] **Step 1: Write failing metadata round-trip tests**

Add:

```js
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
```

- [ ] **Step 2: Run writer tests to verify they fail**

Run:

```bash
npm test -- src/lib/classicTiffWriter.test.js
```

Expected: FAIL because the writer still has a fixed entry list and fixed-size IFD layout.

- [ ] **Step 3: Replace fixed tag layout with encoded entry models**

Introduce these internal helpers:

```js
function encodeMetadataEntry(entry) {
  // Validate type, count, values, and byte length.
  // Encode numeric values little-endian.
  // Return { tag, type, count, bytes }.
}

function buildPageEntries(page, stripByteCount) {
  // Return generated structural entries, generated ImageDescription,
  // and validated safe metadata entries sorted by numeric tag.
}

function layoutClassicTiff(pageEntries, pixelPages) {
  // Compute every variable IFD size first.
  // Assign aligned external-value offsets.
  // Assign strip offsets after all IFD and metadata bytes.
  // Return the final offsets and total ArrayBuffer size.
}
```

Values up to four bytes remain inline. Larger values go into a two-byte-aligned
extra-data area. IFDs remain chained in output page order. Generate SampleFormat
339 with unsigned value `1` for each sample, even when the source omitted it.

- [ ] **Step 4: Preserve exact pixel and ImageJ behavior**

Keep existing page validation and pixel serialization. Extend tests to assert:

```js
expect(metadata.firstIfd.entries.map((entry) => entry.tag)).toEqual(
  [...metadata.firstIfd.entries.map((entry) => entry.tag)].sort((a, b) => a - b)
);
expect(metadata.firstIfd.entries.find((entry) => entry.tag === 339).values).toEqual([1]);
expect([...decodeTiffStack(output, "result.tif").pages[0].pixels]).toEqual([
  1000, 1001, 1002, 1003
]);
```

Retain the existing RGB, palette, multiple-page, incompatible-page, and
page-specific ImageJ description tests.

- [ ] **Step 5: Run writer, decoder, and display-range tests**

Run:

```bash
npm test -- src/lib/classicTiffWriter.test.js src/lib/tiffStack.test.js src/lib/resultSequence.test.js
```

Expected: PASS.

- [ ] **Step 6: Commit the generalized writer**

```bash
git add src/lib/classicTiffWriter.js src/lib/classicTiffWriter.test.js
git commit -m "feat: write preserved TIFF metadata"
```

### Task 5: Build TIFF, CSV, And Metadata Sidecar Together

**Files:**
- Modify: `src/lib/tiffDisplayRange.js`
- Create: `src/lib/tiffDisplayRange.test.js`
- Modify: `src/lib/resultSequence.js`
- Modify: `src/lib/resultSequence.test.js`

**Interfaces:**
- Produces:

```js
formatImageJResultDescription({
  range,
  pageCount,
  includeSequenceShape
})
```

- Extends `buildResultSequence()` return value with:

```js
{
  pageCount,
  tiffFilename,
  csvFilename: "stack-selections.csv",
  metadataFilename: "source-metadata.json"
}
```

- Extends `buildResultSequence()` input with optional
  `metadataLimits: { maxTagBytes, maxFileMetadataBytes, maxIfdDepth }`, passed
  directly to `readClassicTiffMetadata()` for deterministic limit tests.
- Consumes: `readClassicTiffMetadata()`, `classifyResultPageMetadata()`,
  `serializeSourceMetadataJson()`, and generalized `writeClassicGrayTiff()`.

- [ ] **Step 1: Write failing ImageJ result-description tests**

Create:

```js
import { describe, expect, it } from "vitest";
import { formatImageJResultDescription } from "./tiffDisplayRange.js";

describe("ImageJ result descriptions", () => {
  it("describes the first output page as a time sequence", () => {
    expect(formatImageJResultDescription({
      range: { min: 1000, max: 2000 },
      pageCount: 3,
      includeSequenceShape: true
    })).toBe(
      "ImageJ=1.53e\nimages=3\nchannels=1\nslices=1\nframes=3\nhyperstack=true\nmin=1000\nmax=2000"
    );
  });

  it("keeps later pages limited to their own display range", () => {
    expect(formatImageJResultDescription({
      range: { min: 3000, max: 4000 },
      pageCount: 3,
      includeSequenceShape: false
    })).toBe("ImageJ=1.53e\nmin=3000\nmax=4000");
  });
});
```

- [ ] **Step 2: Run the description tests to verify they fail**

Run:

```bash
npm test -- src/lib/tiffDisplayRange.test.js
```

Expected: FAIL because `formatImageJResultDescription()` does not exist.

- [ ] **Step 3: Implement generated result descriptions**

Add `formatImageJResultDescription()` while preserving
`parseImageJDisplayRange()` and `formatImageJDisplayRange()`. Use the selected
IFD description when present, otherwise use the first IFD description when
deriving a source display range. Never copy source `images`, `slices`, or
`frames` lines into output.

- [ ] **Step 4: Write a failing result integration test**

Add a two-source build test with:

- First source: first-IFD make/model, first-IFD ImageJ description with stale
  `images=12`, selected second-page orientation, nested EXIF date, and private
  tag 65000.
- Second source: a different ImageJ min/max and one selected page.
- Exact 16-bit pixel values that include out-of-display-range samples.

Assert:

```js
const result = await buildResultSequence({ directoryHandle: "root", files, selections, io });
expect(result.metadataFilename).toBe("source-metadata.json");

const outputTiff = writes.find((write) => write.name === result.tiffFilename).data;
const outputMetadata = readClassicTiffMetadata(outputTiff, {
  filename: result.tiffFilename,
  selectedStackNumber: 1
});
const outputDescription = outputMetadata.firstIfd.entries.find((entry) => entry.tag === 270).values;

expect(outputDescription).toContain("images=2");
expect(outputDescription).toContain("slices=1");
expect(outputDescription).toContain("frames=2");
expect(outputDescription).not.toContain("images=12");
expect(outputMetadata.firstIfd.entries.find((entry) => entry.tag === 271).values).toBe("ScopeCo");
expect(outputMetadata.firstIfd.entries.find((entry) => entry.tag === 274).values).toEqual([6]);

const sidecar = JSON.parse(
  writes.find((write) => write.name === "source-metadata.json").text
);
expect(sidecar.pages[0]).toMatchObject({
  outputPage: 1,
  source: {
    filename: "a.tif",
    stackNumber: 2,
    stackCount: 2,
    byteOrder: "II"
  }
});
expect(sidecar.pages[0].firstIfd.entries).toEqual(
  expect.arrayContaining([expect.objectContaining({ tag: 65000 })])
);
expect(sidecar.pages[0].firstIfd.nestedIfds[0].ifd.entries).toEqual(
  expect.arrayContaining([expect.objectContaining({ tag: 36867 })])
);
```

Retain assertions for exact numeric pixels and distinct page min/max.

- [ ] **Step 5: Integrate strict metadata reading and classification**

Refactor each selected file iteration to read the source once:

```js
const sourceBuffer = await readHandleBuffer(fileHandle);
const stack = decodeTiffStack(sourceBuffer, fileHandle.name);
const selectedStack = clamp(saved.selectedStack, 1, stack.stackCount);
const metadata = readClassicTiffMetadata(sourceBuffer, {
  filename: fileHandle.name,
  selectedStackNumber: selectedStack,
  limits: metadataLimits
});
const classified = classifyResultPageMetadata({
  metadata,
  filename: fileHandle.name,
  selectedStack,
  stackCount: stack.stackCount,
  outputPage: selectedPages.length + 1
});
```

Use `classified.embeddedEntries` on the output page. Store
`classified.sourceRecord` for sidecar serialization.

- [ ] **Step 6: Serialize all artifacts before opening output files**

After selected-page validation:

```js
const tiffFilename = normalizeResultTiffFilename(outputName);
const outputTiff = writeClassicGrayTiff(selectedPages);
const outputCsv = serializeStackSelectionsCsv(selectedRows);
const outputMetadata = serializeSourceMetadataJson({
  tiffFilename,
  pageRecords: sourceRecords
});

const resultDirectory = await io.ensureResultDirectory(directoryHandle);
await io.writeBinaryFile(resultDirectory, tiffFilename, outputTiff);
await io.writeTextFile(resultDirectory, "stack-selections.csv", outputCsv);
await io.writeTextFile(resultDirectory, "source-metadata.json", outputMetadata);
```

Add a limit-failure test that passes a low metadata limit through an injectable
`metadataLimits` build option and asserts no I/O method was called.

Add a sidecar-write failure test:

```js
const io = {
  ensureResultDirectory: vi.fn(async () => "result-dir"),
  writeBinaryFile: vi.fn(),
  writeTextFile: vi.fn(async (_dir, name) => {
    if (name === "source-metadata.json") throw new Error("metadata write failed");
  })
};

await expect(
  buildResultSequence({ directoryHandle: "root", files, selections, io })
).rejects.toThrow(/metadata write failed/i);
```

This verifies that the build never returns a success result when the metadata
artifact cannot be written.

- [ ] **Step 7: Run integration and regression tests**

Run:

```bash
npm test -- src/lib/tiffDisplayRange.test.js src/lib/resultSequence.test.js src/lib/resultTiffMetadata.test.js src/lib/classicTiffWriter.test.js
```

Expected: PASS, with three generated artifacts and unchanged pixels/min/max.

- [ ] **Step 8: Commit result integration**

```bash
git add src/lib/tiffDisplayRange.js src/lib/tiffDisplayRange.test.js src/lib/resultSequence.js src/lib/resultSequence.test.js
git commit -m "feat: archive source metadata with result TIFFs"
```

### Task 6: Surface And Document The Metadata Artifact

**Files:**
- Modify: `src/App.jsx`
- Modify: `src/App.test.jsx`
- Modify: `README.md`

**Interfaces:**
- Consumes: `buildResultSequence()` result property `metadataFilename`.
- Produces: success status naming all three output artifacts.
- Documents: TIFF embedded metadata versus complete sidecar provenance.

- [ ] **Step 1: Write a failing UI assertion**

Extend `allows building a result from a partial selection`:

```js
await waitFor(() =>
  expect(
    screen.getByText(
      /Built result\/a-selected\.tif, result\/stack-selections\.csv, and result\/source-metadata\.json with 1 pages/i
    )
  ).toBeInTheDocument()
);

const resultDir = dir.files.get("result");
expect(resultDir.files.get("source-metadata.json").writes[0]).toContain(
  '"schemaVersion": 1'
);
```

- [ ] **Step 2: Run the UI test to verify it fails**

Run:

```bash
npm test -- src/App.test.jsx
```

Expected: FAIL because the status omits `source-metadata.json`.

- [ ] **Step 3: Update the success status**

Use:

```js
`Built result/${result.tiffFilename}, result/${result.csvFilename}, and result/${result.metadataFilename} with ${result.pageCount} pages.`
```

Do not add a new panel, dialog, or control.

- [ ] **Step 4: Document output metadata**

Add `source-metadata.json` to the README output list and state:

```markdown
- `<result-name>.tif` keeps exact selected pixel samples, generated sequence
  structure, page display ranges, and safe standard reconstruction metadata.
- `source-metadata.json` stores first-page, selected-page, nested, private, and
  source-relative metadata with source filename and original stack provenance.
```

Keep the existing run and 16-bit rendering instructions unchanged.

- [ ] **Step 5: Run UI and result tests**

Run:

```bash
npm test -- src/App.test.jsx src/lib/resultSequence.test.js
```

Expected: PASS.

- [ ] **Step 6: Commit the user-facing update**

```bash
git add src/App.jsx src/App.test.jsx README.md
git commit -m "docs: surface TIFF metadata result output"
```

### Task 7: Review And Verify The Complete Feature

**Files:**
- Review: all files changed since `e6fdad2`
- Update only when review finds a concrete defect: the affected production,
  test, README, or `docs/solutions/` file.

**Interfaces:**
- Verifies all contracts produced by Tasks 1 through 6.
- Produces no new application API unless a review finding requires a correction.

- [ ] **Step 1: Review the full feature diff**

Run:

```bash
git diff --stat e6fdad2..HEAD
git diff e6fdad2..HEAD -- src server README.md
```

Check specifically for:

- Any source tag missing from sidecar classifications.
- Big-endian numeric metadata copied as raw bytes instead of re-encoded.
- First-IFD metadata lost when selecting a later page.
- Source structural offsets copied into output.
- Stale source ImageJ stack dimensions retained.
- Metadata parsing leaking into the tolerant display path.
- Metadata errors occurring after output files begin writing.

- [ ] **Step 2: Run the complete test suite**

Run:

```bash
npm test
```

Expected: all tests pass, including metadata field types, nested IFDs, writer
round trips, exact pixels, per-page min/max, sidecar output, and UI status.

- [ ] **Step 3: Run production and repository checks**

Run:

```bash
npm run build
git diff --check
git status --short
```

Expected: build and whitespace checks pass. Status contains only intentional
plan/documentation state or review fixes.

- [ ] **Step 4: Compound the reusable first-IFD lesson**

Because design review exposed the wrong assumption that the selected page IFD
contains all relevant metadata, run:

```text
ce-compound mode:headless "TIFF result preservation must inspect both the first IFD and selected-page IFD because acquisition metadata commonly exists only on the first page"
```

If the compound workflow adds a durable solution document, verify its
frontmatter and links, then commit it separately:

```bash
git add docs/solutions
git commit -m "docs: record TIFF metadata preservation rules"
```

- [ ] **Step 5: Verify final commits and working tree**

Run:

```bash
git log --oneline -8
git status --short --branch
```

Expected: the display-range baseline, reader, policy, writer, integration, UI
documentation, and any generated learning note are separate reviewable commits.
