---
title: Invalidate folder state before changing directory sessions
last_updated: 2026-07-28
category: testing
tags:
  - stale-state
  - async-loading
  - tiff-stack
  - folder-switching
  - busy-ownership
---

# Invalidate folder state before changing directory sessions

## Context

Opening a new directory can overlap with frame-loading effects from the previous directory. If the session generation changes while the old `files` array and selections are still active, an old frame load can run under the new session and clear a shared busy flag before the new folder has finished listing or preloading.

## Guidance

Treat accepting a directory handle as the invalidation boundary. Immediately clear file lists, selections, decoded TIFF state, previous pages, caches, and current indexes before listing or preloading the new folder.

Use independently owned busy flags for overlapping async work. Folder listing/preload should own `folderBusy`; frame decoding should own `frameBusy`; selection persistence can own its own short-lived flag. Derive UI disabled state from those flags instead of letting one effect clear another workflow's loading state.

Match each control to the operation that actually makes it unsafe. `Open Folder` must remain available during frame decoding so a slow or stalled TIFF cannot trap the user in the current directory. It should be disabled only while another folder-picker/listing operation is active. Controls that consume decoded frame state, such as Confirm, should still use the broader combined busy state.

## Why This Matters

Confirm and Build actions are only safe when the visible file list, decoded frame state, selections, and target directory all belong to the same accepted folder. During a slow folder switch, stale rows from the old folder must not remain actionable.

Folder switching is also a recovery action. If `frameBusy` disables `Open Folder`, a TIFF whose read never resolves prevents the user from choosing a healthy directory even though changing directories is safe.

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

<button disabled={folderBusy || !supportsDirectoryPicker()}>
  Open Folder
</button>

<button disabled={!visibleCurrentPage || busy}>
  Confirm
</button>
```

Protect this distinction with a regression test that opens a directory whose first TIFF read remains pending, verifies `Open Folder` stays enabled, then opens a second directory and confirms its first frame loads. Waiting for a deferred read-start signal alone can race React's state commit, so let the next event-loop turn render `frameBusy` before asserting the button state.

## Related

- [`src/App.jsx`](../../src/App.jsx)
- [`src/App.test.jsx`](../../src/App.test.jsx)
- [Scope decoded TIFF state to a directory session](scope-decoded-state-to-directory-session.md)
