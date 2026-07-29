---
title: Use code-unit ordering across deterministic TIFF artifacts
date: 2026-07-28
category: logic-errors
module: result-tiff-generation
problem_type: logic_error
component: service_object
symptoms:
  - "Sidecar page order changes when the runtime locale changes"
  - "Sidecar records appear in filename order but carry nonascending output-page numbers"
root_cause: logic_error
resolution_type: code_fix
severity: medium
tags:
  - tiff
  - metadata
  - sidecar
  - deterministic-output
  - filenames
  - output-pages
---

# Use Code-Unit Ordering Across Deterministic TIFF Artifacts

## Problem

The generated TIFF, selection CSV, and source-metadata sidecar promise filename-ascending output. `String.prototype.localeCompare()` applies runtime locale collation, so its result can vary for non-ASCII filenames. Sorting only the final sidecar with a deterministic comparator can also detach record order from the previously assigned TIFF `outputPage`.

## Symptoms

- The same selected filenames can produce a different result-page order under another runtime locale.
- A sidecar sorted by code units can contain records ordered as pages 2, 1 when TIFF pages were assigned using locale collation.

## What Didn't Work

Replacing `localeCompare()` only inside `serializeSourceMetadataJson()` made the JSON array stable but did not change the earlier page-number assignment. The serializer hid the locale-dependent build order instead of correcting it.

## Solution

Use direct code-unit comparison before assigning output-page numbers or building any artifact. Use the same ordering contract when serializing sidecar records, with output-page number as the deterministic tiebreaker for duplicate filenames.

```js
function compareStrings(left, right) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

const rows = [...selections.values()]
  .sort((left, right) => compareStrings(left.filename, right.filename));
```

## Why This Works

Relational string comparison is defined by JavaScript code-unit order and does not consult process locale. Establishing that order before page assignment makes TIFF page position, CSV insertion order, sidecar array order, and each `outputPage` value describe the same sequence.

## Prevention

- Test an ASCII filename against a non-ASCII filename, such as `z-source.tif` and `\u00e4-source.tif`.
- Assert both the decoded TIFF pixel-page order and the sidecar filename-to-`outputPage` mapping.
- Do not use locale-aware sort helpers in serialized or cross-artifact ordering contracts.

## Related Issues

- [Inspect first and selected TIFF IFDs for acquisition metadata](../best-practices/inspect-first-and-selected-tiff-ifds-for-acquisition-metadata.md)
