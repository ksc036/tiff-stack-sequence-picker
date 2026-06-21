---
title: Guard derived decoded state by file identity
category: testing
tags:
  - stale-state
  - async-decode
  - tiff-stack
---

# Guard derived decoded state by file identity

## Context

Async frame loads can leave the previous decoded TIFF in component state after navigation has already moved `currentFile` to a different filename. During that transition, derived values such as `currentPage` can accidentally pair the new filename with the old decoded pages.

## Guidance

Derive usable decoded state through an identity check, not only presence. Before enabling frame actions or reading a page, verify that the decoded stack belongs to the active file.

Action handlers should repeat the identity guard because UI disabled state is not a security boundary for stale async state.

## Why This Matters

Selections are keyed by filename. If a stale decoded page is accepted for a newly selected file, the app can save a row for a timepoint that has not decoded yet, making the result sequence silently use the wrong stack metadata.

## Example

```js
const decodedCurrentTiff = currentTiff?.filename === currentFile?.name ? currentTiff : null;
const currentPage = decodedCurrentTiff?.pages[currentStack - 1] ?? null;

async function confirmCurrentSelection() {
  if (!currentFile || currentTiff?.filename !== currentFile.name || !currentPage) return;
}
```
