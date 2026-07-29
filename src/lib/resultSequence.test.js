import { describe, expect, it, vi } from "vitest";
import { buildResultSequence } from "./resultSequence.js";
import { makeClassicGrayTiff } from "./tiffTestFixtures.js";
import { parseStackSelectionsCsv } from "./stackSelections.js";
import { decodeTiffStack } from "./tiffStack.js";
import { readClassicTiffMetadata } from "./tiffMetadata.js";
import { readGrey16RawFromTiffBuffer } from "../../server/imageProcessing.js";

function sourceFile(name, buffer) {
  const arrayBuffer = vi.fn(async () => buffer);
  return {
    name,
    async getFile() {
      return { arrayBuffer };
    },
    arrayBuffer
  };
}

function unreadableSourceFile(name) {
  return {
    name,
    async getFile() {
      throw new Error(`${name} should be skipped`);
    }
  };
}

describe("result sequence builder", () => {
  it("builds TIFF, CSV, and complete source metadata from selected pages", async () => {
    const sourceA = makeClassicGrayTiff({
      bitsPerSample: 16,
      pages: [
        [100, 200, 300, 400],
        [500, 1000, 2000, 4000]
      ],
      metadataByPage: [
        [
          {
            tag: 270,
            type: 2,
            value: "ImageJ=1.53e\nimages=12\nchannels=1\nslices=12\nframes=1\nmin=1000\nmax=2000"
          },
          { tag: 271, type: 2, value: "ScopeCo" },
          { tag: 272, type: 2, value: "Model A" },
          { tag: 65000, type: 7, values: [9, 8, 7] },
          {
            tag: 34665,
            type: 4,
            nestedIfd: [{ tag: 36867, type: 2, value: "2026:07:28 10:11:12" }]
          }
        ],
        [{ tag: 274, type: 3, values: [6] }]
      ]
    });
    const sourceB = makeClassicGrayTiff({
      bitsPerSample: 16,
      pages: [[2500, 3000, 4000, 5000]],
      metadataByPage: [[
        { tag: 270, type: 2, value: "ImageJ=1.53e\nmin=3000\nmax=4000" }
      ]]
    });
    const files = [
      sourceFile("a.tif", sourceA),
      sourceFile("b.tif", sourceB)
    ];
    const selections = parseStackSelectionsCsv(
      "filename,selected_stack,stack_count\na.tif,2,2\nb.tif,1,1\n"
    );
    const writes = [];
    const io = {
      ensureResultDirectory: vi.fn(async () => "result-dir"),
      writeBinaryFile: vi.fn(async (dir, name, data) => writes.push({ dir, name, data })),
      writeTextFile: vi.fn(async (dir, name, text) => writes.push({ dir, name, text }))
    };

    const result = await buildResultSequence({ directoryHandle: "root", files, selections, io });

    expect(result).toMatchObject({
      pageCount: 2,
      tiffFilename: "selected-stack-sequence.tif",
      csvFilename: "stack-selections.csv",
      metadataFilename: "source-metadata.json"
    });
    expect(files.map((file) => file.arrayBuffer.mock.calls.length)).toEqual([1, 1]);

    const outputTiff = writes.find((write) => write.name === result.tiffFilename).data;
    const outputMetadata = readClassicTiffMetadata(outputTiff, {
      filename: result.tiffFilename,
      selectedStackNumber: 1
    });
    const outputDescription = outputMetadata.firstIfd.entries.find((entry) => entry.tag === 270).values;

    expect(outputDescription).toContain("images=2");
    expect(outputDescription).toContain("slices=1");
    expect(outputDescription).toContain("frames=2");
    expect(outputDescription).not.toContain("images=12");
    expect(outputMetadata.firstIfd.entries.find((entry) => entry.tag === 271).values).toBe("ScopeCo");
    expect(outputMetadata.firstIfd.entries.find((entry) => entry.tag === 272).values).toBe("Model A");
    expect(outputMetadata.firstIfd.entries.find((entry) => entry.tag === 274).values).toEqual([6]);

    const firstPage = await readGrey16RawFromTiffBuffer(Buffer.from(outputTiff), { stackNumber: 1 });
    const secondPage = await readGrey16RawFromTiffBuffer(Buffer.from(outputTiff), { stackNumber: 2 });

    expect([firstPage.min, firstPage.max]).toEqual([1000, 2000]);
    expect([secondPage.min, secondPage.max]).toEqual([3000, 4000]);
    expect([...new Uint16Array(firstPage.buffer.buffer, firstPage.buffer.byteOffset, firstPage.buffer.byteLength / 2)]).toEqual(
      [500, 1000, 2000, 4000]
    );
    expect([...new Uint16Array(secondPage.buffer.buffer, secondPage.buffer.byteOffset, secondPage.buffer.byteLength / 2)]).toEqual(
      [2500, 3000, 4000, 5000]
    );

    const sidecar = JSON.parse(
      writes.find((write) => write.name === "source-metadata.json").text
    );
    expect(sidecar.pages[0]).toMatchObject({
      outputPage: 1,
      source: {
        filename: "a.tif",
        stackNumber: 2,
        stackCount: 2,
        byteOrder: "II"
      }
    });
    expect(sidecar.pages[0].firstIfd.entries).toEqual(
      expect.arrayContaining([expect.objectContaining({ tag: 65000 })])
    );
    expect(sidecar.pages[0].firstIfd.nestedIfds[0].ifd.entries).toEqual(
      expect.arrayContaining([expect.objectContaining({ tag: 36867 })])
    );
  });

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

  it("uses code-unit filename order for result page provenance", async () => {
    const files = [
      sourceFile("\u00e4-source.tif", makeClassicGrayTiff({ pages: [[5, 6, 7, 8]] })),
      sourceFile("z-source.tif", makeClassicGrayTiff({ pages: [[1, 2, 3, 4]] }))
    ];
    const selections = new Map(files.map((file) => [
      file.name,
      { filename: file.name, selectedStack: 1, stackCount: 1 }
    ]));
    const writes = [];
    const io = {
      ensureResultDirectory: vi.fn(async () => "result-dir"),
      writeBinaryFile: vi.fn(async (dir, name, data) => writes.push({ dir, name, data })),
      writeTextFile: vi.fn(async (dir, name, text) => writes.push({ dir, name, text }))
    };

    await buildResultSequence({ directoryHandle: "root", files, selections, io });

    const outputTiff = writes.find((write) => write.name === "selected-stack-sequence.tif").data;
    const decoded = decodeTiffStack(outputTiff.buffer, "selected-stack-sequence.tif");
    expect(decoded.pages.map((page) => [...page.pixels])).toEqual([
      [1, 2, 3, 4],
      [5, 6, 7, 8]
    ]);

    const sidecar = JSON.parse(
      writes.find((write) => write.name === "source-metadata.json").text
    );
    expect(sidecar.pages.map(({ outputPage, source }) => ({
      outputPage,
      filename: source.filename
    }))).toEqual([
      { outputPage: 1, filename: "z-source.tif" },
      { outputPage: 2, filename: "\u00e4-source.tif" }
    ]);
  });

  it("writes the result TIFF with the editable image name", async () => {
    const files = [
      sourceFile("a.tif", makeClassicGrayTiff({ pages: [[1, 2, 3, 4]] }))
    ];
    const selections = parseStackSelectionsCsv("filename,selected_stack,stack_count\na.tif,1,1\n");
    const writes = [];
    const io = {
      ensureResultDirectory: vi.fn(async () => "result-dir"),
      writeBinaryFile: vi.fn(async (dir, name, data) => writes.push({ dir, name, data })),
      writeTextFile: vi.fn(async (dir, name, text) => writes.push({ dir, name, text }))
    };

    const result = await buildResultSequence({ directoryHandle: "root", files, selections, outputName: "cell A1", io });

    expect(writes.find((write) => write.name === "cell A1.tif")).toBeTruthy();
    expect(result.tiffFilename).toBe("cell A1.tif");
  });

  it("strips path characters from the editable image name", async () => {
    const files = [
      sourceFile("a.tif", makeClassicGrayTiff({ pages: [[1, 2, 3, 4]] }))
    ];
    const selections = parseStackSelectionsCsv("filename,selected_stack,stack_count\na.tif,1,1\n");
    const writes = [];
    const io = {
      ensureResultDirectory: vi.fn(async () => "result-dir"),
      writeBinaryFile: vi.fn(async (dir, name, data) => writes.push({ dir, name, data })),
      writeTextFile: vi.fn(async (dir, name, text) => writes.push({ dir, name, text }))
    };

    const result = await buildResultSequence({ directoryHandle: "root", files, selections, outputName: "../bad:name.tiff", io });

    expect(writes.find((write) => write.name === ".._bad_name.tiff")).toBeTruthy();
    expect(result.tiffFilename).toBe(".._bad_name.tiff");
  });

  it("clamps stale saved selections to the closest available stack while building results", async () => {
    const files = [
      sourceFile("a.tif", makeClassicGrayTiff({ pages: [[1, 2, 3, 4], [5, 6, 7, 8]] }))
    ];
    const selections = parseStackSelectionsCsv("filename,selected_stack,stack_count\na.tif,4,4\n");
    const writes = [];
    const io = {
      ensureResultDirectory: vi.fn(async () => "result-dir"),
      writeBinaryFile: vi.fn(async (dir, name, data) => writes.push({ dir, name, data })),
      writeTextFile: vi.fn(async (dir, name, text) => writes.push({ dir, name, text }))
    };

    await buildResultSequence({ directoryHandle: "root", files, selections, io });

    const tiffWrite = writes.find((write) => write.name === "selected-stack-sequence.tif");
    const decoded = decodeTiffStack(tiffWrite.data.buffer, "selected-stack-sequence.tif");
    expect([...decoded.pages[0].pixels]).toEqual([5, 6, 7, 8]);
    expect(writes.find((write) => write.name === "stack-selections.csv").text).toContain("a.tif,2,2");
  });

  it("builds only selected files and skips unselected frames in the middle", async () => {
    const files = [
      sourceFile("a.tif", makeClassicGrayTiff({ pages: [[1, 2, 3, 4]] })),
      unreadableSourceFile("b-skipped.tif"),
      sourceFile("c.tif", makeClassicGrayTiff({ pages: [[9, 10, 11, 12]] }))
    ];
    const selections = parseStackSelectionsCsv(
      "filename,selected_stack,stack_count\na.tif,1,1\nc.tif,1,1\n"
    );
    const writes = [];
    const io = {
      ensureResultDirectory: vi.fn(async () => "result-dir"),
      writeBinaryFile: vi.fn(async (dir, name, data) => writes.push({ dir, name, data })),
      writeTextFile: vi.fn(async (dir, name, text) => writes.push({ dir, name, text }))
    };

    const result = await buildResultSequence({ directoryHandle: "root", files, selections, io });

    const tiffWrite = writes.find((write) => write.name === "selected-stack-sequence.tif");
    const decoded = decodeTiffStack(tiffWrite.data.buffer, "selected-stack-sequence.tif");
    expect(result.pageCount).toBe(2);
    expect(decoded.pages.map((page) => [...page.pixels])).toEqual([
      [1, 2, 3, 4],
      [9, 10, 11, 12]
    ]);
    expect(writes.find((write) => write.name === "stack-selections.csv").text).toBe(
      "filename,selected_stack,stack_count\na.tif,1,1\nc.tif,1,1\n"
    );
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

  it("rejects source metadata over the configured limit before output I/O", async () => {
    const files = [
      sourceFile("a.tif", makeClassicGrayTiff({ pages: [[1, 2, 3, 4]] }))
    ];
    const selections = parseStackSelectionsCsv("filename,selected_stack,stack_count\na.tif,1,1\n");
    const io = {
      ensureResultDirectory: vi.fn(),
      writeBinaryFile: vi.fn(),
      writeTextFile: vi.fn()
    };

    await expect(buildResultSequence({
      directoryHandle: "root",
      files,
      selections,
      metadataLimits: {
        maxTagBytes: 3,
        maxFileMetadataBytes: 1024,
        maxIfdDepth: 8
      },
      io
    })).rejects.toThrow(/metadata limit/i);

    expect(io.ensureResultDirectory).not.toHaveBeenCalled();
    expect(io.writeBinaryFile).not.toHaveBeenCalled();
    expect(io.writeTextFile).not.toHaveBeenCalled();
  });

  it("rejects when the source metadata sidecar cannot be written", async () => {
    const files = [
      sourceFile("a.tif", makeClassicGrayTiff({ pages: [[1, 2, 3, 4]] }))
    ];
    const selections = parseStackSelectionsCsv("filename,selected_stack,stack_count\na.tif,1,1\n");
    const io = {
      ensureResultDirectory: vi.fn(async () => "result-dir"),
      writeBinaryFile: vi.fn(),
      writeTextFile: vi.fn(async (_dir, name) => {
        if (name === "source-metadata.json") throw new Error("metadata write failed");
      })
    };

    await expect(
      buildResultSequence({ directoryHandle: "root", files, selections, io })
    ).rejects.toThrow(/metadata write failed/i);
  });
});
