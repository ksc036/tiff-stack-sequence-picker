---
title: Derive TIFF ASCII counts from emitted bytes
date: 2026-07-28
category: logic-errors
module: classic-tiff-writer
problem_type: logic_error
component: service_object
symptoms:
  - "Astral ImageDescription text produces fewer bytes than its declared TIFF count"
  - "Non-ASCII ImageDescription text is silently truncated into unsupported byte values"
root_cause: missing_validation
resolution_type: code_fix
severity: medium
tags:
  - tiff
  - image-description
  - ascii
  - encoding
  - byte-length
---

# Derive TIFF ASCII Counts From Emitted Bytes

## Problem

A classic-TIFF writer derived tag 270's ASCII count from JavaScript string length while constructing bytes through string iteration. Astral characters have two UTF-16 code units but one string iterator element, so the IFD could advertise more bytes than the writer emitted and cause readers to consume padding or subsequent data.

## Symptoms

- An ImageDescription containing an astral character produced a declared count larger than its byte array.
- BMP non-ASCII characters were truncated into one byte without an explicit encoding policy.
- ASCII-only descriptions appeared correct, so ordinary ImageJ fixtures did not expose the mismatch.

## What Didn't Work

Using `normalized.length` for the TIFF count and `Uint8Array.from(normalized, ...)` for bytes looked equivalent for ASCII input. The two operations use different Unicode units, however: string length counts UTF-16 code units, while string iteration advances by Unicode code point.

## Solution

Generated ImageJ descriptions support ASCII only. Validate every normalized description code unit before writing, reject values above `0x7f`, build the final byte array explicitly, and derive the IFD count from that array.

```js
const bytes = new Uint8Array(normalized.length);
for (let index = 0; index < normalized.length; index += 1) {
  const codeUnit = normalized.charCodeAt(index);
  if (codeUnit > 0x7f) {
    throw new Error("TIFF ImageDescription supports ASCII characters only");
  }
  bytes[index] = codeUnit;
}

return { tag, type: 2, count: bytes.byteLength, bytes };
```

## Why This Works

The explicit character-set check prevents silent replacement or truncation. Deriving count from the emitted bytes makes the binary length field and the layout model share one authoritative representation, so readers cannot overrun the description into adjacent data.

## Prevention

- For binary formats, derive declared lengths from the final serialized byte buffer rather than source string length.
- Validate the supported character set before encoding when the format or application contract is narrower than Unicode.
- Test one valid ASCII round trip, one BMP non-ASCII rejection, and one astral rejection.
- Assert the parsed field count and raw bytes, not only the decoded string.

## Related Issues

- [Preserve ImageJ display ranges in rebuilt TIFF pages](preserve-imagej-display-range-in-rebuilt-tiff.md)
