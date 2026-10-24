// Save states for single player: a snapshot of the whole game, taken in an instant and restored
// exactly, anywhere in a single-player game. Not in co-op (every player simulates the same game;
// one player cannot rewind it).
//
// - Quick save / quick load: Ctrl+S / Ctrl+O (⌘S / ⌘O on a Mac), also F5 / F9.
// - The Saves screen (Ctrl+Shift+S / ⌘⇧S, or the toolbar): six slots and the quick save, each
//   with a picture, the area, cash and wanted level (web/saves.js).
// - Continue on the front page: the newest save, straight from the landing page.
//
// The game's state is its WebAssembly memory. A save copies it up to the heap's end between two
// frames, then compresses it (gzip) and keeps it in IndexedDB; a load writes it back and has the
// core rebuild what lives in the browser (textures, sounds, clock; savestate_web.cpp). A snapshot
// only fits the build that made it, so each one records a hash of gta2.wasm.

const DB_NAME = 'gta2-port-states';
const STORE = 'states';

/** The quick save and the six slots, in the order the Saves screen shows them. */
export const SLOTS = ['quick', 's1', 's2', 's3', 's4', 's5', 's6'];
export const slotName = (slot) => (slot === 'quick' ? 'Quick save' : slot === 'auto' ? 'Autosave' : `Slot ${slot.slice(1)}`);

function promisify(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

let dbPromise = null;
function openDb() {
  if (!dbPromise) {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'slot' });
    dbPromise = promisify(req);
    dbPromise.catch(() => { dbPromise = null; });
  }
  return dbPromise;
}

async function write(fn) {
  const db = await openDb();
  const tx = db.transaction(STORE, 'readwrite');
  fn(tx.objectStore(STORE));
  await new Promise((resolve, reject) => {
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('the browser refused to store it'));
  });
}

async function get(slot) {
  const db = await openDb();
  return promisify(db.transaction(STORE, 'readonly').objectStore(STORE).get(slot));
}

let buildPromise = null;
/** This build's identity: the SHA-256 of gta2.wasm (the snapshot's memory layout depends on it). */
function buildId() {
  if (!buildPromise) {
    buildPromise = fetch(new URL('gta2.wasm', import.meta.url))
      .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(`gta2.wasm: HTTP ${r.status}`))))
      .then((buf) => crypto.subtle.digest('SHA-256', buf))
      .then((d) => Array.from(new Uint8Array(d).slice(0, 12), (b) => b.toString(16).padStart(2, '0')).join(''))
      .catch((err) => { buildPromise = null; throw err; });
  }
  return buildPromise;
}

/**
 * Every save in this browser, newest first, without the snapshots themselves:
 * {slot, savedAt, label, thumb (Blob), current (made by this build)}.
 */
export async function listSaves() {
  let records;
  try {
    const db = await openDb();
    records = await promisify(db.transaction(STORE, 'readonly').objectStore(STORE).getAll());
  } catch {
    return []; // no IndexedDB here (private window, blocked storage)
  }
  const build = await buildId().catch(() => null);
  return records
    .map(({ data, ...meta }) => ({ ...meta, current: !!build && meta.build === build }))
    .sort((a, b) => b.savedAt - a.savedAt);
}

export async function deleteSave(slot) {
  await write((store) => store.delete(slot));
}

const gzip = (bytes) => new Response(new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip'))).blob();
const gunzip = async (blob) => new Uint8Array(await new Response(blob.stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());

// Ctrl/⌘ S and O: the usual save and open shortcuts, which a page may take over in every browser.
// F5 / F9 also work, as in many PC games, but F5 is the browser's reload and Mac keyboards need Fn.
const MAC = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
export const SAVE_KEY = MAC ? '⌘S' : 'Ctrl+S';
export const LOAD_KEY = MAC ? '⌘O' : 'Ctrl+O';
export const SAVES_KEY = MAC ? '⌘⇧S' : 'Ctrl+Shift+S';

const until = async (ready, ms = 3000) => {
  for (const end = performance.now() + ms; !ready() && performance.now() < end;) await new Promise((r) => setTimeout(r, 20));
};

/** A short message over the game (bottom centre). */
export function toast(text, isError = false) {
  let box = document.getElementById('state-toast');
  if (!box) {
    box = document.createElement('div');
    box.id = 'state-toast';
    box.setAttribute('role', 'status');
    document.body.append(box);
  }
  box.textContent = text;
  box.classList.toggle('error', isError);
  box.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { box.hidden = true; }, isError ? 4000 : 1800);
}

// The district from the map file the game loaded ("data\\wil.gmp" -> Downtown).
const DISTRICT_OF = { wil: 'Downtown', ste: 'Residential', bil: 'Industrial' };
function districtOf(mapFile) {
  const base = mapFile.split(/[\\/]/).pop().toLowerCase().replace(/(-multi)?\.gmp$/, '');
  return DISTRICT_OF[base] || (base ? 'Bonus level' : '');
}

const titleCase = (s) => s.toLowerCase().replace(/(^|[\s-])\p{L}/gu, (m) => m.toUpperCase());

export class SaveStates {
  /**
   * @param {object} opts
   * @param {object} opts.Module the game module
   * @param {object} opts.renderer the WebGL renderer (its canvas gives the save's picture)
   * @param {object} opts.map the shell's map (rebuilt after a load; never interrupted mid-build)
   */
  constructor({ Module, renderer, map }) {
    this.Module = Module;
    this.renderer = renderer;
    this.map = map;
    this.busy = false;
    this.screen = null; // the Saves screen (web/saves.js), which takes Ctrl/⌘+Shift+S
  }

  /** Keys: Ctrl/⌘+S or F5 quick saves, Ctrl/⌘+O or F9 quick loads. Returns true when it used the key. */
  handleKey(e, down) {
    const mod = (MAC ? e.metaKey : e.ctrlKey) && !e.altKey;
    const saves = mod && e.shiftKey && e.code === 'KeyS';
    const save = e.code === 'F5' || (mod && !e.shiftKey && e.code === 'KeyS');
    const load = e.code === 'F9' || (mod && !e.shiftKey && e.code === 'KeyO');
    if (!save && !load && !saves) return false;
    if (down && !e.repeat) {
      if (saves) { if (this.screen) this.screen.show(); } else if (save) this.save('quick'); else this.load('quick');
    }
    return true; // never to the game, and the browser neither reloads nor opens its own dialogs
  }

  canSave() {
    return this.Module.ccall('gta2_port_savestate_can_save', 'number', [], []) === 1;
  }

  /** The game as it is on screen now, small (the canvas keeps its last frame). */
  picture() {
    const { canvas, viewport } = this.renderer;
    const w = 320;
    const h = Math.round((w * viewport.h) / Math.max(1, viewport.w));
    const small = document.createElement('canvas');
    small.width = w;
    small.height = h;
    const ctx = small.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(canvas, viewport.x, viewport.y, viewport.w, viewport.h, 0, 0, w, h);
    return new Promise((resolve) => small.toBlob((b) => resolve(b), 'image/jpeg', 0.8));
  }

  /** What the save's card shows: the area, district, cash, lives, wanted level. Read after the copy. */
  label() {
    const M = this.Module;
    const p = M.ccall('gta2_port_savestate_label', 'number', [], []);
    const v = M.HEAP32.subarray(p >> 2, (p >> 2) + 8);
    let area = '';
    for (let i = 0, o = (p + 32) >> 1; i < 48 && M.HEAPU16[o + i]; i++) area += String.fromCharCode(M.HEAPU16[o + i]);
    let mapFile = '';
    for (let i = 0, o = p + 32 + 96; i < 64 && M.HEAPU8[o + i]; i++) mapFile += String.fromCharCode(M.HEAPU8[o + i]);
    return {
      area: titleCase(area.trim()), district: districtOf(mapFile), cash: v[1], lives: v[2], multiplier: v[3],
      stars: v[4], health: v[5], inCar: !!v[6],
    };
  }

  /**
   * Saves the game into a slot. The picture is taken now unless one is given (the Saves screen
   * takes it before it covers the game).
   * @returns {Promise<boolean>}
   */
  async save(slot, { picture = null, quiet = false } = {}) {
    if (this.busy) return false;
    if (!this.canSave()) { if (!quiet) toast('Saving works during a single-player game.', true); return false; }
    this.busy = true;
    try {
      const M = this.Module;
      await until(() => !this.map.building);
      // between frames (this is a key, click or timer callback), so the copy is one consistent moment
      const clockPtr = M._malloc(8);
      const end = M.ccall('gta2_port_savestate_prepare', 'number', ['number'], [clockPtr]) >>> 0;
      const clock = M.HEAPF64[clockPtr >> 3];
      M._free(clockPtr);
      const bytes = M.HEAPU8.slice(0, end);
      const label = this.label();
      const thumb = picture || await this.picture();
      const started = performance.now();
      const [data, build] = await Promise.all([gzip(bytes), buildId()]);
      await write((store) => store.put({ slot, build, savedAt: Date.now(), size: end, clock, data, label, thumb }));
      console.log(`save ${slot}: ${(end / 1048576).toFixed(1)} MB -> ${(data.size / 1048576).toFixed(1)} MB in ${Math.round(performance.now() - started)} ms`);
      if (!quiet) toast(slot === 'quick' ? `Quick saved (${LOAD_KEY} to load)` : `Saved to ${slotName(slot)}`);
      return true;
    } catch (err) {
      console.error(err);
      toast(`Could not save: ${err.message || err}`, true);
      return false;
    } finally {
      this.busy = false;
    }
  }

  /** @returns {Promise<boolean>} */
  async load(slot) {
    if (this.busy) return false;
    this.busy = true;
    try {
      const M = this.Module;
      const record = await get(slot);
      if (!record) {
        toast(slot === 'quick' ? `No quick save yet: press ${SAVE_KEY} during a game.` : `${slotName(slot)} is empty.`, true);
        return false;
      }
      if (record.build !== await buildId()) { toast('That save was made by a different version of the game.', true); return false; }
      const bytes = await gunzip(record.data);
      if (bytes.length !== record.size) throw new Error('the save is damaged');
      await until(() => !this.map.building);
      if (!M.ccall('gta2_port_savestate_reserve', 'number', ['number'], [record.size])) throw new Error('not enough memory');
      // one synchronous step between frames: the game's memory becomes the saved one
      const heap = M.HEAPU8;
      heap.set(bytes, 0);
      heap.fill(0, bytes.length); // above the saved heap's end: unused, as the allocator expects
      M.ccall('gta2_port_savestate_restored', null, ['number'], [record.clock]);
      M.ccall('gta2_port_set_paused', null, ['number'], [0]); // a save made behind the Saves screen was paused
      this.map.invalidate();
      toast(slot === 'quick' ? 'Quick loaded' : `Loaded ${slotName(slot)}`);
      return true;
    } catch (err) {
      console.error(err);
      toast(`Could not load: ${err.message || err}`, true);
      return false;
    } finally {
      this.busy = false;
    }
  }
}
