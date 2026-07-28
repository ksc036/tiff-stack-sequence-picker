import { describe, expect, it } from "vitest";
import { formatImageJResultDescription } from "./tiffDisplayRange.js";

describe("ImageJ result descriptions", () => {
  it("describes the first output page as a time sequence", () => {
    expect(formatImageJResultDescription({
      range: { min: 1000, max: 2000 },
      pageCount: 3,
      includeSequenceShape: true
    })).toBe(
      "ImageJ=1.53e\nimages=3\nchannels=1\nslices=1\nframes=3\nhyperstack=true\nmin=1000\nmax=2000"
    );
  });

  it("keeps later pages limited to their own display range", () => {
    expect(formatImageJResultDescription({
      range: { min: 3000, max: 4000 },
      pageCount: 3,
      includeSequenceShape: false
    })).toBe("ImageJ=1.53e\nmin=3000\nmax=4000");
  });
});
