// Profiles (one layout per ship or controller setup) and the starter presets on the panel's Profiles tab: switching,
// renaming, duplicating, deleting and importing never lose a layout, Undo covers each of them, and the presets build
// the right widgets and walk through binding the ones that need a device.
const fs = require("fs");
const { test, expect, STORE_KEY } = require("./fixtures/app");
const h = require("./fixtures/gamepad");

const stick = (id, x, label = "Stick") => ({ id, type: "stick", label, match: h.DEV.virpil().id, nth: 0, axes: { x: 0, y: 1 }, inv: {}, x, y: 700 });
// A save from before profiles: one layout, no list.
const OLD = { ver: 2, savedAt: 1, settings: { theme: "default", gridSize: 24, layoutW: 1600, layoutH: 900 }, widgets: [stick("s1", 600, "Left Stick"), stick("s2", 900, "Right Stick")] };

const lib = page => page.evaluate(() => ({ active: profile.layouts.active, names: profile.layouts.list.map(e => e.name),
  current: profile.layouts.list.find(e => e.id === profile.layouts.active).name, labels: profile.widgets.map(w => w.label) }));
const openProfilesTab = page => page.click("#tab-profiles");
const profileButton = (page, name) => page.locator(".prof-list button", { has: page.locator(`b:text-is("${name}")`) });

test.describe("profiles", () => {
  test("a save from before profiles becomes one profile, and keeps every widget", async ({ app, page }) => {
    await app.open({ profile: OLD, query: "?edit" });
    expect(await lib(page)).toMatchObject({ names: ["My Profile"], current: "My Profile", labels: ["Left Stick", "Right Stick"] });
    await page.evaluate(() => save()); await app.flushSave();
    const stored = await app.storedProfile();
    expect(stored.layouts.list).toHaveLength(1);
    expect(stored.layouts.list[0]).not.toHaveProperty("widgets");   // the active profile's layout is the top-level one
    expect(stored.widgets).toHaveLength(2);
  });

  test("the Profiles tab switches, renames, duplicates and deletes, and Undo takes each back", async ({ app, page }) => {
    await app.open({ profile: OLD, query: "?edit", devices: [h.DEV.virpil()] });
    await openProfilesTab(page);
    await expect(page.locator("#tab-profiles")).toHaveAttribute("aria-selected", "true");

    // Rename
    const name = page.getByRole("textbox", { name: "Profile name" });
    await name.fill("Gladius"); await name.press("Enter");
    expect((await lib(page)).current).toBe("Gladius");

    // New blank profile: empty layout, editor preferences kept, Gladius' widgets stored with it
    await page.click('#panel button:has-text("+ New Profile")');
    let st = await lib(page);
    expect(st).toMatchObject({ names: ["Gladius", "New Profile"], current: "New Profile", labels: [] });
    expect(await page.evaluate(() => profile.settings.gridSize)).toBe(24);
    expect(await page.locator("#stage .widget").count()).toBe(0);

    // Switch back by clicking it in the list
    await profileButton(page, "Gladius").click();
    st = await lib(page);
    expect(st).toMatchObject({ current: "Gladius", labels: ["Left Stick", "Right Stick"] });
    expect(await page.locator("#stage .widget").count()).toBe(2);

    // Undo returns to the empty profile, Redo to Gladius
    await page.keyboard.press("Control+z");
    expect(await lib(page)).toMatchObject({ current: "New Profile", labels: [] });
    await page.keyboard.press("Control+y");
    expect(await lib(page)).toMatchObject({ current: "Gladius", labels: ["Left Stick", "Right Stick"] });

    // Duplicate opens the copy
    await page.click('#panel button:has-text("Duplicate")');
    st = await lib(page);
    expect(st).toMatchObject({ names: ["Gladius", "Gladius Copy", "New Profile"], current: "Gladius Copy", labels: ["Left Stick", "Right Stick"] });

    // Delete asks first, then opens a neighbor; Undo brings it back
    await page.click('#panel button.danger:has-text("Delete")');
    await page.click("#confirm [data-confirm=yes]");
    st = await lib(page);
    expect(st.names).toEqual(["Gladius", "New Profile"]);
    expect(st.current).toBe("New Profile");
    await page.keyboard.press("Control+z");
    expect((await lib(page)).names).toEqual(["Gladius", "Gladius Copy", "New Profile"]);
    expect(app.consoleErrors).toEqual([]);
  });

  test("the only profile can't be deleted", async ({ app, page }) => {
    await app.open({ profile: OLD, query: "?edit" });
    await openProfilesTab(page);
    await expect(page.locator('#panel button.danger:has-text("Delete")')).toBeDisabled();
  });

  test("every profile survives a reload, and the one on screen stays on screen", async ({ app, page }) => {
    await app.open({ profile: OLD, query: "?edit" });
    await page.evaluate(() => { addBlankLayout(); addLabel(); renameLayout(activeLayout(), "Labels Only"); });
    await app.flushSave();
    await app.reload("?edit");
    expect(await lib(page)).toMatchObject({ names: ["My Profile", "Labels Only"], current: "Labels Only", labels: ["Label"] });
    await page.evaluate(() => switchLayout(profile.layouts.list[0].id));
    expect((await lib(page)).labels).toEqual(["Left Stick", "Right Stick"]);
  });

  test("Import adds the file as a new profile and keeps the others", async ({ app, page }) => {
    await app.open({ profile: OLD, query: "?edit" });
    await page.evaluate(() => closeWelcome());
    await app.importJSON({ ver: 2, savedAt: 5, settings: {}, widgets: [stick("x1", 100, "Hornet Stick")] }, "joi-hornet.json");
    expect(await app.toast()).toMatch(/imported/i);
    expect(await lib(page)).toMatchObject({ names: ["My Profile", "Hornet"], current: "Hornet", labels: ["Hornet Stick"] });
    // Undo takes the whole import back
    await page.keyboard.press("Control+z");
    expect(await lib(page)).toMatchObject({ names: ["My Profile"], labels: ["Left Stick", "Right Stick"] });
  });

  test("an empty profile makes room for an import instead of staying behind", async ({ app, page }) => {
    await app.open({ query: "?edit" });
    await page.evaluate(() => closeWelcome());
    await app.importJSON(OLD, "joi-profile.json");
    expect(await lib(page)).toMatchObject({ names: ["My Profile"], labels: ["Left Stick", "Right Stick"] });
  });

  test("Download .json holds one profile; profile.js holds them all", async ({ app, page }) => {
    await app.open({ profile: OLD, query: "?edit" });
    await page.evaluate(() => { renameLayout(activeLayout(), "Gladius"); addBlankLayout(); renameLayout(activeLayout(), "Cutlass"); addLabel(); });
    const read = async fn => { const [d] = await Promise.all([page.waitForEvent("download"), page.evaluate(fn)]); return { name: d.suggestedFilename(), text: fs.readFileSync(await d.path(), "utf8") }; };
    const one = await read(() => exportProfile(false));
    expect(one.name).toBe("joi-cutlass.json");
    const j = JSON.parse(one.text);
    expect(j.layouts.list.map(e => e.name)).toEqual(["Cutlass"]);
    expect(j.widgets.map(w => w.label)).toEqual(["Label"]);
    const all = await read(() => exportProfile(true));
    expect(all.name).toBe("profile.js");
    const backup = JSON.parse(/window\.JOI_PROFILE = ([\s\S]*);\s*$/.exec(all.text)[1]);
    expect(backup.layouts.list.map(e => e.name)).toEqual(["Gladius", "Cutlass"]);
    expect(backup.layouts.list[0].widgets.map(w => w.label)).toEqual(["Left Stick", "Right Stick"]);
  });

  test("a damaged profile list loads what it can", async ({ app, page }) => {
    const bad = { ...OLD, layouts: { active: "nope", list: [null, { id: "a b" }, { id: "ok", name: "  Spare  ", widgets: [{ id: "q", type: "label", label: "Q" }, { id: "__proto__", type: "nope" }] }] } };
    await app.open({ profile: bad, query: "?edit" });
    expect(await lib(page)).toMatchObject({ names: ["My Profile", "Spare"], labels: ["Left Stick", "Right Stick"] });
    await page.evaluate(() => switchLayout(profile.layouts.list[1].id));
    expect((await lib(page)).labels).toEqual(["Q"]);
  });
});

test.describe("presets", () => {
  test("every preset builds on screen without errors", async ({ app, page }) => {
    await app.open({ query: "?edit" });
    await page.evaluate(() => closeWelcome());
    const ids = await page.evaluate(() => PRESETS.map(p => p.id));
    for (const id of ids) {
      await page.evaluate(id => { addPreset(id); closeWizard(); }, id);
      const st = await page.evaluate(() => ({ n: profile.widgets.length, off: offscreenWidgets().length, dom: document.querySelectorAll("#stage .widget").length }));
      expect(st.n, id).toBeGreaterThan(0);
      expect(st.dom, id).toBe(st.n);
      expect(st.off, id + " widgets off screen").toBe(0);
    }
    // The first preset took the empty starting profile; each other one is its own profile.
    expect((await lib(page)).names).toEqual(["WASD + Mouse", "HOSAS + Pedals", "HOTAS + Pedals", "HOSAM", "Directional Inputs"]);
    expect(app.consoleErrors).toEqual([]);
  });

  test("HOTAS + Pedals asks to bind each device, in order", async ({ app, page }) => {
    await app.open({ query: "?edit" });
    await page.evaluate(() => closeWelcome());
    await openProfilesTab(page);
    await page.click('#panel .presets button:has-text("HOTAS + Pedals")');
    await expect(page.locator("#wiz-body .kicker")).toHaveText("Bind Inputs · 1 of 5 · Throttle");
    expect(await page.evaluate(() => [...document.querySelectorAll("#stage .widget.unbound")].length)).toBe(5);
    await page.click('#wiz-body button:has-text("Skip for Now")');
    await expect(page.locator("#wiz-body .kicker")).toHaveText("Bind Inputs · 2 of 5 · Strafe");
    await page.click('#wiz-body button:has-text("Cancel")');
    expect(await page.evaluate(() => !!wiz)).toBe(false);
    await expect(page.locator('#panel button:has-text("Bind Inputs")')).toBeVisible();
  });

  test("HOSAM binds its stick, Up / Down and Roll by moving them, and the mouse needs nothing", async ({ app, page }) => {
    await app.open({ query: "?edit", devices: [h.DEV.virpil()] });
    await page.evaluate(() => closeWelcome());
    await page.evaluate(() => addPreset("hosam"));
    await expect(page.locator("#wiz-body .kicker")).toHaveText("Bind Inputs · 1 of 3 · Strafe");
    await h.play(page, h.stickXY(0));
    await expect(page.locator("#wiz-body .kicker")).toHaveText("Bind Inputs · 2 of 3 · Up / Down");
    await h.play(page, h.throwAxis(0, 5, 2, 0, 1));
    await expect(page.locator("#wiz-body .kicker")).toHaveText("Bind Inputs · 3 of 3 · Roll");
    await h.play(page, h.throwAxis(0, 5, h.AX.twist, 0, 1));
    await expect.poll(() => page.evaluate(() => !!wiz)).toBe(false);
    const ws = await h.widgets(page);
    const s = ws.find(w => w.label === "Strafe");
    expect(s.match).toBe(h.DEV.virpil().id);
    expect(s.axes).toEqual({ x: 0, y: 1 });
    expect(ws.find(w => w.label === "Up / Down").axes).toEqual({ a: 2 });
    expect(ws.find(w => w.label === "Roll").axes).toEqual({ a: h.AX.twist });
    expect(await page.evaluate(() => profile.widgets.filter(isUnbound).length)).toBe(0);
    expect(await app.toast()).toMatch(/all inputs bound/i);
  });

  test("WASD + Mouse: keys and mouse work with nothing to bind", async ({ app, page }) => {
    await app.open({ query: "?edit" });
    await page.evaluate(() => closeWelcome());
    await page.evaluate(() => addPreset("wasd-mouse"));
    expect(await page.evaluate(() => !!wiz)).toBe(false);
    const labels = (await h.widgets(page)).map(w => w.label);
    expect(labels).toEqual(["Q", "W", "E", "A", "S", "D", "Ctrl", "Space", "Pitch / Yaw", "LMB", "RMB"]);
    await page.evaluate(() => setEditing(false));
    // Mouse movement swings the Mouse widget right; it eases back to center when the mouse stops.
    await page.mouse.move(200, 200);
    const mx = () => page.evaluate(() => mouse.pad.axes[0]);
    for (let i = 1; i <= 6; i++) { await page.mouse.move(200 + i * 40, 200); await app.frames(1); }
    expect(await mx()).toBeGreaterThan(0.2);
    await expect.poll(mx, { timeout: 3000 }).toBe(0);
    // A held mouse button lights its key
    const lmb = await page.evaluate(() => profile.widgets.find(w => w.label === "LMB").id);
    await page.mouse.down();
    await expect(page.locator(`#stage .widget[data-id="${lmb}"]`)).toHaveClass(/\bon\b/);
    await page.mouse.up();
    await expect(page.locator(`#stage .widget[data-id="${lmb}"]`)).not.toHaveClass(/\bon\b/);
  });

  test("a mouse widget survives a reload and never asks for a device", async ({ app, page }) => {
    await app.open({ query: "?edit" });
    await page.evaluate(() => { closeWelcome(); addPreset("wasd-mouse"); });
    await app.flushSave();
    await app.reload("?edit");
    const m = await page.evaluate(() => profile.widgets.find(w => w.mouse));
    expect(m).toMatchObject({ type: "stick", mouse: true, axes: { x: 0, y: 1 } });
    expect(m.match).toBeUndefined();
    expect(await page.evaluate(() => document.querySelector(`#stage .widget[data-id="${profile.widgets.find(w => w.mouse).id}"]`).classList.contains("offline"))).toBe(false);
    expect(await page.evaluate(k => JSON.parse(localStorage.getItem(k)).layouts.list[0].preset, STORE_KEY)).toBe("wasd-mouse");
  });
});
