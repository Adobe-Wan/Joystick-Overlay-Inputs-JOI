// Place values (Show > Values): a stick's two values in a pair under the gate (the default), or along the axes they
// measure, the up and down value in a column beside the gate and the left and right value under it. The choice is
// per widget, saved, undoable, applies to every selected stick, and never lets the widget change size.
const { test, expect } = require("./fixtures/app");
const h = require("./fixtures/gamepad");

const VID = h.DEV.virpil().id;
const stick = (o = {}) => ({ id: "s1", type: "stick", x: 400, y: 300, label: "Pitch / Yaw", match: VID, nth: 0, axes: { x: 0, y: 1 }, inv: {}, axisNames: "flight", ...o });
const base = widgets => ({ ver: 2, savedAt: 1, settings: { background: "solid", bgColor: "#24303c" }, widgets });
const open = (app, profile) => app.open({ profile, devices: [h.DEV.virpil()], query: "?transparent" });
const edit = (page, ids) => page.evaluate(ids => { setEditing(true); setSelection(ids); }, ids);
const tiles = (page, aria) => page.locator(`#panel [role=group][aria-label="${aria}"] button`);
const tile = (page, aria, text) => tiles(page, aria).filter({ hasText: new RegExp(`^${text}$`) });
const sw = (page, label) => page.locator(`#panel input[role=switch][aria-label="${label}"]`);
const focusStage = page => page.evaluate(() => { if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur(); });
// Where the gate and the two values sit, from the browser's own boxes, in the overlay's layout pixels (the stage is
// scaled to fit the window).
const rects = (page, id = "s1") => page.evaluate(id => {
  const rt = runtime[id], k = rt.root.getBoundingClientRect().width / rt.root.offsetWidth;
  const r = e => { if (!e) return null; const b = e.getBoundingClientRect(); return { l: b.left / k, r: b.right / k, t: b.top / k, b: b.bottom / k }; };
  return { gate: r(rt.canvas), y: r(rt.spans.y), x: r(rt.spans.x), ycol: r(rt.root.querySelector(".ycol")), pair: !!rt.root.querySelector(".readout.pair") };
}, id);
const size = (page, id = "s1") => page.evaluate(id => [runtime[id].root.offsetWidth, runtime[id].root.offsetHeight], id);

test.describe("place values", () => {
  test("a new stick keeps the pair under the gate and saves no layout", async ({ app, page }) => {
    await open(app, base([stick()]));
    const w = await page.evaluate(() => profile.widgets[0]);
    expect(w).not.toHaveProperty("valueLayout");
    expect(w).not.toHaveProperty("valueSide");
    await expect(page.locator('.widget[data-id="s1"] .readout')).toHaveClass("readout pair");
    expect(await page.locator('.widget[data-id="s1"] .axes').count()).toBe(0);
    await edit(page, ["s1"]);
    await expect(tile(page, "Place values", "Below")).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator('#panel [role=group][aria-label="Side for the up and down value"]')).toBeHidden();
  });

  test("Along the axes puts the up and down value beside the gate and the other under it; Left moves the column", async ({ app, page }) => {
    await open(app, base([stick()]));
    await edit(page, ["s1"]);
    const gate = () => rects(page).then(r => [(r.gate.l + r.gate.r) / 2, (r.gate.t + r.gate.b) / 2]);
    const before = await gate();
    await tile(page, "Place values", "Along the axes").click();
    expect(await page.evaluate(() => profile.widgets[0].valueLayout)).toBe("axes");
    await expect(page.locator("#panel .crow .hint").filter({ hasText: "Along the axes: the up and down value stands beside the gate" })).toBeVisible();
    await expect(tile(page, "Side for the up and down value", "Right")).toHaveAttribute("aria-pressed", "true");
    let r = await rects(page);
    expect(r.pair).toBe(false);
    expect(r.ycol.l - r.gate.r, "8 px between gate and column").toBeCloseTo(8, 0);
    expect(r.y.t).toBeGreaterThan(r.gate.t);
    expect(r.y.b).toBeLessThan(r.gate.b);
    expect(Math.abs((r.ycol.t + r.ycol.b) / 2 - (r.gate.t + r.gate.b) / 2), "column centered on the gate").toBeLessThanOrEqual(1);
    expect(r.x.t).toBeGreaterThanOrEqual(r.gate.b);
    expect(r.x.l).toBeGreaterThanOrEqual(r.gate.l);
    expect(r.x.r).toBeLessThanOrEqual(r.gate.r);
    // The label stands above its value.
    const ys = await page.evaluate(() => { const c = runtime.s1.root.querySelector(".ycol"); return [c.querySelector("b").textContent, c.querySelector("b").getBoundingClientRect().bottom, runtime.s1.spans.y.getBoundingClientRect().top]; });
    expect(ys[0]).toBe("PIT");
    expect(ys[1]).toBeLessThanOrEqual(ys[2] + 1);
    // The gate stayed where it was on screen: the box grew around it.
    const keeps = async what => { const g = await gate(); for (const i of [0, 1]) expect(Math.abs(g[i] - before[i]), what).toBeLessThanOrEqual(1); };
    await keeps("gate kept on Along the axes");

    await tile(page, "Side for the up and down value", "Left").click();
    expect(await page.evaluate(() => profile.widgets[0].valueSide)).toBe("left");
    await keeps("gate kept on Left");
    r = await rects(page);
    expect(r.gate.l - r.ycol.r, "8 px between column and gate").toBeCloseTo(8, 0);
    expect(r.x.t).toBeGreaterThanOrEqual(r.gate.b);
    expect(r.x.l).toBeGreaterThanOrEqual(r.gate.l);

    await tile(page, "Side for the up and down value", "Right").click();
    expect(await page.evaluate(() => profile.widgets[0])).not.toHaveProperty("valueSide");
    await tile(page, "Place values", "Below").click();
    expect(await page.evaluate(() => profile.widgets[0])).not.toHaveProperty("valueLayout");
    expect((await rects(page)).pair).toBe(true);
    await keeps("gate kept back on Below");
    expect(await page.evaluate(() => [profile.widgets[0].x, profile.widgets[0].y])).toEqual([400, 300]);
  });

  test("the widget keeps its size as the values go from 0% to +100% to -100%, in either layout", async ({ app, page }) => {
    for (const o of [{}, { valueLayout: "axes" }, { valueLayout: "axes", valueSide: "left" }, { valueLayout: "axes", showAxisLabels: false }]) {
      await open(app, base([stick(o)]));
      const sizes = [], texts = [];
      for (const v of [0, 1, -1, 0.05, 0]) {
        await page.evaluate(v => window.__fakeGP.set(0, { axes: { 0: v, 1: v } }), v);
        await app.frames(10);
        sizes.push(await size(page));
        texts.push(await page.evaluate(() => [runtime.s1.spans.x.textContent, runtime.s1.spans.y.textContent].join(" ")));
      }
      expect(new Set(texts.map(t => t.split(" ")[0])).size, JSON.stringify(o) + " values moved").toBeGreaterThanOrEqual(3);
      for (const s of sizes) expect(s, JSON.stringify(o)).toEqual(sizes[0]);
    }
  });

  test("a saved profile keeps the layout and side, and Undo takes the choice back", async ({ app, page }) => {
    // The stick goes in after load, not through the seeded storage, so the reload reads only what the app saved.
    await app.open({ devices: [h.DEV.virpil()], query: "?transparent" });
    await page.evaluate(p => { profile = normalize(p); rebuildAll(); save(); }, base([stick()]));
    await edit(page, ["s1"]);
    await page.evaluate(() => closeWelcome());
    await tile(page, "Place values", "Along the axes").click();
    await tile(page, "Side for the up and down value", "Left").click();
    await app.flushSave();
    expect((await app.storedProfile()).widgets[0]).toMatchObject({ valueLayout: "axes", valueSide: "left" });
    await app.reload("?transparent");
    expect(await page.evaluate(() => profile.widgets[0])).toMatchObject({ valueLayout: "axes", valueSide: "left" });
    await expect(page.locator('.widget[data-id="s1"] .axes')).toHaveClass("axes left");

    // A bad value from a file is dropped, so the widget falls back to the pair.
    expect(await page.evaluate(() => normalize({ widgets: [{ id: "a", type: "stick", valueLayout: "sideways", valueSide: "up" }] }).widgets[0])).not.toHaveProperty("valueLayout");

    await edit(page, ["s1"]);
    await tile(page, "Place values", "Below").click();
    expect(await page.evaluate(() => profile.widgets[0])).not.toHaveProperty("valueLayout");
    expect((await rects(page)).pair).toBe(true);
    await focusStage(page);
    await page.keyboard.press("Control+z");
    expect(await page.evaluate(() => profile.widgets[0].valueLayout)).toBe("axes");
    await expect(page.locator('.widget[data-id="s1"] .axes')).toHaveCount(1);
    expect((await rects(page)).ycol).not.toBeNull();
  });

  test("with several sticks selected the choice goes to each one; a non-stick in the selection hides it", async ({ app, page }) => {
    await open(app, base([stick(), stick({ id: "s2", x: 700, axisNames: "strafe" }), stick({ id: "m1", x: 1000, mouse: true, match: undefined, nth: undefined })]));
    await edit(page, ["s1", "s2", "m1"]);
    await tile(page, "Place values", "Along the axes").click();
    await tile(page, "Side for the up and down value", "Left").click();
    expect(await page.evaluate(() => profile.widgets.map(w => [w.valueLayout, w.valueSide]))).toEqual([["axes", "left"], ["axes", "left"], ["axes", "left"]]);
    for (const id of ["s1", "s2", "m1"]) {
      const r = await rects(page, id);
      expect(r.ycol.r, id).toBeLessThanOrEqual(r.gate.l);
    }
    expect(await page.evaluate(() => runtime.s2.root.querySelector(".ycol b").textContent)).toBe("U/D");

    await page.evaluate(() => { profile.widgets.push({ id: "t1", type: "throttle", x: 200, y: 300, label: "Throttle", axes: {}, inv: {} }); rebuildAll(); });
    await edit(page, ["s1", "t1"]);
    await expect(tiles(page, "Place values")).toHaveCount(0);
    await expect(sw(page, "Values")).toBeVisible();
  });

  test("Values off hides Place values and the column; on again brings both back", async ({ app, page }) => {
    await open(app, base([stick({ valueLayout: "axes" })]));
    await edit(page, ["s1"]);
    await expect(tiles(page, "Place values").first()).toBeVisible();
    const withVals = await size(page);
    await sw(page, "Values").click({ force: true });
    expect(await page.evaluate(() => profile.widgets[0].showValues)).toBe(false);
    await expect(tiles(page, "Place values").first()).toBeHidden();
    expect(await page.locator('.widget[data-id="s1"] .ycol').count()).toBe(0);
    expect(await page.locator('.widget[data-id="s1"] .readout').count()).toBe(0);
    expect((await size(page))[0]).toBeLessThan(withVals[0]);
    await sw(page, "Values").click({ force: true });
    await expect(tiles(page, "Place values").first()).toBeVisible();
    expect(await page.locator('.widget[data-id="s1"] .ycol').count()).toBe(1);
    expect(await size(page)).toEqual(withVals);
  });

  test("axis labels off and per-part fonts still apply along the axes", async ({ app, page }) => {
    await open(app, base([stick({ valueLayout: "axes", fonts: { values: { f: "consolas", s: 16 }, labels: { s: 8 } } })]));
    const st = await page.evaluate(() => { const c = runtime.s1.root.querySelector(".ycol"), v = getComputedStyle(runtime.s1.spans.y), b = getComputedStyle(c.querySelector("b"));
      return [v.fontSize, v.fontFamily.split(",")[0], b.fontSize]; });
    expect(st).toEqual(["16px", "Consolas", "8px"]);
    await page.evaluate(() => { profile.widgets[0].showAxisLabels = false; rebuildAll(); });
    expect(await page.locator('.widget[data-id="s1"] .ycol b').count()).toBe(0);
    expect(await page.locator('.widget[data-id="s1"] .xval b').count()).toBe(0);
    const r = await rects(page);
    expect(r.ycol.l).toBeGreaterThanOrEqual(r.gate.r);
  });
});
