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
  serializeStackSelectionsCsv,
  setStackSelection
} from "./lib/stackSelections.js";
import { fetchRaw16TiffPage } from "./lib/raw16Client.js";
import { renderRaw16ToCanvas } from "./lib/raw16Renderer.js";

const CSV_NAME = "stack-selections.csv";

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function sortedSelectionRows(rows) {
  return new Map([...rows.entries()].sort(([a], [b]) => a.localeCompare(b)));
}

function filterSelectionRowsForFiles(rows, files) {
  const filenames = new Set(files.map((file) => file.name));
  return new Map([...rows.entries()].filter(([filename]) => filenames.has(filename)));
}

function statusText(kind, text) {
  return { kind, text };
}

function TiffCanvas({ title, subtitle, page }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    if (!page || !canvasRef.current) return;
    const canvas = canvasRef.current;
    renderRaw16ToCanvas(canvas, {
      pixels: page.pixels,
      width: page.width,
      height: page.height,
      min: page.displayMin,
      max: page.displayMax
    });
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
  const [currentPage, setCurrentPage] = useState(null);
  const [previousPage, setPreviousPage] = useState(null);
  const [directorySessionId, setDirectorySessionId] = useState(0);
  const [status, setStatus] = useState(statusText("idle", "Choose a folder of TIFF frames."));
  const [folderBusy, setFolderBusy] = useState(false);
  const [frameBusy, setFrameBusy] = useState(false);
  const [selectionBusy, setSelectionBusy] = useState(false);
  const [building, setBuilding] = useState(false);
  const stackCache = useRef(new Map());
  const directorySessionRef = useRef(0);
  const fileHandleIds = useRef(new WeakMap());
  const nextFileHandleId = useRef(1);

  const currentFile = files[currentIndex] ?? null;
  const decodedCurrentTiff =
    currentTiff?.filename === currentFile?.name &&
    currentTiff?.directorySessionId === directorySessionId &&
    currentTiff?.fileHandle === currentFile
      ? currentTiff
      : null;
  const visibleCurrentPage =
    currentPage?.filename === currentFile?.name &&
    currentPage?.directorySessionId === directorySessionId &&
    currentPage?.fileHandle === currentFile &&
    currentPage?.stackNumber === currentStack
      ? currentPage
      : null;
  const currentSelection = currentFile ? selections.get(currentFile.name) : null;
  const selectedCount = files.filter((file) => selections.has(file.name)).length;
  const hasSelections = selectedCount > 0;
  const busy = folderBusy || frameBusy || selectionBusy;

  const progress = useMemo(() => {
    if (files.length === 0) return 0;
    return Math.round((selectedCount / files.length) * 100);
  }, [files.length, selectedCount]);

  const getFileHandleId = useCallback((fileHandle) => {
    if (!fileHandleIds.current.has(fileHandle)) {
      fileHandleIds.current.set(fileHandle, nextFileHandleId.current);
      nextFileHandleId.current += 1;
    }
    return fileHandleIds.current.get(fileHandle);
  }, []);

  const stackCachePrefix = useCallback(
    (fileHandle, sessionId = directorySessionId) => `${sessionId}:${getFileHandleId(fileHandle)}:`,
    [directorySessionId, getFileHandleId]
  );

  const stackCacheKey = useCallback(
    (fileHandle, stackNumber, sessionId = directorySessionId) =>
      `${stackCachePrefix(fileHandle, sessionId)}${Math.max(1, Number(stackNumber) || 1)}`,
    [directorySessionId, stackCachePrefix]
  );

  const pruneStackCache = useCallback(
    (sessionId, fileHandles) => {
      const keepPrefixes = fileHandles.filter(Boolean).map((fileHandle) => stackCachePrefix(fileHandle, sessionId));
      for (const key of stackCache.current.keys()) {
        if (key.startsWith(`${sessionId}:`) && !keepPrefixes.some((prefix) => key.startsWith(prefix))) {
          stackCache.current.delete(key);
        }
      }
    },
    [stackCachePrefix]
  );

  const loadStack = useCallback(async (fileHandle, requestedStack = 1, sessionId = directorySessionId) => {
    if (!fileHandle) return null;
    const requestStack = Math.max(1, Number(requestedStack) || 1);
    const cacheKey = stackCacheKey(fileHandle, requestStack, sessionId);
    if (stackCache.current.has(cacheKey)) return stackCache.current.get(cacheKey);

    const file = await fileHandle.getFile();
    const raw = await fetchRaw16TiffPage(file, requestStack);
    const page = {
      ...raw.page,
      filename: fileHandle.name,
      directorySessionId: sessionId,
      fileHandle
    };
    const stack = {
      filename: fileHandle.name,
      stackCount: raw.stackCount,
      page
    };
    stackCache.current.set(cacheKey, stack);
    stackCache.current.set(stackCacheKey(fileHandle, page.stackNumber, sessionId), stack);
    return stack;
  }, [directorySessionId, stackCacheKey]);

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
        setCurrentPage(null);
        setPreviousPage(null);
        setFrameBusy(false);
        return;
      }

      setFrameBusy(true);
      setCurrentTiff(null);
      setCurrentPage(null);
      try {
        const savedRow = selections.get(currentFile.name);
        const previousSaved =
          currentIndex > 0 ? selections.get(files[currentIndex - 1]?.name)?.selectedStack : undefined;
        const stack = await loadStack(currentFile, savedRow?.selectedStack ?? previousSaved ?? 1);
        if (cancelled) return;

        setCurrentTiff({ filename: stack.filename, stackCount: stack.stackCount, directorySessionId, fileHandle: currentFile });
        setCurrentStack(stack.page.stackNumber);
        setCurrentPage(stack.page);
        if (savedRow && (savedRow.selectedStack !== stack.page.stackNumber || savedRow.stackCount !== stack.stackCount)) {
          setSelections((rows) => {
            const currentRow = rows.get(currentFile.name);
            if (!currentRow) return rows;
            const selectedStack = clamp(currentRow.selectedStack, 1, stack.stackCount);
            if (currentRow.selectedStack === selectedStack && currentRow.stackCount === stack.stackCount) return rows;
            return setStackSelection(rows, currentFile.name, selectedStack, stack.stackCount);
          });
        }

        const previousFile = files[currentIndex - 1];
        const previousRow = previousFile ? selections.get(previousFile.name) : null;
        if (previousFile && previousRow) {
          const previousStack = await loadStack(previousFile, previousRow.selectedStack);
          if (!cancelled) {
            setPreviousPage(previousStack.page);
          }
        } else {
          setPreviousPage(null);
        }
        pruneStackCache(directorySessionId, [currentFile, previousFile]);
      } catch (error) {
        if (!cancelled) {
          setCurrentTiff(null);
          setCurrentPage(null);
          setCurrentStack(1);
          setStatus(statusText("error", error.message));
        }
      } finally {
        if (!cancelled) setFrameBusy(false);
      }
    }

    loadCurrentFrame();
    return () => {
      cancelled = true;
    };
  }, [currentFile, currentIndex, directorySessionId, files, loadStack, pruneStackCache, selections]);

  async function openFolder() {
    setFolderBusy(true);
    setStatus(statusText("idle", "Waiting for folder permission..."));
    try {
      const handle = await chooseTiffDirectory();
      const nextSessionId = directorySessionRef.current + 1;
      directorySessionRef.current = nextSessionId;
      setDirectoryHandle(null);
      setFiles([]);
      setSelections(new Map());
      setCurrentIndex(0);
      setCurrentStack(1);
      setCurrentTiff(null);
      setCurrentPage(null);
      setPreviousPage(null);
      setDirectorySessionId(nextSessionId);
      stackCache.current.clear();
      const tiffFiles = await listDirectTiffFiles(handle);
      let restored = new Map();
      try {
        restored = parseStackSelectionsCsv(await readTextFile(handle, CSV_NAME));
      } catch (error) {
        restored = new Map();
      }
      restored = filterSelectionRowsForFiles(restored, tiffFiles);
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
      setFolderBusy(false);
    }
  }

  async function confirmCurrentSelection() {
    if (!currentFile || !decodedCurrentTiff || !visibleCurrentPage) return;

    setSelectionBusy(true);
    try {
      const next = setStackSelection(selections, currentFile.name, currentStack, decodedCurrentTiff.stackCount);
      setSelections(next);
      await persistSelections(next);
      setStatus(statusText("ok", `Saved ${currentFile.name} stack ${currentStack}.`));
      if (currentIndex < files.length - 1) setCurrentIndex((index) => index + 1);
    } catch (error) {
      setStatus(statusText("error", error.message));
    } finally {
      setSelectionBusy(false);
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

  async function showCurrentStack(stackNumber) {
    if (!currentFile || !decodedCurrentTiff) return;
    const requestedStack = clamp(stackNumber, 1, decodedCurrentTiff.stackCount);
    setFrameBusy(true);
    setCurrentPage(null);
    try {
      const stack = await loadStack(currentFile, requestedStack);
      setCurrentTiff({ filename: stack.filename, stackCount: stack.stackCount, directorySessionId, fileHandle: currentFile });
      setCurrentStack(stack.page.stackNumber);
      setCurrentPage(stack.page);
    } catch (error) {
      setStatus(statusText("error", error.message));
    } finally {
      setFrameBusy(false);
    }
  }

  async function buildResult() {
    if (!directoryHandle || !hasSelections) return;
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
              page={visibleCurrentPage}
            />
          </div>

          <section className="control-strip" aria-label="Current stack controls">
            <button
              className="icon-button"
              onClick={() => showCurrentStack(currentStack - 1)}
              disabled={!decodedCurrentTiff || currentStack <= 1 || frameBusy}
              title="Previous stack"
            >
              <ChevronLeft size={18} aria-hidden="true" />
            </button>
            <div className="stack-readout">
              <span>Current stack</span>
              <strong>
                {decodedCurrentTiff ? currentStack : "-"} / {decodedCurrentTiff?.stackCount ?? "-"}
              </strong>
            </div>
            <button
              className="icon-button"
              onClick={() => showCurrentStack(currentStack + 1)}
              disabled={!decodedCurrentTiff || currentStack >= decodedCurrentTiff.stackCount || frameBusy}
              title="Next stack"
            >
              <ChevronRight size={18} aria-hidden="true" />
            </button>
            <button className="confirm-button" onClick={confirmCurrentSelection} disabled={!visibleCurrentPage || busy}>
              <Check size={18} aria-hidden="true" />
              Confirm{currentIndex < files.length - 1 ? " & Next" : ""}
            </button>
            <button className="build-button" onClick={buildResult} disabled={!hasSelections || building || folderBusy || selectionBusy}>
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
