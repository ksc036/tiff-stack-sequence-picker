import { describe, expect, it, vi } from "vitest";
import { mapRaw16ToRgba, renderRaw16ToCanvas } from "./raw16Renderer.js";

describe("raw16 canvas renderer", () => {
  it("maps 16-bit pixels to RGBA using display min and max with clamping", () => {
    const rgba = mapRaw16ToRgba(new Uint16Array([1000, 1005, 1010, 2000]), 1000, 1010);

    expect([...rgba]).toEqual([
      0, 0, 0, 255,
      128, 128, 128, 255,
      255, 255, 255, 255,
      255, 255, 255, 255
    ]);
  });

  it("uses the 2D fallback when WebGL2 is unavailable", () => {
    const imageData = { data: new Uint8ClampedArray(16) };
    const context2d = {
      createImageData: vi.fn(() => imageData),
      putImageData: vi.fn()
    };
    const canvas = {
      width: 0,
      height: 0,
      getContext: vi.fn((type) => (type === "2d" ? context2d : null))
    };

    const mode = renderRaw16ToCanvas(canvas, {
      pixels: new Uint16Array([1000, 1005, 1010, 2000]),
      width: 2,
      height: 2,
      min: 1000,
      max: 1010
    });

    expect(mode).toBe("2d");
    expect(canvas.width).toBe(2);
    expect(canvas.height).toBe(2);
    expect(context2d.createImageData).toHaveBeenCalledWith(2, 2);
    expect(context2d.putImageData).toHaveBeenCalledWith(imageData, 0, 0);
    expect([...imageData.data]).toEqual([
      0, 0, 0, 255,
      128, 128, 128, 255,
      255, 255, 255, 255,
      255, 255, 255, 255
    ]);
  });
});

