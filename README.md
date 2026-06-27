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
npm run dev -- --host 127.0.0.1
```

Open the URL shown by Vite:

```text
http://127.0.0.1:5173/
```

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
