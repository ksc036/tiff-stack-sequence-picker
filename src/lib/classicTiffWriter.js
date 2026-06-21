function writeAscii(view, offset, text) {
  for (let index = 0; index < text.length; index += 1) {
    view.setUint8(offset + index, text.charCodeAt(index));
  }
}

function writeEntry(view, offset, tag, type, count, value) {
  view.setUint16(offset, tag, true);
  view.setUint16(offset + 2, type, true);
  view.setUint32(offset + 4, count, true);
  if (type === 3 && count === 1) {
    view.setUint16(offset + 8, value, true);
    view.setUint16(offset + 10, 0, true);
  } else {
    view.setUint32(offset + 8, value, true);
  }
}

function assertPageShape(page) {
  if (page.samplesPerPixel !== 1) throw new Error("Result TIFF supports grayscale pages only");
  if (page.bitsPerSample !== 8 && page.bitsPerSample !== 16) {
    throw new Error("Result TIFF supports only 8-bit or 16-bit grayscale pages");
  }
  if (page.photometric !== 0 && page.photometric !== 1) {
    throw new Error("Result TIFF supports photometric interpretation 0 or 1 only");
  }
}

function pageBytes(page) {
  const expectedSamples = page.width * page.height;
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
  const entriesPerIfd = 9;
  const ifdByteLength = 2 + entriesPerIfd * 12 + 4;
  const pixelStart = 8 + pages.length * ifdByteLength;
  const totalPixelBytes = pixelPages.reduce((sum, bytes) => sum + bytes.byteLength, 0);
  const buffer = new ArrayBuffer(pixelStart + totalPixelBytes);
  const view = new DataView(buffer);

  writeAscii(view, 0, "II");
  view.setUint16(2, 42, true);
  view.setUint32(4, 8, true);

  let stripOffset = pixelStart;
  pages.forEach((page, pageIndex) => {
    const ifdOffset = 8 + pageIndex * ifdByteLength;
    const stripByteCount = pixelPages[pageIndex].byteLength;
    const entries = [
      [256, 4, 1, page.width],
      [257, 4, 1, page.height],
      [258, 3, 1, page.bitsPerSample],
      [259, 3, 1, 1],
      [262, 3, 1, page.photometric],
      [273, 4, 1, stripOffset],
      [277, 3, 1, 1],
      [278, 4, 1, page.height],
      [279, 4, 1, stripByteCount]
    ];

    view.setUint16(ifdOffset, entries.length, true);
    entries.forEach(([tag, type, count, value], entryIndex) => {
      writeEntry(view, ifdOffset + 2 + entryIndex * 12, tag, type, count, value);
    });
    const nextIfdOffset = pageIndex === pages.length - 1 ? 0 : ifdOffset + ifdByteLength;
    view.setUint32(ifdOffset + 2 + entries.length * 12, nextIfdOffset, true);

    new Uint8Array(buffer, stripOffset, stripByteCount).set(pixelPages[pageIndex]);
    stripOffset += stripByteCount;
  });

  return new Uint8Array(buffer);
}
