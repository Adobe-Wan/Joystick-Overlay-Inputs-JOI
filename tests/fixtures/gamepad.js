// Node-side helpers for driving the fake Gamepad API: device specs, per-frame timeline builders,
// wizard drivers that click through the real UI, and readers for the wizard / widget state.
// One timeline frame is one requestAnimationFrame (about 16.7 ms in headless Chromium), and the page's
// frame() loop runs the detector once per frame, so a timeline frame is exactly one detector tick.

// ---- device specs (Chrome / OBS id strings) ----
const HAT_IDLE = 1.2857142857142858;
const DEV = {
  // Windows DirectInput layout as Chrome reports a non-standard pad: 0 X, 1 Y, 2 Z, 3 Rx, 4 Ry, 5 Rz (twist), 6 slider, 9 hat
  virpil: (o = {}) => ({ id: "VPC Alpha Prime R (Vendor: 3344 Product: 0138)", axes: [0, 0, 0, 0, 0, 0, 0, 0, 0, HAT_IDLE], buttons: 32, ...o }),
  // VKB T-Rudder: 0 left toe brake, 1 right toe brake (rest -1), 5 rudder
  trudder: (o = {}) => ({ id: "T-Rudder (Vendor: 231d Product: 011f)", axes: [-1, -1, 0, 0, 0, 0], buttons: 0, ...o }),
  throttle: (rest = -1, o = {}) => ({ id: "VPC MongoosT-50CM3 Throttle (Vendor: 3344 Product: 0194)", axes: [0, 0, rest, 0, 0, 0, 0, 0], buttons: 64, ...o }),
  xbox: (o = {}) => ({ id: "Xbox 360 Controller (XInput STANDARD GAMEPAD)", axes: [0, 0, 0, 0], buttons: 17, mapping: "standard", ...o }),
  firefoxRudder: (o = {}) => ({ id: "231d-11f-T-Rudder", axes: [-1, -1, 0, 0, 0, 0], buttons: 0, ...o })
};
const AX = { x: 0, y: 1, twist: 5, hat: 9, bl: 0, br: 1, rudder: 5, thr: 2 };

// ---- timeline builders (frames ~ 16.7 ms) ----
const ms = n => Math.round(n / 16.67);
const lcg = seed => { let s = seed; return () => ((s = (s * 16807) % 2147483647) / 2147483647 - 0.5) * 2; };
// Smooth motion of several axes on one slot. axes: { index: [from, to] }. Optional delay / duration per axis
// (frames) and a noise amplitude.
function move(slot, at, frames, axes, { delay = {}, dur = {}, noise = 0, seed = 1 } = {}) {
  const out = [], rnd = lcg(seed);
  const end = Math.max(frames, ...Object.keys(axes).map(i => (delay[i] || 0) + (dur[i] || frames)));
  for (let f = 0; f <= end; f++) {
    const a = {};
    for (const i in axes) {
      const [from, to] = axes[i], d = delay[i] || 0, n = dur[i] || frames;
      const t = Math.min(1, Math.max(0, (f - d) / n)), e = t * t * (3 - 2 * t);
      a[i] = from + (to - from) * e + (noise ? rnd() * noise : 0);
    }
    out.push({ at: at + f, op: "set", slot, axes: a });
  }
  return out;
}
const hold = (slot, at, frames, axes) => Array.from({ length: frames }, (_, f) => ({ at: at + f, op: "set", slot, axes }));
const btn = (slot, at, i, v) => ({ at, op: "set", slot, buttons: { [i]: v } });
const press = (slot, at, i, frames = ms(200)) => [btn(slot, at, i, true), btn(slot, at + frames, i, false)];
const plug = (at, spec, slot) => ({ at, op: "plug", spec, slot });
const unplug = (at, slot) => ({ at, op: "unplug", slot });
function noise(slot, at, frames, idx, rest, amp, seed = 7) {
  const rnd = lcg(seed);
  return Array.from({ length: frames }, (_, f) => ({ at: at + f, op: "set", slot,
    axes: Object.fromEntries(idx.map((i, k) => [i, rest[k] + rnd() * amp])) }));
}
// Push an axis to `to` and back to rest, the way the wizard asks ("move it all the way and let go").
const throwAxis = (slot, at, i, rest, to, opts = {}) => [
  ...move(slot, at, ms(250), { [i]: [rest, to] }, opts),
  ...hold(slot, at + ms(250) + 1, ms(150), { [i]: to }),
  ...move(slot, at + ms(400) + 2, ms(200), { [i]: [to, rest] })];
const stickXY = (slot, at = 5) => [...throwAxis(slot, at, AX.x, 0, 1), ...throwAxis(slot, at + ms(900), AX.y, 0, -1)];

// ---- running a timeline ----
// Wait n page frames.
const frames = (page, n) => page.evaluate(n => new Promise(r => {
  const end = window.__fakeGP.frame + n;
  (function w() { window.__fakeGP.frame >= end ? r() : requestAnimationFrame(w); })();
}), n);
// Queue a timeline (frame offsets relative to now), wait until it has been applied, then `tail` more frames.
async function play(page, timeline, tail = 40) {
  await page.evaluate(tl => window.__fakeGP.load(tl), timeline);
  await page.waitForFunction(() => window.__fakeGP.pending() === 0, null, { timeout: 60_000 });
  await frames(page, tail);
}

// ---- wizard drivers (real UI) ----
async function firstRunToType(page) {
  await page.click("#welcome [data-welcome=device]");          // Add Devices One by One: straight to What Are You Adding?
}
const chooseType = (page, name) => page.click(`#wiz-body .types button:has-text("${name}")`);
const clickAction = (page, text) => page.click(`#wiz-body .actions button:has-text("${text}")`);
const toType = async (page, name) => { await firstRunToType(page); await chooseType(page, name); };

// ---- state readers ----
const wizState = page => page.evaluate(() => wiz && JSON.parse(JSON.stringify({ kind: wiz.kind, stage: wiz.stage, type: wiz.type, step: wiz.step,
  axes: wiz.axes, inv: wiz.inv, button: wiz.button, dev: wiz.dev && { id: wiz.dev.id, nth: wiz.dev.nth, slot: wiz.dev.pad && wiz.dev.pad.index } })));
const widgets = page => page.evaluate(() => JSON.parse(JSON.stringify(profile.widgets.map(w => ({ id: w.id, type: w.type, label: w.label, match: w.match, nth: w.nth, axes: w.axes, inv: w.inv, button: w.button })))));
// Which slot each widget currently reads, as the main loop resolves it.
const resolve = page => page.evaluate(() => profile.widgets.map(w => { const p = padFor(w, connectedPads()); return { label: w.label, slot: p ? p.index : null }; }));

module.exports = { frames, play, DEV, AX, HAT_IDLE, ms, move, hold, btn, press, plug, unplug, noise, throwAxis, stickXY,
  firstRunToType, chooseType, clickAction, toType, wizState, widgets, resolve };
