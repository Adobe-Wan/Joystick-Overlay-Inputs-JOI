// Circular display for Axis, Throttle and Pedals; Button/Key widgets bound to a keyboard key; Button/Key shapes;
// the WASD shortcut; and old layouts (no shape, no key) loading unchanged.
const { test, expect } = require("./fixtures/app");
const { DEV } = require("./fixtures/gamepad");

const pad = DEV.virpil();
const COLORS = { accent: "#4fd1ff", text: "#f2f7fb", bg: "#05080c", bgAlpha: 88 };
const dev = (o) => ({ x: 100, y: 100, size: 1, match: pad.id, nth: 0, inv: {}, ...COLORS, ...o });
const key = (o) => ({ x: 100, y: 300, size: 1, button: 0, ...COLORS, ...o });
const setAxis = (page, i, v) => page.evaluate(([i, v]) => window.__fakeGP.set(0, { axes: { [i]: v } }), [i, v]);
const isOn = (page, id) => page.evaluate(id => runtime[id].root.classList.contains("on"), id);
const boxOf = (page, id) => page.evaluate(id => { const r = runtime[id].root; return { w: r.offsetWidth, h: r.offsetHeight }; }, id);
// The dial's pixel at an angle clockwise from 12 o'clock, on the middle of its ring: does it carry the highlight?
const lit = (page, id, deg) => page.evaluate(([id, deg]) => {
  const c = runtime[id].canvas, g = c.getContext("2d"), k = c.width / c._w;
  const th = Math.max(4, Math.round(c._w * 0.12)), r = c._w / 2 - th / 2 - 1, a = (deg - 90) * Math.PI / 180;
  const [R, G, B] = g.getImageData(Math.round((c._w / 2 + Math.cos(a) * r) * k), Math.round((c._h / 2 + Math.sin(a) * r) * k), 1, 1).data;
  return B > 200 && G > 150 && R < 140;   // #4fd1ff
}, [id, deg]);

test.describe("Circular display", () => {
  const profile = { savedAt: Date.now(), settings: {}, widgets: [
    dev({ id: "ax", type: "axis", label: "Axis", axes: { a: 0 }, orient: "c" }),
    dev({ id: "th", type: "throttle", label: "Throttle", x: 260, axes: { t: 2 }, orient: "c" }),
    dev({ id: "pd", type: "pedals", label: "Pedals", x: 420, axes: { r: 1, bl: 3, br: 4 }, orient: "c" })] };

  test("an Axis fills clockwise from the top when positive and counterclockwise when negative, with its value in the middle", async ({ app, page }) => {
    await app.open({ devices: [pad], profile });
    const size = await boxOf(page, "ax");
    expect(await page.evaluate(() => { const c = runtime.ax.canvas; return [c._w, c._h]; })).toEqual([80, 80]);
    await setAxis(page, 0, 0.5); await app.frames(10);
    expect(await lit(page, "ax", 30), "right of top at +50%").toBe(true);
    expect(await lit(page, "ax", -30), "left of top at +50%").toBe(false);
    expect(await page.evaluate(() => runtime.ax.spans.v.closest(".dial") !== null && runtime.ax.spans.v.textContent)).toBe("+50%");
    await setAxis(page, 0, -0.5); await app.frames(10);
    expect(await lit(page, "ax", -30), "left of top at -50%").toBe(true);
    expect(await lit(page, "ax", 30), "right of top at -50%").toBe(false);
    for (const v of [-1, 1, 0]) { await setAxis(page, 0, v); await app.frames(6); expect(await boxOf(page, "ax"), `size at ${v}`).toEqual(size); }
  });

  test("a Throttle fills clockwise from the dial's left end", async ({ app, page }) => {
    await app.open({ devices: [pad], profile });
    await setAxis(page, 2, 0); await app.frames(10);   // 50%: the fill reaches the top
    expect(await lit(page, "th", -100)).toBe(true);
    expect(await lit(page, "th", 30)).toBe(false);
  });

  test("Pedals show the rudder as a dial between brakes as tall as it", async ({ app, page }) => {
    await app.open({ devices: [pad], profile });
    await setAxis(page, 1, -0.3); await app.frames(10);
    const got = await page.evaluate(() => ({ center: runtime.pd.spans.r.closest(".dial") !== null, r: runtime.pd.spans.r.textContent,
      brake: runtime.pd.brakeL._h, dial: runtime.pd.canvas._h }));
    expect(got).toEqual({ center: true, r: "-30%", brake: 80, dial: 80 });
  });

  test("the Display choice switches an Axis to Circular and Dial size sets its diameter", async ({ app, page }) => {
    const p = { savedAt: Date.now(), settings: {}, widgets: [dev({ id: "ax", type: "axis", label: "Axis", axes: { a: 0 } })] };
    await app.open({ devices: [pad], profile: p, query: "?edit" });
    await page.evaluate(() => setSelection(["ax"]));
    await page.click('#panel [aria-label="Display"] button:has-text("Circular")');
    expect(await page.evaluate(() => profile.widgets[0].orient)).toBe("c");
    await expect(page.locator("#panel .crow, #panel .srow, #panel label, #panel span").filter({ hasText: /^Dial size$/ }).first()).toBeVisible();
    await page.evaluate(() => { profile.widgets[0].dims = { cd: 120 }; refreshWidget(profile.widgets[0]); });
    expect(await page.evaluate(() => runtime.ax.canvas._w)).toBe(120);
  });
});

test.describe("keyboard keys", () => {
  const profile = { savedAt: Date.now(), settings: {}, widgets: [key({ id: "w", type: "button", label: "W", key: "KeyW", shape: "keycap" })] };

  test("a key widget lights while its key is held, never reads as not connected, and keeps its size", async ({ app, page }) => {
    await app.open({ profile });
    await app.frames(4);
    expect(await page.evaluate(() => runtime.w.root.classList.contains("offline"))).toBe(false);
    const size = await boxOf(page, "w");
    expect(size).toEqual({ w: 44, h: 44 });
    await page.keyboard.down("w"); await app.frames(4);
    expect(await isOn(page, "w")).toBe(true);
    expect(await boxOf(page, "w")).toEqual(size);
    await page.keyboard.up("w"); await app.frames(4);
    expect(await isOn(page, "w")).toBe(false);
    await page.keyboard.down("w"); await app.frames(4);
    await page.evaluate(() => window.dispatchEvent(new Event("blur"))); await app.frames(4);
    expect(await isOn(page, "w"), "losing focus releases the key").toBe(false);
    await page.keyboard.up("w");
  });

  test("+ Button/Key binds a pressed key by its code, names it from the keyboard and makes it a keycap", async ({ app, page }) => {
    await app.open({ profile: { savedAt: Date.now(), settings: {}, widgets: [] }, query: "?edit" });
    await page.click("#ui [data-act=add-button]");
    await expect(page.locator("#wiz-title")).toHaveText("Press the Button or Key You Want to Show");
    await page.keyboard.press("q");
    await expect(page.locator("#wiz-body .name-in")).toHaveValue("Q");
    await page.click('#wiz-body .actions button:has-text("Add to Overlay")');
    const w = (await app.profile()).widgets[0];
    expect(w).toMatchObject({ type: "button", key: "KeyQ", label: "Q", shape: "keycap" });
    expect(w.match).toBeUndefined();
  });

  test("Space binds when the step has just opened, and a tabbed-to button still presses with Enter", async ({ app, page }) => {
    await app.open({ profile: { savedAt: Date.now(), settings: {}, widgets: [] }, query: "?edit" });
    await page.click("#ui [data-act=add-button]");
    await app.frames(2);
    await page.keyboard.press("Space");
    await expect(page.locator("#wiz-body .name-in")).toHaveValue("Space");
    await page.click('#wiz-body .actions button:has-text("Start Over")');
    await page.focus('#wiz-body .actions button:has-text("Cancel")');
    await page.keyboard.press("Enter");
    expect(await page.evaluate(() => wiz)).toBeNull();
  });

  test("Add W, A, S and D Keys lays out four keycaps like a keyboard and selects them", async ({ app, page }) => {
    await app.open({ profile: { savedAt: Date.now(), settings: {}, widgets: [] }, query: "?edit" });
    await page.click("#ui [data-act=add-button]");
    await page.click('#wiz-body button:has-text("Add W, A, S and D Keys")');
    const ws = Object.fromEntries((await app.profile()).widgets.map(w => [w.label, w]));
    expect(Object.keys(ws)).toEqual(["W", "A", "S", "D"]);
    for (const c of "WASD") expect(ws[c]).toMatchObject({ key: "Key" + c, shape: "keycap", type: "button" });
    expect(ws.W.x).toBe(ws.S.x);
    expect(ws.W.y).toBeLessThan(ws.S.y);
    expect(ws.A.y).toBe(ws.S.y); expect(ws.D.y).toBe(ws.S.y);
    expect(ws.A.x).toBeLessThan(ws.S.x); expect(ws.S.x).toBeLessThan(ws.D.x);
    expect(await page.evaluate(() => selected.size)).toBe(4);
  });

  test("Detect Again moves a key widget to a device button, and back to a key", async ({ app, page }) => {
    const xbox = DEV.xbox();
    await app.open({ devices: [xbox], profile, query: "?edit" });
    await page.evaluate(() => startRemap(profile.widgets[0]));
    // Press only once the step is listening: a button already held when it opens counts only after a release.
    await expect.poll(() => page.evaluate(() => !!(wiz && wiz.det))).toBe(true);
    await page.evaluate(() => window.__fakeGP.set(0, { buttons: { 2: true } }));
    await expect.poll(() => page.evaluate(() => profile.widgets[0].match || null), { timeout: 10_000 }).toBe(xbox.id);
    await page.evaluate(() => window.__fakeGP.set(0, { buttons: { 2: false } }));
    let w = (await app.profile()).widgets[0];
    expect(w).toMatchObject({ button: 2, match: xbox.id, label: "W", shape: "keycap" });
    expect(w.key).toBeUndefined();
    await page.evaluate(() => startRemap(profile.widgets[0]));
    await expect(page.locator("#wiz-title")).toHaveText("Press the Button or Key You Want to Show");
    await page.keyboard.press("e");
    w = (await app.profile()).widgets[0];
    expect(w).toMatchObject({ key: "KeyE", label: "W" });
    expect(w.match).toBeUndefined();
  });
});

test.describe("shapes and saved layouts", () => {
  test("normalize() keeps keys and shapes on Button/Key widgets only, and Circular only where it fits", async ({ app, page }) => {
    await app.open();
    const got = await page.evaluate(() => normalize({ ver: 2, widgets: [
      { id: "a", type: "button", key: "KeyW", shape: "keycap", match: "x", nth: 1, hat: 3 },
      { id: "b", type: "button", key: "url(evil)", shape: "star" },
      { id: "c", type: "stick", key: "KeyW", shape: "circle", orient: "c" },
      { id: "d", type: "axis", orient: "c", dims: { cd: 120 } },
      { id: "e", type: "pedals", orient: "c" }] }).widgets);
    expect(got[0]).toMatchObject({ key: "KeyW", shape: "keycap" });
    expect(got[0].match).toBeUndefined(); expect(got[0].hat).toBeUndefined();
    expect(got[1].key).toBeUndefined(); expect(got[1].shape).toBeUndefined();
    expect(got[2].key).toBeUndefined(); expect(got[2].shape).toBeUndefined(); expect(got[2].orient).toBeUndefined();
    expect(got[3]).toMatchObject({ orient: "c", dims: { cd: 120 } });
    expect(got[4].orient).toBe("c");
  });

  test("a layout saved before Button/Key loads its buttons as before, as Box", async ({ app, page }) => {
    const p = { savedAt: Date.now(), settings: {}, widgets: [dev({ id: "b", type: "button", label: "FIRE", button: 3 })] };
    await app.open({ devices: [pad], profile: p, query: "?edit" });
    expect(await page.evaluate(() => [...runtime.b.root.classList].includes("shape-box"))).toBe(true);
    await page.evaluate(() => setSelection(["b"]));
    await expect(page.locator("#panel h3, #panel .p-head").first()).toContainText("Button/Key");
    await expect(page.locator('#panel [aria-label="Button/Key shape"] button[aria-pressed=true]')).toHaveText("Box");
  });

  test("Circle and Rounded Square are as tall as they are wide; a Keycap is one key tall", async ({ app, page }) => {
    const p = { savedAt: Date.now(), settings: {}, widgets: [
      key({ id: "c", type: "button", label: "B1", key: "KeyB", shape: "circle" }),
      key({ id: "s", type: "button", label: "Boost", key: "KeyN", shape: "square", x: 200 }),
      key({ id: "k", type: "button", label: "Space", key: "Space", shape: "keycap", x: 300 })] };
    await app.open({ profile: p });
    const c = await boxOf(page, "c"), s = await boxOf(page, "s"), k = await boxOf(page, "k");
    expect(c.w).toBe(c.h); expect(s.w).toBe(s.h);
    expect(c.w).toBeGreaterThanOrEqual(44);
    expect(k.h).toBe(44); expect(k.w).toBeGreaterThan(44);
    expect(await page.evaluate(() => getComputedStyle(runtime.c.root).borderRadius)).toBe("50%");
  });
});
