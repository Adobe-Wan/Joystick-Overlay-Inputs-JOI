// The new-pilot pass: the welcome opens on the starter setups, axes can carry flight names, binding sits at the top
// of the widget panel, the toolbar's Review opens the heatmap with per-axis numbers, and the one-time backup tip.
const { test, expect } = require("./fixtures/app");
const h = require("./fixtures/gamepad");

const VID = h.DEV.virpil().id;
const stick = (o = {}) => ({ id: "s1", type: "stick", x: 400, y: 300, label: "Stick", match: VID, nth: 0, axes: { x: 0, y: 1 }, inv: {}, ...o });
const pedals = (o = {}) => ({ id: "p1", type: "pedals", x: 800, y: 300, label: "Pedals", match: VID, nth: 0, axes: { r: 2 }, inv: {}, ...o });
const base = (widgets, extra = {}) => ({ ver: 2, savedAt: 1, settings: { background: "solid", bgColor: "#24303c" }, widgets, ...extra });
const open = (app, profile, devices = [h.DEV.virpil()]) => app.open({ profile, devices, query: "?transparent" });
const edit = (page, ids) => page.evaluate(ids => { setEditing(true); setSelection(ids); }, ids);
const panelText = page => page.locator("#panel").innerText();

test.describe("welcome", () => {
  test("opens on the starter setups, each with its acronym spelled out, and a tile builds that setup", async ({ app, page }) => {
    await app.open({ query: "?edit" });
    await expect(page.locator("#welcome")).toHaveClass(/open/);
    const tiles = await page.evaluate(() => [...document.querySelectorAll("#welcome-presets button")].map(b => [b.dataset.welcomePreset, b.querySelector(".full") && b.querySelector(".full").textContent, b.querySelectorAll("svg").length]));
    expect(tiles.map(t => t[0])).toEqual(["wasd-mouse", "hosas-pedals", "hotas-pedals", "hosam", "directional"]);
    expect(tiles.find(t => t[0] === "hotas-pedals")[1]).toBe("Hands On Throttle And Stick");
    for (const t of tiles) expect(t[2], t[0] + " hardware icons").toBeGreaterThan(0);
    expect(await page.evaluate(() => document.activeElement === document.querySelector("#welcome-presets button"))).toBe(true);
    await page.click('#welcome-presets button[data-welcome-preset="hosas-pedals"]');
    await expect(page.locator("#welcome")).not.toHaveClass(/open/);
    expect(await page.evaluate(() => profile.widgets.map(w => w.label))).toEqual(["Strafe", "Up / Down", "Pedals", "Pitch / Yaw", "Roll"]);
    await expect(page.locator("#wiz-body .kicker")).toHaveText("Bind Inputs · 1 of 5 · Strafe");   // straight into binding, no screenshot step first
  });
  test("Add Devices One by One opens the device wizard on its first step, with no screenshot step", async ({ app, page }) => {
    await app.open({ query: "?edit" });
    await page.click('#welcome [data-welcome="device"]');
    await expect(page.locator("#wiz-body .kicker")).toHaveText("Step 1 of 3");
    expect(await page.evaluate(() => [...document.querySelectorAll("#wiz-body .wsteps li")].map(l => l.textContent))).toEqual(["1. Device", "2. Move", "3. Name"]);
  });
  test("says where you are: a browser gets the OBS line, OBS does not", async ({ app, page }) => {
    await app.open({ query: "?edit" });
    expect(await page.evaluate(() => document.getElementById("welcome-where").hidden)).toBe(false);
    await page.evaluate(() => closeWelcome());
    await app.reload("?edit&transparent");
    await page.evaluate(() => openWelcome());
    expect(await page.evaluate(() => document.getElementById("welcome-where").hidden)).toBe(true);
  });
  test("? opens the shortcut list; the empty editor shows a card that leads to the setups", async ({ app, page }) => {
    await app.open({ profile: base([]), query: "?edit" });
    await expect(page.locator("#empty-edit")).toBeVisible();
    await page.click("#empty-presets");
    await expect(page.locator("#welcome")).toHaveClass(/open/);
    await expect(page.locator("#empty-edit")).toBeHidden();
    await page.evaluate(() => { closeWelcome(); document.activeElement.blur(); });   // single-key shortcuts act with nothing focused
    await page.keyboard.press("?");
    await expect(page.locator("#welcome")).toHaveClass(/open/);
    expect(await page.evaluate(() => document.getElementById("welcome-keys").open)).toBe(true);
  });
});

test.describe("flight names", () => {
  test("a stick says X and Y until told otherwise; presets ask for Yaw / Pitch and Strafe; pedals say YAW", async ({ app, page }) => {
    await open(app, base([stick(), stick({ id: "s2", x: 600, label: "Aim", axisNames: "flight" }), pedals()]));
    const labs = id => page.evaluate(id => [...runtime[id].root.querySelectorAll(".readout b")].map(b => b.textContent), id);
    expect(await labs("s1")).toEqual(["X", "Y"]);
    expect(await labs("s2")).toEqual(["YAW", "PIT"]);
    expect(await labs("p1")).toEqual(["YAW"]);
    await page.evaluate(() => { const w = profile.widgets[2]; w.axisNames = "rudder"; refreshWidget(w); });
    expect(await labs("p1")).toEqual(["RUD"]);
  });
  test("the names are chosen under Axis labels in Show, and a bad name from a file is dropped", async ({ app, page }) => {
    await open(app, base([stick({ axisNames: "nonsense" })]));
    expect(await page.evaluate(() => profile.widgets[0].axisNames)).toBeUndefined();
    await edit(page, ["s1"]);
    await page.click('#panel .tiles[aria-label="Axis names"] button[data-v="strafe"]');
    expect(await page.evaluate(() => [profile.widgets[0].axisNames, [...runtime.s1.root.querySelectorAll(".readout b")].map(b => b.textContent)])).toEqual(["strafe", ["L/R", "U/D"]]);
    await page.click('#panel .tiles[aria-label="Axis names"] button[data-v="xy"]');
    expect(await page.evaluate(() => "axisNames" in profile.widgets[0])).toBe(false);   // the default is not stored
  });
});

test.describe("widget panel", () => {
  test("what the widget listens to sits under its name, with Bind or Rebind; style sections start closed", async ({ app, page }) => {
    await open(app, base([stick(), stick({ id: "s2", x: 600, match: undefined, nth: undefined, axes: {} }), { id: "k1", type: "button", x: 900, y: 300, label: "W", key: "KeyW", button: 0 }]));
    const row = () => page.evaluate(() => { const r = document.querySelector("#panel .bind-row"); return [r.querySelector(".hint").textContent, r.querySelector("button").textContent, r.querySelector(".hint").classList.contains("warn")]; });
    await edit(page, ["s1"]);
    expect(await row()).toEqual(["VPC Alpha Prime R", "Rebind", false]);
    await edit(page, ["s2"]);
    expect(await row()).toEqual(["Not bound yet", "Bind", true]);
    await edit(page, ["k1"]);
    expect(await row()).toEqual(["Key: W", "Rebind", false]);
    await page.click("#panel .bind-row button");
    await expect(page.locator("#wiz-title")).toHaveText("Press the Button or Key You Want to Show");
    await page.evaluate(() => closeWizard());
    await edit(page, ["s1"]);
    const secs = await page.evaluate(() => [...document.querySelectorAll("#panel .sec")].map(s => [s.querySelector(".name").textContent, s.classList.contains("open")]));
    expect(Object.fromEntries(secs)).toMatchObject({ "Position and Size": true, Layout: true, Show: true, "Color Theme": false, Colors: false, "Cockpit Look": false });
  });
});

test.describe("review", () => {
  test("Review on the toolbar opens the heatmap panel with a line per axis widget, and the numbers follow the input", async ({ app, page }) => {
    await open(app, base([stick(), pedals()]));
    await page.evaluate(() => setEditing(true));
    await page.click("#toolbar [data-act=review]");
    await expect(page.locator("#panel h3")).toHaveText("Review");
    await expect(page.locator("#panel .review-list .row")).toHaveCount(2);
    await expect(page.locator("#panel .review-list .row").first()).toContainText("No movement yet");
    // Hold the stick in a corner for a while, then rest it in the middle.
    await page.evaluate(() => window.__fakeGP.set(0, { axes: { 0: 1, 1: -1 } })); await app.frames(30);
    await page.evaluate(() => window.__fakeGP.set(0, { axes: { 0: 0, 1: 0 } })); await app.frames(30);
    await page.evaluate(() => window.__fakeGP.set(0, { axes: { 0: 0.3, 1: 0 } })); await app.frames(2);
    const st = await page.evaluate(() => reviewStats(profile.widgets[0]));
    expect(st.total).toBeGreaterThan(0);
    expect(st.full).toBeGreaterThan(0.3); expect(st.rest).toBeGreaterThan(0.3); expect(st.full + st.rest).toBeLessThanOrEqual(1);
    await page.click('#panel button:has-text("Show Heatmap")');
    expect(await page.evaluate(() => showHeat)).toBe(true);
    await expect(page.locator('#panel button:has-text("Hide Heatmap")')).toBeVisible();
    expect(await page.evaluate(() => [...document.querySelectorAll("#panel .sec-t .name")].map(e => e.textContent))).not.toContain("Session Heatmap");
  });
  test("the toolbar is Edit Mode, Add, Review, Settings, Save and Share, Help and the panel toggle", async ({ app, page }) => {
    await open(app, base([stick()]));
    await page.evaluate(() => setEditing(true));
    expect(await page.evaluate(() => [...document.querySelectorAll("#toolbar button")].map(b => b.textContent))).toEqual(["+ Add", "Review", "Settings", "Save and Share", "Help", "Hide Panel"]);
    await page.click("#toolbar [data-act=panel]");
    expect(await page.evaluate(() => [document.body.classList.contains("panel-hidden"), document.getElementById("panel-btn").textContent])).toEqual([true, "Show Panel"]);
    await page.click("#toolbar [data-act=add-device]");
    await expect(page.locator("#wiz-title")).toHaveText("What Are You Adding?");
  });
});

test.describe("setup tab", () => {
  test("buttons come before the explanation, the device line is neutral until a device is seen, then lists it", async ({ app, page }) => {
    await app.open({ profile: base([stick()]), devices: [], query: "?edit" });
    const txt = await panelText(page);
    expect(txt.indexOf("+ Device")).toBeLessThan(txt.indexOf("Add each device once"));
    expect(txt).toContain("Wiggle a stick or press a button");
    expect(await page.evaluate(() => [...document.querySelectorAll("#panel .hint.warn")].map(e => e.textContent))).toEqual([]);   // nothing is wrong yet, so nothing is orange
    expect(txt.indexOf("Reset All")).toBeGreaterThan(txt.indexOf("Check Devices"));
  });
  test("leaving the editor the first time with a layout says how to keep it, once", async ({ app, page }) => {
    await app.open({ profile: base([stick()]), query: "?edit" });
    await page.evaluate(() => setEditing(false));
    await expect(page.locator("#toast")).toContainText("Download profile.js");
    expect(await page.evaluate(k => JSON.parse(localStorage.getItem(k)).backup, "joi.tips")).toBe(true);
    await page.evaluate(() => { toast("x", 10); setEditing(true); setEditing(false); });
    await expect(page.locator("#toast")).not.toContainText("Download profile.js");
  });
});
