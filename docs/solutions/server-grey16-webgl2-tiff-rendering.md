# Server Grey16 + WebGL2 TIFF Rendering

## Context

For 16-bit TIFF display, this project should follow the rendering pipeline from `/Users/ksc/Documents/imageSegmentationUsingPen` while keeping this app's workflow unchanged.

## Rule

When a TIFF is 16-bit grayscale, the local server extracts `grey16` raw pixels and display `min` / `max`. The browser renders those pixels on a WebGL2 canvas and maps brightness in the shader from display `min` / `max`.

If WebGL2 is unavailable, use a 2D canvas fallback that maps the same 16-bit raw pixels to RGBA on the CPU.

Do not regress to forced 8-bit PNG display or client-only TIFF-to-RGBA rendering as the primary path.

