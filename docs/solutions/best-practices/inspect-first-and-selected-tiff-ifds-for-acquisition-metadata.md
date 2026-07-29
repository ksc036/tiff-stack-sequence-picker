---
title: Inspect first and selected TIFF IFDs for acquisition metadata
date: 2026-07-29
category: best-practices
module: tiff-result-metadata
problem_type: best_practice
component: service_object
severity: high
applies_when:
  - "Rebuilding or exporting a selected page from a multi-page TIFF"
  - "Preserving ImageJ, OME, EXIF, or acquisition-system metadata"
tags:
  - tiff
  - metadata
  - ifd
  - acquisition
  - imagej
  - provenance
  - result-generation
---

# Inspect First And Selected TIFF IFDs For Acquisition Metadata

## Context

A selected TIFF page IFD describes that page, but it is not a complete source-metadata boundary. ImageJ, OME, microscope, and acquisition software commonly place file-level descriptions, make/model, calibration, or nested metadata pointers only in the first IFD. Reading only the selected page silently loses that context when a later stack page is exported.

## Guidance

Parse the first top-level IFD and the selected page IFD through the strict result-generation metadata path. Preserve their identities instead of flattening them prematurely.

- For embeddable root tags, prefer the selected IFD value when both IFDs contain the same tag.
- Use a first-IFD value only when the selected IFD omits that safe tag.
- For ImageJ display range discovery, inspect the selected description first and then fall back to the first-IFD description.
- Archive both IFDs and their reachable known nested metadata IFDs in the provenance sidecar.
- Regenerate structural offsets, links, strip layout, and result sequence dimensions instead of copying them from either source IFD.

```js
const metadata = readClassicTiffMetadata(sourceBuffer, {
  filename,
  selectedStackNumber
});

const sourceDescription =
  getImageDescription(metadata.selectedIfd)
  ?? getImageDescription(metadata.firstIfd);
```

## Why This Matters

The first and selected IFDs have different ownership roles: the first often carries file-level acquisition context, while the selected IFD carries page-specific interpretation. Treating the selected IFD as complete can produce a TIFF whose pixels are exact but whose calibration, provenance, display range, or acquisition identity is incomplete. Treating the first IFD as authoritative for every tag can overwrite valid page-specific values.

## When To Apply

- A user can select any page from a multi-page classic TIFF.
- Result generation promises reconstruction metadata or source provenance.
- Source software is known to store dataset descriptions or acquisition data on page one.
- The selected page can differ from the first page.

## Examples

Suppose the first IFD contains microscope make/model, a file-level ImageJ description, and an EXIF pointer, while the selected third-page IFD contains orientation. The rebuilt page should embed the safe make/model and selected orientation, generate fresh result-level ImageJ dimensions and structural offsets, and retain both original IFDs plus nested EXIF data in the sidecar.

## Related

- [Preserve ImageJ display ranges in rebuilt TIFF pages](../logic-errors/preserve-imagej-display-range-in-rebuilt-tiff.md)
- [Preserve TIFF pointer context in nested IFD bounds errors](../logic-errors/preserve-tiff-pointer-context-in-bounds-errors.md)
- [Bound TIFF metadata before value materialization](../logic-errors/bound-tiff-metadata-before-materialization.md)
