import { describe, expect, it } from "vitest";
import {
  parseStackSelectionsCsv,
  serializeStackSelectionsCsv,
  setStackSelection
} from "./stackSelections.js";

describe("stack selections CSV", () => {
  it("parses saved selections keyed by filename", () => {
    const csv = "filename,selected_stack,stack_count\nb.tif,2,4\na.tiff,1,1\n";

    expect(parseStackSelectionsCsv(csv)).toEqual(
      new Map([
        ["b.tif", { filename: "b.tif", selectedStack: 2, stackCount: 4 }],
        ["a.tiff", { filename: "a.tiff", selectedStack: 1, stackCount: 1 }]
      ])
    );
  });

  it("quotes filenames with CSV-sensitive characters when serializing", () => {
    const rows = new Map([
      ["alpha, beta.tif", { filename: "alpha, beta.tif", selectedStack: 3, stackCount: 5 }],
      ['quote "scan".tiff', { filename: 'quote "scan".tiff', selectedStack: 1, stackCount: 1 }]
    ]);

    expect(serializeStackSelectionsCsv(rows)).toBe(
      'filename,selected_stack,stack_count\n"alpha, beta.tif",3,5\n"quote ""scan"".tiff",1,1\n'
    );
  });

  it("updates one row without mutating the original map", () => {
    const original = new Map([
      ["a.tif", { filename: "a.tif", selectedStack: 1, stackCount: 3 }]
    ]);

    const updated = setStackSelection(original, "a.tif", 2, 3);

    expect(original.get("a.tif").selectedStack).toBe(1);
    expect(updated.get("a.tif")).toEqual({ filename: "a.tif", selectedStack: 2, stackCount: 3 });
  });

  it("rejects invalid one-based selected stacks", () => {
    expect(() => setStackSelection(new Map(), "a.tif", 0, 3)).toThrow(/selected stack/i);
    expect(() => setStackSelection(new Map(), "a.tif", 4, 3)).toThrow(/selected stack/i);
  });
});
