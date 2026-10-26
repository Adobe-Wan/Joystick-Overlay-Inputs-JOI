// Keeping OBS light: a device's resting wobble never makes the overlay redraw, slow moves still show, and the
// 30 FPS draw rate halves the frames OBS has to composite while inputs move.
const { test, expect, readFixture } = require("./fixtures/app");

const VALID = JSON.parse(readFixture("valid.json"));
const pad = (id, axes, buttons) => ({ id, axes: Array(axes).fill(0), buttons });
const DEVICES = [pad("Dev (Vendor: 0001 Product: 0002)", 8, 32), pad("Dev (Vendor: 0001 Product: 0002)", 8, 32),
  pad("Thr (Vendor: 0003 Product: 0004)", 8, 32), { id: "T-Rudder (Vendor: 231d Product: 011f)", axes: [-1, -1, 0, 0, 0, 0], buttons: 0 }];

// Counts drawWidget calls, and drives every device from a timer with fn(t, slot, axis) -> value.
async function drive(page, fn) {
  await page.evaluate(src => {
    const f = new Function("t", "s", "i", "return " + src);
    window.__draws = 0;
    const d = drawWidget; window.drawWidget = (...a) => { window.__draws++; return d(...a); };
    let t = 0;
    window.__drive = setInterval(() => { t++; for (let s = 0; s < 4; s++) { const a = {}; for (let i = 0; i < 8; i++) a[i] = f(t, s, i); window.__fakeGP.set(s, { axes: a }); } }, 8);
  }, fn);
}
const drawsOver = async (page, ms) => { const a = await page.evaluate(() => window.__draws); await page.waitForTimeout(ms); return (await page.evaluate(() => window.__draws)) - a; };

test("a device wobbling at rest is never redrawn, and the loop drops to idle polling", async ({ app, page }) => {
  await app.open({ profile: VALID, devices: DEVICES, query: "?transparent" });
  await drive(page, "(s === 3 && i < 2 ? -1 : 0) + (Math.random() - 0.5) * 0.008");   // ±0.4%
  await page.waitForTimeout(1000);
  expect(await drawsOver(page, 2000)).toBe(0);
  expect(await page.evaluate(() => !!rafId), "requestAnimationFrame running").toBe(false);
});

test("a slow, steady move still draws, and lands exactly on the end", async ({ app, page }) => {
  await app.open({ profile: VALID, devices: DEVICES, query: "?transparent" });
  await drive(page, "Math.min(1, t * 0.002)");   // 0.2% per tick, under the noise threshold each step
  await page.waitForTimeout(500);
  expect(await drawsOver(page, 1500)).toBeGreaterThan(0);
  await page.waitForTimeout(4000);
  const shown = await page.evaluate(() => { const w = profile.widgets.find(o => o.id === "p1"); return runtime[w.id].root.textContent; });
  expect(shown).toContain("100%");
});

test("Draw rate 30 FPS halves the passes while inputs move, and is shared by every profile", async ({ app, page }) => {
  await app.open({ profile: VALID, devices: DEVICES, query: "?transparent" });
  await drive(page, "Math.sin(t / (20 + 7 * i + s))");
  await page.waitForTimeout(800);
  const at60 = await drawsOver(page, 2000);
  await page.evaluate(() => { profile.settings.fps = 30; save(); });
  await page.waitForTimeout(300);
  const at30 = await drawsOver(page, 2000);
  expect(at30).toBeLessThan(at60 * 0.65);
  expect(at30).toBeGreaterThan(at60 * 0.3);
  await page.evaluate(() => { addBlankLayout(); });
  expect(await page.evaluate(() => profile.settings.fps)).toBe(30);
});

test("Draw rate 30 also steps Projector motion, which runs freely again at 60", async ({ app, page }) => {
  await app.open({ profile: VALID, devices: DEVICES, query: "?transparent" });
  await page.evaluate(() => { for (const w of profile.widgets) w.holo = { on: true, tier: "subtle" }; save(); rebuildAll(); });
  const state = () => page.evaluate(() => document.getAnimations().filter(a => a.animationName === "holo-env").map(a => [a.playState, a.currentTime]));
  await page.waitForTimeout(200);
  const free = await state();
  expect(free.length).toBeGreaterThan(0);
  expect(free.every(([s]) => s === "running")).toBe(true);
  await page.evaluate(() => { profile.settings.fps = 30; save(); applySettings(); });
  await page.waitForTimeout(200);
  const a = await state();
  expect(a.every(([s]) => s === "paused")).toBe(true);
  await page.waitForTimeout(300);
  const b = await state();
  expect(b[0][1] - a[0][1]).toBeGreaterThan(200);   // still moving, a step at a time
  expect(b[0][1] - a[0][1]).toBeLessThan(400);
  // A rebuild makes new animations, which are paused on the next step.
  await page.evaluate(() => rebuildAll());
  await page.waitForTimeout(150);
  expect((await state()).every(([s]) => s === "paused")).toBe(true);
  await page.evaluate(() => { profile.settings.fps = 60; save(); applySettings(); });
  const c = await state();
  expect(c.every(([s]) => s === "running")).toBe(true);
  expect(await page.evaluate(() => stepT)).toBe(0);
});

// Smoothness Check: what the browser lets the overlay draw while inputs move, so a pilot can see a game starving OBS.
const checkText = page => page.evaluate(() => { setSelection([], "settings"); return document.querySelector("#frame-check").textContent; });

test("Smoothness Check waits for movement, then reports frames a second while inputs move", async ({ app, page }) => {
  await app.open({ profile: VALID, devices: DEVICES, query: "?edit" });
  await page.waitForTimeout(600);   // the first paint after loading draws every widget, which is not movement
  expect(await checkText(page)).toMatch(/^Move a control/);
  expect(await page.evaluate(() => frameReport())).toBeNull();
  await drive(page, "Math.sin(t / (20 + 7 * i + s))");
  await page.waitForTimeout(2500);
  const r = await page.evaluate(() => frameReport());
  expect(r.fps).toBeGreaterThan(15);   // a loaded test machine (or a trace being recorded) runs below 60
  expect(r.fps).toBeLessThanOrEqual(r.best + 0.01);
  expect(r.slow).toBe(false);
  expect(await checkText(page)).toMatch(/frames a second, longest pause \d+ ms\. Best this session: \d+/);
  await expect(page.locator("#frame-check")).not.toHaveClass(/warn/);
  // At rest the loop polls on a timer, and those ticks are not frames OBS was asked for: nothing more is counted.
  await page.evaluate(() => clearInterval(window.__drive));
  await page.waitForTimeout(1000);
  const before = await page.evaluate(() => frameStats.buckets.reduce((n, b) => n + b.frames, 0));
  await page.waitForTimeout(1500);
  expect(await page.evaluate(() => frameStats.buckets.reduce((n, b) => n + b.frames, 0))).toBe(before);
});

test("Smoothness Check warns when frames come far slower than the session's best", async ({ app, page }) => {
  await app.open({ profile: VALID, devices: DEVICES, query: "?edit" });
  await drive(page, "Math.sin(t / (20 + 7 * i + s))");
  await page.waitForTimeout(2500);
  // Stand in for a starved browser: every frame now takes about 100 ms.
  await page.evaluate(() => { const spin = () => { const end = performance.now() + 95; while (performance.now() < end); window.__spin = requestAnimationFrame(spin); }; window.__spin = requestAnimationFrame(spin); });
  await page.waitForTimeout(6000);
  await page.evaluate(() => cancelAnimationFrame(window.__spin));
  const r = await page.evaluate(() => frameReport());
  expect(r.slow).toBe(true);
  expect(r.worst).toBeLessThan(r.best * 0.5);
  expect(r.longest).toBeGreaterThan(90);
  expect(await checkText(page)).toContain("holding OBS's browser back");
  await expect(page.locator("#frame-check")).toHaveClass(/warn/);
});
