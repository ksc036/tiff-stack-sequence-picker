export function supportsDirectoryPicker() {
  return typeof window !== "undefined" && "showDirectoryPicker" in window;
}

export async function chooseTiffDirectory() {
  if (!supportsDirectoryPicker()) {
    throw new Error("This browser does not support the File System Access API.");
  }
  return window.showDirectoryPicker({ mode: "readwrite" });
}

export async function listDirectTiffFiles(directoryHandle) {
  const files = [];
  for await (const entry of directoryHandle.values()) {
    if (entry.kind === "file" && /\.tiff?$/i.test(entry.name)) {
      files.push(entry);
    }
  }
  return files.sort((a, b) => a.name.localeCompare(b.name));
}

export async function readTextFile(directoryHandle, filename) {
  const fileHandle = await directoryHandle.getFileHandle(filename);
  const file = await fileHandle.getFile();
  return file.text();
}

export async function writeTextFile(directoryHandle, filename, text) {
  const fileHandle = await directoryHandle.getFileHandle(filename, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(text);
  await writable.close();
}

export async function writeBinaryFile(directoryHandle, filename, data) {
  const fileHandle = await directoryHandle.getFileHandle(filename, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(data);
  await writable.close();
}

export async function ensureResultDirectory(directoryHandle) {
  return directoryHandle.getDirectoryHandle("result", { create: true });
}
