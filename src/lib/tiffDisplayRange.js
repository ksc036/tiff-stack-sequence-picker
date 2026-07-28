export function parseImageJDisplayRange(description) {
  if (!description) return null;

  const minMatch = description.match(/(?:^|\n)\s*min\s*=\s*([-+]?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?)/);
  const maxMatch = description.match(/(?:^|\n)\s*max\s*=\s*([-+]?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?)/);
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
