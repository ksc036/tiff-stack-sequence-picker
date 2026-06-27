# Ignore Nonessential TIFF IFD Tags

## Context

Real microscope TIFF files can include metadata tags such as `ImageDescription` with ASCII field type `2`, or other non-pixel metadata types. A stack decoder that eagerly parses every IFD entry can fail before it reaches the image data.

## Rule

When decoding a constrained TIFF subset, parse only the IFD tags required for that subset and skip unrelated metadata tags. Add regression fixtures with common metadata tags so compatibility is protected without broadening the supported pixel format by accident.
