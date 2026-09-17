/* ==========================================================================
   FACETING STUDIO — crown / pavilion angle viewer
   --------------------------------------------------------------------------
   Everything you're likely to need to change lives in CONFIG below.
   ========================================================================== */

const CONFIG = {
  // Folder holding the photos, relative to this index.html file.
  photoDir: "JS+gem/",

  // Filename prefixes, in the order they appear in the filename.
  // Your example filename was:
  //   Cro30.00Pav40.00Tab58.00Sta50.00Low78.00.jpg
  // (your written instructions said "Cor" for crown — "Cro" is what's
  // actually in the example filename, so that's what's used here. If your
  // real files use "Cor", just change it below.)
  filePrefixes: { crown: "Cro", pavilion: "Pav", table: "Tab", star: "Sta", lower: "Low" },
  extension: ".jpg",

  // Variable axes
  crown:    { min: 30.0, max: 40.0, step: 0.5, default: 35.0 },
  pavilion: { min: 40.0, max: 42.0, step: 0.2, default: 41.0 },

  // Fixed, display-only values. These must match the photos you actually
  // have in src/photo/ — the app doesn't vary these, it just prints them
  // into the filename and onto the spec card.
  fixed: { table: 58.00, star: 50.00, lower: 78.00 },

  preloadConcurrency: 8,
};

/* ---------------------------------------------------------------------- */
/* Helpers                                                                 */
/* ---------------------------------------------------------------------- */

function fmt2(n) {
  return n.toFixed(2);
}

// Builds an inclusive numeric range [min..max] stepping by `step`,
// rounded to 2dp to avoid floating point drift (e.g. 40.19999999).
function range(min, max, step) {
  const count = Math.round((max - min) / step);
  const out = [];
  for (let i = 0; i <= count; i++) {
    out.push(Math.round((min + i * step) * 100) / 100);
  }
  return out;
}

function buildFilename(crown, pavilion) {
  const P = CONFIG.filePrefixes;
  const F = CONFIG.fixed;
  return (
    P.crown + fmt2(crown) +
    P.pavilion + fmt2(pavilion) +
    P.table + fmt2(F.table) +
    P.star + fmt2(F.star) +
    P.lower + fmt2(F.lower) +
    CONFIG.extension
  );
}

function photoUrl(crown, pavilion) {
  return CONFIG.photoDir + buildFilename(crown, pavilion);
}

const crownSteps = range(CONFIG.crown.min, CONFIG.crown.max, CONFIG.crown.step);
const pavilionSteps = range(CONFIG.pavilion.min, CONFIG.pavilion.max, CONFIG.pavilion.step);

/* ---------------------------------------------------------------------- */
/* Image cache / preloading                                               */
/* ---------------------------------------------------------------------- */

const imageCache = new Map(); // src -> Promise<{img, ok}>

function getImage(src) {
  if (imageCache.has(src)) return imageCache.get(src);
  const p = new Promise((resolve) => {
    const img = new Image();
    img.decoding = "async";
    img.onload = () => resolve({ img, ok: true });
    img.onerror = () => resolve({ img, ok: false });
    img.src = src;
  });
  imageCache.set(src, p);
  return p;
}

async function preloadAll(onProgress) {
  const combos = [];
  for (const c of crownSteps) for (const p of pavilionSteps) combos.push([c, p]);
  const total = combos.length;
  let done = 0;
  const queue = combos.slice();

  async function worker() {
    while (queue.length) {
      const [c, p] = queue.shift();
      await getImage(photoUrl(c, p));
      done++;
      onProgress && onProgress(done, total);
    }
  }
  const workers = Array.from({ length: CONFIG.preloadConcurrency }, worker);
  await Promise.all(workers);
}

/* ---------------------------------------------------------------------- */
/* Stage — crossfades between the two <img> layers, never shows a blank   */
/* frame because the incoming image is always fully decoded first.       */
/* ---------------------------------------------------------------------- */

const imgLayers = [document.getElementById("imgA"), document.getElementById("imgB")];
const stageErrorEl = document.getElementById("stageError");
const stageLoaderEl = document.getElementById("stageLoader");
let activeLayer = 0;
let showToken = 0;
let firstFrameShown = false;

async function showFrame(crown, pavilion) {
  const src = photoUrl(crown, pavilion);
  const myToken = ++showToken;

  const { img, ok } = await getImage(src);
  if (myToken !== showToken) return; // a newer frame was requested meanwhile

  if (!ok) {
    stageErrorEl.hidden = false;
    stageErrorEl.innerHTML =
      `Photo not found:<br><b>${buildFilename(crown, pavilion)}</b><br>` +
      `Check that it exists in <b>${CONFIG.photoDir}</b>`;
    return; // keep whatever was showing before — no flicker
  }
  stageErrorEl.hidden = true;

  const next = imgLayers[1 - activeLayer];
  const curr = imgLayers[activeLayer];
  next.src = img.src;
  try { await next.decode(); } catch (e) { /* some browsers may reject; fine to continue */ }
  if (myToken !== showToken) return;

  next.classList.add("is-visible");
  curr.classList.remove("is-visible");
  activeLayer = 1 - activeLayer;

  if (!firstFrameShown) {
    firstFrameShown = true;
    stageLoaderEl.classList.add("is-hidden");
  }
}

/* ---------------------------------------------------------------------- */
/* Generic angle slider — pointer drag, wheel / trackpad, keyboard        */
/* ---------------------------------------------------------------------- */

class AngleSlider {
  constructor({ el, orientation, steps, valueEl, suffix, initialIndex, onChange }) {
    this.el = el;
    this.orientation = orientation; // 'vertical' | 'horizontal'
    this.steps = steps;
    this.valueEl = valueEl;
    this.suffix = suffix || "";
    this.onChange = onChange;
    this.track = el.querySelector(".slider__track");
    this.fill = el.querySelector(".slider__fill");
    this.handle = el.querySelector(".slider__handle");
    this.index = initialIndex ?? Math.floor(steps.length / 2);
    this.dragging = false;
    this.el.style.touchAction = "none";

    this.el.setAttribute("tabindex", "0");
    this.el.setAttribute("role", "slider");
    this.el.setAttribute("aria-orientation", orientation);
    this.el.setAttribute("aria-valuemin", steps[0]);
    this.el.setAttribute("aria-valuemax", steps[steps.length - 1]);

    this._bind();
    this._render(false);
  }

  get value() { return this.steps[this.index]; }

  _bind() {
    const onDown = (e) => {
      this.dragging = true;
      this.el.classList.add("is-active");
      this.el.focus();
      try { this.el.setPointerCapture(e.pointerId); } catch (err) {}

      this._startX = e.clientX;
      this._startY = e.clientY;
      this._startIndex = this.index;

      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    };

    const onMove = (e) => {
      if (!this.dragging) return;
      const rect = this.track.getBoundingClientRect();
      const range = this.steps.length - 1;
      let delta = 0;
      if (this.orientation === "horizontal") {
        delta = (e.clientX - this._startX) / (rect.width || 1);
      } else {
        delta = (this._startY - e.clientY) / (rect.height || 1);
      }
      this.setIndex(Math.round(this._startIndex + delta * range));
    };

    const onUp = () => {
      this.dragging = false;
      this.el.classList.remove("is-active");
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };

    this.el.addEventListener("pointerdown", onDown);

    // Two-finger trackpad swipe (and mouse wheel) while hovering the slider.
    this.el.addEventListener("wheel", (e) => {
      e.preventDefault();
      const raw = this.orientation === "horizontal"
        ? (Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY)
        : e.deltaY;
      if (Math.abs(raw) < 1) return;
      this.setIndex(this.index + (raw > 0 ? 1 : -1));
    }, { passive: false });

    this.el.addEventListener("keydown", (e) => {
      const next = this.orientation === "horizontal"
        ? { ArrowRight: 1, ArrowLeft: -1 }
        : { ArrowUp: 1, ArrowDown: -1 };
      if (e.key in next) { e.preventDefault(); this.setIndex(this.index + next[e.key]); }
      else if (e.key === "Home") { e.preventDefault(); this.setIndex(0); }
      else if (e.key === "End") { e.preventDefault(); this.setIndex(this.steps.length - 1); }
    });

    this.el.addEventListener("focus", () => this.el.classList.add("is-focused"));
    this.el.addEventListener("blur", () => this.el.classList.remove("is-focused"));
  }

  setIndex(idx) {
    idx = Math.min(this.steps.length - 1, Math.max(0, idx));
    const changed = idx !== this.index;
    this.index = idx;
    this._render(true);
    if (changed) this.onChange && this.onChange(this.value, this.index);
  }

  _render() {
    const fraction = this.index / (this.steps.length - 1);
    if (this.orientation === "horizontal") {
      this.handle.style.left = `${fraction * 100}%`;
      this.fill.style.width = `${fraction * 100}%`;
    } else {
      this.handle.style.top = `${(1 - fraction) * 100}%`;
      this.fill.style.height = `${fraction * 100}%`;
    }
    this.el.setAttribute("aria-valuenow", this.value);
    if (this.valueEl) this.valueEl.textContent = `${this.value.toFixed(1)}${this.suffix}`;
  }
}

/* ---------------------------------------------------------------------- */
/* Wire it all up                                                         */
/* ---------------------------------------------------------------------- */

const state = { crown: CONFIG.crown.default, pavilion: CONFIG.pavilion.default };

function nearestIndex(steps, target) {
  let best = 0, bestDiff = Infinity;
  steps.forEach((v, i) => {
    const d = Math.abs(v - target);
    if (d < bestDiff) { bestDiff = d; best = i; }
  });
  return best;
}

const crownSlider = new AngleSlider({
  el: document.getElementById("crownSlider"),
  orientation: "vertical",
  steps: crownSteps,
  valueEl: document.getElementById("crownValue"),
  suffix: "°",
  initialIndex: nearestIndex(crownSteps, CONFIG.crown.default),
  onChange: (v) => { state.crown = v; showFrame(state.crown, state.pavilion); },
});

const pavilionSlider = new AngleSlider({
  el: document.getElementById("pavilionSlider"),
  orientation: "horizontal",
  steps: pavilionSteps,
  valueEl: document.getElementById("pavilionValue"),
  suffix: "°",
  initialIndex: nearestIndex(pavilionSteps, CONFIG.pavilion.default),
  onChange: (v) => { state.pavilion = v; showFrame(state.crown, state.pavilion); },
});

// Spec card (fixed, informational values)
document.getElementById("specTable").textContent = `${CONFIG.fixed.table.toFixed(1)}%`;
document.getElementById("specStar").textContent = `${CONFIG.fixed.star.toFixed(1)}%`;
document.getElementById("specLower").textContent = `${CONFIG.fixed.lower.toFixed(1)}%`;

// Initial frame, then background-preload the full grid so every later
// slide is a flicker-free crossfade from cache.
showFrame(state.crown, state.pavilion).then(() => {
  const statusEl = document.getElementById("preloadStatus");
  const fillEl = document.getElementById("preloadFill");
  const labelEl = document.getElementById("preloadLabel");
  statusEl.hidden = false;
  preloadAll((done, total) => {
    fillEl.style.width = `${(done / total) * 100}%`;
    if (done >= total) {
      labelEl.textContent = `Gallery ready — ${total} views loaded`;
      setTimeout(() => { statusEl.hidden = true; }, 1200);
    }
  });
});
