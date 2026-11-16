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

## Bridge

The API above is called from inside the page, so a tool outside the browser has to launch and drive one
(Playwright, DevTools Protocol). The bridge turns this around: **the page connects to the tool**, and the tool
calls the same API through that connection. Nothing launches or drives a browser; the visitor only opens a link,
in the browser they already use.

```text
local tool (command line, agent tool server)         Circuit Studio page
  listens on ws://127.0.0.1:<port>         <──────── connects (link opened by the visitor)
  {id, method, params}                     ────────> runs window.circuitStudio[method](...params)
  {id, result} / {id, error} / {id, progress} <───── answers
```

- **Opt-in, from the link**: the bridge starts only when the URL fragment holds
  `#bridge=ws://127.0.0.1:<port>&token=<token>`, for example
  `https://<site>/#bridge=ws://127.0.0.1:5199&token=3f9c…`. The fragment is never sent to the web server.
  Without it, nothing changes.
- **This machine only**: the page connects only to a loopback address (`127.0.0.1`, `localhost`, `[::1]`) over
  `ws:`, so a link cannot make it talk to a remote server.
- **Token**: the page's first message is `{type: "hello", token, protocol: "circuit-studio-bridge/1", api: 1}`; the tool closes the
  connection unless the token is the one it put in the link (and it checks the page's `Origin`). Once it accepts
  the page, it may send `{type: "welcome", client: "<its name>"}`. Other pages open
  in the browser cannot use the tool, and other tools cannot use the page.
- **Requests**: `{id, method, params}` with `method` among `ready`, `openProject`, `getProject`, `listParts`,
  `capabilities`, `renderImage`, `renderVideo`, `planRoutes`, `videoSettings`. Answers are `{id, result}` or
  `{id, error: {message}}`; a `Blob` in a result (image, video) is sent as `{$blob: {type, base64}}`.
  `renderVideo` also sends `{id, progress}` while it runs, and `{cancel: id}` stops it.
- **In the header**: while the bridge is on, a badge next to the project name says so ("Driven by <tool>",
  "<tool> disconnected, retrying"), so the visitor always sees that a tool drives the page.
- **Reconnection**: when the tool stops or restarts, the page reconnects every 2 s, so a long-lived tab picks up a restarted tool by itself. It
  stops retrying when the tool closes the connection with code 4000 (another tab took over) or 4001 (token
  refused, e.g. an outdated link).
- **Browsers**: from a page served over `https`, connecting to `127.0.0.1` is allowed (loopback counts as a secure
  origin), but recent Chrome and Edge ask the visitor once whether the site may reach apps on this device. Served
  from the same machine (`http://localhost`), there is no prompt.
