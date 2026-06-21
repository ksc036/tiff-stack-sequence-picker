const HEADER = "filename,selected_stack,stack_count";

function parseCsvLine(line) {
  const fields = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];
    if (quoted) {
      if (char === '"' && next === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      fields.push(field);
      field = "";
    } else {
      field += char;
    }
  }

  fields.push(field);
  return fields;
}

function escapeCsvField(value) {
  const text = String(value);
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function parsePositiveInteger(value, label) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1) {
    throw new Error(`${label} must be a positive integer`);
  }
  return number;
}

export function parseStackSelectionsCsv(text = "") {
  const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
  if (!normalized) return new Map();

  const [header, ...lines] = normalized.split("\n");
  if (header !== HEADER) {
    throw new Error(`Unexpected CSV header. Expected ${HEADER}`);
  }

  return lines.filter(Boolean).reduce((rows, line) => {
    const [filename, selectedStackValue, stackCountValue] = parseCsvLine(line);
    const selectedStack = parsePositiveInteger(selectedStackValue, "selected stack");
    const stackCount = parsePositiveInteger(stackCountValue, "stack count");
    if (selectedStack > stackCount) {
      throw new Error("selected stack cannot exceed stack count");
    }
    rows.set(filename, { filename, selectedStack, stackCount });
    return rows;
  }, new Map());
}

export function serializeStackSelectionsCsv(rows) {
  const body = [...rows.values()]
    .map((row) => {
      const selectedStack = parsePositiveInteger(row.selectedStack, "selected stack");
      const stackCount = parsePositiveInteger(row.stackCount, "stack count");
      if (selectedStack > stackCount) {
        throw new Error("selected stack cannot exceed stack count");
      }
      return [escapeCsvField(row.filename), selectedStack, stackCount].join(",");
    })
    .join("\n");

  return `${HEADER}\n${body}${body ? "\n" : ""}`;
}

export function setStackSelection(rows, filename, selectedStack, stackCount) {
  const nextSelectedStack = parsePositiveInteger(selectedStack, "selected stack");
  const nextStackCount = parsePositiveInteger(stackCount, "stack count");
  if (nextSelectedStack > nextStackCount) {
    throw new Error("selected stack cannot exceed stack count");
  }

  const next = new Map(rows);
  next.set(filename, { filename, selectedStack: nextSelectedStack, stackCount: nextStackCount });
  return next;
}
