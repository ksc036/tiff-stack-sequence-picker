import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
    cleanup();
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

  it("does not confirm stale decoded TIFF state while the next file is still decoding", async () => {
    const good = fileHandle("a-good.tif", makeClassicGrayTiff());
    let delayedReadCount = 0;
    const delayed = {
      ...fileHandle("z-delayed.tif", makeClassicGrayTiff()),
      async getFile() {
        delayedReadCount += 1;
        if (delayedReadCount === 1) throw new Error("preload skipped");
        return new Promise(() => {});
      }
    };
    const dir = directoryHandle([good, delayed]);
    window.showDirectoryPicker = vi.fn(async () => dir);

    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: /open folder/i }));

    const confirm = await screen.findByRole("button", { name: /confirm/i });
    await waitFor(() => expect(confirm).toBeEnabled());

    fireEvent.click(confirm);

    expect(await screen.findByText(/z-delayed\.tif/i)).toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: /current frame/i })).getByText(/no frame loaded/i)).toBeInTheDocument();
    expect(confirm).toBeDisabled();

    fireEvent.click(confirm);

    expect(screen.queryByLabelText(/selected stack for z-delayed\.tif/i)).not.toBeInTheDocument();
    expect(dir.files.get("stack-selections.csv").writes[0]).toContain("a-good.tif,1,1");
    expect(dir.files.get("stack-selections.csv").writes[0]).not.toContain("z-delayed.tif");
  });

  it("does not reuse decoded state or cache entries across folders with the same TIFF filename", async () => {
    const folderAFile = fileHandle("same.tif", makeClassicGrayTiff({ pages: [[0, 0, 0, 0]] }));
    const folderBBuffer = makeClassicGrayTiff({
      pages: [
        [16, 16, 16, 16],
        [240, 240, 240, 240]
      ]
    });
    let folderBReadCount = 0;
    let finishFolderBDecode;
    const folderBFile = {
      ...fileHandle("same.tif", folderBBuffer),
      async getFile() {
        folderBReadCount += 1;
        if (folderBReadCount === 1) throw new Error("preload skipped");
        return new Promise((resolve) => {
          finishFolderBDecode = () =>
            resolve({
              arrayBuffer: async () => folderBBuffer,
              text: async () => ""
            });
        });
      }
    };
    const folderA = directoryHandle([folderAFile]);
    const folderB = directoryHandle([folderBFile]);
    window.showDirectoryPicker = vi.fn().mockResolvedValueOnce(folderA).mockResolvedValueOnce(folderB);

    render(<App />);

    const openFolder = screen.getByRole("button", { name: /open folder/i });
    fireEvent.click(openFolder);

    const confirm = await screen.findByRole("button", { name: /confirm/i });
    await waitFor(() => expect(confirm).toBeEnabled());

    fireEvent.click(confirm);

    await waitFor(() => expect(folderA.files.get("stack-selections.csv").writes[0]).toContain("same.tif,1,1"));

    fireEvent.click(openFolder);

    await waitFor(() => expect(openFolder).toBeEnabled());
    expect(confirm).toBeDisabled();
    fireEvent.click(confirm);
    expect(folderB.files.get("stack-selections.csv")).toBeUndefined();

    finishFolderBDecode();
    await waitFor(() => expect(screen.getByText("1 / 2")).toBeInTheDocument());
    expect(screen.queryByLabelText(/selected stack for same\.tif/i)).not.toBeInTheDocument();
    await waitFor(() => expect(confirm).toBeEnabled());

    fireEvent.click(confirm);

    await waitFor(() => expect(folderB.files.get("stack-selections.csv").writes[0]).toContain("same.tif,1,2"));
    expect(folderB.files.get("stack-selections.csv").writes[0]).not.toContain("same.tif,1,1");
  });
});
