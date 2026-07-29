---
title: Bound TIFF metadata before value materialization
date: 2026-07-28
category: logic-errors
module: tiff-stack-decoder
problem_type: logic_error
component: service_object
symptoms:
  - "Malformed ImageDescription counts cause excessive allocation or iteration"
root_cause: missing_validation
resolution_type: code_fix
severity: medium
tags:
  - tiff
  - metadata
  - image-description
  - limits
  - parsing
---

# Bound TIFF Metadata Before Value Materialization

## Problem

Classic TIFF tag counts are untrusted input. A decoded `ImageDescription` (tag 270) can declare a value larger than the supported metadata budget, and eagerly materializing that value can cause excessive allocation or iteration before the parser reaches normal image validation.

## Symptoms

- A small TIFF file can declare an `ImageDescription` count much larger than the file itself.
- Validation reports an invalid value offset only after attempting work proportional to the declared count.
- Normal pixel decoding becomes vulnerable to metadata that is not needed for rendering.

## What Didn't Work

Checking only the resolved value offset is too late when the decoder creates or iterates the value array first. Bounds validation and allocation limits protect different resources and must happen in that order.

## Solution

Enforce the 16 MiB per-tag limit immediately after reading the fixed-size TIFF type and count fields, before resolving the value offset or creating/iterating the values array. Include the source filename, tag identity, and limit in the error. Keep unrelated IFD tags on the existing ignored path.

```js
const byteLength = typeSize * count;
if (tag === 270 && byteLength > MAX_IMAGE_DESCRIPTION_BYTES) {
  throw new Error(`${filename} ImageDescription tag 270 exceeds 16 MiB metadata limit`);
}

const valueOffset = byteLength <= 4
  ? entryOffset + 8
  : view.getUint32(entryOffset + 8, littleEndian);
```

## Why This Works

The count and field type are available in the fixed 12-byte IFD entry, so the decoder can reject unsupported work before trusting any source-relative offset or allocating storage. Restricting this path to tag 270 preserves the tolerant decoder's existing behavior for unrelated metadata.

## Prevention

- Test an oversized tag count with an invalid value offset so the regression proves the metadata-limit error occurs before value access.
- Apply byte and count limits before materializing any variable-length binary metadata.
- Keep strict, complete metadata traversal in the result-generation parser instead of expanding the tolerant pixel decoder.

## Related Issues

- [Preserve ImageJ display ranges in rebuilt TIFF pages](preserve-imagej-display-range-in-rebuilt-tiff.md)
- [Preserve TIFF pointer context in nested IFD bounds errors](preserve-tiff-pointer-context-in-bounds-errors.md)
