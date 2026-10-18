// Soak: two minutes of continuous simulated input on the full-featured profile, with a pass through the editor
// every 15 s. After forced GCs, JS heap, DOM nodes and event listeners must stay flat.
// Not part of `npm test`; run with `npm run test:soak`.
const { test, expect, readFixture } = require("./fixtures/app");

const VALID = JSON.parse(readFixture("valid.json"));
const pad = (id, axes, buttons) => ({ id, axes: Array(axes).fill(0), buttons });
const DEVICES = [pad("Dev (Vendor: 0001 Product: 0002)", 8, 32), pad("Dev (Vendor: 0001 Product: 0002)", 8, 32),
  pad("Thr (Vendor: 0003 Product: 0004)", 8, 32), { id: "T-Rudder (Vendor: 231d Product: 011f)", axes: [-1, -1, 0, 0, 0, 0], buttons: 0 },
  pad("Box (Vendor: 0005 Product: 0006)", 8, 16)];
const SOAK_MS = 120_000, WARMUP_MS = 10_000, SAMPLE_EVERY_MS = 30_000;

test("@soak two minutes of input keeps memory, DOM and listeners flat", async ({ app, page }) => {
  test.setTimeout(SOAK_MS + 120_000);
  await app.open({ profile: VALID, devices: DEVICES, maxSlots: 5, query: "?transparent" });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Performance.enable");
  const sample = async () => {
    await cdp.send("HeapProfiler.collectGarbage"); await cdp.send("HeapProfiler.collectGarbage");
    const dom = await cdp.send("Memory.getDOMCounters");
    const { metrics } = await cdp.send("Performance.getMetrics");
    const m = Object.fromEntries(metrics.map(x => [x.name, x.value]));
    return { heapMB: +(m.JSHeapUsedSize / 1048576).toFixed(2), nodes: dom.nodes, listeners: dom.jsEventListeners, polls: await page.evaluate(() => window.__fakeGP.polls) };
  };
  // Every axis sweeps, every button toggles, on every frame.
  await page.evaluate(() => {
    let t = 0;
    (function drive() {
      t++;
      for (let s = 0; s < 5; s++) {
        const a = {}, b = {};
        for (let i = 0; i < 8; i++) a[i] = Math.sin(t / (20 + 7 * i + s));
        b[t % 16] = true; b[(t + 8) % 16] = false;
        window.__fakeGP.set(s, { axes: a, buttons: b });
      }
      requestAnimationFrame(drive);
    })();
  });
  // A pass through the editor: select, nudge, open settings, leave. Exercises panel rebuilds and listeners.
  const editorPass = () => page.evaluate(() => {
    setEditing(true); setSelection(["s1"]); setSelection(["s1", "t1", "b1"]); setSelection([], "settings"); setSelection([], "devices");
    setSelection(["p1"]); moveWidgets(selectedWidgets(), 1, 0); moveWidgets(selectedWidgets(), -1, 0); setSelection([]); setEditing(false);
  });

  await page.waitForTimeout(WARMUP_MS);
  await editorPass();
  const base = await sample();
  const samples = [base];
  const t0 = Date.now();
  while (Date.now() - t0 < SOAK_MS) {
    for (let i = 0; i < SAMPLE_EVERY_MS / 15_000; i++) { await page.waitForTimeout(15_000); await editorPass(); }
    samples.push(await sample());
  }
  test.info().annotations.push({ type: "samples", description: JSON.stringify(samples) });
  console.log("soak samples", JSON.stringify(samples));
  const end = samples[samples.length - 1];
  expect(end.polls - base.polls, "overlay kept reading input").toBeGreaterThan((SOAK_MS / 1000) * 20);
  expect(end.nodes - base.nodes, "DOM nodes growth").toBeLessThanOrEqual(Math.max(50, base.nodes * 0.02));
  expect(end.listeners - base.listeners, "event listener growth").toBeLessThanOrEqual(10);
  expect(end.heapMB - base.heapMB, "JS heap growth (MB)").toBeLessThanOrEqual(Math.max(2, base.heapMB * 0.2));
  // Not creeping up sample after sample either.
  const rising = samples.slice(1).every((s, i) => s.nodes > samples[i].nodes);
  expect(rising, "DOM nodes grew at every sample").toBe(false);
});
