// October 2026 UX audit, stage and overlay: the round + steps out of the way of widgets and Undo / Redo live in the
// toolbar (R03), editor notes stay out of the stream (R11), groups that keep widgets together (R14), and a browser
// preview chip that sits top left and folds to a pill (R18).
const { test, expect } = require("./fixtures/app");
const h = require("./fixtures/gamepad");

const VID = h.DEV.virpil().id;
const stick = (o = {}) => ({ id: "s1", type: "stick", x: 400, y: 300, label: "Stick", match: VID, nth: 0, axes: { x: 0, y: 1 }, inv: {}, ...o });
const base = (widgets, extra = {}) => ({ ver: 2, savedAt: 1, settings: { background: "solid", bgColor: "#24303c" }, widgets, ...extra });
const blur = page => page.evaluate(() => { if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur(); });
const meet = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
const rectOf = (page, sel) => page.locator(sel).evaluate(e => { const r = e.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, w: r.width, h: r.height }; });
const center = async (page, sel) => { const r = await rectOf(page, sel); return { x: r.left + r.w / 2, y: r.top + r.h / 2 }; };
const widgetRects = page => page.evaluate(() => [...document.querySelectorAll("#stage .widget")].map(e => { const r = e.getBoundingClientRect(); return { id: e.dataset.id, left: r.left, right: r.right, top: r.top, bottom: r.bottom }; }));

test.describe("R03: the + and Undo / Redo", () => {
  for (const [width, height] of [[1280, 720], [1366, 768], [1600, 900]]) {
    test(`at ${width}x${height} the + covers no widget from any preset or template, and the toolbar stays on one row`, async ({ app, page }) => {
      await page.setViewportSize({ width, height });
      await app.open({ query: "?edit" });
      await page.evaluate(() => closeWelcome());
      await page.mouse.move(1, height / 2);   // the pointer away from the + and the widgets
      const ids = await page.evaluate(() => PRESETS.map(p => p.id));
      expect(ids.length).toBeGreaterThanOrEqual(7);
      for (const id of ids) {
        await page.evaluate(id => { profile = newProfile(); rebuildAll(); addPreset(id); closeWizard(); setSelection([]); }, id);
        await page.waitForTimeout(300);   // the + glides to its spot
        const fab = await rectOf(page, "#fab");
        for (const w of await widgetRects(page)) expect(meet(fab, w), `${id}: the + over ${w.id}`).toBe(false);
        expect(await page.locator("#fab-wrap").evaluate(e => getComputedStyle(e).opacity), id).toBe("1");
        const bar = await page.evaluate(() => new Set([...document.querySelectorAll("#toolbar button")].map(b => Math.round(b.getBoundingClientRect().top))).size);
        expect(bar, "toolbar rows").toBe(1);
      }
      // A opens the + menu wherever the + is.
      await blur(page);
      await page.keyboard.press("a");
      await expect(page.locator("#fab")).toHaveAttribute("aria-expanded", "true");
    });
  }

  test("Undo and Redo sit in the toolbar next to Edit Mode, work, and are disabled with nothing to undo or redo", async ({ app, page }) => {
    await app.open({ profile: base([stick()]), devices: [h.DEV.virpil()], query: "?edit" });
    const undo = page.locator("#toolbar #undo-btn"), redo = page.locator("#toolbar #redo-btn");
    await expect(undo).toBeDisabled(); await expect(redo).toBeDisabled();
    await expect(undo).toHaveAttribute("aria-label", "Undo"); await expect(undo).toHaveAttribute("title", "Undo (Ctrl+Z)");
    await expect(undo).toHaveAttribute("aria-keyshortcuts", "Control+Z");
    await expect(redo).toHaveAttribute("aria-label", "Redo"); await expect(redo).toHaveAttribute("title", "Redo (Ctrl+Y)");
    // Right after the Edit Mode switch, before + Add.
    expect(await page.evaluate(() => [...document.querySelectorAll("#toolbar > *")].slice(0, 4).map(e => e.id || e.className))).toEqual(["switch", "undo-btn", "redo-btn", "divider"]);
    expect(await page.locator("#fab-wrap > :not(#fab):not(#fab-menu)").count(), "nothing left beside the +").toBe(0);
    // A 36 px target, like the toolbar's other buttons.
    const r = await rectOf(page, "#undo-btn");
    expect([Math.round(r.w), Math.round(r.h)]).toEqual([36, 36]);
    await page.evaluate(() => setSelection(["s1"])); await blur(page);
    await page.keyboard.press("Shift+ArrowRight");
    await expect(undo).toBeEnabled(); await expect(redo).toBeDisabled();
    await undo.click();
    expect((await app.profile()).widgets[0].x).toBe(400);
    await expect(undo).toBeDisabled(); await expect(redo).toBeEnabled();
    await redo.click();
    expect((await app.profile()).widgets[0].x).toBe(410);
    await expect(redo).toBeDisabled();
    // The shortcuts still work.
    await blur(page);
    await page.keyboard.press("Control+z");
    expect((await app.profile()).widgets[0].x).toBe(400);
    await page.keyboard.press("Control+y");
    expect((await app.profile()).widgets[0].x).toBe(410);
  });

  test("a widget dragged under the + makes it fade and let clicks through, and on the drop the + moves above it", async ({ app, page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await app.open({ profile: base([stick()]), devices: [h.DEV.virpil()], query: "?edit" });
    const fab = await rectOf(page, "#fab"), from = await center(page, "#stage .widget[data-id=s1]");
    const to = { x: fab.left + fab.w / 2, y: fab.top + fab.h / 2 };
    await page.mouse.move(from.x, from.y); await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 8 });
    await expect(page.locator("#fab-wrap")).toHaveClass(/yield/);
    expect(await page.evaluate(([x, y]) => !!document.elementFromPoint(x, y).closest("#fab-wrap"), [to.x, to.y]), "clicks reach the widget").toBe(false);
    await page.mouse.up();
    await page.waitForTimeout(300);
    const after = await rectOf(page, "#fab"), w = (await widgetRects(page))[0];
    expect(meet(after, w)).toBe(false);
    expect(after.bottom).toBeLessThanOrEqual(w.top);
    await expect(page.locator("#fab-wrap")).not.toHaveClass(/yield/);
    // Dragged away again, the + goes back to its dock.
    const back = await center(page, "#stage .widget[data-id=s1]");
    await page.mouse.move(back.x, back.y); await page.mouse.down(); await page.mouse.move(300, 300, { steps: 6 }); await page.mouse.up();
    await page.waitForTimeout(300);
    expect(Math.round((await rectOf(page, "#fab")).bottom)).toBe(Math.round(fab.bottom));
  });
});

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

test.describe("R14: groups", () => {
  const three = () => base([stick({ id: "a", x: 300, y: 300, label: "Left" }), stick({ id: "b", x: 600, y: 300, label: "Right" }), stick({ id: "c", x: 900, y: 500, label: "Alone" })]);
  async function grouped(app, page) {
    await app.open({ profile: three(), devices: [h.DEV.virpil()], query: "?edit" });
    await page.evaluate(() => setSelection(["a", "b"])); await blur(page);
    await page.keyboard.press("Control+g");
    const p = await app.profile();
    expect(p.widgets[0].group).toBeTruthy();
    expect(p.widgets[1].group).toBe(p.widgets[0].group);
    expect(p.widgets[2].group).toBeUndefined();
    await page.evaluate(() => setSelection([]));
  }
  const pos = async app => Object.fromEntries((await app.profile()).widgets.map(w => [w.id, [w.x, w.y]]));

  test("Ctrl+G groups the selection, and dragging one member moves the whole group by the same delta", async ({ app, page }) => {
    await grouped(app, page);
    expect(await app.toast()).toBe("Grouped 2 widgets. Ctrl+Shift+G ungroups them.");
    const before = await pos(app), from = await center(page, "#stage .widget[data-id=b]");
    await page.mouse.move(from.x, from.y); await page.mouse.down(); await page.mouse.move(from.x + 47, from.y + 61, { steps: 6 }); await page.mouse.up();
    const after = await pos(app);
    const d = id => [after[id][0] - before[id][0], after[id][1] - before[id][1]];
    expect(d("b")[0]).not.toBe(0);
    expect(d("a")).toEqual(d("b"));
    expect(d("c")).toEqual([0, 0]);
    // Arrow keys move the group too.
    await blur(page);
    await page.keyboard.press("ArrowLeft");
    const nudged = await pos(app);
    expect([nudged.a[0] - after.a[0], nudged.b[0] - after.b[0], nudged.c[0] - after.c[0]]).toEqual([-1, -1, 0]);
  });

  test("a click selects the whole group, and a second click selects just that member", async ({ app, page }) => {
    await grouped(app, page);
    const at = await center(page, "#stage .widget[data-id=a]");
    await page.mouse.click(at.x, at.y);
    expect(await page.evaluate(() => [...selected].sort())).toEqual(["a", "b"]);
    await expect(page.locator("#panel .p-head h3")).toHaveText("Group of 2");
    await expect(page.locator("#panel .p-head button", { hasText: "Ungroup" })).toBeVisible();
    await page.mouse.click(at.x, at.y);
    expect(await page.evaluate(() => [...selected])).toEqual(["a"]);
    await expect(page.locator("#panel .p-head h3")).toHaveText("Stick");
    await expect(page.locator("#panel .p-head .bind-row", { hasText: "In a group of 2" })).toBeVisible();
    // Inside the group, the member moves on its own.
    await blur(page);
    const before = await pos(app);
    await page.keyboard.press("ArrowDown");
    const after = await pos(app);
    expect([after.a[1] - before.a[1], after.b[1] - before.b[1]]).toEqual([1, 0]);
    // Select Group goes back to the whole group; Shift+click on a member takes the group out of a selection.
    await page.click("#panel .p-head button:has-text('Select Group')");
    expect(await page.evaluate(() => [...selected].sort())).toEqual(["a", "b"]);
    const c = await center(page, "#stage .widget[data-id=c]");
    await page.keyboard.down("Shift"); await page.mouse.click(c.x, c.y); await page.keyboard.up("Shift");
    expect(await page.evaluate(() => [...selected].sort())).toEqual(["a", "b", "c"]);
    await expect(page.locator("#panel .p-head button", { hasText: /^Group$/ })).toBeVisible();
    await page.keyboard.down("Shift"); await page.mouse.click(at.x, at.y); await page.keyboard.up("Shift");
    expect(await page.evaluate(() => [...selected])).toEqual(["c"]);
    // A box drawn over one member picks up the whole group.
    await page.evaluate(() => setSelection([]));
    const ra = await rectOf(page, "#stage .widget[data-id=a]");
    await page.mouse.move(ra.left - 20, ra.top - 20); await page.mouse.down(); await page.mouse.move(ra.left + 10, ra.top + 10, { steps: 4 }); await page.mouse.up();
    expect(await page.evaluate(() => [...selected].sort())).toEqual(["a", "b"]);
  });

  test("a group survives a reload, Ctrl+Z undoes the grouping, and Ctrl+Shift+G or Ungroup dissolves it", async ({ app, page }) => {
    await grouped(app, page);
    await app.flushSave();
    await app.reload("?edit");
    const p = await app.profile();
    expect(p.widgets[0].group).toBeTruthy();
    expect(p.widgets[1].group).toBe(p.widgets[0].group);
    // Undo takes back the grouping; Redo brings it back.
    await app.open({ profile: three(), devices: [h.DEV.virpil()], query: "?edit" });
    await page.evaluate(() => setSelection(["a", "b"])); await blur(page);
    await page.keyboard.press("Control+g");
    await page.keyboard.press("Control+z");
    expect((await app.profile()).widgets.some(w => w.group)).toBe(false);
    await page.keyboard.press("Control+y");
    expect((await app.profile()).widgets.filter(w => w.group).length).toBe(2);
    await page.evaluate(() => setSelection(["a", "b"])); await blur(page);
    await page.keyboard.press("Control+Shift+g");
    expect((await app.profile()).widgets.some(w => w.group)).toBe(false);
    expect(await app.toast()).toBe("Ungrouped 2 widgets");
    await page.evaluate(() => setSelection(["a", "b"]));
    await page.click("#panel .p-head button:has-text('Group')");
    expect((await app.profile()).widgets.filter(w => w.group).length).toBe(2);
    await page.click("#panel .p-head button:has-text('Ungroup')");
    expect((await app.profile()).widgets.some(w => w.group)).toBe(false);
  });

  test("removing the members removes the group, a copy of a group is a group of its own, and stray ids are dropped on load", async ({ app, page }) => {
    await grouped(app, page);
    // Duplicate the group: the copies form a second group.
    await page.evaluate(() => setSelection(["a", "b"])); await blur(page);
    await page.keyboard.press("Control+d");
    let p = await app.profile();
    const groups = new Set(p.widgets.map(w => w.group).filter(Boolean));
    expect(p.widgets.length).toBe(5);
    expect(groups.size).toBe(2);
    // Remove one member of the first group: a group of one is no group.
    await page.evaluate(() => setSelection(["a"])); await blur(page);
    await page.keyboard.press("Delete");
    p = await app.profile();
    expect(p.widgets.find(w => w.id === "b").group).toBeUndefined();
    expect(new Set(p.widgets.map(w => w.group).filter(Boolean)).size).toBe(1);
    // An imported file: a real pair stays, a group named once and a malformed id are dropped.
    await app.importJSON(base([stick({ id: "p", group: "pair" }), stick({ id: "q", x: 700, group: "pair" }), stick({ id: "r", x: 1000, group: "lonely" }), stick({ id: "t", x: 100, group: "bad id!" })]));
    p = await app.profile();
    expect(Object.fromEntries(p.widgets.map(w => [w.id, w.group ?? null]))).toEqual({ p: "pair", q: "pair", r: null, t: null });
  });

  test("On Screen shows a group as one row with its members indented under it", async ({ app, page }) => {
    await grouped(app, page);
    const rows = await page.evaluate(() => {
      const h = [...document.querySelectorAll("#panel h4")].find(e => e.textContent === "On Screen");
      const out = []; for (let n = h.nextElementSibling; n && (n.matches(".row, .on-group")); n = n.nextElementSibling) out.push(n);
      return out.map(n => n.matches(".on-group") ? { group: n.getAttribute("aria-label"), rows: [...n.querySelectorAll(".row")].map(r => r.className + ":" + r.textContent) } : n.textContent);
    });
    expect(rows).toEqual([{ group: "Group of 2", rows: ["row group-row:EditGroup of 2", "row member:EditLeft", "row member:EditRight"] }, "EditAlone"]);
    const indent = await page.evaluate(() => [...document.querySelectorAll("#panel .on-group .row")].map(r => Math.round(r.getBoundingClientRect().left)));
    expect(indent[1]).toBeGreaterThan(indent[0]);
    await page.click('#panel .on-group [aria-label="Edit Group of 2"]');
    expect(await page.evaluate(() => [...selected].sort())).toEqual(["a", "b"]);
    await page.evaluate(() => setSelection([]));
    await page.click('#panel .on-group [aria-label="Edit Right"]');
    expect(await page.evaluate(() => [...selected])).toEqual(["b"]);
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
