import { writeClassicGrayTiff } from "./classicTiffWriter.js";
import {
  ensureResultDirectory,
  writeBinaryFile,
  writeTextFile
} from "./localTiffDirectory.js";
import {
  classifyResultPageMetadata,
  serializeSourceMetadataJson
} from "./resultTiffMetadata.js";
import { serializeStackSelectionsCsv } from "./stackSelections.js";
import { decodeTiffStack } from "./tiffStack.js";
import {
  formatImageJResultDescription,
  parseImageJDisplayRange
} from "./tiffDisplayRange.js";
import { readClassicTiffMetadata } from "./tiffMetadata.js";

const defaultIo = {
  ensureResultDirectory,
  writeBinaryFile,
  writeTextFile
};
const DEFAULT_TIFF_FILENAME = "selected-stack-sequence.tif";
const CSV_FILENAME = "stack-selections.csv";
const METADATA_FILENAME = "source-metadata.json";

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function compareStrings(left, right) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function stripTiffExtension(filename) {
  return String(filename ?? "").replace(/\.tiff?$/i, "");
}

function sanitizeFilename(filename) {
  return String(filename ?? "")
    .trim()
    .replace(/[\\/:*?"<>|]+/g, "_");
}

export function defaultResultNameFromFilename(filename) {
  return stripTiffExtension(filename) || stripTiffExtension(DEFAULT_TIFF_FILENAME);
}

export function normalizeResultTiffFilename(outputName) {
  const filename = sanitizeFilename(outputName) || DEFAULT_TIFF_FILENAME;
  return /\.tiff?$/i.test(filename) ? filename : `${filename}.tif`;
}

async function readHandleBuffer(fileHandle) {
  const file = await fileHandle.getFile();
  return file.arrayBuffer();
}

function getImageDescription(ifd) {
  const description = ifd.entries.find((entry) => entry.tag === 270)?.values;
  return typeof description === "string" ? description : undefined;
}

export async function buildResultSequence({
  directoryHandle,
  files,
  selections,
  outputName,
  metadataLimits,
  io = defaultIo
}) {
  const filesByName = new Map(files.map((fileHandle) => [fileHandle.name, fileHandle]));
  const selectedRowsInFileOrder = [...selections.values()]
    .filter((row) => filesByName.has(row.filename))
    .sort((a, b) => compareStrings(a.filename, b.filename));
  const selectedRows = new Map();
  const selectedPages = [];
  const sourceRecords = [];

  if (selectedRowsInFileOrder.length === 0) {
    throw new Error("At least one stack selection is required to build a result");
  }

  for (const saved of selectedRowsInFileOrder) {
    const fileHandle = filesByName.get(saved.filename);
    const sourceBuffer = await readHandleBuffer(fileHandle);
    const stack = decodeTiffStack(sourceBuffer, fileHandle.name);
    const selectedStack = clamp(saved.selectedStack, 1, stack.stackCount);
    const metadata = readClassicTiffMetadata(sourceBuffer, {
      filename: fileHandle.name,
      selectedStackNumber: selectedStack,
      limits: metadataLimits
    });
    const classified = classifyResultPageMetadata({
      metadata,
      filename: fileHandle.name,
      selectedStack,
      stackCount: stack.stackCount,
      outputPage: selectedPages.length + 1
    });

    const selectedPage = stack.pages[selectedStack - 1];
    const sourceDescription = getImageDescription(metadata.selectedIfd);
    selectedPages.push({
      ...selectedPage,
      displayRange: parseImageJDisplayRange(sourceDescription),
      metadataEntries: classified.embeddedEntries
    });
    sourceRecords.push(classified.sourceRecord);
    selectedRows.set(fileHandle.name, {
      filename: fileHandle.name,
      selectedStack,
      stackCount: stack.stackCount
    });
  }

  const pageCount = selectedPages.length;
  const outputPages = selectedPages.map(({ displayRange, ...page }, pageIndex) => ({
    ...page,
    imageDescription: formatImageJResultDescription({
      range: displayRange,
      pageCount,
      includeSequenceShape: pageIndex === 0
    })
  }));
  const tiffFilename = normalizeResultTiffFilename(outputName);
  const outputTiff = writeClassicGrayTiff(outputPages);
  const outputCsv = serializeStackSelectionsCsv(selectedRows);
  const outputMetadata = serializeSourceMetadataJson({
    tiffFilename,
    pageRecords: sourceRecords
  });

  const resultDirectory = await io.ensureResultDirectory(directoryHandle);
  await io.writeBinaryFile(resultDirectory, tiffFilename, outputTiff);
  await io.writeTextFile(resultDirectory, CSV_FILENAME, outputCsv);
  await io.writeTextFile(resultDirectory, METADATA_FILENAME, outputMetadata);

  return {
    pageCount,
    tiffFilename,
    csvFilename: CSV_FILENAME,
    metadataFilename: METADATA_FILENAME
  };
}
