// Fake Gamepad API for Playwright init scripts (browser side).
// Replaces navigator.getGamepads with a scriptable set of devices driven by a per-frame timeline.
//
// window.__fakeGP API:
//   plug(spec, slot?)        -> slot index. spec = { id, axes:[...rest], buttons:n|[...], zeroUntilReport?:bool, mapping?:"" }
//   unplug(slot)
//   set(slot, { axes:{i:v}, buttons:{i:true|false|0..1} })   // immediate
//   load(timeline)           // [{ at:frame, op:"set"|"plug"|"unplug", slot, axes, buttons, spec }], at relative to now
//   frame                    // frames ticked so far
//   pending()                // timeline entries not yet applied
//   config({ maxSlots, gestureGate })  // maxSlots: slots returned (Chrome = 4); gestureGate: hide all pads until a gesture
//   log                      // [{frame, ev}] connect/disconnect events dispatched
//   polls                    // how many times the page called navigator.getGamepads()
// Frames advance once per distinct requestAnimationFrame timestamp, before the page's callbacks run,
// so a timeline frame == one page frame (one wizardTick).
(() => {
  const S = { slots: [], queue: [], frame: 0, polls: 0, maxSlots: 4, gestureGate: false, gestured: false, log: [], lastTs: -1 };
  const mkButtons = b => (Array.isArray(b) ? b : Array.from({ length: b ?? 16 }, () => 0)).map(v => ({ v: +v }));
  function plug(spec, slot) {
    if (slot == null) { slot = 0; while (S.slots[slot]) slot++; }
    const rest = (spec.axes || []).slice();
    const d = { id: spec.id, index: slot, mapping: spec.mapping || "", rest,
      axes: spec.zeroUntilReport ? rest.map(() => 0) : rest.slice(), reported: !spec.zeroUntilReport,
      buttons: mkButtons(spec.buttons), ts: performance.now() };
    S.slots[slot] = d;
    checkGesture(d);
    dispatch("gamepadconnected", d);
    return slot;
  }
  function unplug(slot) { const d = S.slots[slot]; if (!d) return; S.slots[slot] = null; dispatch("gamepaddisconnected", d, false); }
  function set(slot, { axes = {}, buttons = {} } = {}) {
    const d = S.slots[slot]; if (!d) return;
    if (!d.reported) { d.reported = true; d.axes = d.rest.slice(); }   // first HID report: every axis jumps to its real value
    for (const i in axes) d.axes[i] = +axes[i];
    for (const i in buttons) d.buttons[i] = { v: buttons[i] === true ? 1 : buttons[i] === false ? 0 : +buttons[i] };
    d.ts = performance.now();
    checkGesture(d);
  }
  function checkGesture(d) {
    if (d.buttons.some(b => b.v > 0.5) || d.axes.some(a => Math.abs(a) > 0.5)) S.gestured = true;
  }
  function visible() { return !S.gestureGate || S.gestured; }
  function snap(d) {
    return Object.freeze({ id: d.id, index: d.index, connected: true, mapping: d.mapping, timestamp: d.ts,
      axes: Object.freeze(d.axes.slice()),
      buttons: Object.freeze(d.buttons.map(b => Object.freeze({ pressed: b.v > 0.5, touched: b.v > 0, value: b.v }))) });
  }
  function dispatch(type, d, connected = true) {
    S.log.push({ frame: S.frame, ev: type, slot: d.index });
    if (!visible() && connected) return;
    const e = new Event(type); e.gamepad = Object.assign({}, snap(d), { connected });
    queueMicrotask(() => window.dispatchEvent(e));
  }
  function apply(e) {
    if (e.op === "plug") plug(e.spec, e.slot);
    else if (e.op === "unplug") unplug(e.slot);
    else if (e.op === "set") set(e.slot, e);
  }
  function tick() {
    S.frame++;
    while (S.queue.length && S.queue[0].abs <= S.frame) apply(S.queue.shift());
  }
  Object.defineProperty(navigator, "getGamepads", { configurable: true, value: function getGamepads() {
    S.polls++;
    const out = [];
    const n = Math.max(S.maxSlots, 0);
    for (let i = 0; i < n; i++) { const d = S.slots[i]; out.push(d && visible() ? snap(d) : null); }
    return out;
  } });
  const raf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = cb => raf(ts => { if (ts !== S.lastTs) { S.lastTs = ts; tick(); } cb(ts); });
  window.__fakeGP = {
    plug, unplug, set,
    load(tl) {
      const base = S.frame;
      for (const e of tl) S.queue.push(Object.assign({}, e, { abs: base + (e.at || 0) }));
      S.queue.sort((a, b) => a.abs - b.abs);
    },
    pending: () => S.queue.length,
    get frame() { return S.frame; },
    get polls() { return S.polls; },
    config(o) { if (o.maxSlots != null) S.maxSlots = o.maxSlots; if (o.gestureGate != null) S.gestureGate = o.gestureGate; },
    get log() { return S.log; },
    state: () => S.slots.map(d => d && { id: d.id, axes: d.axes.slice(), buttons: d.buttons.map(b => b.v) })
  };
})();
