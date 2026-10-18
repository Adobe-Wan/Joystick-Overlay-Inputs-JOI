// A device that loses power and comes back, including one of two identical devices (a pair of VIRPIL Alpha Primes
// share USB ids and are told apart by the slot they were bound in).
const { test, expect } = require("./fixtures/app");
const h = require("./fixtures/gamepad");

const VID = h.DEV.virpil().id;
const stick = (id, nth, slot, label) => ({ id, type: "stick", x: 100 + nth * 300, y: 100, label, match: VID, nth, slot, axes: { x: 0, y: 1 }, inv: {} });
const THR = h.DEV.throttle();
const profile = { ver: 2, savedAt: 1, settings: {}, widgets: [
  stick("mongoose", 0, 0, "Mongoose"), stick("warbrd", 1, 1, "WarBRD"),
  { id: "thr", type: "throttle", x: 700, y: 100, label: "Throttle", match: THR.id, nth: 0, slot: 2, axes: { t: 2 }, inv: {} }] };

const offline = page => page.evaluate(() => Object.fromEntries(profile.widgets.map(w => [w.id, runtime[w.id].root.classList.contains("offline")])));
// The value a widget's pad currently reports on axis 0, so a widget showing the wrong device is caught.
const reads = page => page.evaluate(() => Object.fromEntries(profile.widgets.map(w => { const rt = runtime[w.id], p = padOf(w, rt); return [w.id, p ? p.axes[0] : null]; })));

async function setup(app, { devices, gestureGate = false } = {}) {
  await app.open({ profile, gestureGate, devices: devices || [h.DEV.virpil({ axes: [0.1, 0, 0, 0, 0, 0, 0, 0, 0, h.DEV.virpil().axes[9]] }), h.DEV.virpil({ axes: [0.2, 0, 0, 0, 0, 0, 0, 0, 0, h.DEV.virpil().axes[9]] }), THR] });
  await app.frames(10);
}
const wait = (app, n = 40) => app.frames(n);

test.describe("a device that drops out and comes back", () => {
  test("the second identical stick returns in its own slot", async ({ app, page }) => {
    await setup(app);
    expect(await offline(page)).toEqual({ mongoose: false, warbrd: false, thr: false });
    await page.evaluate(() => window.__fakeGP.unplug(1)); await wait(app);
    expect(await offline(page)).toEqual({ mongoose: false, warbrd: true, thr: false });
    await page.evaluate(([spec]) => window.__fakeGP.plug(spec, 1), [h.DEV.virpil({ axes: [0.2, 0, 0, 0, 0, 0, 0, 0, 0, 1.2857] })]); await wait(app);
    expect(await offline(page)).toEqual({ mongoose: false, warbrd: false, thr: false });
    expect(await reads(page)).toMatchObject({ mongoose: 0.1, warbrd: 0.2 });
  });

  test("the second identical stick returns in a different slot", async ({ app, page }) => {
    await setup(app);
    await page.evaluate(() => window.__fakeGP.unplug(1)); await wait(app);
    await page.evaluate(([spec]) => window.__fakeGP.plug(spec, 3), [h.DEV.virpil({ axes: [0.2, 0, 0, 0, 0, 0, 0, 0, 0, 1.2857] })]); await wait(app);
    expect(await offline(page)).toEqual({ mongoose: false, warbrd: false, thr: false });
    expect(await reads(page)).toMatchObject({ mongoose: 0.1, warbrd: 0.2 });
  });

  test("the first identical stick returns in a different slot", async ({ app, page }) => {
    await setup(app);
    await page.evaluate(() => window.__fakeGP.unplug(0)); await wait(app);
    expect(await offline(page)).toEqual({ mongoose: true, warbrd: false, thr: false });
    await page.evaluate(([spec]) => window.__fakeGP.plug(spec, 3), [h.DEV.virpil({ axes: [0.1, 0, 0, 0, 0, 0, 0, 0, 0, 1.2857] })]); await wait(app);
    expect(await offline(page)).toEqual({ mongoose: false, warbrd: false, thr: false });
    expect(await reads(page)).toMatchObject({ mongoose: 0.1, warbrd: 0.2 });
  });

  test("both sticks drop out and come back one at a time", async ({ app, page }) => {
    await setup(app);
    await page.evaluate(() => { window.__fakeGP.unplug(0); window.__fakeGP.unplug(1); }); await wait(app);
    expect(await offline(page)).toEqual({ mongoose: true, warbrd: true, thr: false });
    await page.evaluate(([spec]) => window.__fakeGP.plug(spec, 1), [h.DEV.virpil({ axes: [0.2, 0, 0, 0, 0, 0, 0, 0, 0, 1.2857] })]); await wait(app);
    const mid = await offline(page);
    expect(mid.mongoose).toBe(true);   // never shows the other stick's input
    await page.evaluate(([spec]) => window.__fakeGP.plug(spec, 0), [h.DEV.virpil({ axes: [0.1, 0, 0, 0, 0, 0, 0, 0, 0, 1.2857] })]); await wait(app);
    expect(await offline(page)).toEqual({ mongoose: false, warbrd: false, thr: false });
    expect(await reads(page)).toMatchObject({ mongoose: 0.1, warbrd: 0.2 });
  });

  test("a device the browser hides until a button is pressed", async ({ app, page }) => {
    await setup(app);
    await page.evaluate(() => window.__fakeGP.unplug(1)); await wait(app);
    await page.evaluate(([spec]) => { window.__fakeGP.config({ gestureGate: true }); window.__fakeGP.plug(spec, 1); }, [h.DEV.virpil({ axes: [0.2, 0, 0, 0, 0, 0, 0, 0, 0, 1.2857] })]); await wait(app, 60);
    await page.evaluate(() => window.__fakeGP.set(1, { buttons: { 0: true } })); await wait(app);
    expect((await offline(page)).warbrd).toBe(false);
  });

  test("everything drops out, then everything returns", async ({ app, page }) => {
    await setup(app);
    await page.evaluate(() => { for (const s of [0, 1, 2]) window.__fakeGP.unplug(s); }); await wait(app, 120);
    expect(await offline(page)).toEqual({ mongoose: true, warbrd: true, thr: true });
    await page.evaluate(([a, b, c]) => { window.__fakeGP.plug(a, 0); window.__fakeGP.plug(b, 1); window.__fakeGP.plug(c, 2); },
      [h.DEV.virpil({ axes: [0.1, 0, 0, 0, 0, 0, 0, 0, 0, 1.2857] }), h.DEV.virpil({ axes: [0.2, 0, 0, 0, 0, 0, 0, 0, 0, 1.2857] }), THR]);
    await wait(app, 120);
    expect(await offline(page)).toEqual({ mongoose: false, warbrd: false, thr: false });
  });

  test("it drops out and returns while no input moves, with the loop asleep", async ({ app, page }) => {
    await setup(app);
    await wait(app, 200);   // long enough for the loop to idle
    await page.evaluate(() => window.__fakeGP.unplug(1)); await wait(app, 120);
    await page.evaluate(([spec]) => window.__fakeGP.plug(spec, 1), [h.DEV.virpil({ axes: [0.2, 0, 0, 0, 0, 0, 0, 0, 0, 1.2857] })]); await wait(app, 120);
    expect((await offline(page)).warbrd).toBe(false);
  });

  test("it can drop out and come back again, in a new slot each time", async ({ app, page }) => {
    await setup(app);
    let at = 1;
    for (const next of [3, 1, 3]) {
      await page.evaluate(slot => window.__fakeGP.unplug(slot), at); await wait(app);
      expect(await offline(page)).toEqual({ mongoose: false, warbrd: true, thr: false });
      await page.evaluate(([spec, slot]) => window.__fakeGP.plug(spec, slot), [h.DEV.virpil({ axes: [0.2, 0, 0, 0, 0, 0, 0, 0, 0, 1.2857] }), next]); await wait(app);
      expect(await offline(page)).toEqual({ mongoose: false, warbrd: false, thr: false });
      expect(await reads(page)).toMatchObject({ mongoose: 0.1, warbrd: 0.2 });
      at = next;
    }
  });

  // Layouts made before slots were stored, or whose slots went stale, bind identical sticks by their order alone.
  test.describe("a layout that stores no slots", () => {
    const slotless = { ...profile, widgets: profile.widgets.map(w => { const rest = { ...w }; delete rest.slot; return rest; }) };
    test("the other stick stays online while one drops out, and both are right when it returns", async ({ app, page }) => {
      await app.open({ profile: slotless, devices: [h.DEV.virpil({ axes: [0.1, 0, 0, 0, 0, 0, 0, 0, 0, 1.2857] }), h.DEV.virpil({ axes: [0.2, 0, 0, 0, 0, 0, 0, 0, 0, 1.2857] }), THR] });
      await wait(app, 10);
      await page.evaluate(() => window.__fakeGP.unplug(1)); await wait(app);
      expect(await offline(page)).toEqual({ mongoose: false, warbrd: true, thr: false });
      expect(await reads(page)).toMatchObject({ mongoose: 0.1 });
      await page.evaluate(([spec]) => window.__fakeGP.plug(spec, 3), [h.DEV.virpil({ axes: [0.2, 0, 0, 0, 0, 0, 0, 0, 0, 1.2857] })]); await wait(app);
      expect(await offline(page)).toEqual({ mongoose: false, warbrd: false, thr: false });
      expect(await reads(page)).toMatchObject({ mongoose: 0.1, warbrd: 0.2 });
    });
    test("the first stick dropping does not hand its widget to the second stick", async ({ app, page }) => {
      await app.open({ profile: slotless, devices: [h.DEV.virpil({ axes: [0.1, 0, 0, 0, 0, 0, 0, 0, 0, 1.2857] }), h.DEV.virpil({ axes: [0.2, 0, 0, 0, 0, 0, 0, 0, 0, 1.2857] }), THR] });
      await wait(app, 10);
      await page.evaluate(() => window.__fakeGP.unplug(0)); await wait(app);
      expect(await offline(page)).toEqual({ mongoose: true, warbrd: false, thr: false });
      expect(await reads(page)).toMatchObject({ warbrd: 0.2 });
    });
  });
});
