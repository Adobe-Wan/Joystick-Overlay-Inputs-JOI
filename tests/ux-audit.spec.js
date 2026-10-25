// Fixes from the October 2026 UX audit: a bound or unbound state you can see at the top of the widget panel, a
// toolbar that stays on one row with the panel hidden, axis-name tiles that read on one line, feedback when a widget
// is removed, hints that name real controls, Review that tells an unbound widget from a still one, and a Check
// Devices meter that starts at zero for a device that rests away from the middle.
const { test, expect } = require("./fixtures/app");
const h = require("./fixtures/gamepad");

const VID = h.DEV.virpil().id;
const stick = (o = {}) => ({ id: "s1", type: "stick", x: 400, y: 300, label: "Stick", match: VID, nth: 0, axes: { x: 0, y: 1 }, inv: {}, ...o });
const pedals = (o = {}) => ({ id: "p1", type: "pedals", x: 800, y: 300, label: "Pedals", match: VID, nth: 0, axes: { r: 2 }, inv: {}, ...o });
const base = (widgets, extra = {}) => ({ ver: 2, savedAt: 1, settings: { background: "solid", bgColor: "#24303c" }, widgets, ...extra });
const edit = (page, ids, mode) => page.evaluate(([ids, mode]) => { setEditing(true); setSelection(ids, mode); }, [ids, mode]);
const color = (page, sel) => page.evaluate(s => getComputedStyle(document.querySelector(s)).color, sel);
const blur = page => page.evaluate(() => { if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur(); });

test("the bind row under the name shows Not bound yet and a missing device in the warning color", async ({ app, page }) => {
  await app.open({ profile: base([stick({ match: undefined, axes: {} }), stick({ id: "s2", x: 700 }), stick({ id: "s3", x: 1000, match: "Gone (Vendor: 0aaa Product: 0bbb)" })]),
    devices: [h.DEV.virpil()], query: "?transparent" });
  const warn = "rgb(255, 200, 110)", text3 = "rgb(163, 180, 202)";
  await edit(page, ["s1"]);
  await expect(page.locator("#panel .bind-row .hint")).toHaveText("Not bound yet");
  expect(await color(page, "#panel .bind-row .hint")).toBe(warn);
  await edit(page, ["s3"]);
  await expect(page.locator("#panel .bind-row .hint")).toContainText("not connected");
  expect(await color(page, "#panel .bind-row .hint")).toBe(warn);
  await edit(page, ["s2"]);   // bound and here: a quiet line, not a warning
  expect(await color(page, "#panel .bind-row .hint")).toBe(text3);
});

test("with the panel hidden the toolbar stays on one row", async ({ app, page }) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await app.open({ profile: base([stick()]), devices: [h.DEV.virpil()], query: "?edit" });
  const bar = () => page.evaluate(() => { const r = document.querySelector("#toolbar").getBoundingClientRect(); return { h: Math.round(r.height), tops: new Set([...document.querySelectorAll("#toolbar button")].map(b => Math.round(b.getBoundingClientRect().top))).size }; });
  const shown = await bar();
  expect(shown.tops).toBe(1);
  await page.click("#toolbar [data-act=panel]");
  expect(await page.evaluate(() => document.body.classList.contains("panel-hidden"))).toBe(true);
  expect(await bar()).toEqual(shown);
});

test("a stick's axis-name tiles each fit on one line", async ({ app, page }) => {
  await app.open({ profile: base([stick({ axisNames: "strafefb" })]), devices: [h.DEV.virpil()], query: "?transparent" });
  await edit(page, ["s1"]);
  const tiles = page.locator('#panel .tiles[aria-label="Axis names"] button');
  await expect(tiles).toHaveCount(4);
  // One line in this machine's font, with room to spare: the editor falls back from Segoe UI to whatever sans the
  // machine has (DejaVu Sans on a Linux runner is about a fifth wider than Inter), so a label that just fits here
  // would wrap there.
  const sizes = await tiles.evaluateAll(bs => bs.map(b => { const r = b.getBoundingClientRect(), cs = getComputedStyle(b), lh = parseFloat(cs.lineHeight);
    const c = document.createElement("canvas").getContext("2d"); c.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    return { t: b.textContent, h: r.height, lines: Math.round((b.scrollHeight - 2) / lh), fill: c.measureText(b.textContent).width / (b.clientWidth - 8) }; }));
  for (const s of sizes) { expect(s.lines, s.t).toBe(1); expect(s.h, s.t).toBe(32); expect(s.fill, s.t + " leaves room for a wider font").toBeLessThan(0.75); }
  // Pedals keep their three short names side by side.
  await app.open({ profile: base([pedals()]), devices: [h.DEV.virpil()], query: "?transparent" });
  await edit(page, ["p1"]);
  expect(await page.locator('#panel .tiles[aria-label="Axis names"]').evaluate(g => g.classList.contains("stack"))).toBe(false);
});

test("removing widgets says what went and that Ctrl+Z brings it back", async ({ app, page }) => {
  await app.open({ profile: base([stick(), pedals()]), devices: [h.DEV.virpil()], query: "?transparent" });
  await edit(page, ["s1"]); await blur(page);
  await page.keyboard.press("Delete");
  expect(await app.toast()).toBe("Removed Stick. Ctrl+Z brings it back.");
  await page.keyboard.press("Control+z");
  expect(await page.evaluate(() => profile.widgets.map(w => w.id))).toEqual(["s1", "p1"]);
  await edit(page, ["s1", "p1"]);
  await page.click("#panel .p-foot button.danger");
  expect(await app.toast()).toBe("Removed 2 widgets. Ctrl+Z brings them back.");
  expect(await page.evaluate(() => profile.widgets.length)).toBe(0);
});

test("the Draw rate hint names the Projector's Motion choice, which has Subtle and Full", async ({ app, page }) => {
  await app.open({ profile: base([stick({ holo: { on: true } })]), devices: [h.DEV.virpil()], query: "?transparent" });
  await edit(page, [], "settings");
  await expect(page.locator("#panel")).toContainText("unless a widget's Projector Motion is set to Subtle or Full");
  await edit(page, ["s1"]);
  const motion = page.locator('#panel .tiles[aria-label="Projector motion"] button');
  if (!(await motion.count())) await page.evaluate(() => [...document.querySelectorAll("#panel .sec-t[aria-expanded=false]")].forEach(b => b.click()));
  await expect(motion).toHaveText(["Still", "Subtle", "Full"]);
});

test("Review tells an unbound widget from one that hasn't moved", async ({ app, page }) => {
  await app.open({ profile: base([stick({ match: undefined, axes: {} }), pedals()]), devices: [h.DEV.virpil()], query: "?transparent" });
  await edit(page, [], "review");
  const rows = page.locator("#panel .review-list .row");
  await expect(rows.nth(0)).toContainText("Not bound to an input yet");
  await expect(rows.nth(1)).toContainText("No movement yet");
});

test("Name It suggests a name in flight words", async ({ app, page }) => {
  await app.open({ profile: base([]), devices: [h.DEV.virpil()], query: "?transparent" });
  await page.evaluate(() => { setEditing(true); startDeviceWizard(); });
  await h.chooseType(page, "Stick");
  await app.play(h.stickXY(0), 60);
  await expect(page.locator("#wiz-title")).toHaveText("Name It");
  await expect(page.locator("#wiz-body .lead")).toContainText('for example "Pitch / Yaw" or "Strafe"');
});

test("Check Devices: the meter starts at zero for a stick with a hat and pedals with toe brakes, and follows movement", async ({ app, page }) => {
  await app.open({ profile: base([]), devices: [h.DEV.virpil(), h.DEV.trudder()], query: "?transparent" });
  await edit(page, [], "devices");
  const meters = () => page.locator("#dev-body .dev-meter i").evaluateAll(is => is.map(i => i.style.width));
  await app.frames(20);
  expect(await meters()).toEqual(["0%", "0%"]);   // a hat idles at 1.29 and toe brakes at -1: neither is movement
  await page.evaluate(() => window.__fakeGP.set(0, { axes: { 0: 0.6 } }));
  await page.evaluate(() => window.__fakeGP.set(1, { axes: { 1: 0 } }));   // right toe brake half way: -1 to 0
  await expect.poll(meters).toEqual(["60%", "100%"]);
  await page.evaluate(() => window.__fakeGP.set(0, { axes: { 0: 0, 9: -1 } }));   // stick back, hat pushed up
  await expect.poll(meters).toEqual(["100%", "100%"]);
  await page.evaluate(idle => { window.__fakeGP.set(0, { axes: { 9: idle } }); window.__fakeGP.set(1, { axes: { 1: -1 } }); }, h.HAT_IDLE);
  await expect.poll(meters).toEqual(["0%", "0%"]);   // let go: back to zero
});
