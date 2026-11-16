# Automation API

Circuit Studio exposes a small scripting API on `window.circuitStudio`, in development and production builds, so
browser automation (Playwright, Puppeteer, Chrome DevTools Protocol) can open a project and render images or
videos without driving the interface. Everything still runs in the visitor's browser; nothing is uploaded.

```ts
window.circuitStudio = {
  version: 1,                     // incremented on breaking changes
  ready: Promise<void>,           // resolves when the 3D viewport has started
  openProject(data): Promise<{ name, components, wires }>,
  getProject(): Project,          // current project, without embedded assets
  listParts(): Promise<PartInfo[]>,
  capabilities(settings?): Promise<{ mp4, webm, png }>,
  renderImage({ width?, height?, transparent? }?): Promise<Blob>,
  videoSettings(settings?): { settings, source, presets, choices }
  renderVideo(settings?, { selected?, onProgress?, signal? }?):
    Promise<{ blob, filename, mimeType, frames, duration, warnings }>,
  planRoutes(data?): Promise<{ blocked, wires: [{ id, blocked, points? }] }>,
}
```

- **`openProject(data)`** accepts a project object, its JSON text, or a `.c3dproj` / `.c3dzip` `Blob`. It uses the
  same path as **Open** (validation, migrations, embedded assets), replaces the current project, and resolves
  once wire routes are computed and the scene has stopped changing, so the next render shows the whole circuit.
- **`listParts()`** returns the built-in parts and the parts saved in the local library, each with `modelId`,
  `name`, `source` (`built-in` or `library`), `dimensions` and its pins (`id`, `label`, `silkscreen`, `aliases`,
  `functions`, `electrical`). Scripts use it to map a wiring list to pin IDs.
- **`renderImage()`** renders the current view to a PNG (default 1920×1080).
- **`renderVideo(settings?)`** runs the Auto Video export and returns the file in memory. Settings are, in order:
  the defaults, then the project's stored settings (`presentation.video`, see
  [Auto Video generator](AUTO_VIDEO_GENERATOR.md)), then the `settings` passed in. The browser's local preset is
  not used, so the same project renders the same way on any machine. Only one export can run at a time: the page
  shows its progress like an export from the dialog, and its **Cancel video** button stops it (the call then fails).
- **`videoSettings(settings?)`** gives the settings a `renderVideo(settings)` call would use (`settings`, with
  `source`: `"project"` when the project stores its own, else `"defaults"`), the presets of the Auto Video dialog,
  and the allowed values of the settings that have a fixed list (`choices`). Invalid values are replaced the same
  way the dialog does, so comparing what you passed with what comes back shows what was not accepted.
- **`planRoutes(data?)`** computes the wire routes of a project (an object or its JSON text; the current project
  when omitted) with the same planner as the workspace, without opening it or loading any model. It returns
  each wire's `id`, whether it is `blocked` (no route found without crossing parts or other wires) and its
  route `points` (mm), plus the list of `blocked` wire IDs. Tools that generate projects use it to check, or
  improve, a part layout before opening the result.

## Example (Playwright)

```js
import {chromium} from 'playwright';
import {readFile, writeFile} from 'node:fs/promises';

const browser = await chromium.launch({args: ['--enable-gpu', '--ignore-gpu-blocklist']});
const page = await browser.newPage();
await page.goto('http://localhost:4173/');
await page.waitForFunction(() => window.circuitStudio);
const project = JSON.parse(await readFile('my-project.c3dproj', 'utf8'));
await page.evaluate(async project => { await window.circuitStudio.openProject(project); }, project);
const base64 = await page.evaluate(async () => {
  const {blob} = await window.circuitStudio.renderVideo({fps: 30});
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = ''; for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
});
await writeFile('wiring.mp4', Buffer.from(base64, 'base64'));
await browser.close();
```

Video encoding uses WebCodecs: run a browser with hardware acceleration available, and check
`capabilities()` first on unfamiliar machines.
