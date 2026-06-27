# Lazy-Load Browser TIFF ArrayBuffers

## Context

Browser `File.arrayBuffer()` loads an entire file into memory. Preloading every TIFF in a folder can fail with `Array buffer allocation failed`, especially when each file contains large z-stacks or decoded pixel buffers are cached.

## Rule

For browser-local TIFF workflows, load and decode only the current frame and the fixed previous reference frame. Do not decode a full folder just to validate metadata. Reconcile restored CSV selections lazily as each file is decoded, and clamp stale stack selections again during result generation.
