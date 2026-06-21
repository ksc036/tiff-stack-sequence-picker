---
title: Keep browser build tooling out of runtime dependencies
category: workflow
tags:
  - vite
  - npm-audit
  - dependencies
---

# Keep browser build tooling out of runtime dependencies

## Context

During the TIFF stack picker setup, `npm audit --omit=dev` initially reported Vite/esbuild issues because Vite and the React plugin were listed in `dependencies`.

## Guidance

For browser-local Vite apps, keep build and test tooling in `devDependencies`. Runtime dependencies should be limited to libraries imported by the shipped browser bundle.

## Why This Matters

`npm audit --omit=dev` should answer whether runtime dependencies have known vulnerabilities. Putting build tooling under `dependencies` makes that signal noisy and can make local dev-server advisories look like shipped app risk.

## Example

Use:

```json
{
  "dependencies": {
    "react": "^18.3.1",
    "react-dom": "^18.3.1"
  },
  "devDependencies": {
    "@vitejs/plugin-react": "^5.0.0",
    "vite": "^5.4.11",
    "vitest": "^2.1.5"
  }
}
```
