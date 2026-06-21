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

async function readHandleBuffer(fileHandle) {
  const file = await fileHandle.getFile();
  return file.arrayBuffer();
}

export async function buildResultSequence({ directoryHandle, files, selections, io = defaultIo }) {
  const sortedFiles = [...files].sort((a, b) => a.name.localeCompare(b.name));
  const selectedRows = new Map();
  const selectedPages = [];

  for (const fileHandle of sortedFiles) {
    const saved = selections.get(fileHandle.name);
    if (!saved) throw new Error(`Missing stack selection for ${fileHandle.name}`);

    const stack = decodeTiffStack(await readHandleBuffer(fileHandle), fileHandle.name);
    if (saved.selectedStack < 1 || saved.selectedStack > stack.stackCount) {
      throw new Error(`Selected stack for ${fileHandle.name} is outside the available stack count`);
    }

    selectedPages.push(stack.pages[saved.selectedStack - 1]);
    selectedRows.set(fileHandle.name, {
      filename: fileHandle.name,
      selectedStack: saved.selectedStack,
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
