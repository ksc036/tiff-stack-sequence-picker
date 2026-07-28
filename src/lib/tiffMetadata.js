export const DEFAULT_TIFF_METADATA_LIMITS = Object.freeze({
  maxTagBytes: 16 * 1024 * 1024,
  maxFileMetadataBytes: 64 * 1024 * 1024,
  maxIfdDepth: 8
});

const TYPE_SIZES = new Map([
  [1, 1], [2, 1], [3, 2], [4, 4], [5, 8], [6, 1], [7, 1],
  [8, 2], [9, 4], [10, 8], [11, 4], [12, 8], [13, 4]
]);

const NESTED_IFD_POINTER_TAGS = new Set([330, 34665, 34853, 40965]);

function getView(input) {
  if (input instanceof ArrayBuffer) return new DataView(input);
  if (ArrayBuffer.isView(input)) return new DataView(input.buffer, input.byteOffset, input.byteLength);
  throw new Error("TIFF metadata data must be an ArrayBuffer or typed array");
}

function assertRange(view, offset, length, message) {
  if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || offset < 0 || length < 0 || offset > view.byteLength - length) {
    throw new Error(message);
  }
}

function validateLimits(limits, filename) {
  const resolved = { ...DEFAULT_TIFF_METADATA_LIMITS, ...limits };
  for (const [name, value] of Object.entries(resolved)) {
    if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${filename}: ${name} must be a non-negative integer`);
  }
  return resolved;
}

function readIfdInfo(view, offset, littleEndian, filename, stackNumber, pointerTag) {
  const ifdContext = Number.isInteger(pointerTag) ? `tag ${pointerTag} IFD` : "IFD";
  assertRange(view, offset, 2, `${filename}: stack ${stackNumber} ${ifdContext} points outside the TIFF file`);
  const entryCount = view.getUint16(offset, littleEndian);
  const byteLength = 2 + entryCount * 12 + 4;
  assertRange(view, offset, byteLength, `${filename}: stack ${stackNumber} ${ifdContext} extends outside the TIFF file`);
  return {
    entryCount,
    nextOffset: view.getUint32(offset + 2 + entryCount * 12, littleEndian)
  };
}

function decodeValues(view, valueOffset, type, count, littleEndian, rawBytes) {
  if (type === 2) return new TextDecoder("ascii").decode(rawBytes).replace(/\0+$/, "");

  const values = [];
  const typeSize = TYPE_SIZES.get(type);
  for (let index = 0; index < count; index += 1) {
    const offset = valueOffset + index * typeSize;
    switch (type) {
      case 1:
      case 7:
        values.push(view.getUint8(offset));
        break;
      case 3:
        values.push(view.getUint16(offset, littleEndian));
        break;
      case 4:
      case 13:
        values.push(view.getUint32(offset, littleEndian));
        break;
      case 5:
        values.push({
          numerator: view.getUint32(offset, littleEndian),
          denominator: view.getUint32(offset + 4, littleEndian)
        });
        break;
      case 6:
        values.push(view.getInt8(offset));
        break;
      case 8:
        values.push(view.getInt16(offset, littleEndian));
        break;
      case 9:
        values.push(view.getInt32(offset, littleEndian));
        break;
      case 10:
        values.push({
          numerator: view.getInt32(offset, littleEndian),
          denominator: view.getInt32(offset + 4, littleEndian)
        });
        break;
      case 11:
        values.push(view.getFloat32(offset, littleEndian));
        break;
      case 12:
        values.push(view.getFloat64(offset, littleEndian));
        break;
      default:
        throw new Error(`Unsupported TIFF field type ${type}`);
    }
  }
  return values;
}

function readEntry(view, entryOffset, littleEndian, filename, stackNumber, limits, capturedBytes) {
  const tag = view.getUint16(entryOffset, littleEndian);
  const type = view.getUint16(entryOffset + 2, littleEndian);
  const count = view.getUint32(entryOffset + 4, littleEndian);
  const typeSize = TYPE_SIZES.get(type);
  if (!typeSize) throw new Error(`${filename}: stack ${stackNumber} tag ${tag} has unsupported TIFF field type ${type}`);

  const byteLength = count * typeSize;
  if (!Number.isSafeInteger(byteLength)) throw new Error(`${filename}: stack ${stackNumber} tag ${tag} has an invalid value length`);
  if (byteLength > limits.maxTagBytes) {
    throw new Error(`${filename}: stack ${stackNumber} tag ${tag} exceeds the ${limits.maxTagBytes} bytes metadata limit`);
  }
  if (capturedBytes.value > limits.maxFileMetadataBytes - byteLength) {
    throw new Error(`${filename}: stack ${stackNumber} tag ${tag} exceeds the ${limits.maxFileMetadataBytes} bytes file metadata limit`);
  }

  const valueOffset = byteLength <= 4 ? entryOffset + 8 : view.getUint32(entryOffset + 8, littleEndian);
  assertRange(view, valueOffset, byteLength, `${filename}: stack ${stackNumber} tag ${tag} points outside the TIFF file`);
  const rawBytes = new Uint8Array(view.buffer, view.byteOffset + valueOffset, byteLength).slice();
  capturedBytes.value += byteLength;
  return { tag, type, count, values: decodeValues(view, valueOffset, type, count, littleEndian, rawBytes), rawBytes };
}

function readIfd(view, offset, littleEndian, filename, stackNumber, limits, capturedBytes, depth, activeOffsets, pointerTag) {
  if (depth > limits.maxIfdDepth) {
    throw new Error(`${filename}: stack ${stackNumber} exceeds nested IFD depth ${limits.maxIfdDepth} at tag ${pointerTag}`);
  }
  if (activeOffsets.has(offset)) {
    throw new Error(`${filename}: stack ${stackNumber} has a metadata IFD cycle at tag ${pointerTag}`);
  }

  const { entryCount } = readIfdInfo(view, offset, littleEndian, filename, stackNumber, pointerTag);
  const nextActiveOffsets = new Set(activeOffsets).add(offset);
  const entries = [];
  for (let index = 0; index < entryCount; index += 1) {
    const entryOffset = offset + 2 + index * 12;
    entries.push(readEntry(view, entryOffset, littleEndian, filename, stackNumber, limits, capturedBytes));
  }

  const nestedIfds = [];
  for (const entry of entries) {
    if (!NESTED_IFD_POINTER_TAGS.has(entry.tag)) continue;
    if (entry.type !== 4 && entry.type !== 13) {
      throw new Error(`${filename}: stack ${stackNumber} tag ${entry.tag} must use TIFF field type 4 or 13 for an IFD pointer`);
    }
    for (const childOffset of entry.values) {
      if (childOffset === 0) continue;
      nestedIfds.push({
        pointerTag: entry.tag,
        ifd: readIfd(
          view,
          childOffset,
          littleEndian,
          filename,
          stackNumber,
          limits,
          capturedBytes,
          depth + 1,
          nextActiveOffsets,
          entry.tag
        )
      });
    }
  }
  return { offset, entries, nestedIfds };
}

export function readClassicTiffMetadata(input, options = {}) {
  const { filename = "TIFF file", selectedStackNumber = 1, limits: requestedLimits } = options;
  const view = getView(input);
  const limits = validateLimits(requestedLimits, filename);
  assertRange(view, 0, 8, `${filename}: TIFF header is incomplete`);
  const byteOrder = String.fromCharCode(view.getUint8(0), view.getUint8(1));
  if (byteOrder !== "II" && byteOrder !== "MM") throw new Error(`${filename}: unsupported TIFF byte order`);
  const littleEndian = byteOrder === "II";
  if (view.getUint16(2, littleEndian) !== 42) throw new Error(`${filename}: not a classic TIFF file`);
  if (!Number.isInteger(selectedStackNumber) || selectedStackNumber < 1) {
    throw new Error(`${filename}: selected stack number must be a positive integer`);
  }

  let offset = view.getUint32(4, littleEndian);
  let firstOffset;
  let selectedOffset;
  const visitedOffsets = new Set();
  for (let stackNumber = 1; offset !== 0; stackNumber += 1) {
    if (visitedOffsets.has(offset)) throw new Error(`${filename}: cycle in top-level IFD chain at stack ${stackNumber}`);
    visitedOffsets.add(offset);
    const { nextOffset } = readIfdInfo(view, offset, littleEndian, filename, stackNumber);
    if (stackNumber === 1) firstOffset = offset;
    if (stackNumber === selectedStackNumber) {
      selectedOffset = offset;
      break;
    }
    offset = nextOffset;
  }
  if (selectedOffset === undefined) throw new Error(`${filename}: selected stack ${selectedStackNumber} does not exist`);

  const capturedBytes = { value: 0 };
  const firstIfd = readIfd(view, firstOffset, littleEndian, filename, 1, limits, capturedBytes, 0, new Set(), "first IFD");
  const selectedIfd = selectedOffset === firstOffset
    ? firstIfd
    : readIfd(view, selectedOffset, littleEndian, filename, selectedStackNumber, limits, capturedBytes, 0, new Set(), "selected IFD");
  return { byteOrder, firstIfd, selectedIfd };
}
