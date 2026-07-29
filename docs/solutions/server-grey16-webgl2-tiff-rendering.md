# Server Grey16 + WebGL2 TIFF Rendering

## Context

For 16-bit TIFF display, this project should follow the rendering pipeline from `/Users/ksc/Documents/imageSegmentationUsingPen` while keeping this app's workflow unchanged.

## Rule

When a TIFF is 16-bit grayscale, the local server extracts `grey16` raw pixels and display `min` / `max`. The browser renders those pixels on a WebGL2 canvas and maps brightness in the shader from display `min` / `max`.

If WebGL2 is unavailable, use a 2D canvas fallback that maps the same 16-bit raw pixels to RGBA on the CPU.

Do not regress to forced 8-bit PNG display or client-only TIFF-to-RGBA rendering as the primary path.

## Canvas Lifecycle

Keep each viewer canvas mounted while frames and stacks change. Hide an empty or loading canvas instead of conditionally removing it from the DOM.

Removing and recreating the current-frame canvas for every navigation also creates a new WebGL2 context. Browsers may retain detached contexts until their context limit is reached, then lose an older context. In the side-by-side viewer this can make the fixed previous-selection image turn white after several frame changes.

The app regression test must confirm that the current-frame canvas remains the same DOM object while advancing through multiple TIFF files.
