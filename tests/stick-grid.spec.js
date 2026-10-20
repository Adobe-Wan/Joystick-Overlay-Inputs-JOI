// The stick gate's grid options (Layout > Grid): cells on a square face, rings on a radar, Bold Center Lines and
// Outer Border. The default keeps the 4×4 look, and every choice is saved, undoable and checked on load.
const { test, expect } = require("./fixtures/app");
const h = require("./fixtures/gamepad");

const VID = h.DEV.virpil().id;
const stick = (o = {}) => ({ id: "s1", type: "stick", x: 400, y: 300, label: "Stick", match: VID, nth: 0, axes: { x: 0, y: 1 }, inv: {}, ...o });
const base = widgets => ({ ver: 2, savedAt: 1, settings: { background: "solid", bgColor: "#24303c" }, widgets });
const open = (app, profile) => app.open({ profile, devices: [h.DEV.virpil()], query: "?transparent" });
const edit = (page, ids) => page.evaluate(ids => { setEditing(true); setSelection(ids); }, ids);
const tiles = (page, aria) => page.locator(`#panel [role=group][aria-label="${aria}"] button`);
const tile = (page, aria, text) => tiles(page, aria).filter({ hasText: new RegExp(`^${text}$`) });
const sw = (page, label) => page.locator(`#panel input[role=switch][aria-label="${label}"]`);
const w0 = page => page.evaluate(() => profile.widgets[0]);

// Counts the lit columns of the face layer along one row: each grid line (and the rim) is a run of lit pixels.
const linesAcross = (page, rowFrac = 0.37) => page.evaluate(f => {
  const c = runtime.s1.canvas, face = stickFace(profile.widgets[0], runtime.s1, c), g = face.getContext("2d");
  const y = Math.round(face.height * f), d = g.getImageData(0, y, face.width, 1).data;
  let runs = 0, on = false;
  for (let i = 0; i < face.width; i++) { const lit = d[i * 4 + 3] > 0; if (lit && !on) runs++; on = lit; }
  return runs;
}, rowFrac);

test.describe("stick grid", () => {
  test("the default is the 4×4 grid with a border, and Layout shows the Grid options", async ({ app, page }) => {
    await open(app, base([stick()]));
    await edit(page, ["s1"]);
    await expect(tile(page, "Grid lines", "4×4")).toHaveAttribute("aria-pressed", "true");
    await expect(sw(page, "Outer Border")).toBeChecked();
    await expect(sw(page, "Bold Center Lines")).not.toBeChecked();
    await expect(page.locator('#panel [aria-label="Radar rings"]')).toHaveCount(0);
    // rim + 3 inner lines + rim
    expect(await linesAcross(page)).toBe(5);
  });

  test("each grid choice draws its lines and is saved only when it differs from the default", async ({ app, page }) => {
    await open(app, base([stick()]));
    await edit(page, ["s1"]);
    for (const [text, n, lines] of [["None", 1, 2], ["2×2", 2, 3], ["3×3", 3, 4], ["6×6", 6, 7], ["8×8", 8, 9]]) {
      await tile(page, "Grid lines", text).click();
      expect((await w0(page)).grid).toBe(n);
      expect(await linesAcross(page)).toBe(lines);
    }
    await tile(page, "Grid lines", "4×4").click();
    expect(await w0(page)).not.toHaveProperty("grid");
  });

  test("center lines only, with no outer border", async ({ app, page }) => {
    await open(app, base([stick()]));
    await edit(page, ["s1"]);
    await tile(page, "Grid lines", "None").click();
    await sw(page, "Bold Center Lines").check({ force: true });
    await sw(page, "Outer Border").uncheck({ force: true });
    expect(await w0(page)).toMatchObject({ grid: 1, cross: true, outline: false });
    expect(await linesAcross(page, 0.37)).toBe(1);   // just the vertical center line
    expect(await linesAcross(page, 0.03)).toBe(1);   // near the top edge, no border either
  });

  test("a radar face offers rings instead of lines", async ({ app, page }) => {
    await open(app, base([stick({ face: "radar" })]));
    await edit(page, ["s1"]);
    await expect(page.locator('#panel [aria-label="Grid lines"]')).toHaveCount(0);
    await expect(tile(page, "Radar rings", "2")).toHaveAttribute("aria-pressed", "true");
    // Across the middle row: rim, 2 rings, center, 2 rings, rim (the center row crosses each ring twice).
    const mid = () => linesAcross(page, 0.5);
    expect(await mid()).toBe(6);
    await tile(page, "Radar rings", "4").click();
    expect((await w0(page)).rings).toBe(4);
    expect(await mid()).toBe(10);
    await tile(page, "Radar rings", "None").click();
    expect(await mid()).toBe(2);
  });

  test("switching the face swaps Lines for Rings", async ({ app, page }) => {
    await open(app, base([stick()]));
    await edit(page, ["s1"]);
    await tile(page, "Stick face", "Radar").click();
    await expect(page.locator('#panel [aria-label="Radar rings"]')).toHaveCount(1);
    await expect(page.locator('#panel [aria-label="Grid lines"]')).toHaveCount(0);
  });

  test("grid changes undo and redo one step at a time", async ({ app, page }) => {
    await open(app, base([stick()]));
    await edit(page, ["s1"]);
    await tile(page, "Grid lines", "2×2").click();
    await page.waitForTimeout(450);
    await sw(page, "Outer Border").uncheck({ force: true });
    await page.evaluate(() => undo());
    expect(await w0(page)).toMatchObject({ grid: 2 });
    expect(await w0(page)).not.toHaveProperty("outline");
    await page.evaluate(() => undo());
    expect(await w0(page)).not.toHaveProperty("grid");
    await page.evaluate(() => redo());
    expect((await w0(page)).grid).toBe(2);
    await expect(tile(page, "Grid lines", "2×2")).toHaveAttribute("aria-pressed", "true");
  });

  test("the choices survive a reload", async ({ app, page }) => {
    await open(app, base([stick({ grid: 3, cross: true, outline: false })]));
    await page.reload();
    expect(await w0(page)).toMatchObject({ grid: 3, cross: true, outline: false });
  });

  test("grid values from a file are checked: out of range clamps, the wrong type is dropped", async ({ app, page }) => {
    await open(app, base([stick({ grid: 99, rings: "lots", cross: "yes", outline: 0 })]));
    const w = await w0(page);
    expect(w.grid).toBe(8);
    for (const k of ["rings", "cross", "outline"]) expect(w).not.toHaveProperty(k);
  });

  test("Reset Layout puts the default grid back", async ({ app, page }) => {
    await open(app, base([stick({ grid: 8, cross: true, outline: false, rings: 3 })]));
    await edit(page, ["s1"]);
    await page.locator("#panel button", { hasText: /^Reset Layout$/ }).click();
    const w = await w0(page);
    for (const k of ["grid", "rings", "cross", "outline"]) expect(w).not.toHaveProperty(k);
  });

  test("Stick Area fills just the gate: a disc on a radar, nothing outside it", async ({ app, page }) => {
    await open(app, base([stick({ face: "radar", bgAlpha: 0 })]));
    // The canvas alpha at a point, as a fraction of the stick size: inside the disc between lines, and the corner outside it.
    const alphaAt = (fx, fy) => page.evaluate(([fx, fy]) => {
      const rt = runtime.s1, c = rt.canvas; drawStick(profile.widgets[0], rt, null);
      return c.getContext("2d").getImageData(Math.round(c.width * fx), Math.round(c.height * fy), 1, 1).data[3];
    }, [fx, fy]);
    expect(await alphaAt(0.6, 0.42)).toBeLessThan(40);   // at most a ring's antialiased edge
    await edit(page, ["s1"]);
    await expect(page.locator('#panel button.cpick[aria-label^="Stick area fill"]')).toHaveCount(1);
    await page.evaluate(() => { const r = document.querySelector('#panel input[aria-label="Stick area opacity"]'); r.value = 80; r.dispatchEvent(new Event("input", { bubbles: true })); });
    expect((await w0(page)).areaAlpha).toBe(80);
    expect(await alphaAt(0.6, 0.42)).toBeGreaterThan(150);
    expect(await alphaAt(0.03, 0.03)).toBe(0);
    await page.evaluate(() => undo());
    expect(await w0(page)).not.toHaveProperty("areaAlpha");
  });

  test("Stick Area shows only when every selected widget is a stick, and its values are checked on load", async ({ app, page }) => {
    await open(app, base([stick({ areaBg: "nope", areaAlpha: 140 }), { id: "t1", type: "throttle", x: 800, y: 300, label: "Throttle", match: VID, nth: 0, axes: { t: 2 }, inv: {} }]));
    expect(await w0(page)).toMatchObject({ areaAlpha: 100 });
    expect(await w0(page)).not.toHaveProperty("areaBg");
    await edit(page, ["s1", "t1"]);
    await expect(page.locator('#panel input[aria-label="Stick area opacity"]')).toHaveCount(0);
  });
});
