/**
 * Force the dev server to recompile the moment a source file changes.
 *
 * WHY THIS EXISTS. Next's dev server compiles LAZILY: a chunk is rebuilt when a client
 * asks for it, not when the file changes. With a browser tab open and connected, HMR
 * does the asking for you. Without one — tab closed, backgrounded, or a run of edits
 * made while you were looking elsewhere — the served CSS stays behind the source, which
 * reads exactly like "my change did nothing".
 *
 * There is no config flag for this. `experimental.preloadEntriesOnStart` is already true
 * and only covers startup, and `onDemandEntries` tunes how long entries are KEPT, not
 * whether they are built. So this watches the source and makes the request itself.
 *
 * VERIFIED: adding a marker rule to globals.css and then fetching only `/` puts that
 * marker in the served stylesheet. Requesting the page is enough; the stylesheet URL
 * does not need to be requested separately.
 *
 * Run it beside the dev server, in its own terminal:
 *
 *     npm run dev        # terminal 1
 *     npm run dev:poke   # terminal 2
 *
 * It builds nothing itself and cannot corrupt the cache — it only makes an HTTP request,
 * the same thing a browser refresh does.
 *
 * NOTE WHEN CHECKING WHETHER A CHANGE LANDED: compare against what the server SERVES,
 * not against the chunk file in `.next/dev` — that file lags independently and will lie
 * to you in both directions. And the dev server serves UNMINIFIED css, so grep for
 * `.some-class` with following lines, never for the minified `.some-class{...}` form.
 */
import { watch } from 'node:fs';
import { readdir } from 'node:fs/promises';
import path from 'node:path';

const PORT = process.env.PORT ?? '3001';
const ORIGIN = `http://localhost:${PORT}`;
const ROOTS = ['app', 'components', 'lib'];
const WATCHED = /\.(css|jsx?|tsx?|mjs)$/;

// Coalesce: an editor save can emit several events for one write, and a scripted edit
// touching three files should still produce one compile.
const DEBOUNCE_MS = 150;
let timer = null;
let pending = new Set();

async function poke() {
  const files = [...pending];
  pending = new Set();
  const started = Date.now();
  try {
    const res = await fetch(ORIGIN + '/', { cache: 'no-store' });
    const ms = Date.now() - started;
    const what = files.length === 1 ? files[0] : `${files.length} files`;
    console.log(
      res.ok
        ? `  recompiled after ${what} (${ms}ms)`
        : `  ${ORIGIN} answered ${res.status} after ${what}`
    );
  } catch (err) {
    // The server being down is the ordinary case when you stop it — say so plainly
    // rather than throwing and killing the watcher.
    console.log(`  dev server not answering on ${PORT} (${err.code ?? err.message})`);
  }
}

function schedule(file) {
  pending.add(file);
  clearTimeout(timer);
  timer = setTimeout(poke, DEBOUNCE_MS);
}

const present = [];
for (const dir of ROOTS) {
  try {
    await readdir(dir);
    // `recursive` is supported on Windows and macOS; on Linux it needs Node 20+.
    watch(dir, { recursive: true }, (_event, filename) => {
      if (!filename) return;
      const rel = path.join(dir, filename.toString());
      if (WATCHED.test(rel)) schedule(rel.replace(/\\/g, '/'));
    });
    present.push(dir);
  } catch {
    /* directory absent in this project — skip it */
  }
}

console.log(`dev-poke: watching ${present.join(', ')} -> ${ORIGIN}`);
console.log('every save now forces a recompile; leave this running beside `npm run dev`.');
