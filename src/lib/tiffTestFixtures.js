const TYPE_SIZES = new Map([
  [1, 1], [2, 1], [3, 2], [4, 4], [5, 8], [6, 1], [7, 1],
  [8, 2], [9, 4], [10, 8], [11, 4], [12, 8], [13, 4]
]);

function encodeFixtureValues(entry, littleEndian) {
  const typeSize = TYPE_SIZES.get(entry.type);
  if (!typeSize) throw new Error(`Unsupported TIFF fixture field type ${entry.type}`);

  if (entry.type === 2) {
    const value = entry.value.endsWith("\0") ? entry.value : `${entry.value}\0`;
    return { count: value.length, bytes: Uint8Array.from(value, (character) => character.charCodeAt(0)) };
  }

  const values = entry.values;
  const bytes = new Uint8Array(values.length * typeSize);
  const view = new DataView(bytes.buffer);
  values.forEach((value, index) => {
    const offset = index * typeSize;
    switch (entry.type) {
      case 1:
      case 7:
        view.setUint8(offset, value);
        break;
      case 3:
        view.setUint16(offset, value, littleEndian);
        break;
      case 4:
      case 13:
        view.setUint32(offset, value, littleEndian);
        break;
      case 5:
        view.setUint32(offset, value[0], littleEndian);
        view.setUint32(offset + 4, value[1], littleEndian);
        break;
      case 6:
        view.setInt8(offset, value);
        break;
      case 8:
        view.setInt16(offset, value, littleEndian);
        break;
      case 9:
        view.setInt32(offset, value, littleEndian);
        break;
      case 10:
        view.setInt32(offset, value[0], littleEndian);
        view.setInt32(offset + 4, value[1], littleEndian);
        break;
      case 11:
        view.setFloat32(offset, value, littleEndian);
        break;
      case 12:
        view.setFloat64(offset, value, littleEndian);
        break;
      default:
        throw new Error(`Unsupported TIFF fixture field type ${entry.type}`);
    }
  });
  return { count: values.length, bytes };
}

function fixtureEntry(tag, type, values, littleEndian) {
  const encoded = encodeFixtureValues({ type, values }, littleEndian);
  return { tag, type, ...encoded };
}

function asciiFixtureEntry(tag, value, littleEndian) {
  const encoded = encodeFixtureValues({ type: 2, value }, littleEndian);
  return { tag, type: 2, ...encoded };
}

function buildMetadataIfd(entries, littleEndian) {
  const ifd = { entries: [] };
  entries.forEach((entry) => {
    if (entry.nestedIfd) {
      const child = buildMetadataIfd(entry.nestedIfd, littleEndian);
      ifd.entries.push({ tag: entry.tag, type: entry.type, count: 1, bytes: null, child });
      return;
    }
    const encoded = entry.type === 2
      ? encodeFixtureValues({ type: entry.type, value: entry.value }, littleEndian)
      : encodeFixtureValues(entry, littleEndian);
    ifd.entries.push({ tag: entry.tag, type: entry.type, ...encoded });
  });
  return ifd;
}

function flattenIfds(ifd, result) {
  result.push(ifd);
  ifd.entries.forEach((entry) => {
    if (entry.child) flattenIfds(entry.child, result);
  });
}

function writeIfd(view, ifd, littleEndian, nextOffset) {
  view.setUint16(ifd.offset, ifd.entries.length, littleEndian);
  ifd.entries.forEach((entry, index) => {
    const offset = ifd.offset + 2 + index * 12;
    view.setUint16(offset, entry.tag, littleEndian);
    view.setUint16(offset + 2, entry.type, littleEndian);
    view.setUint32(offset + 4, entry.count, littleEndian);
    if (entry.bytes.length <= 4) {
      new Uint8Array(view.buffer, view.byteOffset + offset + 8, 4).set(entry.bytes);
    } else {
      view.setUint32(offset + 8, entry.valueOffset, littleEndian);
    }
  });
  view.setUint32(ifd.offset + 2 + ifd.entries.length * 12, nextOffset, littleEndian);
}

export function makeClassicGrayTiff({
  width = 2,
  height = 2,
  bitsPerSample = 8,
  photometric = 1,
  samplesPerPixel = 1,
  description,
  colorMap,
  pages = [[0, 64, 128, 255]],
  byteOrder = "II",
  metadataByPage = []
} = {}) {
  if (byteOrder !== "II" && byteOrder !== "MM") throw new Error(`Unsupported TIFF byte order ${byteOrder}`);

  const littleEndian = byteOrder === "II";
  const bytesPerSample = bitsPerSample / 8;
  const pageByteLength = width * height * samplesPerPixel * bytesPerSample;
  const bitsPerSampleValues = Array.from({ length: samplesPerPixel }, () => bitsPerSample);
  const roots = pages.map((_, pageIndex) => {
    const entries = [
      fixtureEntry(256, 4, [width], littleEndian),
      fixtureEntry(257, 4, [height], littleEndian),
      fixtureEntry(258, 3, bitsPerSampleValues, littleEndian),
      fixtureEntry(259, 3, [1], littleEndian),
      fixtureEntry(262, 3, [photometric], littleEndian),
      ...(description ? [asciiFixtureEntry(270, description, littleEndian)] : []),
      fixtureEntry(273, 4, [0], littleEndian),
      fixtureEntry(277, 3, [samplesPerPixel], littleEndian),
      fixtureEntry(278, 4, [height], littleEndian),
      fixtureEntry(279, 4, [pageByteLength], littleEndian),
      ...(samplesPerPixel > 1 ? [fixtureEntry(284, 3, [1], littleEndian)] : []),
      ...(colorMap ? [fixtureEntry(320, 3, colorMap, littleEndian)] : [])
    ];
    const metadataIfd = buildMetadataIfd(metadataByPage[pageIndex] ?? [], littleEndian);
    return { entries: [...entries, ...metadataIfd.entries] };
  });

  const ifds = [];
  roots.forEach((root) => flattenIfds(root, ifds));
  let nextOffset = 8;
  ifds.forEach((ifd) => {
    ifd.offset = nextOffset;
    nextOffset += 2 + ifd.entries.length * 12 + 4;
  });

  ifds.forEach((ifd) => {
    ifd.entries.forEach((entry) => {
      if (entry.child) entry.bytes = encodeFixtureValues({ type: entry.type, values: [entry.child.offset] }, littleEndian).bytes;
      if (entry.bytes.length > 4) {
        entry.valueOffset = nextOffset;
        nextOffset += entry.bytes.length;
      }
    });
  });

  const pixelStart = nextOffset;
  roots.forEach((root, pageIndex) => {
    const stripOffsetEntry = root.entries.find((entry) => entry.tag === 273);
    stripOffsetEntry.bytes = encodeFixtureValues({ type: 4, values: [pixelStart + pageIndex * pageByteLength] }, littleEndian).bytes;
  });

  const buffer = new ArrayBuffer(pixelStart + pages.length * pageByteLength);
  const view = new DataView(buffer);
  view.setUint8(0, byteOrder.charCodeAt(0));
  view.setUint8(1, byteOrder.charCodeAt(1));
  view.setUint16(2, 42, littleEndian);
  view.setUint32(4, roots[0]?.offset ?? 0, littleEndian);

  ifds.forEach((ifd) => {
    const rootIndex = roots.indexOf(ifd);
    const nextIfd = rootIndex >= 0 && rootIndex < roots.length - 1 ? roots[rootIndex + 1].offset : 0;
    writeIfd(view, ifd, littleEndian, nextIfd);
    ifd.entries.forEach((entry) => {
      if (entry.bytes.length > 4) new Uint8Array(buffer, entry.valueOffset, entry.bytes.length).set(entry.bytes);
    });
  });

  pages.forEach((page, pageIndex) => {
    const stripOffset = pixelStart + pageIndex * pageByteLength;
    if (bitsPerSample === 8) {
      new Uint8Array(buffer, stripOffset, pageByteLength).set(Uint8Array.from(page));
      return;
    }
    page.forEach((value, index) => view.setUint16(stripOffset + index * 2, value, littleEndian));
  });

  return buffer;
}

export function makeClassicRgbTiff(options = {}) {
  return makeClassicGrayTiff({
    photometric: 2,
    samplesPerPixel: 3,
    pages: [[255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 255]],
    ...options
  });
}

export function makeClassicPaletteTiff(options = {}) {
  const red = new Array(256).fill(0);
  const green = new Array(256).fill(0);
  const blue = new Array(256).fill(0);
  red[1] = 65535;
  green[2] = 65535;
  blue[3] = 65535;
  return makeClassicGrayTiff({
    bitsPerSample: 8,
    photometric: 3,
    colorMap: [...red, ...green, ...blue],
    pages: [[0, 1, 2, 3]],
    ...options
  });
}
