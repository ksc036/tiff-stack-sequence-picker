const TYPE_SIZES = new Map([
  [1, 1],
  [2, 1],
  [3, 2],
  [4, 4]
]);

const DECODED_PAGE_TAGS = new Set([
  256,
  257,
  258,
  259,
  262,
  273,
  277,
  279,
  284,
  320,
  339
]);

function getView(input) {
  if (input instanceof ArrayBuffer) {
    return new DataView(input);
  }
  if (ArrayBuffer.isView(input)) {
    return new DataView(input.buffer, input.byteOffset, input.byteLength);
  }
  throw new Error("TIFF data must be an ArrayBuffer or typed array");
}

function readAscii(view, offset, length) {
  let value = "";
  for (let index = 0; index < length; index += 1) {
    value += String.fromCharCode(view.getUint8(offset + index));
  }
  return value;
}

function readValue(view, offset, type, littleEndian) {
  if (type === 3) return view.getUint16(offset, littleEndian);
  if (type === 4) return view.getUint32(offset, littleEndian);
  if (type === 1) return view.getUint8(offset);
  throw new Error(`Unsupported TIFF field type ${type}`);
}

function readEntryValues(view, entryOffset, littleEndian) {
  const type = view.getUint16(entryOffset + 2, littleEndian);
  const count = view.getUint32(entryOffset + 4, littleEndian);
  const typeSize = TYPE_SIZES.get(type);
  if (!typeSize) throw new Error(`Unsupported TIFF field type ${type}`);

  const byteLength = typeSize * count;
  const valueOffset = byteLength <= 4 ? entryOffset + 8 : view.getUint32(entryOffset + 8, littleEndian);
  const values = [];
  for (let index = 0; index < count; index += 1) {
    values.push(readValue(view, valueOffset + index * typeSize, type, littleEndian));
  }
  return { type, count, values };
}

function scalar(tags, tag, fallback) {
  const entry = tags.get(tag);
  if (!entry) return fallback;
  return entry.values[0];
}

function getRequiredScalar(tags, tag, label) {
  const value = scalar(tags, tag);
  if (value == null) throw new Error(`Missing required TIFF tag ${label}`);
  return value;
}

function allValuesEqual(values, expected) {
  return values.every((value) => value === expected);
}

function colorMapSampleToByte(value) {
  return Math.round(value / 257);
}

function copyStrips(view, offsets, counts, expectedByteLength) {
  const totalByteLength = counts.reduce((sum, count) => sum + count, 0);
  if (totalByteLength !== expectedByteLength) {
    throw new Error("TIFF strip byte counts do not match page dimensions");
  }

  const bytes = new Uint8Array(expectedByteLength);
  let targetOffset = 0;
  offsets.forEach((offset, index) => {
    const count = counts[index];
    bytes.set(new Uint8Array(view.buffer, view.byteOffset + offset, count), targetOffset);
    targetOffset += count;
  });
  return bytes;
}

function bytesToPixels(bytes, bitsPerSample, littleEndian) {
  if (bitsPerSample === 8) return bytes;

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const pixels = new Uint16Array(bytes.byteLength / 2);
  for (let index = 0; index < pixels.length; index += 1) {
    pixels[index] = view.getUint16(index * 2, littleEndian);
  }
  return pixels;
}

export function decodeTiffStack(input, filename = "TIFF file") {
  const view = getView(input);
  const byteOrder = readAscii(view, 0, 2);
  const littleEndian = byteOrder === "II";
  if (!littleEndian && byteOrder !== "MM") {
    throw new Error(`${filename} is not a classic TIFF file`);
  }
  if (view.getUint16(2, littleEndian) !== 42) {
    throw new Error(`${filename} is not a supported classic TIFF file`);
  }

  const pages = [];
  let ifdOffset = view.getUint32(4, littleEndian);
  const seenOffsets = new Set();

  while (ifdOffset !== 0) {
    if (seenOffsets.has(ifdOffset)) throw new Error("TIFF contains a circular IFD chain");
    seenOffsets.add(ifdOffset);
    const entryCount = view.getUint16(ifdOffset, littleEndian);
    const tags = new Map();
    for (let index = 0; index < entryCount; index += 1) {
      const entryOffset = ifdOffset + 2 + index * 12;
      const tag = view.getUint16(entryOffset, littleEndian);
      if (!DECODED_PAGE_TAGS.has(tag)) continue;
      tags.set(tag, readEntryValues(view, entryOffset, littleEndian));
    }

    const width = getRequiredScalar(tags, 256, "ImageWidth");
    const height = getRequiredScalar(tags, 257, "ImageLength");
    const bitsPerSample = getRequiredScalar(tags, 258, "BitsPerSample");
    const bitsPerSampleValues = tags.get(258)?.values ?? [bitsPerSample];
    const compression = scalar(tags, 259, 1);
    const photometric = getRequiredScalar(tags, 262, "PhotometricInterpretation");
    const samplesPerPixel = scalar(tags, 277, 1);
    const planarConfiguration = scalar(tags, 284, 1);
    const sampleFormat = scalar(tags, 339, 1);
    const sampleFormatValues = tags.get(339)?.values ?? [sampleFormat];
    const colorMap = tags.get(320)?.values;
    const stripOffsets = tags.get(273)?.values;
    const stripByteCounts = tags.get(279)?.values;

    if (compression !== 1) throw new Error(`${filename} must use uncompressed TIFF pages`);
    if (samplesPerPixel !== 1 && samplesPerPixel !== 3) {
      throw new Error(`${filename} must use single-channel grayscale or RGB samples`);
    }
    if (bitsPerSample !== 8 && bitsPerSample !== 16) {
      throw new Error(`${filename} must use 8-bit or 16-bit samples`);
    }
    if (!allValuesEqual(bitsPerSampleValues, bitsPerSample)) {
      throw new Error(`${filename} must use the same bit depth for every sample`);
    }
    if (samplesPerPixel === 1 && photometric === 3) {
      if (bitsPerSample !== 8) throw new Error(`${filename} must use 8-bit palette color samples`);
      if (!colorMap?.length) throw new Error(`${filename} must include a palette ColorMap`);
      if (colorMap.length < 3 * 2 ** bitsPerSample) throw new Error(`${filename} has an incomplete palette ColorMap`);
    } else if (samplesPerPixel === 1 && photometric !== 0 && photometric !== 1) {
      throw new Error(`${filename} must use black-is-zero, white-is-zero, or palette-color photometric interpretation`);
    }
    if (samplesPerPixel === 3 && photometric !== 2) throw new Error(`${filename} must use RGB photometric interpretation`);
    if (samplesPerPixel === 3 && planarConfiguration !== 1) throw new Error(`${filename} must use chunky RGB samples`);
    if (!allValuesEqual(sampleFormatValues, 1)) throw new Error(`${filename} must use unsigned integer samples`);
    if (!stripOffsets?.length || !stripByteCounts?.length || stripOffsets.length !== stripByteCounts.length) {
      throw new Error(`${filename} has invalid strip metadata`);
    }

    const expectedByteLength = width * height * samplesPerPixel * (bitsPerSample / 8);
    const bytes = copyStrips(view, stripOffsets, stripByteCounts, expectedByteLength);
    pages.push({
      filename,
      stackNumber: pages.length + 1,
      width,
      height,
      bitsPerSample,
      samplesPerPixel,
      photometric,
      colorMap,
      pixels: bytesToPixels(bytes, bitsPerSample, littleEndian)
    });

    ifdOffset = view.getUint32(ifdOffset + 2 + entryCount * 12, littleEndian);
  }

  if (pages.length === 0) throw new Error(`${filename} does not contain any TIFF pages`);
  return { filename, stackCount: pages.length, pages };
}

export function normalizeGrayPageToRgba(page) {
  if (page.samplesPerPixel === 3 && page.photometric === 2) {
    const rgba = new Uint8ClampedArray(page.width * page.height * 4);
    const scale = page.bitsPerSample === 16 ? 255 / 65535 : 1;
    for (let index = 0; index < page.width * page.height; index += 1) {
      const sourceOffset = index * 3;
      const targetOffset = index * 4;
      rgba[targetOffset] = Math.round(page.pixels[sourceOffset] * scale);
      rgba[targetOffset + 1] = Math.round(page.pixels[sourceOffset + 1] * scale);
      rgba[targetOffset + 2] = Math.round(page.pixels[sourceOffset + 2] * scale);
      rgba[targetOffset + 3] = 255;
    }
    return rgba;
  }

  if (page.samplesPerPixel === 1 && page.photometric === 3) {
    const rgba = new Uint8ClampedArray(page.width * page.height * 4);
    const paletteSize = page.colorMap.length / 3;
    for (let index = 0; index < page.width * page.height; index += 1) {
      const paletteIndex = page.pixels[index];
      const targetOffset = index * 4;
      rgba[targetOffset] = colorMapSampleToByte(page.colorMap[paletteIndex] ?? 0);
      rgba[targetOffset + 1] = colorMapSampleToByte(page.colorMap[paletteIndex + paletteSize] ?? 0);
      rgba[targetOffset + 2] = colorMapSampleToByte(page.colorMap[paletteIndex + paletteSize * 2] ?? 0);
      rgba[targetOffset + 3] = 255;
    }
    return rgba;
  }

  const pixels = page.pixels;
  let min = Infinity;
  let max = -Infinity;
  for (const value of pixels) {
    if (value < min) min = value;
    if (value > max) max = value;
  }

  const scale = max === min ? 0 : 255 / (max - min);
  const rgba = new Uint8ClampedArray(page.width * page.height * 4);
  for (let index = 0; index < pixels.length; index += 1) {
    let gray = max === min ? 0 : Math.round((pixels[index] - min) * scale);
    if (page.photometric === 0) gray = 255 - gray;
    const offset = index * 4;
    rgba[offset] = gray;
    rgba[offset + 1] = gray;
    rgba[offset + 2] = gray;
    rgba[offset + 3] = 255;
  }
  return rgba;
}
