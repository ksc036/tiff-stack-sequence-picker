---
title: Restore persisted selections after decoding current file metadata
category: testing
tags:
  - persisted-state
  - tiff-stack
  - restore-flow
---

# Restore persisted selections after decoding current file metadata

## Context

Persisted `stack-selections.csv` rows include the stack count from the file set that created them. When a folder is reopened with changed TIFF contents, those saved counts can be stale.

## Guidance

Treat persisted CSV rows as user intent, not as current truth. Decode the currently loaded TIFF files first, then restore only rows that match successfully decoded files. Clamp each restored `selectedStack` into `1..actualStackCount` and rewrite the in-memory row with the actual stack count.

## Why This Matters

Installing saved rows before validating them against current files can mark a frame complete with an impossible stack index. Build flows should operate only on selections that are valid for the current decoded TIFF stack.

## Example

```js
const restored = restoreStackSelectionsForLoadedTiffs(savedRows, loadedTiffs);
```

The helper should drop missing or failed-decode files and return rows shaped for the current folder:

```js
{
  filename: "frame-001.tif",
  selectedStack: 3,
  stackCount: 3
}
```
