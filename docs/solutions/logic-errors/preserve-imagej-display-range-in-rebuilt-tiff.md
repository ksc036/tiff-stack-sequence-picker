---
title: Preserve ImageJ display ranges in rebuilt TIFF pages
date: 2026-07-28
category: logic-errors
module: result-tiff-generation
problem_type: logic_error
component: service_object
symptoms:
  - "Result TIFF contrast differs from the selected source page"
  - "Pixel arrays match, but rendering uses pixel extrema instead of source ImageJ min/max"
root_cause: logic_error
resolution_type: code_fix
severity: medium
tags:
  - tiff
  - imagej
  - display-range
  - min-max
  - image-description
  - 16-bit
related_components:
  - frontend_stimulus
  - testing_framework
---

# Preserve ImageJ Display Ranges in Rebuilt TIFF Pages

## Problem

The result builder copied each selected z-stack page's pixel values into a new TIFF, but it omitted TIFF tag 270 (`ImageDescription`). When that description contained ImageJ display `min` and `max`, the source and result rendered with different contrast despite identical 16-bit data.

## Symptoms

- Source and result pixel arrays were identical.
- A source range of `1000-1010` became `1000-2000` in the result because `2000` was the page's largest pixel.
- Result frames appeared brighter, darker, or lower contrast than their selected source pages.

## What Didn't Work

Testing only decoded pixel equality proved data integrity but not display fidelity. Rebuilding a TIFF from dimensions, photometric tags, and pixel strips alone leaves the renderer without the source's intended intensity mapping.

## Solution

Treat the ImageJ display range as page-specific result metadata:

1. Decode tag 270 only when it is an ASCII `ImageDescription`; continue ignoring unrelated TIFF tags.
2. Parse and validate source ImageJ `min` and `max` in a shared helper.
3. Give each selected output page a clean ImageJ description containing its source range.
4. Write that description into each output IFD. When the source has no valid range, write no range values so the existing pixel-extrema fallback remains active.

```js
const selectedPage = stack.pages[selectedStack - 1];
selectedPages.push({
  ...selectedPage,
  imageDescription: formatImageJDisplayRange(
    parseImageJDisplayRange(selectedPage.imageDescription)
  )
});
```

## Why This Works

The generated TIFF now preserves both inputs to the visible result: the original numeric pixels and the original page-specific intensity range. The server and compatible ImageJ readers therefore map the result page with the same `min` and `max` used for its source.

## Prevention

- Test raw pixel equality and display-range equality as separate contracts.
- Cover multiple source files with distinct ImageJ ranges in one generated result.
- Keep TIFF metadata parsing selective, but distinguish unknown metadata from metadata required by a promised workflow.
- Preserve per-page display metadata rather than applying one range to the entire result sequence.

## Related Issues

- [Server grey16 and WebGL2 TIFF rendering](../server-grey16-webgl2-tiff-rendering.md)
- [Ignore nonessential TIFF IFD tags](../ignore-nonessential-tiff-ifd-tags.md)
- [Support ImageJ palette TIFFs](../support-imagej-palette-tiffs.md)
