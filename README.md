# TIFF Stack Sequence Picker

Browser tool for choosing one z-stack plane from each TIFF time frame and exporting the selected sequence.

## Requirements

- Node.js 18 or newer
- Chrome or Edge
  - This app uses the browser File System Access API, so Safari and Firefox are not supported for local folder access.

## Install

```bash
npm install
```

## Run Locally

```bash
npm run dev
```

Open:

```text
http://127.0.0.1:5173/
```

The dev command starts one local Express server on `0.0.0.0:5173`. That server handles `/api/tiff/raw16` and also serves the Vite app.

On another device in the same network, open the machine's LAN IP with the same port, for example:

```text
http://<this-computer-ip>:5173/
```

## TIFF Display Pipeline

16-bit TIFF display follows `/Users/ksc/Documents/imageSegmentationUsingPen`:

- The browser sends the selected TIFF file to the local `/api/tiff/raw16` endpoint.
- The server reads the requested stack page as `grey16` raw pixels.
- ImageJ `min` / `max` display metadata is used when present; otherwise the selected page pixel range is used.
- The browser renders the 16-bit raw pixels with WebGL2 using display `min` / `max`.
- A 2D canvas CPU mapping is used only when WebGL2 is unavailable.

## How To Use

1. Click `Open Folder`.
2. Select a folder that directly contains `.tif` or `.tiff` files.
3. The files are sorted by filename. Earlier filenames are treated as earlier time frames.
4. Use the stack arrow buttons to choose the z-stack for the current frame.
5. Click `Confirm & Next` to save that frame's selected stack.
6. You can skip frames by not confirming them. `Build Result` only includes confirmed selections, so the result can start in the middle and can skip unnecessary frames.
7. Click `Build Result`.

The app writes output files to a `result` folder inside the selected TIFF folder:

- `selected-stack-sequence.tif`
- `stack-selections.csv`

Selections are also saved to `stack-selections.csv` in the source folder while you work, so you can reopen the folder and continue or edit previous choices.

## Build

```bash
npm run build
```

The production files are generated in `dist/`.

## Test

```bash
npm test
```
