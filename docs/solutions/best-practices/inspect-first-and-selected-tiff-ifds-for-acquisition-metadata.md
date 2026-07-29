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

A selected TIFF page IFD describes that page, but it is not a complete source-metadata boundary. ImageJ, OME, microscope, and acquisition software commonly place file-level descriptions, equipment identity, or nested metadata pointers only in the first IFD. Reading only the selected page silently loses that context when a later stack page is exported.

## Guidance

Parse the first top-level IFD and the selected page IFD through the strict result-generation metadata path. Preserve their identities instead of flattening them prematurely.

- Embed every supported selected-IFD tag that passes its tag-specific schema.
- Fall back to the first IFD only for the explicit file-level descriptive allowlist: document name, make, model, software, artist, host computer, copyright, and XMP.
- Never fall back to first-IFD orientation, resolution, resolution unit, position, page name, capture time, ICC profile, or ImageJ display range. Their absence in the selected IFD is meaningful.
- Derive an ImageJ display range only from the selected IFD's supported description. A missing or invalid selected-page range uses the pixel-extrema display fallback.
- Archive both IFDs and their reachable known nested metadata IFDs in the provenance sidecar.
- Regenerate structural offsets, links, strip layout, and result sequence dimensions instead of copying them from either source IFD.

```js
const metadata = readClassicTiffMetadata(sourceBuffer, {
  filename,
  selectedStackNumber
});

const sourceDescription = getImageDescription(metadata.selectedIfd);
```

## Why This Matters

The first and selected IFDs have different ownership roles: the first often carries file-level acquisition context, while the selected IFD carries page-specific interpretation. Treating the selected IFD as the complete provenance boundary loses acquisition identity. Treating the first IFD as a default source for page metadata can silently apply page 1's orientation, calibration, capture time, or display range to a different page.

## When To Apply

- A user can select any page from a multi-page classic TIFF.
- Result generation promises reconstruction metadata or source provenance.
- Source software is known to store dataset descriptions or acquisition data on page one.
- The selected page can differ from the first page.

## Examples

Suppose the first IFD contains microscope make/model, Orientation 6, an ImageJ description, and an EXIF pointer, while the selected third-page IFD omits orientation and description. The rebuilt page should embed the make/model, omit orientation and display-range values, generate fresh result-level ImageJ dimensions and structural offsets, and retain both original IFDs plus nested EXIF data in the sidecar.

## Related

- [Preserve ImageJ display ranges in rebuilt TIFF pages](../logic-errors/preserve-imagej-display-range-in-rebuilt-tiff.md)
- [Preserve TIFF pointer context in nested IFD bounds errors](../logic-errors/preserve-tiff-pointer-context-in-bounds-errors.md)
- [Bound TIFF metadata before value materialization](../logic-errors/bound-tiff-metadata-before-materialization.md)
