import { writeClassicGrayTiff } from "./classicTiffWriter.js";
import {
  ensureResultDirectory,
  writeBinaryFile,
  writeTextFile
} from "./localTiffDirectory.js";
import { serializeStackSelectionsCsv } from "./stackSelections.js";
import { decodeTiffStack } from "./tiffStack.js";

const defaultIo = {
  ensureResultDirectory,
  writeBinaryFile,
  writeTextFile
};

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

async function readHandleBuffer(fileHandle) {
  const file = await fileHandle.getFile();
  return file.arrayBuffer();
}

export async function buildResultSequence({ directoryHandle, files, selections, io = defaultIo }) {
  const filesByName = new Map(files.map((fileHandle) => [fileHandle.name, fileHandle]));
  const selectedRowsInFileOrder = [...selections.values()]
    .filter((row) => filesByName.has(row.filename))
    .sort((a, b) => a.filename.localeCompare(b.filename));
  const selectedRows = new Map();
  const selectedPages = [];

  if (selectedRowsInFileOrder.length === 0) {
    throw new Error("At least one stack selection is required to build a result");
  }

  for (const saved of selectedRowsInFileOrder) {
    const fileHandle = filesByName.get(saved.filename);
    const stack = decodeTiffStack(await readHandleBuffer(fileHandle), fileHandle.name);
    const selectedStack = clamp(saved.selectedStack, 1, stack.stackCount);

    selectedPages.push(stack.pages[selectedStack - 1]);
    selectedRows.set(fileHandle.name, {
      filename: fileHandle.name,
      selectedStack,
      stackCount: stack.stackCount
    });
  }

  const outputTiff = writeClassicGrayTiff(selectedPages);
  const outputCsv = serializeStackSelectionsCsv(selectedRows);

  const resultDirectory = await io.ensureResultDirectory(directoryHandle);
  await io.writeBinaryFile(resultDirectory, "selected-stack-sequence.tif", outputTiff);
  await io.writeTextFile(resultDirectory, "stack-selections.csv", outputCsv);

  return {
    pageCount: selectedPages.length,
    tiffFilename: "selected-stack-sequence.tif",
    csvFilename: "stack-selections.csv"
  };
}
