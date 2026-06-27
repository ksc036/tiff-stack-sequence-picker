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
    async getDirectoryHandle(name, options = {}) {
      if (!files.has(name) && options.create) files.set(name, directoryHandle());
      if (!files.has(name)) throw new Error(`missing ${name}`);
      return files.get(name);
    }
  };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
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
    expect(screen.getByRole("button", { name: /build result/i })).toBeEnabled();
    expect(dir.files.get("stack-selections.csv").writes[0]).toContain("good.tif,1,1");
    expect(dir.files.get("stack-selections.csv").writes[0]).not.toContain("malformed.tif");
  });

  it("does not preload every TIFF when opening a folder", async () => {
    let firstReadCount = 0;
    let secondReadCount = 0;
    const firstBuffer = makeClassicGrayTiff();
    const first = {
      ...fileHandle("a-current.tif", firstBuffer),
      async getFile() {
        firstReadCount += 1;
        return {
          arrayBuffer: async () => firstBuffer,
          text: async () => ""
        };
      }
    };
    const second = {
      ...fileHandle("b-large.tif", makeClassicGrayTiff()),
      async getFile() {
        secondReadCount += 1;
        throw new Error("large TIFF should not be read during folder open");
      }
    };
    const dir = directoryHandle([first, second]);
    window.showDirectoryPicker = vi.fn(async () => dir);

    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: /open folder/i }));

    await screen.findByText(/Loaded 2 TIFF frames/i);
    await waitFor(() => expect(screen.getByText("1 / 1")).toBeInTheDocument());

    expect(firstReadCount).toBe(1);
    expect(secondReadCount).toBe(0);
  });

  it("does not confirm stale decoded TIFF state while the next file is still decoding", async () => {
    const good = fileHandle("a-good.tif", makeClassicGrayTiff());
    const delayed = {
      ...fileHandle("z-delayed.tif", makeClassicGrayTiff()),
      async getFile() {
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
    let finishFolderBDecode;
    const folderBFile = {
      ...fileHandle("same.tif", folderBBuffer),
      async getFile() {
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

  it("clears old folder state and keeps actions disabled while the next folder is still listing", async () => {
    const folderAFile = fileHandle("folder-a.tif", makeClassicGrayTiff());
    const folderBFile = fileHandle("folder-b.tif", makeClassicGrayTiff());
    const folderA = directoryHandle([folderAFile]);
    const listingStarted = deferred();
    const finishListing = deferred();
    const folderB = {
      ...directoryHandle([folderBFile]),
      async *values() {
        listingStarted.resolve();
        await finishListing.promise;
        yield folderBFile;
      }
    };
    window.showDirectoryPicker = vi.fn().mockResolvedValueOnce(folderA).mockResolvedValueOnce(folderB);

    render(<App />);

    const openFolder = screen.getByRole("button", { name: /open folder/i });
    fireEvent.click(openFolder);

    const confirm = await screen.findByRole("button", { name: /confirm/i });
    await waitFor(() => expect(confirm).toBeEnabled());

    fireEvent.click(confirm);
    await waitFor(() => expect(screen.getByRole("button", { name: /build result/i })).toBeEnabled());

    fireEvent.click(openFolder);
    await listingStarted.promise;

    await waitFor(() => expect(screen.queryByText("folder-a.tif")).not.toBeInTheDocument());
    expect(confirm).toBeDisabled();
    expect(screen.getByRole("button", { name: /build result/i })).toBeDisabled();
    fireEvent.click(confirm);
    fireEvent.click(screen.getByRole("button", { name: /build result/i }));
    expect(folderA.files.get("stack-selections.csv").writes).toHaveLength(2);
    expect(folderB.files.get("stack-selections.csv")).toBeUndefined();

    finishListing.resolve();
    await screen.findByText("folder-b.tif");
    await waitFor(() => expect(confirm).toBeEnabled());

    fireEvent.click(confirm);
    await waitFor(() => expect(folderB.files.get("stack-selections.csv").writes[0]).toContain("folder-b.tif,1,1"));
  });

  it("allows building a result from a partial selection", async () => {
    const selected = fileHandle("a-selected.tif", makeClassicGrayTiff({ pages: [[1, 2, 3, 4]] }));
    const skipped = {
      ...fileHandle("b-skipped.tif", makeClassicGrayTiff({ pages: [[9, 9, 9, 9]] })),
      async getFile() {
        throw new Error("unselected TIFF should not be read by build");
      }
    };
    const dir = directoryHandle([selected, skipped]);
    window.showDirectoryPicker = vi.fn(async () => dir);

    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: /open folder/i }));

    const confirm = await screen.findByRole("button", { name: /confirm/i });
    await waitFor(() => expect(confirm).toBeEnabled());
    fireEvent.click(confirm);

    const build = screen.getByRole("button", { name: /build result/i });
    await waitFor(() => expect(build).toBeEnabled());
    fireEvent.click(build);

    await waitFor(() =>
      expect(screen.getByText(/Built result\/selected-stack-sequence\.tif.*with 1 pages/i)).toBeInTheDocument()
    );
    const resultDir = dir.files.get("result");
    expect(resultDir.files.get("stack-selections.csv").writes[0]).toBe(
      "filename,selected_stack,stack_count\na-selected.tif,1,1\n"
    );
  });
});
