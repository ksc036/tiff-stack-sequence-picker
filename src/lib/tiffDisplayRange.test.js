import { describe, expect, it } from "vitest";
import {
  formatImageJResultDescription,
  parseImageJDisplayRange
} from "./tiffDisplayRange.js";

describe("ImageJ result descriptions", () => {
  it("parses numeric range lines with horizontal whitespace", () => {
    expect(parseImageJDisplayRange(
      "ImageJ=1.53e\n\tmin \t= \t-1.5e2 \t\n max=2.5E+2\t"
    )).toEqual({ min: -150, max: 250 });
  });

  it.each([
    "ImageJ=1.53e\nmin=1oops\nmax=2",
    "ImageJ=1.53e\nmin=1\nmax=2oops"
  ])("rejects numeric prefixes in range lines: %s", (description) => {
    expect(parseImageJDisplayRange(description)).toBeNull();
  });

  it.each([
    "ImageJ=1.53e\nmin=1",
    "ImageJ=1.53e\nmax=2",
    "ImageJ=1.53e\nmin=2\nmax=1",
    "ImageJ=1.53e\nmin=invalid\nmax=2"
  ])("falls back when the range is missing or invalid: %s", (description) => {
    expect(parseImageJDisplayRange(description)).toBeNull();
  });

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
