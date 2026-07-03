function numberHeader(headers, name) {
  const value = Number(headers.get(name));
  if (!Number.isFinite(value)) throw new Error(`Raw16 response is missing ${name}`);
  return value;
}

function contentTypeFor(file) {
  return file?.type || "image/tiff";
}

export async function fetchRaw16TiffPage(file, stackNumber) {
  if (!file) throw new Error("A TIFF file is required");

  const response = await fetch(`/api/tiff/raw16?stackNumber=${encodeURIComponent(stackNumber)}`, {
    method: "POST",
    headers: { "Content-Type": contentTypeFor(file) },
    body: file
  });

  if (!response.ok) {
    let message = "Failed to read TIFF raw16 data";
    try {
      const body = await response.json();
      if (body?.error) message = body.error;
    } catch {
      try {
        const text = await response.text();
        if (text) message = text;
      } catch {
        // Keep the default message when the response body cannot be read.
      }
    }
    throw new Error(message);
  }

  const buffer = await response.arrayBuffer();
  const pixels = new Uint16Array(buffer);
  const width = numberHeader(response.headers, "x-image-width");
  const height = numberHeader(response.headers, "x-image-height");
  const stackCount = numberHeader(response.headers, "x-stack-count");
  const selectedStackNumber = numberHeader(response.headers, "x-stack-number");
  const displayMin = numberHeader(response.headers, "x-display-min");
  const displayMax = numberHeader(response.headers, "x-display-max");

  return {
    filename: file.name,
    stackCount,
    page: {
      filename: file.name,
      width,
      height,
      bitsPerSample: 16,
      samplesPerPixel: 1,
      photometric: 1,
      stackNumber: selectedStackNumber,
      displayMin,
      displayMax,
      pixelFormat: response.headers.get("x-pixel-format") || "uint16le",
      pixels
    }
  };
}
