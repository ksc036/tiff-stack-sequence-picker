function writeAscii(view, offset, text) {
  for (let index = 0; index < text.length; index += 1) {
    view.setUint8(offset + index, text.charCodeAt(index));
  }
}

function shortValue(value) {
  return { type: 3, count: 1, value };
}

function longValue(value) {
  return { type: 4, count: 1, value };
}

function writeEntry(view, offset, tag, entry) {
  view.setUint16(offset, tag, true);
  view.setUint16(offset + 2, entry.type, true);
  view.setUint32(offset + 4, entry.count, true);
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
  pages = [[0, 64, 128, 255]]
} = {}) {
  const bytesPerSample = bitsPerSample / 8;
  const pageByteLength = width * height * bytesPerSample;
  const entriesPerIfd = 9;
  const ifdByteLength = 2 + entriesPerIfd * 12 + 4;
  const pixelStart = 8 + pages.length * ifdByteLength;
  const totalLength = pixelStart + pages.length * pageByteLength;
  const buffer = new ArrayBuffer(totalLength);
  const view = new DataView(buffer);

  writeAscii(view, 0, "II");
  view.setUint16(2, 42, true);
  view.setUint32(4, 8, true);

  pages.forEach((page, pageIndex) => {
    const ifdOffset = 8 + pageIndex * ifdByteLength;
    const stripOffset = pixelStart + pageIndex * pageByteLength;
    view.setUint16(ifdOffset, entriesPerIfd, true);
    const entries = [
      [256, longValue(width)],
      [257, longValue(height)],
      [258, shortValue(bitsPerSample)],
      [259, shortValue(1)],
      [262, shortValue(photometric)],
      [273, longValue(stripOffset)],
      [277, shortValue(1)],
      [278, longValue(height)],
      [279, longValue(pageByteLength)]
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
