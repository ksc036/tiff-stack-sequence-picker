import sharp from "sharp";

export const DEFAULT_MAX_IMAGE_PIXELS = 536_870_912;

function positiveInteger(value, fallback) {
  const number = Number.parseInt(value, 10);
  return Number.isSafeInteger(number) && number > 0 ? number : fallback;
}

export function resolveMaxImagePixels(maxImagePixels = process.env.MAX_IMAGE_PIXELS) {
  return positiveInteger(maxImagePixels, DEFAULT_MAX_IMAGE_PIXELS);
}

function sharpInputOptions({ maxImagePixels, pageIndex } = {}) {
  return {
    limitInputPixels: resolveMaxImagePixels(maxImagePixels),
    ...(Number.isInteger(pageIndex) ? { page: pageIndex, pages: 1 } : {})
  };
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function findDisplayRange(pixels) {
  let min = 65535;
  let max = 0;

  for (const value of pixels) {
    if (value < min) min = value;
    if (value > max) max = value;
  }

  return { min, max };
}

function toBuffer(input) {
  if (Buffer.isBuffer(input)) return input;
  if (input instanceof ArrayBuffer) return Buffer.from(input);
  if (ArrayBuffer.isView(input)) return Buffer.from(input.buffer, input.byteOffset, input.byteLength);
  throw new Error("TIFF input must be a Buffer, ArrayBuffer, or typed array");
}

function readTiffUInt16(buffer, offset, littleEndian) {
  return littleEndian ? buffer.readUInt16LE(offset) : buffer.readUInt16BE(offset);
}

function readTiffUInt32(buffer, offset, littleEndian) {
  return littleEndian ? buffer.readUInt32LE(offset) : buffer.readUInt32BE(offset);
}

export function parseImageJDisplayRange(description) {
  if (!description) return null;

  const minMatch = description.match(/(?:^|\n)\s*min\s*=\s*([-+]?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?)/);
  const maxMatch = description.match(/(?:^|\n)\s*max\s*=\s*([-+]?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?)/);
  const min = Number(minMatch?.[1]);
  const max = Number(maxMatch?.[1]);

  if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) return null;
  return { min, max };
}

function readAsciiTagValue(buffer, entryOffset, count, littleEndian) {
  if (count <= 0 || count > 1_048_576) return null;

  const value =
    count <= 4
      ? buffer.subarray(entryOffset + 8, entryOffset + 8 + count)
      : buffer.subarray(
          readTiffUInt32(buffer, entryOffset + 8, littleEndian),
          readTiffUInt32(buffer, entryOffset + 8, littleEndian) + count
        );

  return value.toString("utf8").replace(/\0+$/, "");
}

export function readImageDescriptionFromClassicTiffBuffer(input, pageIndex = 0) {
  const buffer = toBuffer(input);
  if (buffer.length < 8) return null;

  const byteOrder = buffer.toString("ascii", 0, 2);
  const littleEndian = byteOrder === "II";
  if (!littleEndian && byteOrder !== "MM") return null;
  if (readTiffUInt16(buffer, 2, littleEndian) !== 42) return null;

  let ifdOffset = readTiffUInt32(buffer, 4, littleEndian);
  for (let currentPage = 0; ifdOffset > 0 && currentPage <= pageIndex; currentPage += 1) {
    if (ifdOffset + 2 > buffer.length) return null;

    const entryCount = readTiffUInt16(buffer, ifdOffset, littleEndian);
    if (entryCount <= 0 || entryCount > 4096) return null;

    if (currentPage === pageIndex) {
      for (let index = 0; index < entryCount; index += 1) {
        const entryOffset = ifdOffset + 2 + index * 12;
        if (entryOffset + 12 > buffer.length) return null;

        const tag = readTiffUInt16(buffer, entryOffset, littleEndian);
        const type = readTiffUInt16(buffer, entryOffset + 2, littleEndian);
        const count = readTiffUInt32(buffer, entryOffset + 4, littleEndian);
        if (tag === 270 && type === 2) {
          return readAsciiTagValue(buffer, entryOffset, count, littleEndian);
        }
      }
      return null;
    }

    const nextIfdOffset = ifdOffset + 2 + entryCount * 12;
    if (nextIfdOffset + 4 > buffer.length) return null;
    ifdOffset = readTiffUInt32(buffer, nextIfdOffset, littleEndian);
  }

  return null;
}

export async function readGrey16RawFromTiffBuffer(input, { stackNumber = 1, maxImagePixels } = {}) {
  const buffer = toBuffer(input);
  const metadata = await sharp(buffer, sharpInputOptions({ maxImagePixels })).metadata();
  const stackCount = Math.max(1, metadata.pages ?? 1);
  const selectedStackNumber = clamp(positiveInteger(stackNumber, 1), 1, stackCount);
  const pageIndex = selectedStackNumber - 1;
  const { data, info } = await sharp(buffer, sharpInputOptions({ maxImagePixels, pageIndex }))
    .toColourspace("grey16")
    .raw({ depth: "ushort" })
    .toBuffer({ resolveWithObject: true });
  const pixels = new Uint16Array(data.buffer, data.byteOffset, data.byteLength / Uint16Array.BYTES_PER_ELEMENT);
  const imageJRange = parseImageJDisplayRange(readImageDescriptionFromClassicTiffBuffer(buffer, pageIndex));
  const { min, max } = imageJRange ?? findDisplayRange(pixels);

  return {
    buffer: data,
    width: metadata.width ?? info.width,
    height: metadata.height ?? info.height,
    stackCount,
    stackNumber: selectedStackNumber,
    min,
    max,
    pixelFormat: "uint16le"
  };
}
