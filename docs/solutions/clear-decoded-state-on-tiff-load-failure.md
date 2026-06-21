---
title: Clear decoded UI state when TIFF load fails
category: testing
tags:
  - stale-state
  - failed-decode
  - tiff-stack
---

# Clear decoded UI state when TIFF load fails

## Context

A failed TIFF decode can happen after a previous frame decoded successfully. If the UI only reports the new error but leaves the prior decoded stack in state, controls derived from that old stack can remain enabled for the failed filename.

## Guidance

Treat decode failure as invalidating the current decoded frame. In the error path, clear the decoded stack/page state and reset stack navigation state so actions such as Confirm are disabled from the same source of truth as the preview.

Add a UI regression test that moves from a valid TIFF to a malformed TIFF, waits for the surfaced decode error, and proves the malformed file cannot create a saved selection or unlock result generation.

## Why This Matters

Selections must represent successfully decoded source files. Failed-decode and missing files can remain visible for user attention, but they should not count toward completion, restored selections, or Build Result availability.

## Example

```js
try {
  const stack = await loadStack(currentFile);
  setCurrentTiff(stack);
} catch (error) {
  setCurrentTiff(null);
  setCurrentStack(1);
  setStatus(statusText("error", error.message));
}
```
