import { describe, expect, it, vi } from "vitest";
import {
  ensureResultDirectory,
  listDirectTiffFiles,
  readTextFile,
  supportsDirectoryPicker,
  writeBinaryFile,
  writeTextFile
} from "./localTiffDirectory.js";

function fileHandle(name, text = "") {
  const writes = [];
  return {
    kind: "file",
    name,
    writes,
    async getFile() {
      return { text: async () => text, arrayBuffer: async () => new ArrayBuffer(0) };
    },
    async createWritable() {
      return {
        async write(value) {
          writes.push(value);
        },
        async close() {
          writes.push("__closed__");
        }
      };
    }
  };
}

function directoryHandle(entries = []) {
  const files = new Map(entries.map((entry) => [entry.name, entry]));
  const directories = new Map();
  return {
    files,
    directories,
    async *values() {
      for (const entry of entries) yield entry;
    },
    async getFileHandle(name, options = {}) {
      if (!files.has(name) && options.create) files.set(name, fileHandle(name));
      if (!files.has(name)) throw new Error(`missing ${name}`);
      return files.get(name);
    },
    async getDirectoryHandle(name, options = {}) {
      if (!directories.has(name) && options.create) directories.set(name, directoryHandle());
      if (!directories.has(name)) throw new Error(`missing ${name}`);
      return directories.get(name);
    }
  };
}

describe("local TIFF directory helpers", () => {
  it("detects File System Access API support", () => {
    const original = window.showDirectoryPicker;
    delete window.showDirectoryPicker;
    expect(supportsDirectoryPicker()).toBe(false);
    window.showDirectoryPicker = vi.fn();
    expect(supportsDirectoryPicker()).toBe(true);
    window.showDirectoryPicker = original;
  });

  it("lists only direct TIFF file handles sorted by filename", async () => {
    const nested = { kind: "directory", name: "nested" };
    const dir = directoryHandle([
      fileHandle("z.tiff"),
      fileHandle("notes.txt"),
      fileHandle("A.TIF"),
      nested,
      fileHandle("m.tif")
    ]);

    const files = await listDirectTiffFiles(dir);

    expect(files.map((file) => file.name)).toEqual(["A.TIF", "m.tif", "z.tiff"]);
  });

  it("reads and writes files through directory handles", async () => {
    const existing = fileHandle("stack-selections.csv", "filename,selected_stack,stack_count\n");
    const dir = directoryHandle([existing]);

    await expect(readTextFile(dir, "stack-selections.csv")).resolves.toContain("filename");
    await writeTextFile(dir, "stack-selections.csv", "next");
    await writeBinaryFile(dir, "out.tif", new Uint8Array([1, 2, 3]));

    expect(existing.writes).toEqual(["next", "__closed__"]);
    expect(dir.files.get("out.tif").writes[0]).toEqual(new Uint8Array([1, 2, 3]));
  });

  it("creates a result directory when needed", async () => {
    const dir = directoryHandle();

    await expect(ensureResultDirectory(dir)).resolves.toHaveProperty("files");
    expect(dir.directories.has("result")).toBe(true);
  });
});
