const EMBEDDED_STANDARD_TAGS = new Set([
  269, 271, 272, 274, 282, 283, 285, 286, 287, 296,
  305, 306, 315, 316, 33432, 34675, 700
]);

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
  if (WRITER_OWNED_TAGS.has(entry.tag)) {
    return {
      sourceIfd,
      tag: entry.tag,
      destination: "regenerated",
      reason: "writer-owned-tag"
    };
  }

  if (EMBEDDED_STANDARD_TAGS.has(entry.tag)) {
    if (!isSelected && selectedTags.has(entry.tag)) {
      return {
        sourceIfd,
        tag: entry.tag,
        destination: "sidecar-only",
        reason: "shadowed-by-selected-ifd"
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
      EMBEDDED_STANDARD_TAGS.has(entry.tag) && !selectedTags.has(entry.tag)
    ),
    ...metadata.selectedIfd.entries.filter((entry) => EMBEDDED_STANDARD_TAGS.has(entry.tag))
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
