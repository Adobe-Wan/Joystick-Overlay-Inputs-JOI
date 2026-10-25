// October 2026 UX audit, stage and overlay: editor notes stay out of the stream (R11), and a browser preview chip
// that sits top left and folds to a pill (R18).
const { test, expect } = require("./fixtures/app");
const h = require("./fixtures/gamepad");

const VID = h.DEV.virpil().id;
const stick = (o = {}) => ({ id: "s1", type: "stick", x: 400, y: 300, label: "Stick", match: VID, nth: 0, axes: { x: 0, y: 1 }, inv: {}, ...o });
const base = (widgets, extra = {}) => ({ ver: 2, savedAt: 1, settings: { background: "solid", bgColor: "#24303c" }, widgets, ...extra });
const blur = page => page.evaluate(() => { if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur(); });
const meet = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
const rectOf = (page, sel) => page.locator(sel).evaluate(e => { const r = e.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, w: r.width, h: r.height }; });
const widgetRects = page => page.evaluate(() => [...document.querySelectorAll("#stage .widget")].map(e => { const r = e.getBoundingClientRect(); return { id: e.dataset.id, left: r.left, right: r.right, top: r.top, bottom: r.bottom }; }));

test.describe("R11: editor notes stay off the stream", () => {
  const note = (page, id) => page.evaluate(id => getComputedStyle(document.querySelector(`#stage .widget[data-id=${id}] .title`), "::after").content, id);
  test("not bound yet and not connected show only while editing", async ({ app, page }) => {
    const ws = [stick({ id: "u", match: undefined, axes: {} }), stick({ id: "g", x: 800, match: "Gone (Vendor: 0aaa Product: 0bbb)" })];
    await app.open({ profile: base(ws), devices: [h.DEV.virpil()], query: "?edit" });
    await app.frames(3);
    expect(await note(page, "u")).toBe('"not bound yet"');
    expect(await note(page, "g")).toBe('"not connected"');
    await page.evaluate(() => setEditing(false));
    expect(await note(page, "u")).toBe("none");
    expect(await note(page, "g")).toBe("none");
    expect(await page.locator("#stage .widget[data-id=u]").evaluate(e => e.classList.contains("offline")), "still dimmed").toBe(true);
    // As OBS loads it: never editing, no notes.
    await app.reload("?transparent");
    await app.frames(3);
    expect(await note(page, "u")).toBe("none");
    expect(await note(page, "g")).toBe("none");
  });
});

test.describe("R18: the browser preview chip", () => {
  test("at 1600x900 over the Projections template it sits top left clear of every widget, folds to a pill, and hover opens it", async ({ app, page }) => {
    await page.setViewportSize({ width: 1600, height: 900 });
    await app.open({ query: "?edit" });
    await page.evaluate(() => { closeWelcome(); addPreset("adobewan-projections"); closeWizard(); setEditing(false); });
    await page.mouse.move(800, 450);
    const chip = page.locator("#preview-chip");
    await expect(chip).toBeVisible();
    await expect(chip).toContainText("Browser preview. In OBS this background is transparent.");
    const full = await rectOf(page, "#preview-chip");
    expect([Math.round(full.left), Math.round(full.top)]).toEqual([16, 16]);
    for (const w of await widgetRects(page)) expect(meet(full, w), w.id).toBe(false);
    await page.waitForTimeout(6500);
    await expect(chip).toHaveClass(/min/);
    const pill = await rectOf(page, "#preview-chip");
    expect(pill.w).toBeLessThan(full.w / 3);
    await expect(page.locator("#preview-chip .pill")).toBeVisible();
    await expect(page.locator("#preview-edit")).not.toBeInViewport({ ratio: 0.5 });
    await page.mouse.move(pill.left + pill.w / 2, pill.top + pill.h / 2);
    expect((await rectOf(page, "#preview-chip")).w).toBeGreaterThan(full.w - 2);
    await page.mouse.move(800, 450);
    expect((await rectOf(page, "#preview-chip")).w).toBeLessThan(full.w / 3);
    // The keyboard opens it too: Tab reaches Open Editor and the chip shows it.
    await page.keyboard.press("Tab");
    await expect(page.locator("#preview-edit")).toBeFocused();
    expect((await rectOf(page, "#preview-chip")).w).toBeGreaterThan(full.w - 2);
    // Back from the editor, it opens in full again.
    await blur(page);
    await page.keyboard.press("e");
    expect(await page.evaluate(() => editing)).toBe(true);
    await page.keyboard.press("e");
    await expect(chip).not.toHaveClass(/min/);
  });

  test("with reduced motion the pill appears without animation, and in OBS the chip is never drawn", async ({ app, page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await app.open({ profile: base([stick()]), devices: [h.DEV.virpil()] });
    await page.evaluate(() => { const c = document.querySelector("#preview-chip"); c.classList.add("min"); });
    await expect(page.locator("#preview-chip .pill")).toBeVisible();
    expect(await page.locator("#preview-chip .pill").evaluate(e => parseFloat(getComputedStyle(e).animationDuration))).toBe(0);
    await page.addInitScript(() => { window.obsstudio = { pluginVersion: "test" }; });
    await app.reload();
    await expect(page.locator("#preview-chip")).toBeHidden();
    expect(await page.evaluate(() => document.body.classList.contains("preview"))).toBe(false);
  });
});
