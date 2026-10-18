// Screenshots of the full-featured profile (fixtures/valid.json) in overlay mode, compared with committed baselines
// in tests/__screenshots__/. After an intended visual change, regenerate them with `npm run test:update-snapshots`
// and review the new PNGs before committing.
const { test, expect, readFixture, fixturePath } = require("./fixtures/app");

const VALID = JSON.parse(readFixture("valid.json"));
// A solid backdrop, so the shot shows the widgets the way a chroma-keyed OBS source would.
const PROFILE = { ...VALID, settings: { ...VALID.settings, background: "solid", bgColor: "#24303c" } };
const pad = (id, axes, buttons) => ({ id, axes, buttons });
// Devices held at fixed positions, so every widget is live and shows a reading.
const DEVICES = [
  pad("Dev (Vendor: 0001 Product: 0002)", [0.45, -0.3, 0, 0.6, 0, 0, 0, 0], Array.from({ length: 32 }, (_, i) => (i === 3 ? 1 : 0))),
  pad("Dev (Vendor: 0001 Product: 0002)", [-0.6, 0.5, 0, 0, 0, 0, 0, 0], 32),
  pad("Thr (Vendor: 0003 Product: 0004)", [0, 0, 0.2, 0, 0, 0, 0, 0], 32),
  { id: "T-Rudder (Vendor: 231d Product: 011f)", axes: [-0.2, -1, 0, 0, 0, 0.35], buttons: 0 },
  pad("Box (Vendor: 0005 Product: 0006)", [0, 0, 0, -0.4], 16)
];

test.describe("visual", () => {
  test.beforeEach(async ({ page }) => {
    // The page's noise texture and holo dropouts use Math.random: pin it.
    await page.addInitScript(() => { Math.random = () => 0.42; });
  });

  async function shot(app, page, name, change, arg) {
    await app.open({ profile: PROFILE, devices: DEVICES, maxSlots: 5, query: "?transparent" });
    if (change) await page.evaluate(change, arg);
    await app.frames(10);
    await expect(page).toHaveScreenshot(name + ".png", { maxDiffPixelRatio: 0.01, stylePath: fixturePath("screenshot.css") });
  }
  // Color Theme applied to every widget, as from the Settings panel.
  const theme = id => applyThemeTo([...FEATURED_THEMES, ...MFG_THEMES].find(t => t.id === id), [], true);

  test("default theme", async ({ app, page }) => { await shot(app, page, "default-theme", theme, "default"); });
  for (const id of ["aegis", "drake", "crusader", "avs"]) {
    test(`${id} theme`, async ({ app, page }) => { await shot(app, page, `theme-${id}`, theme, id); });
  }
  test("as saved (mixed per-widget themes and looks)", async ({ app, page }) => { await shot(app, page, "as-saved"); });
  test("Projector on every widget", async ({ app, page }) => {
    await shot(app, page, "projector", () => {
      const ws = profile.widgets.filter(w => w.type !== "label");
      setProjector(ws, true);
      for (const w of ws) w.holo.tier = "static";   // Still: no float or flicker, so the frame is stable
      save(); rebuildAll();
    });
  });
  test("Flat on every widget", async ({ app, page }) => {
    await shot(app, page, "flat", () => {
      const l = LOOK_PRESETS.find(x => x.name === "Flat");
      for (const w of profile.widgets) { w.persp = lookPersp(l); w.proj = lookProj(l); delete w.holo; if (w.type === "stick") delete w.face; }
      save(); rebuildAll();
    });
  });
});
