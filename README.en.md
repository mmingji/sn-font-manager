# SnFont Font Icon Manager

[简体中文](./README.md) | **English**

[![Stars](https://img.shields.io/github/stars/mmingji/sn-font-manager?style=flat-square&logo=github&label=stars)](https://github.com/mmingji/sn-font-manager/stargazers)
[![Release](https://img.shields.io/github/v/release/mmingji/sn-font-manager?style=flat-square&label=release)](https://github.com/mmingji/sn-font-manager/releases)
[![Downloads](https://img.shields.io/github/downloads/mmingji/sn-font-manager/total?style=flat-square&label=downloads)](https://github.com/mmingji/sn-font-manager/releases)
[![License](https://img.shields.io/github/license/mmingji/sn-font-manager?style=flat-square&label=license)](./LICENSE)
[![Vue](https://img.shields.io/badge/Vue-3-42b883?style=flat-square&logo=vuedotjs&logoColor=white)](https://vuejs.org)
[![Vite](https://img.shields.io/badge/Vite-6-646CFF?style=flat-square&logo=vite&logoColor=white)](https://vitejs.dev)
[![Chrome/Edge](https://img.shields.io/badge/Chrome%2FEdge-90%2B-4285F4?style=flat-square&logo=googlechrome&logoColor=white)](#browser-requirements)
[![AI-assisted](https://img.shields.io/badge/AI--assisted-DeepSeek%20Harness-4B6BFB?style=flat-square)](#development-ai-assisted)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen?style=flat-square)](#contributing)

A pure front-end (zero-backend) font-icon manager: parse an existing font into uniformly sized SVG icons, curate an icon project (CRUD, grouping by initial letter, batch operations), and export two font sets (`snfont-regular` / `snfont-bold` — ttf / woff / woff2) with matching CSS. Fonts support **GSUB ligatures** — after installing, typing an icon name (e.g. `trash`) in any text field is replaced by the icon; icons can also be inserted from a character map by glyph name.

**Portable build**: the production artifact is a **single index.html** — unzip and double-click, no installer, no server, no network. Download from [Releases](https://github.com/mmingji/sn-font-manager/releases).

## Screenshots

| Icon management | Font parsing | Preview page |
| --- | --- | --- |
| ![Icon management: grouped grid with card hover actions](docs/screenshots/01-manage.png) | ![Font parsing: codepoint conflict detection and resolution](docs/screenshots/02-parse.png) | ![Generated demo page](docs/screenshots/03-demo.png) |

## Features

| Feature | Description |
| --- | --- |
| Font parsing | Parse ttf/otf/woff/woff2 into uniformly sized SVGs (128/512/1024 or custom). The dashed panel holds pre-parse settings (SVG size / name-mapping table / keep original unicode); the grey area shows the picked file and lets you re-pick. Preview supports selection, renaming and zip download. A built-in unicode→name map (`public/unicode-map.data.js`) names glyphs automatically, falling back to uniXXXX |
| Codepoint conflicts | The preview flags glyphs whose original codepoint collides with the built-in ASCII base glyphs (0x20–0x7E) or with existing project icons: card turns red and you choose one of three strategies (auto-assign / drop conflicting / overwrite existing). Any conflict must be resolved before import |
| Icon management | Grouped by initial letter (Chinese by pinyin), side alphabet index, search, rename/replace/delete, codepoint shown on each card, persisted in real time |
| Project settings | Right drawer: project name / CSS prefix / font name / weight / SVG size + "rename by unicode map" + "project reserved-range usage" (used / remaining with a progress bar; range read from codepoint-plan.data.js) |
| Project download | Full zip: ttf/woff/woff2 + css + demo.html + `<project>.project.json`, grouped in a folder named after the output font |
| Import | Batch SVG (preview, rename, select) and project JSON restore |
| Top bar | Search ｜ multi-select ｜ settings ｜ Import ▾ ｜ Export ▾ |
| Font capabilities | GSUB ligature replaces an icon name on the fly; glyph names from the post table are searchable; codepoints are stable (never recycled); built-in Latin glyphs from a real typeface (ASCII 94 chars), overridable; selectable weight |
| Codepoint planning | New icons take codepoints sequentially from the reserved range U+EE00–U+EFFF (512), skipping ranges already used by the reference icon set |
| Persistence | IndexedDB as primary storage + localStorage snapshot: thousands of icons survive; serialized write queue with a synchronous flush on unload; a boot gate prevents a blank first paint |
| Self-check on start | Detects out-of-range SVG coordinates on demand (clamped into 0–1000); shows progress only when something is actually wrong — silent and idempotent for healthy data |
| Offline run | Portable build: double-click dist/index.html (no server, no network). Any static host works too if you prefer HTTP |
| Image → SVG | Drag in / multi-select bitmaps → potrace (WASM) vectorization (threshold / invert / despeckle, auto re-trace on change) → large preview at the project SVG size + grid (rename / select / download one / download all) → import. The card "Replace" action opens the same dialog (supports SVG files) |
| Portable build | Output is a **single index.html** (JS/CSS/wasm/mapping data all inlined): unzip and double-click. `npm run pack` produces SnFont-portable.zip |

## Tech stack

- Vue 3 + Vite 6 + Pinia (pure front-end; IndexedDB + localStorage snapshot)
- **fontkit** as the font parsing engine (vendored single file: `src/lib/fontkit-bundle.mjs`); woff2 decoding via fonteditor-core's WASM
- fonteditor-core: TrueType building, ttf→woff/woff2 conversion
- Hand-written GSUB generator (ligature lookup type 4, binary injection)
- JSZip + file-saver for zipped downloads
- esm-potrace-wasm for bitmap vectorization. **GPL-2.0 note**: local/internal use carries no distribution obligation; the icons/fonts it produces are data and unaffected; if you ever distribute the app commercially as closed source, swap it for a permissively licensed library (contained in `src/lib/traceImage.js`)
- vite-plugin-singlefile to inline JS/CSS into one HTML so `file://` works by double-click

## Quick start

Requires Node.js ≥ 18

```bash
npm install
npm run dev        # dev server: http://localhost:5173
npm run build      # build into dist/
npm run pack       # build + package the portable zip
```

### Run locally (offline, double-click)

**Portable build**: `npm run pack` → `SnFont-portable.zip` (~0.94 MB). Unzip and **double-click `SnFont/index.html`** — no installer, no server, no network. The artifact is a single HTML file (JS/CSS/woff2.wasm/mapping data inlined); under `file://` both `type="module"` and fetching external files are blocked by CORS, hence IIFE output plus dataURL inlining (see comments in vite.config.js).

<a id="browser-requirements"></a>
**Browsers**: Chrome / Edge 90+ recommended (Firefox restricts `file://` storage quite strictly; Safari untested).
**The app itself ships no project data** — your icons live in the browser's IndexedDB:

- Browsers do **not** partition `file://` storage by folder: moving/copying the folder never loses data, and any local page in the same browser sees the same data (so "unzip several copies" does **not** isolate projects);
- Before switching machines or clearing browser data, back up via "Export ▾ → Download project" and restore with "Import ▾ → Import SVG";
- To wipe data: delete icons in the app, or clear the browser's site data.

(`npm run preview` serves a local static build for development; for HTTP deployment just host `dist/`.)

## Deployment

`dist/` is fully static — host it anywhere (Nginx / GitHub Pages / Vercel / Netlify / intranet). No backend, no runtime dependencies.

## Workflow

1. **Add icons**: "Import ▾ → Import SVG" for batches; "Image → SVG" to vectorize bitmaps (adjustable threshold/invert, multi-image); "Parse font" to decompose ttf/otf/woff/woff2. All three paths lead to a preview (rename / select / conflict handling) → import or download
2. **Manage**: grouped grid on the main page; "Multi-select" for batch delete/export; the "Settings" drawer holds configuration
3. **Export**: "Export ▾ → Download project" → `<font-name>-project.zip`
4. **Use the font**: on the web, link the CSS and write `<i class="sn-trash">`; on the desktop, install the ttf and type the icon name (GSUB); demo.html can be copied into Photoshop

## Project structure

```
src/
├─ lib/
│  ├─ parseFont.js      # font → SVG (fontkit engine + woff2 WASM decoding)
│  ├─ buildFont.js      # TrueType building + y-flip + CSS generation
│  ├─ gsub.js           # GSUB ligature table generation & injection
│  ├─ baseGlyphs.js     # built-in base Latin glyphs (two weights, ligature triggers)
│  ├─ svgNormalize.js   # SVG normalization & out-of-range repair (idempotent; clampSvgToBox / normalizeSvgForce)
│  ├─ traceImage.js     # bitmap → SVG vectorization (canvas binarization + potrace WASM)
│  ├─ unicodeMap.js     # unicode→name mapping reader/applier
│  ├─ codepointPlan.js  # codepoint-plan config reader (reserved range / reference sections) + predicates
│  ├─ loadDataScript.js # dynamic loader for editable data files (*.data.js, timestamped to bypass cache)
│  ├─ pinyin.js         # Chinese pinyin grouping/sorting
│  ├─ zip.js            # zip packaging (SVG / project / demo.html)
│  └─ persist.js        # IndexedDB + localStorage persistence
├─ store/project.js     # Pinia: CRUD / grouping / stable codepoints / conflict overwrite / boot
└─ components/          # UI components (FontParser / ImportModal / SettingsModal drawer …)
```

## Notes

- Data lives in IndexedDB (large capacity) + a localStorage snapshot; export `<project>.project.json` to back up or migrate
- Icon codepoints are permanent; new icons are assigned from U+EE00+ so they never clash with the reference set
- Weight affects only the output file names and the letter/symbol glyphs; icon names, unicodes and CSS class names are weight-independent
- No third-party icon-library name appears anywhere in the generated fonts
- **Built-in name map**: icon names in `public/unicode-map.data.js` follow the **Font Awesome v7.3.1** naming. It is name-only reference data (no fonts, icon artwork or code from that project) and can be edited freely
- Data files are plain `<script>` files (identical across dev/build/portable, content is JSON, edit → refresh to apply): `public/unicode-map.data.js` (icon name map) and `public/codepoint-plan.data.js` (codepoint plan: `project_alloc` at the top defines the reserved range, `reference_sections` records occupancy sections of the reference set)
  - Loaded dynamically with a timestamp to bypass browser script caching; file names are clickable in "Parse font → name map" and "Settings → project reserved-range usage"
  - If a file is missing the app falls back to the snapshot inlined at build time (so an `index.html` alone still works)
- **GSUB ligatures (typing an icon name inserts the icon)** must be sorted by component count descending — otherwise a short name steals a longer one (typing `apple-pay` would render "apple-icon + -pay"). When the ligature data exceeds the u16 offset limit (~64KB) it is split into multiple **Extension subtables** (Lookup Type 7 with u32 offsets) so that thousands of icons still all trigger. **Known limit**: thousands of names sharing the same first character is an extreme case — keep icon-name initials varied
- **Font parsing automatically skips glyph 0 (`.notdef`) and Unicode noncharacter codepoints** (U+FDD0–U+FDEF / U+*FFFE / U+*FFFF): they are not icons, and a noncharacter codepoint (fonts often map `.notdef` to U+FFFF) aborts the font build at that point — which once made exported fonts contain only the base glyphs. The same filter is applied defensively when building from older projects (the console reports how many were skipped), and noncharacter codepoints are re-assigned on import. Glyph 0 in the generated font is created automatically by fonteditor-core — it should not come from the source font
- The parsing engine is fontkit (vendored single file, with regeneration command): it replaces opentype.js, which mis-scaled CFF/OTF compact curve encodings and broke hole direction (hollow rings used to render as thick solid discs). Output now carries `fill-rule="evenodd"` (geometric holes, direction-independent)
- Image → SVG works best on solid-colour artwork on white/transparent backgrounds and line-style icons (threshold / invert / despeckle adjustable); photos, gradients and fine detail are unsuitable and results are always single-colour outlines (an inherent constraint of icon fonts)
- The large preview renders at the project SVG size (unified with the Settings drawer); individual results can be downloaded as SVG for refinement in Illustrator and re-imported
- Threshold / invert / despeckle are stored per image: selecting a card below previews and edits that image; the focused card gets a bold outline, distinct from the blue selected state

<a id="development-ai-assisted"></a>
## Development (AI-assisted)

This project is an **AI-assisted programming product**: requirements, design decisions, acceptance and iteration were driven by the author (sn476); implementation and refactoring were generated by an AI coding agent.

- Tooling: DeepSeek Harness (an in-terminal AI coding agent)
- Model: `deepseek-v4-flash-vision-exp` (DeepSeek)
- Workflow: the author defines requirements and acceptance criteria → the AI implements and self-tests (browser E2E, screenshot comparison, font-artifact verification) → the author reviews and gives feedback → iterate
- Please evaluate and test AI-generated code before relying on it; the project is provided "as is", without warranty (see LICENSE)

## License

- **Project code**: MIT, Copyright (c) 2026 sn476 (see [LICENSE](./LICENSE))
- **Third-party components**: see [THIRD-PARTY-NOTICES.md](./THIRD-PARTY-NOTICES.md). Note that `esm-potrace-wasm` (the bitmap vectorizer) is **GPL-2.0** and is inlined into the build output (dist/): **using it yourself or internally carries no obligation**; **distributing the artifact to others requires complying with GPL-2.0** (ship the license text and a way to obtain the corresponding source)
- **Built-in name data**: icon names in `public/unicode-map.data.js` follow the **Font Awesome v7.3.1** naming (name-only reference data; no fonts, artwork or code from that project)

<a id="contributing"></a>
## Contributing

Issues and PRs are welcome. When reporting a problem, please include your browser version, reproduction steps and a screenshot. For icon size/shape issues, attaching the source font file and the codepoint helps a lot.
