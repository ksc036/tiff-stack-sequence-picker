import { describe, expect, it, vi } from "vitest";
import { buildResultSequence } from "./resultSequence.js";
import { makeClassicGrayTiff } from "./tiffTestFixtures.js";
import { parseStackSelectionsCsv } from "./stackSelections.js";
import { decodeTiffStack } from "./tiffStack.js";

function sourceFile(name, buffer) {
  return {
    name,
    async getFile() {
      return { arrayBuffer: async () => buffer };
    }
  };
}

describe("result sequence builder", () => {
  it("writes one selected grayscale page per source file in filename order", async () => {
    const files = [
      sourceFile("b.tif", makeClassicGrayTiff({ pages: [[10, 11, 12, 13], [20, 21, 22, 23]] })),
      sourceFile("a.tif", makeClassicGrayTiff({ pages: [[1, 2, 3, 4]] }))
    ];
    const selections = parseStackSelectionsCsv(
      "filename,selected_stack,stack_count\na.tif,1,1\nb.tif,2,2\n"
    );
    const writes = [];
    const io = {
      ensureResultDirectory: vi.fn(async () => "result-dir"),
      writeBinaryFile: vi.fn(async (dir, name, data) => writes.push({ dir, name, data })),
      writeTextFile: vi.fn(async (dir, name, text) => writes.push({ dir, name, text }))
    };

    await buildResultSequence({ directoryHandle: "root", files, selections, io });

    const tiffWrite = writes.find((write) => write.name === "selected-stack-sequence.tif");
    const decoded = decodeTiffStack(tiffWrite.data.buffer, "selected-stack-sequence.tif");
    expect(decoded.pages.map((page) => [...page.pixels])).toEqual([
      [1, 2, 3, 4],
      [20, 21, 22, 23]
    ]);
    expect(writes.find((write) => write.name === "stack-selections.csv").text).toContain("b.tif,2,2");
  });

  it("rejects incompatible pages before writing partial result files", async () => {
    const files = [
      sourceFile("a.tif", makeClassicGrayTiff({ width: 2, height: 2, pages: [[1, 2, 3, 4]] })),
      sourceFile("b.tif", makeClassicGrayTiff({ width: 1, height: 2, pages: [[5, 6]] }))
    ];
    const selections = parseStackSelectionsCsv(
      "filename,selected_stack,stack_count\na.tif,1,1\nb.tif,1,1\n"
    );
    const io = {
      ensureResultDirectory: vi.fn(async () => "result-dir"),
      writeBinaryFile: vi.fn(),
      writeTextFile: vi.fn()
    };

    await expect(buildResultSequence({ directoryHandle: "root", files, selections, io })).rejects.toThrow(
      /same width/i
    );
    expect(io.writeBinaryFile).not.toHaveBeenCalled();
    expect(io.writeTextFile).not.toHaveBeenCalled();
  });
});
