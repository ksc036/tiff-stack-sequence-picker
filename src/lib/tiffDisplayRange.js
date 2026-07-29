const IMAGEJ_NUMBER_PATTERN = "[-+]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:[eE][-+]?\\d+)?";

function matchNumericLine(description, name) {
  return description.match(
    new RegExp(`^[\\t ]*${name}[\\t ]*=[\\t ]*(${IMAGEJ_NUMBER_PATTERN})[\\t ]*\\r?$`, "m")
  );
}

export function parseImageJDisplayRange(description) {
  if (!description) return null;

  const minMatch = matchNumericLine(description, "min");
  const maxMatch = matchNumericLine(description, "max");
  const min = Number(minMatch?.[1]);
  const max = Number(maxMatch?.[1]);

  if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) return null;
  return { min, max };
}

export function formatImageJDisplayRange(range) {
  const lines = ["ImageJ=1.53e"];
  if (range) {
    lines.push(`min=${range.min}`, `max=${range.max}`);
  }
  return lines.join("\n");
}

export function formatImageJResultDescription({
  range,
  pageCount,
  includeSequenceShape
}) {
  const lines = ["ImageJ=1.53e"];
  if (includeSequenceShape) {
    lines.push(
      `images=${pageCount}`,
      "channels=1",
      "slices=1",
      `frames=${pageCount}`,
      "hyperstack=true"
    );
  }
  if (range) {
    lines.push(`min=${range.min}`, `max=${range.max}`);
  }
  return lines.join("\n");
}
