const EMBEDDABLE_STANDARD_TAG_SCHEMAS = new Map([
  [269, { type: 2, count: "positive", valueKind: "ascii" }],
  [271, { type: 2, count: "positive", valueKind: "ascii" }],
  [272, { type: 2, count: "positive", valueKind: "ascii" }],
  [274, { type: 3, count: 1, valueKind: "orientation" }],
  [282, { type: 5, count: 1, valueKind: "rational" }],
  [283, { type: 5, count: 1, valueKind: "rational" }],
  [285, { type: 2, count: "positive", valueKind: "ascii" }],
  [286, { type: 5, count: 1, valueKind: "rational" }],
  [287, { type: 5, count: 1, valueKind: "rational" }],
  [296, { type: 3, count: 1, valueKind: "resolution-unit" }],
  [305, { type: 2, count: "positive", valueKind: "ascii" }],
  [306, { type: 2, count: "positive", valueKind: "ascii" }],
  [315, { type: 2, count: "positive", valueKind: "ascii" }],
  [316, { type: 2, count: "positive", valueKind: "ascii" }],
  [700, { type: 1, count: "positive", valueKind: "bytes" }],
  [33432, { type: 2, count: "positive", valueKind: "ascii" }],
  [34675, { type: 7, count: "positive", valueKind: "bytes" }]
]);

const IMAGE_DESCRIPTION_SCHEMA = {
  type: 2,
  count: "positive",
  valueKind: "ascii"
};

const FIRST_IFD_FALLBACK_TAGS = new Set([
  269, 271, 272, 305, 315, 316, 700, 33432
]);

const SOURCE_RELATIVE_POINTER_TAGS = new Set([330, 34665, 34853, 40965]);

const WRITER_OWNED_TAGS = new Set([
  256, 257, 258, 259, 262, 270, 273, 277, 278, 279,
  284, 320, 338, 339
]);

function compareEntries(left, right) {
  return left.tag - right.tag;
}

function compareStrings(left, right) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function compareClassifications(left, right) {
  return compareStrings(left.sourceIfd, right.sourceIfd) || left.tag - right.tag;
}

function getNestedEntries(ifd, sourceIfd) {
  return ifd.nestedIfds.flatMap(({ pointerTag, ifd: nestedIfd }) => [
    ...nestedIfd.entries.map((entry) => ({ entry, sourceIfd: `${sourceIfd}/${pointerTag}` })),
    ...getNestedEntries(nestedIfd, `${sourceIfd}/${pointerTag}`)
  ]);
}

function classifyNestedEntries(ifd, sourceIfd) {
  return getNestedEntries(ifd, sourceIfd).map(({ entry, sourceIfd: nestedSourceIfd }) => ({
    sourceIfd: nestedSourceIfd,
    tag: entry.tag,
    destination: "sidecar-only",
    reason: "nested-ifd"
  }));
}

function classifyRootEntry({ entry, sourceIfd, isSelected, selectedTags }) {
  if (SOURCE_RELATIVE_POINTER_TAGS.has(entry.tag)) {
    return {
      sourceIfd,
      tag: entry.tag,
      destination: "sidecar-only",
      reason: "source-relative-pointer"
    };
  }

  if (WRITER_OWNED_TAGS.has(entry.tag)) {
    return {
      sourceIfd,
      tag: entry.tag,
      destination: "regenerated",
      reason: "writer-owned-tag"
    };
  }

  if (EMBEDDABLE_STANDARD_TAG_SCHEMAS.has(entry.tag)) {
    if (!isSelected && selectedTags.has(entry.tag)) {
      return {
        sourceIfd,
        tag: entry.tag,
        destination: "sidecar-only",
        reason: "shadowed-by-selected-ifd"
      };
    }
    if (!isSelected && !FIRST_IFD_FALLBACK_TAGS.has(entry.tag)) {
      return {
        sourceIfd,
        tag: entry.tag,
        destination: "sidecar-only",
        reason: "not-file-level-fallback"
      };
    }
    return {
      sourceIfd,
      tag: entry.tag,
      destination: "embedded",
      reason: "safe-standard-tag"
    };
  }

  return {
    sourceIfd,
    tag: entry.tag,
    destination: "sidecar-only",
    reason: "not-embeddable"
  };
}

function validationError(entry, context, detail) {
  return new Error(
    `${context.filename}: stack ${context.selectedStack} tag ${entry.tag} ${detail}`
  );
}

function validateDecodedCount(entry, context) {
  if (!Array.isArray(entry.values) || entry.values.length !== entry.count) {
    throw validationError(entry, context, `decoded values must match count ${entry.count}`);
  }
}

function validateByteValues(entry, context) {
  validateDecodedCount(entry, context);
  if (!entry.values.every((value) => Number.isInteger(value) && value >= 0 && value <= 0xff)) {
    throw validationError(entry, context, "must contain unsigned byte values");
  }
}

function validateRecognizedEntry(entry, schema, context) {
  if (entry.type !== schema.type) {
    throw validationError(entry, context, `must use TIFF field type ${schema.type}`);
  }
  if (schema.count === "positive") {
    if (!Number.isSafeInteger(entry.count) || entry.count <= 0) {
      throw validationError(entry, context, "must have a positive count");
    }
  } else if (entry.count !== schema.count) {
    throw validationError(entry, context, `must have count ${schema.count}`);
  }

  if (schema.valueKind === "ascii") {
    if (typeof entry.values !== "string") {
      throw validationError(entry, context, "must contain an ASCII string");
    }
    return;
  }
  if (schema.valueKind === "bytes") {
    validateByteValues(entry, context);
    return;
  }

  validateDecodedCount(entry, context);
  const value = entry.values[0];
  if (schema.valueKind === "orientation") {
    if (!Number.isInteger(value) || value < 1 || value > 8) {
      throw validationError(entry, context, "must contain an integer from 1 through 8");
    }
    return;
  }
  if (schema.valueKind === "resolution-unit") {
    if (!Number.isInteger(value) || ![1, 2, 3].includes(value)) {
      throw validationError(entry, context, "must contain 1, 2, or 3");
    }
    return;
  }
  if (
    !value
    || !Number.isInteger(value.numerator)
    || !Number.isInteger(value.denominator)
  ) {
    throw validationError(entry, context, "must contain one unsigned rational value");
  }
  if (value.denominator === 0) {
    throw validationError(entry, context, "must have a nonzero denominator");
  }
}

function validateRecognizedEntries(entries, context) {
  for (const entry of entries) {
    const schema = entry.tag === 270
      ? IMAGE_DESCRIPTION_SCHEMA
      : EMBEDDABLE_STANDARD_TAG_SCHEMAS.get(entry.tag);
    if (schema) validateRecognizedEntry(entry, schema, context);
  }
}

function normalizeDecodedValue(value) {
  if (typeof value === "number") {
    if (Number.isNaN(value)) return "NaN";
    if (value === Number.POSITIVE_INFINITY) return "Infinity";
    if (value === Number.NEGATIVE_INFINITY) return "-Infinity";
    return value;
  }
  if (Array.isArray(value)) return value.map(normalizeDecodedValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, childValue]) => [key, normalizeDecodedValue(childValue)])
    );
  }
  return value;
}

function bytesToBase64(bytes) {
  const parts = [];
  const chunkSize = 24_576;
  for (let start = 0; start < bytes.length; start += chunkSize) {
    let binary = "";
    for (const byte of bytes.subarray(start, start + chunkSize)) {
      binary += String.fromCharCode(byte);
    }
    parts.push(btoa(binary));
  }
  return parts.join("");
}

function serializeEntry(entry) {
  return {
    tag: entry.tag,
    type: entry.type,
    count: entry.count,
    values: normalizeDecodedValue(entry.values),
    rawValueBase64: bytesToBase64(entry.rawBytes)
  };
}

function serializeIfd(ifd) {
  return {
    offset: ifd.offset,
    entries: [...ifd.entries].sort(compareEntries).map(serializeEntry),
    nestedIfds: [...ifd.nestedIfds]
      .sort((left, right) => left.pointerTag - right.pointerTag || left.ifd.offset - right.ifd.offset)
      .map(({ pointerTag, ifd: nestedIfd }) => ({ pointerTag, ifd: serializeIfd(nestedIfd) }))
  };
}

function comparePageRecords(left, right) {
  return compareStrings(left.source.filename, right.source.filename) || left.outputPage - right.outputPage;
}

function serializePageRecord(pageRecord) {
  return {
    outputPage: pageRecord.outputPage,
    source: { ...pageRecord.source },
    firstIfd: serializeIfd(pageRecord.firstIfd),
    selectedIfd: serializeIfd(pageRecord.selectedIfd),
    tagClassifications: [...pageRecord.tagClassifications].sort(compareClassifications)
  };
}

export function classifyResultPageMetadata({
  metadata,
  filename,
  selectedStack,
  stackCount,
  outputPage
}) {
  const validationContext = { filename, selectedStack };
  validateRecognizedEntries(metadata.firstIfd.entries, validationContext);
  if (metadata.selectedIfd !== metadata.firstIfd) {
    validateRecognizedEntries(metadata.selectedIfd.entries, validationContext);
  }

  const selectedTags = new Set(metadata.selectedIfd.entries.map((entry) => entry.tag));
  const firstClassifications = metadata.firstIfd.entries.map((entry) => classifyRootEntry({
    entry,
    sourceIfd: "first",
    isSelected: false,
    selectedTags
  }));
  const selectedClassifications = metadata.selectedIfd.entries.map((entry) => classifyRootEntry({
    entry,
    sourceIfd: "selected",
    isSelected: true,
    selectedTags
  }));
  const embeddedEntries = [
    ...metadata.firstIfd.entries.filter((entry) =>
      FIRST_IFD_FALLBACK_TAGS.has(entry.tag) && !selectedTags.has(entry.tag)
    ),
    ...metadata.selectedIfd.entries.filter((entry) =>
      EMBEDDABLE_STANDARD_TAG_SCHEMAS.has(entry.tag)
    )
  ].sort(compareEntries);

  return {
    embeddedEntries,
    sourceRecord: {
      outputPage,
      source: {
        filename,
        stackNumber: selectedStack,
        stackCount,
        byteOrder: metadata.byteOrder
      },
      firstIfd: metadata.firstIfd,
      selectedIfd: metadata.selectedIfd,
      tagClassifications: [
        ...firstClassifications,
        ...classifyNestedEntries(metadata.firstIfd, "first"),
        ...selectedClassifications,
        ...classifyNestedEntries(metadata.selectedIfd, "selected")
      ].sort(compareClassifications)
    }
  };
}

export function serializeSourceMetadataJson({ tiffFilename, pageRecords }) {
  const sidecar = {
    schemaVersion: 1,
    output: {
      tiffFilename,
      pageCount: pageRecords.length,
      ordering: "filename-ascending"
    },
    pages: [...pageRecords].sort(comparePageRecords).map(serializePageRecord)
  };
  return `${JSON.stringify(sidecar, null, 2)}\n`;
}
