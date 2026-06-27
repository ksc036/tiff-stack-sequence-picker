# Support ImageJ Palette TIFFs

## Context

ImageJ can export processed microscope TIFF files as palette-color images: `PhotometricInterpretation=3`, `SamplesPerPixel=1`, 8-bit index pixels, and a `ColorMap` tag. These files are not grayscale even though each pixel has one sample.

## Rule

TIFF readers and writers for microscope workflows should treat palette-color as a first-class supported format when uncompressed and 8-bit. Decode the `ColorMap` for preview rendering, preserve it when writing selected result sequences, and include regression tests with palette fixtures.
