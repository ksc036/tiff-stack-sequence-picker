# TIFF Result Metadata Preservation Design

## Summary

The result builder currently creates a valid multi-page TIFF from the selected
source pages, but it only retains the pixel layout and a small amount of display
metadata. The result must preserve enough source metadata to reproduce each
selected image as faithfully as possible without copying offsets or private
values that could make the rebuilt TIFF invalid.

The builder will produce three artifacts:

```text
result/<editable-result-name>.tif
result/stack-selections.csv
result/source-metadata.json
```

The TIFF remains the directly viewable time sequence. The JSON sidecar is the
lossless provenance record for source metadata that cannot safely be embedded
in the rebuilt TIFF.

## Goals

- Preserve every selected page's numeric pixel samples without rescaling,
  clipping, or conversion to 8-bit.
- Preserve metadata that affects image interpretation and reconstruction when
  it is compatible with the generated TIFF.
- Preserve ImageJ display minimum and maximum values per selected page.
- Record the source file's first IFD, the selected page IFD, and reachable known
  metadata IFDs, excluding pixel payload bytes, in a deterministic JSON
  sidecar.
- Record the source filename, original stack number, stack count, byte order,
  and output page number for every result page.
- Generate result-level stack metadata from the actual output page order and
  count instead of copying stale source stack dimensions.
- Fail result generation with a precise error when required metadata cannot be
  read or written. Metadata loss must not be silent.

## Non-Goals

- Byte-for-byte reproduction of the source TIFF files.
- Retaining source compression, strip boundaries, tile layout, or byte order.
- Adding support for BigTIFF, compressed source pages, signed or floating-point
  pixel samples, planar RGB, or pixel formats that the application cannot
  currently display.
- Blindly embedding unknown vendor tags in the output TIFF.
- Copying source z-stack declarations into a result whose pages represent time.

The output remains an uncompressed classic TIFF containing the application's
currently supported 8-bit or 16-bit unsigned grayscale, RGB, or palette pages.

## Preservation Model

Metadata is divided into four categories.

### 1. Exact Pixel Semantics

The selected page supplies these values:

- Pixel sample values
- Width and height
- Bits per sample
- Samples per pixel
- Photometric interpretation
- Sample format
- Color map for palette images
- Extra sample meaning when the supported pixel layout uses it

The writer may change the byte order and storage layout, but decoding the result
must produce the same numeric sample array and interpretation.

### 2. Safe Embedded Metadata

The writer will preserve supported standard fields whose values remain valid
after rebuilding:

- Orientation
- X and Y resolution
- Resolution unit
- X and Y position
- Document name and page name
- Camera or microscope make and model
- Software
- Capture date and time
- Artist, host computer, and copyright
- ICC profile
- XMP packet
- ImageJ display minimum and maximum

Fields are written to the corresponding output page unless the field defines
the result as a whole. Unsupported field types or malformed values produce a
build error with the source filename, stack number, and tag number.

### 3. Regenerated Structural Metadata

Values tied to the physical layout of the old file must never be copied. The
writer regenerates:

- IFD offsets and next-IFD links
- Strip offsets and byte counts
- Rows per strip
- Bits-per-sample value offsets
- Color-map value offsets
- Image-description value offsets
- Compression and planar layout declarations for the generated encoding
- Result page count and time-sequence declaration

Tile offsets, tile byte counts, SubIFD pointers, Exif/GPS IFD pointers,
thumbnail pointers, and other source-file addresses are excluded from the
output TIFF. Their original tag records remain available in the JSON sidecar.

### 4. Sidecar-Only Source Metadata

Every entry from the source file's first IFD and selected page IFD is archived
in `source-metadata.json`, including unknown and private tags. Reading the first
IFD separately matters because ImageJ, OME, and acquisition software commonly
store file-level metadata there even when another page is selected.

Each record contains its tag number, TIFF field type, count, raw value bytes
encoded as base64, and a readable decoded value when the type has a standard
representation.

Strip and tile pixel payloads are not duplicated in JSON. Structural tags such
as strip offsets and counts are recorded as tag values, but the regions they
point to are not copied.

Known metadata directories referenced by SubIFD, EXIF, GPS, and interoperability
IFD pointers are followed recursively and archived under their parent entry.
Traversal uses offset-cycle detection and a maximum nesting depth of eight.
The original pointer values are retained and marked as source-relative, but
these nested directories are not re-embedded in the output TIFF. Unknown
private values that resemble offsets are preserved as raw values without being
dereferenced.

To avoid another unbounded allocation failure, metadata extraction has explicit
limits of 16 MiB for one tag value and 64 MiB of captured metadata per source
file. Exceeding either limit aborts the build with an actionable error instead
of dropping data or attempting an unsafe allocation.

## ImageJ Description Rules

The complete original `ImageDescription` is stored in the sidecar. It is not
copied verbatim into the result because source fields such as `images`,
`slices`, and `frames` describe the old z-stack.

The first result IFD receives a generated ImageJ description declaring:

- `images=<result page count>`
- `channels=1`
- `slices=1`
- `frames=<result page count>`
- The first page's display minimum and maximum when available

Every result page receives its own minimal ImageJ-compatible description with
that source page's display minimum and maximum. This preserves the application's
page-specific WebGL2 rendering contract while keeping the first IFD's dataset
shape accurate for sequence readers.

When a source page has no valid display range, the result page omits range
values and the existing pixel-extrema fallback remains in effect.

## Architecture

### Generic IFD Metadata Reader

A new metadata reader parses classic TIFF field types 1 through 13 independently
from the constrained pixel decoder. It exposes raw value bytes and decoded
values without forcing the viewer to understand every tag.

Keeping this separate is important: an unusual metadata tag must not prevent
the application from displaying a TIFF. Strict metadata validation applies
when building a result, where the user has requested preservation.

### Selected Page Model

The pixel decoder continues returning the supported page data. During result
generation, the metadata reader attaches a normalized metadata object to each
selected page:

```js
{
  source: {
    filename,
    stackNumber,
    stackCount,
    byteOrder
  },
  pixelPage,
  firstIfdMetadata,
  selectedIfdMetadata,
  embeddedMetadata,
  imageJDisplayRange
}
```

This object is an internal build contract. Rendering continues to use the
existing grey16 raw-pixel endpoint and WebGL2 display min/max path.

### TIFF Writer

The classic TIFF writer will accept per-page metadata entries instead of a
fixed list of ten tags. A tag encoder will:

1. Validate field type, count, and byte length.
2. Sort tags numerically within each IFD.
3. Store values of four bytes or fewer inline.
4. Allocate larger values in the extra-data area with word alignment.
5. Generate all structural offsets after layout sizes are known.

The writer owns structural tags and rejects attempts to override them through
copied metadata.

### Sidecar Serializer

The sidecar serializer produces stable, pretty-printed JSON in output-page
order. Its top-level shape is:

```json
{
  "schemaVersion": 1,
  "output": {
    "tiffFilename": "example.tif",
    "pageCount": 2,
    "ordering": "filename-ascending"
  },
  "pages": [
    {
      "outputPage": 1,
      "source": {
        "filename": "source-a.tif",
        "stackNumber": 5,
        "stackCount": 12,
        "byteOrder": "II"
      },
      "firstIfd": {
        "entries": [],
        "nestedIfds": []
      },
      "selectedIfd": {
        "entries": [],
        "nestedIfds": []
      },
      "tagClassifications": [
        {
          "sourceIfd": "selected",
          "tag": 274,
          "destination": "embedded"
        }
      ]
    }
  ]
}
```

Raw metadata bytes are authoritative. Decoded values are included for
inspection and may be omitted only when a field type has no safe textual or
numeric representation. Each tag classification identifies whether its source
was the first IFD, selected IFD, or a nested IFD and whether it was embedded,
regenerated, or retained only in the sidecar.

## Build Flow

For each CSV selection in filename order:

1. Read the source TIFF.
2. Decode the selected page's pixels with the existing constrained decoder.
3. Parse the source file's first IFD, selected page IFD, and reachable known
   nested metadata IFDs.
4. Merge embeddable metadata, preferring the selected IFD for page-specific
   values and using the first IFD for file-level descriptive values that are
   absent from the selected IFD.
5. Classify each tag as embedded, regenerated, or sidecar-only.
6. Normalize the ImageJ display range and result-level description.
7. Add the page and provenance record to in-memory output models.

After every selected page succeeds, the builder serializes the TIFF, CSV, and
JSON completely before opening output files. It then writes:

1. `<editable-result-name>.tif`
2. `stack-selections.csv`
3. `source-metadata.json`

The build response adds `metadataFilename: "source-metadata.json"`.

## Error Handling

- Viewing remains tolerant of unknown metadata and continues parsing only tags
  needed to render supported pixels.
- Result building is strict because metadata preservation is part of its
  contract.
- Errors identify the filename, source stack number, tag number when relevant,
  and the failed operation.
- Invalid source offsets, field counts, truncated values, unsupported metadata
  sizes, and writer conflicts abort before output serialization.
- Output write failures are reported and never presented as a successful build.
- No metadata field is silently removed. Every source tag is represented in the
  sidecar and classified.

## Compatibility

Existing folder selection, filename ordering, editable result naming, CSV
editing, skipped-frame selection, synchronized zoom, and stack navigation stay
unchanged. Existing CSV files remain valid.

The current 16-bit rendering rule also stays unchanged: the server reads TIFF
pixels as `grey16` raw data, and the browser maps those values through display
min/max in WebGL2 with the existing 2D fallback.

## Testing

### Metadata Reader Tests

- Decode classic TIFF field types BYTE, ASCII, SHORT, LONG, RATIONAL, SBYTE,
  UNDEFINED, SSHORT, SLONG, SRATIONAL, FLOAT, DOUBLE, and IFD.
- Cover little-endian and big-endian metadata.
- Capture the first IFD and a different selected-page IFD without conflating
  their entries.
- Follow known nested metadata IFDs with cycle and depth protection.
- Reject truncated values and lengths that exceed allocation limits.
- Prove that unknown tags do not affect normal image viewing.

### Writer Tests

- Round-trip orientation, rational resolution, resolution unit, date/time,
  make/model, ICC, XMP, and page-specific ImageJ ranges.
- Verify tags are numerically sorted and offset values point inside the output.
- Verify structural source offsets cannot override generated values.
- Verify numeric pixels are unchanged for 8-bit and 16-bit pages.

### Result Integration Tests

- Build from multiple TIFF files with different selected z-stacks and metadata.
- Verify result pages remain in filename order.
- Verify exact pixel arrays and page-specific display ranges.
- Verify the first IFD reports the actual result page count and time layout.
- Verify stale source ImageJ stack dimensions do not appear in the result TIFF.
- Verify `source-metadata.json` contains first-IFD and selected-IFD descriptions,
  nested metadata, private tags, raw base64 values, provenance, and tag
  classifications.
- Verify a malformed or oversized metadata value fails the build without a
  success response.

### Regression Checks

- Run the complete unit test suite.
- Run the production Vite build.
- Open the local app and build a result from representative 16-bit microscopy
  TIFFs.
- Compare source and result pixel arrays, min/max display values, orientation,
  resolution, and equipment fields.

## Acceptance Criteria

- Every generated TIFF page decodes to exactly the selected source page's
  numeric samples.
- Result display min/max matches each selected source page when provided.
- Safe reconstruction metadata is present and correct in the generated TIFF.
- Result structural metadata describes the generated sequence, not a source
  z-stack.
- Every tag from the source first IFD, selected page IFD, and reachable known
  nested metadata IFDs is present and classified in `source-metadata.json`.
- Any metadata that cannot be preserved causes a clear build failure.
- Existing TIFF viewing and selection workflows continue to pass their tests.
