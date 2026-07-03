## Review-to-Compound Rule

After any execution/review/fix cycle, if the review exposed a missed requirement, wrong assumption, rollback-worthy overreach, or reusable process mistake, run `ce-compound mode:headless "<short context>"` before claiming final completion or moving to the next task. If `ce-compound` is unavailable, write a durable learning note under `docs/solutions/` or add the rule to the relevant project instructions.

## 16-bit TIFF Rendering Rule

When displaying 16-bit TIFF images, keep the app's selection, CSV, z-stack navigation, and result-building flows intact, but render the image data like `/Users/ksc/Documents/imageSegmentationUsingPen`:

- Send the selected TIFF frame data to the local server for 16-bit grayscale extraction.
- The server returns `grey16` raw pixels with width, height, stack metadata, and display `min` / `max`.
- The browser renders those 16-bit pixels in a WebGL2 canvas using display `min` / `max`.
- Use a 2D canvas CPU mapping only as a fallback when WebGL2 is unavailable.
- Do not replace the display pipeline with forced 8-bit PNG output or client-only TIFF-to-RGBA rendering.

