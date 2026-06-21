import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Check,
  ChevronLeft,
  ChevronRight,
  FolderOpen,
  Hammer,
  Save
} from "lucide-react";
import {
  chooseTiffDirectory,
  listDirectTiffFiles,
  readTextFile,
  supportsDirectoryPicker,
  writeTextFile
} from "./lib/localTiffDirectory.js";
import { buildResultSequence } from "./lib/resultSequence.js";
import {
  parseStackSelectionsCsv,
  restoreStackSelectionsForLoadedTiffs,
  serializeStackSelectionsCsv,
  setStackSelection
} from "./lib/stackSelections.js";
import { decodeTiffStack, normalizeGrayPageToRgba } from "./lib/tiffStack.js";

const CSV_NAME = "stack-selections.csv";

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function sortedSelectionRows(rows) {
  return new Map([...rows.entries()].sort(([a], [b]) => a.localeCompare(b)));
}

function statusText(kind, text) {
  return { kind, text };
}

function TiffCanvas({ title, subtitle, page }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    if (!page || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const context = canvas.getContext("2d");
    canvas.width = page.width;
    canvas.height = page.height;
    const imageData = new ImageData(normalizeGrayPageToRgba(page), page.width, page.height);
    context.putImageData(imageData, 0, 0);
  }, [page]);

  return (
    <section className="viewer-pane" aria-label={title}>
      <div className="viewer-header">
        <div>
          <h2>{title}</h2>
          <p>{subtitle}</p>
        </div>
        {page ? (
          <span className="meta-chip">
            {page.width} x {page.height} / {page.bitsPerSample}-bit
          </span>
        ) : null}
      </div>
      <div className="canvas-stage">
        {page ? <canvas ref={canvasRef} aria-label={`${title} TIFF preview`} /> : <p>No frame loaded</p>}
      </div>
    </section>
  );
}

export default function App() {
  const [directoryHandle, setDirectoryHandle] = useState(null);
  const [files, setFiles] = useState([]);
  const [selections, setSelections] = useState(new Map());
  const [currentIndex, setCurrentIndex] = useState(0);
  const [currentStack, setCurrentStack] = useState(1);
  const [currentTiff, setCurrentTiff] = useState(null);
  const [previousPage, setPreviousPage] = useState(null);
  const [status, setStatus] = useState(statusText("idle", "Choose a folder of TIFF frames."));
  const [busy, setBusy] = useState(false);
  const [building, setBuilding] = useState(false);
  const stackCache = useRef(new Map());

  const currentFile = files[currentIndex] ?? null;
  const currentPage = currentTiff?.pages[currentStack - 1] ?? null;
  const currentSelection = currentFile ? selections.get(currentFile.name) : null;
  const selectedCount = files.filter((file) => selections.has(file.name)).length;
  const allSelected = files.length > 0 && selectedCount === files.length;

  const progress = useMemo(() => {
    if (files.length === 0) return 0;
    return Math.round((selectedCount / files.length) * 100);
  }, [files.length, selectedCount]);

  const loadStack = useCallback(async (fileHandle) => {
    if (!fileHandle) return null;
    if (stackCache.current.has(fileHandle.name)) return stackCache.current.get(fileHandle.name);

    const file = await fileHandle.getFile();
    const stack = decodeTiffStack(await file.arrayBuffer(), fileHandle.name);
    stackCache.current.set(fileHandle.name, stack);
    return stack;
  }, []);

  const persistSelections = useCallback(
    async (rows) => {
      if (!directoryHandle) return;
      await writeTextFile(directoryHandle, CSV_NAME, serializeStackSelectionsCsv(sortedSelectionRows(rows)));
    },
    [directoryHandle]
  );

  useEffect(() => {
    let cancelled = false;

    async function loadCurrentFrame() {
      if (!currentFile) {
        setCurrentTiff(null);
        setPreviousPage(null);
        return;
      }

      setBusy(true);
      try {
        const stack = await loadStack(currentFile);
        if (cancelled) return;

        setCurrentTiff(stack);
        const saved = selections.get(currentFile.name)?.selectedStack;
        const previousSaved =
          currentIndex > 0 ? selections.get(files[currentIndex - 1]?.name)?.selectedStack : undefined;
        setCurrentStack(clamp(saved ?? previousSaved ?? 1, 1, stack.stackCount));

        const previousFile = files[currentIndex - 1];
        const previousRow = previousFile ? selections.get(previousFile.name) : null;
        if (previousFile && previousRow) {
          const previousStack = await loadStack(previousFile);
          if (!cancelled) setPreviousPage(previousStack.pages[previousRow.selectedStack - 1]);
        } else {
          setPreviousPage(null);
        }
      } catch (error) {
        if (!cancelled) setStatus(statusText("error", error.message));
      } finally {
        if (!cancelled) setBusy(false);
      }
    }

    loadCurrentFrame();
    return () => {
      cancelled = true;
    };
  }, [currentFile, currentIndex, files, loadStack, selections]);

  async function openFolder() {
    setBusy(true);
    setStatus(statusText("idle", "Waiting for folder permission..."));
    try {
      const handle = await chooseTiffDirectory();
      const tiffFiles = await listDirectTiffFiles(handle);
      let restored = new Map();
      try {
        restored = parseStackSelectionsCsv(await readTextFile(handle, CSV_NAME));
      } catch (error) {
        restored = new Map();
      }
      stackCache.current.clear();
      const loadedTiffs = [];
      for (const fileHandle of tiffFiles) {
        try {
          const stack = await loadStack(fileHandle);
          loadedTiffs.push({ name: fileHandle.name, stackCount: stack.stackCount });
        } catch (error) {
          // Failed TIFFs remain visible, but cannot contribute a restored selection.
        }
      }
      restored = restoreStackSelectionsForLoadedTiffs(restored, loadedTiffs);
      setDirectoryHandle(handle);
      setFiles(tiffFiles);
      setSelections(restored);
      setCurrentIndex(0);
      setCurrentStack(1);
      setStatus(
        statusText(
          tiffFiles.length ? "ok" : "error",
          tiffFiles.length
            ? `Loaded ${tiffFiles.length} TIFF frame${tiffFiles.length === 1 ? "" : "s"}.`
            : "No direct child .tif or .tiff files found."
        )
      );
    } catch (error) {
      setStatus(statusText("error", error.message));
    } finally {
      setBusy(false);
    }
  }

  async function confirmCurrentSelection() {
    if (!currentFile || !currentTiff || !currentPage) return;

    setBusy(true);
    try {
      const next = setStackSelection(selections, currentFile.name, currentStack, currentTiff.stackCount);
      setSelections(next);
      await persistSelections(next);
      setStatus(statusText("ok", `Saved ${currentFile.name} stack ${currentStack}.`));
      if (currentIndex < files.length - 1) setCurrentIndex((index) => index + 1);
    } catch (error) {
      setStatus(statusText("error", error.message));
    } finally {
      setBusy(false);
    }
  }

  async function editSelection(filename, value) {
    const row = selections.get(filename);
    if (!row) return;
    const selectedStack = clamp(Number(value), 1, row.stackCount);
    try {
      const next = setStackSelection(selections, filename, selectedStack, row.stackCount);
      setSelections(next);
      if (currentFile?.name === filename) setCurrentStack(selectedStack);
      await persistSelections(next);
      setStatus(statusText("ok", `Updated ${filename}.`));
    } catch (error) {
      setStatus(statusText("error", error.message));
    }
  }

  async function buildResult() {
    if (!directoryHandle || !allSelected) return;
    setBuilding(true);
    setStatus(statusText("idle", "Validating selected pages..."));
    try {
      const result = await buildResultSequence({ directoryHandle, files, selections });
      setStatus(
        statusText(
          "ok",
          `Built result/${result.tiffFilename} and result/${result.csvFilename} with ${result.pageCount} pages.`
        )
      );
    } catch (error) {
      setStatus(statusText("error", error.message));
    } finally {
      setBuilding(false);
    }
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">TIFF z-stack sequence picker</p>
          <h1>Pick one stack plane per time frame</h1>
        </div>
        <button className="primary-action" onClick={openFolder} disabled={busy || !supportsDirectoryPicker()}>
          <FolderOpen size={18} aria-hidden="true" />
          Open Folder
        </button>
      </header>

      {!supportsDirectoryPicker() ? (
        <div className="status-banner error">
          <AlertTriangle size={18} aria-hidden="true" />
          This app needs a Chromium browser with the File System Access API.
        </div>
      ) : null}

      <section className={`status-banner ${status.kind}`}>
        {status.kind === "error" ? <AlertTriangle size={18} aria-hidden="true" /> : <Save size={18} aria-hidden="true" />}
        {status.text}
      </section>

      <section className="workspace">
        <aside className="side-rail">
          <div className="progress-block">
            <span>{selectedCount} selected</span>
            <strong>{files.length} frames</strong>
            <div className="progress-track" aria-label={`${progress}% complete`}>
              <div style={{ width: `${progress}%` }} />
            </div>
          </div>

          <div className="file-list" aria-label="TIFF files">
            {files.map((file, index) => (
              <button
                key={file.name}
                className={index === currentIndex ? "active" : ""}
                onClick={() => setCurrentIndex(index)}
              >
                <span>{file.name}</span>
                {selections.has(file.name) ? <Check size={14} aria-label="selected" /> : null}
              </button>
            ))}
          </div>
        </aside>

        <div className="main-panel">
          <div className="viewer-grid">
            <TiffCanvas
              title="Previous Selection"
              subtitle={previousPage ? `${previousPage.filename} / stack ${previousPage.stackNumber}` : "Fixed reference"}
              page={previousPage}
            />
            <TiffCanvas
              title="Current Frame"
              subtitle={currentFile ? `${currentFile.name} / stack ${currentStack}` : "No folder opened"}
              page={currentPage}
            />
          </div>

          <section className="control-strip" aria-label="Current stack controls">
            <button
              className="icon-button"
              onClick={() => setCurrentStack((stack) => clamp(stack - 1, 1, currentTiff?.stackCount ?? 1))}
              disabled={!currentTiff || currentStack <= 1}
              title="Previous stack"
            >
              <ChevronLeft size={18} aria-hidden="true" />
            </button>
            <div className="stack-readout">
              <span>Current stack</span>
              <strong>
                {currentTiff ? currentStack : "-"} / {currentTiff?.stackCount ?? "-"}
              </strong>
            </div>
            <button
              className="icon-button"
              onClick={() => setCurrentStack((stack) => clamp(stack + 1, 1, currentTiff?.stackCount ?? 1))}
              disabled={!currentTiff || currentStack >= currentTiff.stackCount}
              title="Next stack"
            >
              <ChevronRight size={18} aria-hidden="true" />
            </button>
            <button className="confirm-button" onClick={confirmCurrentSelection} disabled={!currentPage || busy}>
              <Check size={18} aria-hidden="true" />
              Confirm{currentIndex < files.length - 1 ? " & Next" : ""}
            </button>
            <button className="build-button" onClick={buildResult} disabled={!allSelected || building}>
              <Hammer size={18} aria-hidden="true" />
              Build Result
            </button>
          </section>

          <section className="selection-table" aria-label="Saved stack selections">
            <div className="table-header">
              <h2>Saved selections</h2>
              {currentSelection ? (
                <span>
                  Current row: stack {currentSelection.selectedStack} of {currentSelection.stackCount}
                </span>
              ) : (
                <span>Confirm the current frame to save a row.</span>
              )}
            </div>
            <div className="rows">
              {[...sortedSelectionRows(selections).values()].map((row) => (
                <label key={row.filename} className="selection-row">
                  <span>{row.filename}</span>
                  <input
                    type="number"
                    min="1"
                    max={row.stackCount}
                    value={row.selectedStack}
                    onChange={(event) => editSelection(row.filename, event.target.value)}
                    aria-label={`Selected stack for ${row.filename}`}
                  />
                  <small>of {row.stackCount}</small>
                </label>
              ))}
            </div>
          </section>
        </div>
      </section>
    </main>
  );
}
