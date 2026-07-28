---
title: Preserve TIFF pointer context in nested IFD bounds errors
date: 2026-07-28
category: logic-errors
module: tiff-metadata-reader
problem_type: logic_error
component: service_object
symptoms:
  - "Malformed nested metadata IFDs report only a generic IFD bounds error"
  - "Result generation cannot identify which metadata pointer referenced invalid data"
root_cause: missing_validation
resolution_type: code_fix
severity: medium
tags:
  - tiff
  - metadata
  - ifd
  - bounds
  - error-context
  - exif
---

# Preserve TIFF Pointer Context in Nested IFD Bounds Errors

## Problem

Known TIFF metadata pointer tags such as EXIF (`34665`) lead to recursive IFD parsing. A bounds failure while reading the referenced IFD previously omitted the pointer tag, leaving strict metadata preservation with an error that named only a generic IFD.

## Solution

Pass the originating pointer tag into IFD bounds validation and include it in both truncated and out-of-range error messages. Keep top-level IFD errors generic because no tag originated those links.

```js
const ifdContext = Number.isInteger(pointerTag) ? `tag ${pointerTag} IFD` : "IFD";
assertRange(view, offset, 2, `${filename}: stack ${stackNumber} ${ifdContext} points outside the TIFF file`);
```

## Prevention

- Test a known metadata pointer whose child offset is beyond the source buffer.
- Require nested-pointer errors to contain the filename, stack number, and originating tag.
- Keep raw-byte fidelity tests separate from malformed-input safety tests so both contracts remain explicit.
