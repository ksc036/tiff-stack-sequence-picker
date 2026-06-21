import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App.jsx";
import { makeClassicGrayTiff } from "./lib/tiffTestFixtures.js";

function fileHandle(name, buffer, text = "") {
  const writes = [];
  return {
    kind: "file",
    name,
    writes,
    async getFile() {
      return {
        arrayBuffer: async () => buffer,
        text: async () => text
      };
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
  return {
    files,
    async *values() {
      for (const entry of entries) yield entry;
    },
    async getFileHandle(name, options = {}) {
      if (!files.has(name) && options.create) files.set(name, fileHandle(name, new ArrayBuffer(0)));
      if (!files.has(name)) throw new Error(`missing ${name}`);
      return files.get(name);
    },
    async getDirectoryHandle() {
      return directoryHandle();
    }
  };
}

describe("App", () => {
  let originalShowDirectoryPicker;
  let originalGetContext;
  let originalImageData;

  beforeEach(() => {
    originalShowDirectoryPicker = window.showDirectoryPicker;
    originalGetContext = HTMLCanvasElement.prototype.getContext;
    originalImageData = globalThis.ImageData;
    HTMLCanvasElement.prototype.getContext = vi.fn(() => ({ putImageData: vi.fn() }));
    globalThis.ImageData = class ImageData {
      constructor(data, width, height) {
        this.data = data;
        this.width = width;
        this.height = height;
      }
    };
  });

  afterEach(() => {
    window.showDirectoryPicker = originalShowDirectoryPicker;
    HTMLCanvasElement.prototype.getContext = originalGetContext;
    globalThis.ImageData = originalImageData;
    vi.restoreAllMocks();
  });

  it("does not allow a failed-decode TIFF to be confirmed from stale decoded state", async () => {
    const good = fileHandle("good.tif", makeClassicGrayTiff());
    const failed = fileHandle("malformed.tif", Uint8Array.from([1, 2, 3, 4]).buffer);
    const dir = directoryHandle([good, failed]);
    window.showDirectoryPicker = vi.fn(async () => dir);

    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: /open folder/i }));

    const confirm = await screen.findByRole("button", { name: /confirm/i });
    await waitFor(() => expect(confirm).toBeEnabled());

    fireEvent.click(confirm);

    await screen.findByText(/malformed\.tif/i);
    await waitFor(() => expect(screen.getByText(/malformed\.tif is not a classic TIFF file/i)).toBeInTheDocument());
    await waitFor(() => expect(confirm).toBeDisabled());

    fireEvent.click(confirm);

    expect(screen.queryByLabelText(/selected stack for malformed\.tif/i)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /build result/i })).toBeDisabled();
    expect(dir.files.get("stack-selections.csv").writes[0]).toContain("good.tif,1,1");
    expect(dir.files.get("stack-selections.csv").writes[0]).not.toContain("malformed.tif");
  });
});
