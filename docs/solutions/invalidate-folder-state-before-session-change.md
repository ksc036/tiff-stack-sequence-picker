---
title: Invalidate folder state before changing directory sessions
category: testing
tags:
  - stale-state
  - async-loading
  - tiff-stack
---

# Invalidate folder state before changing directory sessions

## Context

Opening a new directory can overlap with frame-loading effects from the previous directory. If the session generation changes while the old `files` array and selections are still active, an old frame load can run under the new session and clear a shared busy flag before the new folder has finished listing or preloading.

## Guidance

Treat accepting a directory handle as the invalidation boundary. Immediately clear file lists, selections, decoded TIFF state, previous pages, caches, and current indexes before listing or preloading the new folder.

Use independently owned busy flags for overlapping async work. Folder listing/preload should own `folderBusy`; frame decoding should own `frameBusy`; selection persistence can own its own short-lived flag. Derive UI disabled state from those flags instead of letting one effect clear another workflow's loading state.

## Why This Matters

Confirm and Build actions are only safe when the visible file list, decoded frame state, selections, and target directory all belong to the same accepted folder. During a slow folder switch, stale rows from the old folder must not remain actionable.

## Example

```js
setFolderBusy(true);
const handle = await chooseTiffDirectory();

setDirectoryHandle(null);
setFiles([]);
setSelections(new Map());
setCurrentTiff(null);
setPreviousPage(null);
setCurrentIndex(0);
setCurrentStack(1);
setDirectorySessionId(nextSessionId);

const busy = folderBusy || frameBusy || selectionBusy;
```
