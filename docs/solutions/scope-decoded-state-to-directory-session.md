---
title: Scope decoded browser file state to the directory session
category: testing
tags:
  - stale-state
  - file-identity
  - tiff-stack
---

# Scope decoded browser file state to the directory session

## Context

Browser file handles from different directories can share the same `name`. If decoded TIFF state or caches are keyed only by filename, reopening a new folder can pair the new visible row with old decoded pages or stack metadata.

## Guidance

Treat filename as display data, not identity. When a directory is accepted, immediately clear decoded UI state and advance a directory/session generation. Cache decoded stacks by the current session plus the actual `FileSystemFileHandle` identity, and only derive actionable decoded state when the active file handle and session both match.

Action handlers should repeat the same identity guard used by the UI. A disabled button is helpful feedback, but the handler must also reject stale decoded state.

## Why This Matters

TIFF workflows often reuse filenames across experiment folders. Session-scoped identity prevents Confirm from writing stale stack counts or pages into a newly selected folder while async decoding catches up.

## Example

```js
const decodedCurrentTiff =
  currentTiff?.directorySessionId === directorySessionId &&
  currentTiff?.fileHandle === currentFile
    ? currentTiff
    : null;
```
