// The panel and sizing changes of v1.11: Background opacity, section state, Place on Screen, sizes in drawn pixels,
// the Width / Height pair and Fill, draggable projector bases, fonts, and the Aegis projector light.
const { test, expect } = require("./fixtures/app");
const h = require("./fixtures/gamepad");

const VID = h.DEV.virpil().id;
const stick = (o = {}) => ({ id: "s1", type: "stick", x: 400, y: 300, label: "Stick", match: VID, nth: 0, axes: { x: 0, y: 1 }, inv: {}, ...o });
const bar = (o = {}) => ({ id: "t1", type: "throttle", x: 800, y: 300, label: "Throttle", match: VID, nth: 0, axes: { t: 2 }, inv: {}, ...o });
const base = (widgets, extra = {}) => ({ ver: 2, savedAt: 1, settings: { background: "solid", bgColor: "#24303c" }, widgets, ...extra });
const open = (app, profile, devices = [h.DEV.virpil()]) => app.open({ profile, devices, query: "?transparent" });
const edit = (page, ids) => page.evaluate(ids => { setEditing(true); setSelection(ids); }, ids);
const labels = page => page.evaluate(() => [...document.querySelectorAll("#panel .sec-t .name")].map(e => e.textContent));
const sliderLabels = page => page.evaluate(() => [...document.querySelectorAll("#panel input[type=range]")].map(e => e.getAttribute("aria-label")));

test.describe("Background opacity", () => {
  test("a saved Background fade folds into the opacity, once", async ({ app, page }) => {
    await open(app, base([stick({ bgAlpha: 80, proj: { glow: 40, fade: 50 } })]));
    expect(await page.evaluate(() => ({ a: profile.widgets[0].bgAlpha, p: profile.widgets[0].proj }))).toEqual({ a: 40, p: { glow: 40 } });
  });
  test("there is one opacity control, in Colors and in Cockpit Look, and they agree", async ({ app, page }) => {
    await open(app, base([stick({ bgAlpha: 100 })]));
    await edit(page, ["s1"]);
    const l = await sliderLabels(page);
    expect(l.filter(x => x === "Background opacity")).toHaveLength(2);
    expect(l).not.toContain("Background fade");
    await page.evaluate(() => { const r = document.querySelectorAll('#panel input[aria-label="Background opacity"]')[1]; r.value = 30; r.dispatchEvent(new Event("input", { bubbles: true })); });
    expect(await page.evaluate(() => [...document.querySelectorAll('#panel input[aria-label="Background opacity"]')].map(r => +r.value))).toEqual([30, 30]);
    expect(await page.evaluate(() => profile.widgets[0].bgAlpha)).toBe(30);
  });
  test("a hologram look sets the opacity and leaves it adjustable", async ({ app, page }) => {
    await open(app, base([stick()]));
    await page.evaluate(() => { const l = LOOK_PRESETS.find(x => x.name === "Visor HUD"); const w = profile.widgets[0]; w.bgAlpha = l.alpha; refreshWidget(w); });
    expect(await page.evaluate(() => getComputedStyle(runtime.s1.root).getPropertyValue("--wbg"))).toContain("0)");
  });
});

test.describe("sections", () => {
  test("Arrange has one memory, and a single widget has no Arrange", async ({ app, page }) => {
    await open(app, base([stick(), bar()]));
    await edit(page, ["s1"]);
    expect(await labels(page)).not.toContain("Arrange");
    await page.evaluate(() => setSelection(["s1", "t1"]));
    expect(await page.evaluate(() => document.querySelector("#sec-arrange").hidden)).toBe(false);
    await page.evaluate(() => document.querySelector('[aria-controls="sec-arrange"]').click());
    await page.evaluate(() => setSelection(["s1"])); await page.evaluate(() => setSelection(["s1", "t1"]));
    expect(await page.evaluate(() => document.querySelector("#sec-arrange").hidden)).toBe(true);   // stays as the user left it
  });
  test("every section stays open or closed as the user left it across selections", async ({ app, page }) => {
    await open(app, base([stick(), bar()]));
    await edit(page, ["s1"]);
    await page.evaluate(() => { for (const t of document.querySelectorAll("#panel .sec-t[aria-expanded=true]")) t.click(); });
    const closed = await page.evaluate(() => [...document.querySelectorAll("#panel .sec-t")].map(t => t.getAttribute("aria-expanded")));
    expect(closed.every(x => x === "false")).toBe(true);
    await page.evaluate(() => setSelection(["t1"]));
    expect(await page.evaluate(() => [...document.querySelectorAll("#panel .sec-t")].every(t => t.getAttribute("aria-expanded") === "false"))).toBe(true);
  });
  test("sections carry a family label, an icon and a colored edge", async ({ app, page }) => {
    await open(app, base([stick()]));
    await edit(page, ["s1"]);
    const r = await page.evaluate(() => ({ fams: [...document.querySelectorAll("#panel .fam")].map(e => e.textContent), icons: document.querySelectorAll("#panel .sec-t .ico svg").length, secs: document.querySelectorAll("#panel .sec").length }));
    expect(r.fams).toEqual(["Position", "Widget", "Style", "Input"]);
    expect(r.icons).toBe(r.secs);
  });
});

test.describe("Place on Screen", () => {
  test("the four placement buttons sit in the panel head", async ({ app, page }) => {
    await open(app, base([stick()]));
    await edit(page, ["s1"]);
    expect(await page.evaluate(() => document.querySelectorAll('#panel .p-head [aria-label="Place on screen"] button').length)).toBe(4);
    expect(await page.evaluate(() => [...document.querySelectorAll("#panel button")].some(b => /Move to Bottom/.test(b.textContent)))).toBe(false);
  });
  test("Move to Bottom keeps a projector base inside the safe margin", async ({ app, page }) => {
    await open(app, base([stick({ holo: { on: true, tier: "static", base: { side: "below" } } })]));
    await edit(page, ["s1"]);
    await app.frames(4);
    await page.evaluate(() => placeOnScreen("bottom"));
    const r = await page.evaluate(() => { const f = footprintOf(profile.widgets[0]), C = canvasSize(); return { bottom: f.y + f.h, floor: C.h - profile.settings.margin, wBottom: boxOf(profile.widgets[0]).y + boxOf(profile.widgets[0]).h }; });
    expect(Math.abs(r.bottom - r.floor)).toBeLessThanOrEqual(1);
    expect(r.wBottom).toBeLessThan(r.floor);   // the widget itself sits above its base
  });
});

test.describe("sizes", () => {
  test("defaults are on the 4 px scale", async ({ app, page }) => {
    await open(app, base([stick(), bar()]));
    const d = await page.evaluate(() => [dimsOf(profile.widgets[0]), dimsOf(profile.widgets[1]), PAD, RADIUS]);
    expect(d).toEqual([{ box: 112 }, { bw: 20, bh: 104, cd: 80 }, 4, 8]);   // cd: the Circular display's diameter
  });
  test("a layout from before v2 keeps the size it drew", async ({ app, page }) => {
    const old = { savedAt: 1, settings: {}, widgets: [
      stick({ dims: { box: 200 } }), bar({ dims: { bw: 40, bh: 300 } }),
      { id: "p1", type: "pedals", x: 100, y: 100, label: "Pedals", match: VID, nth: 0, axes: { r: 5 }, inv: {}, scaleW: 2, scaleH: 1.5 }] };
    await open(app, old);
    const r = await page.evaluate(() => ({ ver: profile.ver, dims: profile.widgets.map(w => w.dims), ped: [profile.widgets[2].scaleW, profile.widgets[2].scaleH] }));
    expect(r.ver).toBe(2);
    expect(r.dims[0]).toEqual({ box: 150 });
    expect(r.dims[1]).toEqual({ bw: 30, bh: 225 });
    expect(r.dims[2]).toEqual({ rw: 240, rh: 25 });   // 200 and 22 at 75%, times the old Width / Height scale (2 and 1.5), clamped to 20-240
    expect(r.ped).toEqual([undefined, undefined]);
    await page.evaluate(() => { profile.widgets[0].x += 1; save(); });
    await app.flushSave();
    expect((await app.storedProfile()).ver).toBe(2);
  });
  test("the Width and Height sliders run 20 to 240 px (thickness from 4), and Percent follows the default", async ({ app, page }) => {
    await open(app, base([bar()]));
    await edit(page, ["t1"]);
    const px = await page.evaluate(() => [...document.querySelectorAll("#panel input[type=range]")].filter(r => /^(Width|Height)$/.test(r.getAttribute("aria-label"))).map(r => [r.getAttribute("aria-label"), +r.min, +r.max, +r.value]));
    expect(px).toEqual([["Width", 4, 240, 20], ["Height", 20, 240, 104]]);
    await page.evaluate(() => [...document.querySelectorAll("#panel .tiles button")].find(b => b.textContent === "Percent").click());
    const pct = await page.evaluate(() => [...document.querySelectorAll("#panel input[type=range]")].filter(r => /^(Width|Height)$/.test(r.getAttribute("aria-label"))).map(r => [r.getAttribute("aria-label"), +r.value]));
    expect(pct).toEqual([["Width", 100], ["Height", 100]]);
  });
  test("a horizontal bar's Height (its thickness) goes down to 4 px and draws that thin", async ({ app, page }) => {
    await open(app, base([bar({ orient: "h" })]));
    await edit(page, ["t1"]);
    expect(await page.evaluate(() => +[...document.querySelectorAll("#panel input[type=range]")].find(x => x.getAttribute("aria-label") === "Height").min)).toBe(4);
    await page.evaluate(() => { const r = [...document.querySelectorAll("#panel input[type=range]")].find(x => x.getAttribute("aria-label") === "Height"); r.value = 2; r.dispatchEvent(new Event("input", { bubbles: true })); });
    expect(await page.evaluate(() => profile.widgets[0].dims)).toEqual({ bw: 4 });
    expect(await page.evaluate(() => [runtime.t1.canvas._w, runtime.t1.canvas._h])).toEqual([152, 4]);
    expect(await page.evaluate(() => !!runtime.t1.spans.v)).toBe(true);   // the % readout is still there
  });
  test("a thin rudder keeps its brakes and readouts, and a saved 4 px thickness loads as is", async ({ app, page }) => {
    const ped = { id: "p1", type: "pedals", x: 400, y: 400, label: "Pedals", match: VID, nth: 0, axes: { r: 5, bl: 3, br: 4 }, inv: {}, dims: { rh: 4 } };
    await open(app, base([ped, bar({ dims: { bw: 4 } })]));
    const r = await page.evaluate(() => ({ dims: profile.widgets.map(w => w.dims), rud: [runtime.p1.canvas._w, runtime.p1.canvas._h], brake: [runtime.p1.brakeL._w, runtime.p1.brakeL._h], bar: runtime.t1.canvas._w, spans: Object.keys(runtime.p1.spans).sort() }));
    expect(r.dims).toEqual([{ rh: 4 }, { bw: 4 }]);
    expect(r.rud).toEqual([152, 4]);
    expect(r.brake).toEqual([4, 8]);   // the brakes follow the rudder's thickness
    expect(r.bar).toBe(4);
    expect(r.spans).toEqual(["bl", "br", "r"]);
    await edit(page, ["p1"]);
    expect(await page.evaluate(() => [...document.querySelectorAll("#panel input[type=range]")].filter(r => /^(Width|Height)$/.test(r.getAttribute("aria-label"))).map(r => [r.getAttribute("aria-label"), +r.min]))).toEqual([["Width", 20], ["Height", 4]]);
  });
  test("in Percent, the thickness slider starts at 20% (4 px of the 20 px default)", async ({ app, page }) => {
    await open(app, base([bar()]));
    await edit(page, ["t1"]);
    await page.evaluate(() => [...document.querySelectorAll("#panel .tiles button")].find(b => b.textContent === "Percent").click());
    expect(await page.evaluate(() => +[...document.querySelectorAll("#panel input[type=range]")].find(x => x.getAttribute("aria-label") === "Width").min)).toBe(20);
  });
  test("a horizontal bar's Width is its length", async ({ app, page }) => {
    await open(app, base([bar({ orient: "h" })]));
    await edit(page, ["t1"]);
    await page.evaluate(() => { const r = [...document.querySelectorAll("#panel input[type=range]")].find(x => x.getAttribute("aria-label") === "Width"); r.value = 200; r.dispatchEvent(new Event("input", { bubbles: true })); });
    expect(await page.evaluate(() => profile.widgets[0].dims)).toEqual({ bh: 200 });
    expect(await page.evaluate(() => runtime.t1.canvas._w)).toBe(200);
  });
  test("under Fill, the slider Fill sets shows its size with a note, and dragging it takes over", async ({ app, page }) => {
    await open(app, base([bar({ boxW: 120, boxH: 420, fill: true })]));
    await edit(page, ["t1"]);
    const shown = await page.evaluate(() => { const row = [...document.querySelectorAll("#panel .srow")].find(r => r.classList.contains("overridden")); return row && { label: row.querySelector(".top span").textContent, note: row.querySelector(".fill-note").textContent, value: row.querySelector(".val").textContent }; });
    expect(shown.label).toBe("Height");
    expect(shown.note).toMatch(/override Fill/);
    expect(parseInt(shown.value)).toBeGreaterThan(300);   // the size Fill worked out, not the 104 stored
    await page.evaluate(() => { const r = [...document.querySelectorAll("#panel .srow.overridden input[type=range]")][0]; r.value = 150; r.dispatchEvent(new Event("input", { bubbles: true })); r.dispatchEvent(new Event("change", { bubbles: true })); });
    const w = await page.evaluate(() => profile.widgets[0]);
    expect(w.fill).toBeUndefined();
    expect(w.dims.bh).toBe(150);
    expect(await page.evaluate(() => document.querySelectorAll("#panel .srow.overridden").length)).toBe(0);
  });
  test("the thickness slider stays live under Fill", async ({ app, page }) => {
    await open(app, base([bar({ boxW: 120, boxH: 420, fill: true })]));
    await edit(page, ["t1"]);
    await page.evaluate(() => { const r = [...document.querySelectorAll("#panel input[type=range]")].find(x => x.getAttribute("aria-label") === "Width"); r.value = 40; r.dispatchEvent(new Event("input", { bubbles: true })); });
    expect(await page.evaluate(() => profile.widgets[0].fill)).toBe(true);
  });
});

test.describe("projector base", () => {
  const withBase = () => base([stick({ holo: { on: true, tier: "static", base: { side: "below" } } })]);
  const baseAt = page => page.evaluate(() => { const r = runtime.s1.baseEl.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, dx: profile.widgets[0].holo.base.dx || 0, dy: profile.widgets[0].holo.base.dy || 0, k: overlayScale() }; });
  test("dragging the base moves its offset, and the rays follow", async ({ app, page }) => {
    await open(app, withBase());
    await edit(page, ["s1"]); await app.frames(4);
    const a = await baseAt(page);
    await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move(a.x + 90, a.y - 30, { steps: 6 }); await page.mouse.up();
    const b = await baseAt(page);
    expect(Math.abs(b.x - a.x - 90)).toBeLessThan(2); expect(Math.abs(b.y - a.y + 30)).toBeLessThan(2);
    expect(b.dx).not.toBe(0);
    const ends = await page.evaluate(() => [...runtime.s1.rayLines].map(l => [+l.getAttribute("x1"), +l.getAttribute("y1")]));
    expect(new Set(ends.map(e => e.join())).size).toBe(1);   // every ray starts at the one base
    expect((await page.evaluate(() => profile.widgets[0].x))).toBe(400);   // the widget stayed put
  });
  test("a base drag is one undo step", async ({ app, page }) => {
    await open(app, withBase());
    await edit(page, ["s1"]); await app.frames(4);
    const a = await baseAt(page);
    await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move(a.x + 60, a.y + 10, { steps: 5 }); await page.mouse.up();
    await page.waitForTimeout(450);
    await page.evaluate(() => undo());
    expect((await baseAt(page)).dx).toBe(0);
  });
  test("a base can be grabbed even where the widget's edge handle sits", async ({ app, page }) => {
    await open(app, withBase());
    await edit(page, ["s1"]); await app.frames(4);
    const hit = await page.evaluate(() => { const r = runtime.s1.baseEl.getBoundingClientRect(); return document.elementsFromPoint(r.x + r.width / 2, r.y + r.height / 2).some(n => n.classList && n.classList.contains("holo-base")); });
    expect(hit).toBe(true);
  });
  test("outside the editor the base is not clickable", async ({ app, page }) => {
    await open(app, withBase());
    await app.frames(4);
    expect(await page.evaluate(() => getComputedStyle(runtime.s1.baseEl).pointerEvents)).toBe("none");
  });
});

test.describe("fonts", () => {
  test("one Text font and size by default, each piece of text on its own behind a switch", async ({ app, page }) => {
    await open(app, base([stick()]));
    await edit(page, ["s1"]);
    const fontPickers = () => page.evaluate(() => [...document.querySelectorAll("#panel .tiles[aria-label$=\" font\"]")].filter(e => e.offsetParent !== null).map(e => e.getAttribute("aria-label")));
    expect(await fontPickers()).toEqual(["Text font"]);
    // One choice reaches the name, the values and the axis labels.
    await page.evaluate(() => document.querySelector('#panel .tiles[aria-label="Text font"] button[data-v=bahn]').click());
    expect(await page.evaluate(() => profile.widgets[0].fonts)).toEqual({ title: { f: "bahn" }, values: { f: "bahn" }, labels: { f: "bahn" } });
    await page.evaluate(() => document.querySelector('#panel input[role=switch][aria-label="Set each text separately"]').click());
    expect(await fontPickers()).toEqual(["Name font", "Values font", "Axis labels font"]);
  });
  test("a widget whose texts already differ opens with the separate pickers", async ({ app, page }) => {
    await open(app, base([stick({ fonts: { values: { s: 16 } } })]));
    await edit(page, ["s1"]);
    expect(await page.evaluate(() => document.querySelector('#panel input[role=switch][aria-label="Set each text separately"]').checked)).toBe(true);
  });
  test("a chosen font and size reach the widget", async ({ app, page }) => {
    await open(app, base([stick({ fonts: { title: { f: "bahn", s: 20 }, values: { s: 16 } } })]));
    const r = await page.evaluate(() => { const rt = runtime.s1.root, t = rt.querySelector(".title"), v = rt.querySelector(".val"); return [getComputedStyle(t).fontSize, t.style.fontFamily, getComputedStyle(v).fontSize]; });
    expect(r[0]).toBe("20px"); expect(r[1]).toMatch(/Bahnschrift/); expect(r[2]).toBe("16px");
  });
  test("a font name from a file is never used", async ({ app, page }) => {
    await open(app, base([stick({ fonts: { title: { f: "x; background:url(//evil)", s: 9999 }, values: "Impact" } })]));
    expect(await page.evaluate(() => profile.widgets[0].fonts)).toEqual({ title: { s: 48 } });   // the name is dropped, the size clamped; a non-object is ignored
  });
  test("a readout keeps its width as the value moves, in every font", async ({ app, page }) => {
    await open(app, base([bar({ fonts: { values: { f: "arial", s: 20 } } })]));
    const w0 = await page.evaluate(() => runtime.t1.root.offsetWidth);
    await page.evaluate(() => window.__fakeGP.set(0, { axes: { 2: 1 } })); await app.frames(10);
    expect(await page.evaluate(() => runtime.t1.root.offsetWidth)).toBe(w0);
  });
});

test.describe("Aegis projector", () => {
  const light = (page, theme) => page.evaluate(t => { const w = profile.widgets[0]; applyThemeTo(MFG_THEMES.find(o => o.id === t), [w], false); return holoColorsOf(w); }, theme);
  test("uses the radar's azure, not the MFD's teal", async ({ app, page }) => {
    await open(app, base([stick()]));
    const c = await light(page, "aegis");
    expect(c).toMatchObject({ rays: "#3da5ee", glow: "#1f97f2", core: "#95cdf9" });
  });
  test("other makers still derive their light from their accent", async ({ app, page }) => {
    await open(app, base([stick()]));
    expect((await light(page, "drake")).glow).toBe("#ffb141");
  });
  test("editing a color or the opacity: only a color leaves the theme", async ({ app, page }) => {
    await open(app, base([stick()]));
    await light(page, "aegis");
    await edit(page, ["s1"]);
    await page.evaluate(() => { const r = document.querySelectorAll('#panel input[aria-label="Background opacity"]')[0]; r.value = 50; r.dispatchEvent(new Event("input", { bubbles: true })); });
    expect(await page.evaluate(() => profile.widgets[0].theme)).toBe("aegis");
  });
});
