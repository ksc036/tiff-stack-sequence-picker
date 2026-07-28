const TYPE_SIZES = new Map([
  [1, 1], [2, 1], [3, 2], [4, 4], [5, 8], [6, 1], [7, 1],
  [8, 2], [9, 4], [10, 8], [11, 4], [12, 8], [13, 4]
]);

const RAW_BYTE_TYPES = new Set([1, 2, 6, 7]);
const WRITER_OWNED_TAGS = new Set([
  256, 257, 258, 259, 262, 270, 273, 277, 278, 279,
  284, 320, 338, 339
]);
const UINT16_MAX = 0xffff;
const UINT32_MAX = 0xffffffff;

function normalizeAsciiValue(value) {
  return value.endsWith("\0") ? value : `${value}\0`;
}

function assertInteger(value, min, max, message) {
  if (!Number.isInteger(value) || value < min || value > max) throw new Error(message);
}

function assertNumber(value, message) {
  if (typeof value !== "number") throw new Error(message);
}

function validateDecodedValue(type, value, tag) {
  const message = `TIFF metadata tag ${tag} has an invalid decoded value for field type ${type}`;
  switch (type) {
    case 1:
    case 7:
      assertInteger(value, 0, 0xff, message);
      break;
    case 3:
      assertInteger(value, 0, UINT16_MAX, message);
      break;
    case 4:
    case 13:
      assertInteger(value, 0, UINT32_MAX, message);
      break;
    case 5:
      if (!value || typeof value !== "object") throw new Error(message);
      assertInteger(value.numerator, 0, UINT32_MAX, message);
      assertInteger(value.denominator, 0, UINT32_MAX, message);
      break;
    case 6:
      assertInteger(value, -0x80, 0x7f, message);
      break;
    case 8:
      assertInteger(value, -0x8000, 0x7fff, message);
      break;
    case 9:
      assertInteger(value, -0x80000000, 0x7fffffff, message);
      break;
    case 10:
      if (!value || typeof value !== "object") throw new Error(message);
      assertInteger(value.numerator, -0x80000000, 0x7fffffff, message);
      assertInteger(value.denominator, -0x80000000, 0x7fffffff, message);
      break;
    case 11:
    case 12:
      assertNumber(value, message);
      break;
    default:
      throw new Error(`TIFF metadata tag ${tag} has unsupported field type ${type}`);
  }
}

function encodeNumericValues(type, values) {
  const bytes = new Uint8Array(values.length * TYPE_SIZES.get(type));
  const view = new DataView(bytes.buffer);
  values.forEach((value, index) => {
    const offset = index * TYPE_SIZES.get(type);
    switch (type) {
      case 3:
        view.setUint16(offset, value, true);
        break;
      case 4:
      case 13:
        view.setUint32(offset, value, true);
        break;
      case 5:
        view.setUint32(offset, value.numerator, true);
        view.setUint32(offset + 4, value.denominator, true);
        break;
      case 8:
        view.setInt16(offset, value, true);
        break;
      case 9:
        view.setInt32(offset, value, true);
        break;
      case 10:
        view.setInt32(offset, value.numerator, true);
        view.setInt32(offset + 4, value.denominator, true);
        break;
      case 11:
        view.setFloat32(offset, value, true);
        break;
      case 12:
        view.setFloat64(offset, value, true);
        break;
      default:
        throw new Error(`Cannot numerically encode TIFF field type ${type}`);
    }
  });
  return bytes;
}

function numericEntry(tag, type, values) {
  values.forEach((value) => validateDecodedValue(type, value, tag));
  return { tag, type, count: values.length, bytes: encodeNumericValues(type, values) };
}

function asciiEntry(tag, value) {
  const normalized = normalizeAsciiValue(value);
  const bytes = new Uint8Array(normalized.length);
  for (let index = 0; index < normalized.length; index += 1) {
    const codeUnit = normalized.charCodeAt(index);
    if (codeUnit > 0x7f) {
      throw new Error("TIFF ImageDescription supports ASCII characters only");
    }
    bytes[index] = codeUnit;
  }
  return {
    tag,
    type: 2,
    count: bytes.byteLength,
    bytes
  };
}

function encodeMetadataEntry(entry) {
  if (!entry || typeof entry !== "object") throw new Error("TIFF metadata entry must be an object");
  assertInteger(entry.tag, 0, UINT16_MAX, "TIFF metadata tag must be an unsigned 16-bit integer");
  if (WRITER_OWNED_TAGS.has(entry.tag)) {
    throw new Error(`Metadata cannot override writer-owned TIFF tag ${entry.tag}`);
  }

  const typeSize = TYPE_SIZES.get(entry.type);
  if (!typeSize) throw new Error(`TIFF metadata tag ${entry.tag} has unsupported field type ${entry.type}`);
  assertInteger(
    entry.count,
    0,
    UINT32_MAX,
    `TIFF metadata tag ${entry.tag} must have an unsigned 32-bit count`
  );
  const byteLength = entry.count * typeSize;
  if (!Number.isSafeInteger(byteLength) || byteLength > UINT32_MAX) {
    throw new Error(`TIFF metadata tag ${entry.tag} has an invalid byte length`);
  }

  if (entry.type === 2) {
    if (typeof entry.values !== "string") {
      throw new Error(`TIFF metadata tag ${entry.tag} ASCII values must be a string`);
    }
  } else {
    if (!Array.isArray(entry.values) || entry.values.length !== entry.count) {
      throw new Error(`TIFF metadata tag ${entry.tag} values do not match count ${entry.count}`);
    }
    entry.values.forEach((value) => validateDecodedValue(entry.type, value, entry.tag));
  }

  if (RAW_BYTE_TYPES.has(entry.type)) {
    if (!(entry.rawBytes instanceof Uint8Array) || entry.rawBytes.byteLength !== byteLength) {
      throw new Error(`TIFF metadata tag ${entry.tag} raw byte length does not match count ${entry.count}`);
    }
    return { tag: entry.tag, type: entry.type, count: entry.count, bytes: entry.rawBytes.slice() };
  }

  return {
    tag: entry.tag,
    type: entry.type,
    count: entry.count,
    bytes: encodeNumericValues(entry.type, entry.values)
  };
}

function buildPageEntries(page, stripByteCount) {
  const metadataEntries = page.metadataEntries ?? [];
  if (!Array.isArray(metadataEntries)) throw new Error("Page metadataEntries must be an array");

  const seenMetadataTags = new Set();
  const encodedMetadataEntries = metadataEntries.map((entry) => {
    if (seenMetadataTags.has(entry?.tag)) {
      throw new Error(`Page has duplicate TIFF metadata tag ${entry.tag}`);
    }
    seenMetadataTags.add(entry?.tag);
    return encodeMetadataEntry(entry);
  });
  const entries = [
    numericEntry(256, 4, [page.width]),
    numericEntry(257, 4, [page.height]),
    numericEntry(258, 3, Array.from({ length: page.samplesPerPixel }, () => page.bitsPerSample)),
    numericEntry(259, 3, [1]),
    numericEntry(262, 3, [page.photometric]),
    ...(page.imageDescription != null ? [asciiEntry(270, page.imageDescription)] : []),
    numericEntry(273, 4, [0]),
    numericEntry(277, 3, [page.samplesPerPixel]),
    numericEntry(278, 4, [page.height]),
    numericEntry(279, 4, [stripByteCount]),
    ...(page.samplesPerPixel > 1 ? [numericEntry(284, 3, [1])] : []),
    ...(page.photometric === 3 ? [numericEntry(320, 3, [...page.colorMap])] : []),
    numericEntry(339, 3, Array.from({ length: page.samplesPerPixel }, () => 1)),
    ...encodedMetadataEntries
  ];
  return entries.sort((left, right) => left.tag - right.tag);
}

function alignToWord(offset) {
  return offset + (offset % 2);
}

function layoutClassicTiff(pageEntries, pixelPages) {
  let nextOffset = 8;
  const pageLayouts = pageEntries.map((entries) => {
    const ifdOffset = nextOffset;
    nextOffset += 2 + entries.length * 12 + 4;
    return { entries, ifdOffset };
  });

  pageLayouts.forEach(({ entries }) => {
    entries.forEach((entry) => {
      if (entry.bytes.byteLength <= 4) return;
      nextOffset = alignToWord(nextOffset);
      entry.valueOffset = nextOffset;
      nextOffset += entry.bytes.byteLength;
    });
  });

  nextOffset = alignToWord(nextOffset);
  pageLayouts.forEach((layout, pageIndex) => {
    layout.stripOffset = nextOffset;
    const stripEntry = layout.entries.find((entry) => entry.tag === 273);
    stripEntry.bytes = numericEntry(273, 4, [layout.stripOffset]).bytes;
    nextOffset += pixelPages[pageIndex].byteLength;
  });

  if (nextOffset > UINT32_MAX) throw new Error("Result TIFF exceeds the classic TIFF size limit");
  return { pageLayouts, totalByteLength: nextOffset };
}

function writeIfdEntry(view, buffer, offset, entry) {
  view.setUint16(offset, entry.tag, true);
  view.setUint16(offset + 2, entry.type, true);
  view.setUint32(offset + 4, entry.count, true);
  if (entry.bytes.byteLength <= 4) {
    new Uint8Array(buffer, offset + 8, 4).set(entry.bytes);
  } else {
    view.setUint32(offset + 8, entry.valueOffset, true);
  }
}

function assertPageShape(page) {
  if (page.samplesPerPixel !== 1 && page.samplesPerPixel !== 3) {
    throw new Error("Result TIFF supports single-channel grayscale or RGB pages only");
  }
  if (page.bitsPerSample !== 8 && page.bitsPerSample !== 16) {
    throw new Error("Result TIFF supports only 8-bit or 16-bit pages");
  }
  if (page.samplesPerPixel === 1 && page.photometric === 3) {
    if (page.bitsPerSample !== 8) throw new Error("Result TIFF supports only 8-bit palette-color pages");
    if (!page.colorMap?.length) throw new Error("Result TIFF palette pages require a ColorMap");
    if (page.colorMap.length < 3 * 2 ** page.bitsPerSample) {
      throw new Error("Result TIFF palette pages require a complete ColorMap");
    }
  } else if (page.samplesPerPixel === 1 && page.photometric !== 0 && page.photometric !== 1) {
    throw new Error("Result TIFF supports grayscale or palette-color single-channel pages only");
  }
  if (page.samplesPerPixel === 3 && page.photometric !== 2) {
    throw new Error("Result TIFF supports RGB pages only when photometric interpretation is 2");
  }
}

function pageBytes(page) {
  const expectedSamples = page.width * page.height * page.samplesPerPixel;
  if (page.bitsPerSample === 8) {
    const pixels = page.pixels instanceof Uint8Array ? page.pixels : Uint8Array.from(page.pixels);
    if (pixels.length !== expectedSamples) throw new Error("Page pixel data does not match dimensions");
    return pixels;
  }

  const bytes = new Uint8Array(expectedSamples * 2);
  const view = new DataView(bytes.buffer);
  const pixels = page.pixels instanceof Uint16Array ? page.pixels : Uint16Array.from(page.pixels);
  if (pixels.length !== expectedSamples) throw new Error("Page pixel data does not match dimensions");
  pixels.forEach((value, index) => view.setUint16(index * 2, value, true));
  return bytes;
}

function validatePages(pages) {
  if (!Array.isArray(pages) || pages.length === 0) {
    throw new Error("At least one TIFF page is required");
  }

  const first = pages[0];
  assertPageShape(first);
  pages.forEach((page) => {
    assertPageShape(page);
    if (
      page.width !== first.width ||
      page.height !== first.height ||
      page.bitsPerSample !== first.bitsPerSample ||
      page.photometric !== first.photometric ||
      page.samplesPerPixel !== first.samplesPerPixel
    ) {
      throw new Error(
        "All result pages must have same width, height, bitsPerSample, photometric, and samplesPerPixel"
      );
    }
  });
}

export function writeClassicGrayTiff(pages) {
  validatePages(pages);

  const pixelPages = pages.map(pageBytes);
  const includeImageDescriptions = pages.some((page) => page.imageDescription != null);
  const outputPages = includeImageDescriptions
    ? pages.map((page) => ({ ...page, imageDescription: page.imageDescription ?? "ImageJ=1.53e" }))
    : pages;
  const pageEntries = outputPages.map((page, pageIndex) =>
    buildPageEntries(page, pixelPages[pageIndex].byteLength)
  );
  const { pageLayouts, totalByteLength } = layoutClassicTiff(pageEntries, pixelPages);
  const buffer = new ArrayBuffer(totalByteLength);
  const view = new DataView(buffer);

  view.setUint8(0, "I".charCodeAt(0));
  view.setUint8(1, "I".charCodeAt(0));
  view.setUint16(2, 42, true);
  view.setUint32(4, pageLayouts[0].ifdOffset, true);

  pageLayouts.forEach((layout, pageIndex) => {
    view.setUint16(layout.ifdOffset, layout.entries.length, true);
    layout.entries.forEach((entry, entryIndex) => {
      const entryOffset = layout.ifdOffset + 2 + entryIndex * 12;
      writeIfdEntry(view, buffer, entryOffset, entry);
      if (entry.bytes.byteLength > 4) {
        new Uint8Array(buffer, entry.valueOffset, entry.bytes.byteLength).set(entry.bytes);
      }
    });
    const nextIfdOffset = pageLayouts[pageIndex + 1]?.ifdOffset ?? 0;
    view.setUint32(layout.ifdOffset + 2 + layout.entries.length * 12, nextIfdOffset, true);
    new Uint8Array(buffer, layout.stripOffset, pixelPages[pageIndex].byteLength).set(pixelPages[pageIndex]);
  });

  return new Uint8Array(buffer);
}
