function writeAscii(view, offset, text) {
  for (let index = 0; index < text.length; index += 1) {
    view.setUint8(offset + index, text.charCodeAt(index));
  }
}

function shortValue(value) {
  return { type: 3, count: 1, value };
}

function shortArrayValue(values, valueOffset) {
  if (values.length === 1) return shortValue(values[0]);
  if (values.length * 2 <= 4) {
    const inlineBytes = [];
    values.forEach((value) => {
      inlineBytes.push(value & 0xff, value >> 8);
    });
    return { type: 3, count: values.length, inlineBytes };
  }
  return { type: 3, count: values.length, value: valueOffset };
}

function longValue(value) {
  return { type: 4, count: 1, value };
}

function asciiInlineValue(value) {
  const text = value.endsWith("\0") ? value : `${value}\0`;
  if (text.length > 4) throw new Error("Test ASCII fixture values must fit inline");
  return {
    type: 2,
    count: text.length,
    inlineBytes: Array.from(text, (character) => character.charCodeAt(0))
  };
}

function writeEntry(view, offset, tag, entry) {
  view.setUint16(offset, tag, true);
  view.setUint16(offset + 2, entry.type, true);
  view.setUint32(offset + 4, entry.count, true);
  if (entry.inlineBytes) {
    for (let index = 0; index < 4; index += 1) {
      view.setUint8(offset + 8 + index, entry.inlineBytes[index] ?? 0);
    }
    return;
  }
  if (entry.type === 3 && entry.count === 1) {
    view.setUint16(offset + 8, entry.value, true);
    view.setUint16(offset + 10, 0, true);
  } else {
    view.setUint32(offset + 8, entry.value, true);
  }
}

export function makeClassicGrayTiff({
  width = 2,
  height = 2,
  bitsPerSample = 8,
  photometric = 1,
  samplesPerPixel = 1,
  description,
  colorMap,
  pages = [[0, 64, 128, 255]]
} = {}) {
  const bytesPerSample = bitsPerSample / 8;
  const pageByteLength = width * height * samplesPerPixel * bytesPerSample;
  const bitsPerSampleValues = Array.from({ length: samplesPerPixel }, () => bitsPerSample);
  const bitsPerSampleExtraLength = bitsPerSampleValues.length * 2 > 4 ? bitsPerSampleValues.length * 2 : 0;
  const colorMapExtraLength = colorMap ? colorMap.length * 2 : 0;
  const perPageExtraLength = bitsPerSampleExtraLength + colorMapExtraLength;
  const entriesPerIfd = 9 + (description ? 1 : 0) + (samplesPerPixel > 1 ? 1 : 0) + (colorMap ? 1 : 0);
  const ifdByteLength = 2 + entriesPerIfd * 12 + 4;
  const extraStart = 8 + pages.length * ifdByteLength;
  const pixelStart = extraStart + pages.length * perPageExtraLength;
  const totalLength = pixelStart + pages.length * pageByteLength;
  const buffer = new ArrayBuffer(totalLength);
  const view = new DataView(buffer);

  writeAscii(view, 0, "II");
  view.setUint16(2, 42, true);
  view.setUint32(4, 8, true);

  pages.forEach((page, pageIndex) => {
    const ifdOffset = 8 + pageIndex * ifdByteLength;
    const bitsPerSampleOffset = extraStart + pageIndex * perPageExtraLength;
    const colorMapOffset = bitsPerSampleOffset + bitsPerSampleExtraLength;
    const stripOffset = pixelStart + pageIndex * pageByteLength;
    view.setUint16(ifdOffset, entriesPerIfd, true);
    if (bitsPerSampleExtraLength) {
      bitsPerSampleValues.forEach((value, index) => {
        view.setUint16(bitsPerSampleOffset + index * 2, value, true);
      });
    }
    if (colorMapExtraLength) {
      colorMap.forEach((value, index) => {
        view.setUint16(colorMapOffset + index * 2, value, true);
      });
    }
    const entries = [
      [256, longValue(width)],
      [257, longValue(height)],
      [258, shortArrayValue(bitsPerSampleValues, bitsPerSampleOffset)],
      [259, shortValue(1)],
      [262, shortValue(photometric)],
      ...(description ? [[270, asciiInlineValue(description)]] : []),
      [273, longValue(stripOffset)],
      [277, shortValue(samplesPerPixel)],
      [278, longValue(height)],
      [279, longValue(pageByteLength)],
      ...(samplesPerPixel > 1 ? [[284, shortValue(1)]] : []),
      ...(colorMap ? [[320, { type: 3, count: colorMap.length, value: colorMapOffset }]] : [])
    ];
    entries.forEach(([tag, entry], entryIndex) => {
      writeEntry(view, ifdOffset + 2 + entryIndex * 12, tag, entry);
    });
    const nextOffset = pageIndex === pages.length - 1 ? 0 : ifdOffset + ifdByteLength;
    view.setUint32(ifdOffset + 2 + entriesPerIfd * 12, nextOffset, true);

    if (bitsPerSample === 8) {
      new Uint8Array(buffer, stripOffset, pageByteLength).set(Uint8Array.from(page));
    } else {
      page.forEach((value, index) => view.setUint16(stripOffset + index * 2, value, true));
    }
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
