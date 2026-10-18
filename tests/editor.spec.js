// Editor behavior: undo/redo under a long random edit session, the Size slider keeping widget centers fixed,
// Reset All being final, and Import moving a layout made on another screen shape.
const { test, expect, readFixture } = require("./fixtures/app");

const VALID = JSON.parse(readFixture("valid.json"));
const snap = page => page.evaluate(() => JSON.parse(snapOf()));
// The state the last save() recorded for undo. (Opening some panel sections fills in default holo / persp / proj
// objects on the selected widget without a save, so the live profile can differ from it in those defaults.)
const recorded = page => page.evaluate(() => JSON.parse(hist.last));
// Small seeded PRNG so a failing run can be replayed.
const rng = seed => () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

// Undo merges saves less than HISTORY_MERGE_MS apart into one step (one drag, one slider gesture). These tests make
// edits faster than that, so each edit first ends the previous gesture, as a pause between two edits would.
const endGesture = page => page.evaluate(() => { hist.at = -Infinity; });
const focusStage = page => page.evaluate(() => { if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur(); });

// One random edit, made the way the UI makes it: keys, panel sliders, theme/align/projector actions.
async function randomEdit(page, r) {
  const ids = await page.evaluate(() => profile.widgets.map(w => w.id));
  const pick = () => ids[Math.floor(r() * ids.length)];
  const kind = Math.floor(r() * 9);
  await endGesture(page);
  if (kind <= 2) {   // nudge with the arrow keys
    await page.evaluate(id => setSelection([id]), pick()); await focusStage(page);
    const key = ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"][Math.floor(r() * 4)];
    await page.keyboard.press(r() < 0.3 ? "Shift+" + key : key);
  } else if (kind === 3) {   // drag a panel slider: several input events, one change
    const sel = r() < 0.7 ? [pick()] : [...new Set([pick(), pick(), pick()])];
    await page.evaluate(sel => setSelection(sel), sel);
    const label = ["Size", "Padding", "Corner radius"][Math.floor(r() * 3)];
    const target = r();
    const ok = await page.evaluate(([label, target]) => {
      const s = [...document.querySelectorAll("#panel input[type=range]")].find(x => x.getAttribute("aria-label") === label);
      if (!s) return false;
      const lo = +s.min, hi = +s.max, from = +s.value;
      let to = Math.round(lo + (hi - lo) * target); if (to === from) to = from === hi ? lo : hi;   // a gesture always ends somewhere new
      for (let i = 1; i <= 5; i++) { s.value = Math.round(from + (to - from) * i / 5); s.dispatchEvent(new Event("input", { bubbles: true })); }
      s.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    }, [label, target]);
    if (!ok) await page.evaluate(() => { profile.widgets[0].x += 3; positionWidget(profile.widgets[0]); save(); });
  } else if (kind === 4) {   // a manufacturer theme on one widget
    await page.evaluate(([id, k]) => { setSelection([id]); applyThemeTo(MFG_THEMES[k % MFG_THEMES.length], selectedWidgets(), false); }, [pick(), Math.floor(r() * 100)]);
  } else if (kind === 5) {   // align a few widgets
    const sel = [...new Set([pick(), pick(), pick()])];
    await page.evaluate(([sel, edge]) => { setSelection(sel); align(edge); }, [sel, ["left", "right", "top", "bottom", "hcenter", "vcenter"][Math.floor(r() * 6)]]);
    await page.evaluate(() => { profile.widgets[profile.widgets.length - 1].y += 1; positionWidget(profile.widgets[profile.widgets.length - 1]); save(); });
  } else if (kind === 6) {   // Projector on/off
    await page.evaluate(id => { const w = profile.widgets.find(o => o.id === id); setSelection([id]); setProjector([w], !holoOf(w).on); refreshWidget(w); save(); }, pick());
  } else if (kind === 7) {   // duplicate (Ctrl+D) or delete (Delete), keeping between 4 and 14 widgets
    const n = ids.length;
    await page.evaluate(id => setSelection([id]), pick()); await focusStage(page);
    await page.keyboard.press(n > 14 || (n > 4 && r() < 0.5) ? "Delete" : "Control+d");
  } else {   // add a label, or rename one
    if (r() < 0.5) await page.evaluate(() => addLabel());
    else await page.evaluate(([id, t]) => { const w = profile.widgets.find(o => o.id === id); w.label = "L" + t; refreshWidget(w); save(); }, [pick(), Math.floor(r() * 1e6)]);
  }
}

test.describe("undo / redo", () => {
  test.setTimeout(180_000);

  for (const [name, edits] of [["200 random edits, then undo everything", 200], ["random edits up to the history limit return exactly to the start", "max"]]) {
    test(name, async ({ app, page }) => {
      await app.open({ profile: VALID, query: "?edit" });
      const max = await page.evaluate(() => HISTORY_MAX);
      const n = edits === "max" ? max : edits;
      const r = rng(edits === "max" ? 4242 : 1234);
      const initial = await snap(page);
      expect(await recorded(page)).toEqual(initial);
      const states = [initial];   // every state the session recorded, initial first
      for (let i = 0; i < n; i++) {
        await randomEdit(page, r);
        const s = await recorded(page);
        if (JSON.stringify(s) !== JSON.stringify(states[states.length - 1])) states.push(s);
      }
      const final = states[states.length - 1];
      expect(states.length - 1, "edits that changed something").toBeGreaterThan(n * 0.8);
      await page.evaluate(() => setSelection([])); await focusStage(page);
      const steps = await page.evaluate(() => hist.undo.length);
      expect(steps, "undo steps kept").toBe(Math.min(states.length - 1, max));
      // Undo all, checking every intermediate state on the way back.
      for (let i = 0; i < steps; i++) {
        await page.keyboard.press("Control+z");
        expect(await snap(page), `after ${i + 1} undos`).toEqual(states[states.length - 2 - i]);
      }
      await page.keyboard.press("Control+z");
      expect(await app.toast()).toBe("Nothing to undo");
      const oldest = states[states.length - 1 - steps];
      expect(await snap(page)).toEqual(oldest);
      if (states.length - 1 <= max) expect(await snap(page), "back to the initial profile").toEqual(initial);
      // Redo all the way forward again.
      for (let i = 0; i < steps; i++) await page.keyboard.press("Control+Shift+z");
      expect(await snap(page), "redo restores the final state").toEqual(final);
      // And the page shows what the profile says.
      expect(await page.evaluate(() => document.querySelectorAll("#stage .widget").length)).toBe(final.widgets.length);
    });
  }
});

test.describe("Size slider keeps widget centers fixed", () => {
  const centers = page => page.evaluate(ids => ids.map(id => { const w = profile.widgets.find(o => o.id === id), b = boxOf(w); return { id, cx: b.x + b.w / 2, cy: b.y + b.h / 2, w: b.w }; }),
    [...page.__sel]);
  async function sweep(app, page, ids) {
    await app.open({ profile: VALID, query: "?edit" });
    page.__sel = ids;
    await page.evaluate(ids => setSelection(ids), ids);
    const start = await centers(page);
    const values = [];
    for (let v = 100; v <= 250; v += 7) values.push(v);   // drag up
    for (let v = 250; v >= 50; v -= 3) values.push(v);    // all the way down
    for (let v = 50; v <= 137; v += 1) values.push(v);    // and back, one step at a time
    let worst = 0;
    for (const v of values) {
      await page.evaluate(v => {
        const s = [...document.querySelectorAll("#panel input[type=range]")].find(x => x.getAttribute("aria-label") === "Size");
        s.value = v; s.dispatchEvent(new Event("input", { bubbles: true }));
      }, v);
      const now = await centers(page);
      now.forEach((c, i) => {
        const d = Math.max(Math.abs(c.cx - start[i].cx), Math.abs(c.cy - start[i].cy));
        worst = Math.max(worst, d);
        expect(d, `${c.id} center moved at Size ${v}%`).toBeLessThanOrEqual(0.5);
      });
    }
    // The slider did resize the widgets.
    expect((await centers(page)).map(c => c.w)).not.toEqual(start.map(c => c.w));
    // Typing a value keeps the center too.
    await page.evaluate(() => {
      const s = [...document.querySelectorAll("#panel input[type=range]")].find(x => x.getAttribute("aria-label") === "Size");
      s.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await page.locator("#panel .srow", { hasText: "Size" }).first().locator("button.val").click();
    await page.keyboard.type("213"); await page.keyboard.press("Enter");
    for (const [i, c] of (await centers(page)).entries()) {
      expect(Math.abs(c.cx - start[i].cx), `${c.id} x after typing`).toBeLessThanOrEqual(0.5);
      expect(Math.abs(c.cy - start[i].cy), `${c.id} y after typing`).toBeLessThanOrEqual(0.5);
    }
    return worst;
  }

  test("single widget", async ({ app, page }) => { await sweep(app, page, ["s1"]); });
  test("multi-select of mixed widgets", async ({ app, page }) => { await sweep(app, page, ["s1", "t1", "p1", "b1", "a1"]); });
});

test("Reset All cannot be undone", async ({ app, page }) => {
  await app.open({ profile: VALID, query: "?edit" });
  // Some history first, so there is something Reset All must clear.
  await page.evaluate(() => setSelection(["s1"])); await focusStage(page);
  await page.keyboard.press("ArrowRight"); await endGesture(page); await page.keyboard.press("ArrowDown");
  expect(await page.evaluate(() => hist.undo.length)).toBeGreaterThan(0);
  await page.evaluate(() => setSelection([], "settings"));
  const reset = page.locator("#panel button", { hasText: "Reset All" });
  if (!(await reset.isVisible())) await page.evaluate(() => [...document.querySelectorAll("#panel [aria-expanded=false]")].forEach(b => b.click()));
  await reset.click();
  await page.click("#confirm [data-confirm=yes]");
  await expect(page.locator("#welcome")).toHaveClass(/open/);
  await page.keyboard.press("Escape");
  await expect(page.locator("#welcome")).not.toHaveClass(/open/);
  expect(await page.evaluate(() => profile.widgets.length)).toBe(0);
  await focusStage(page);
  await page.keyboard.press("Control+z");
  expect(await app.toast()).toBe("Nothing to undo");
  expect(await page.evaluate(() => profile.widgets.length)).toBe(0);
  await expect(page.locator("#undo-btn")).toBeDisabled();
  await app.flushSave();
  await app.reload("?edit");
  expect(await page.evaluate(() => profile.widgets.length), "still empty after a reload").toBe(0);
});

test.describe("Import adapts the layout to the screen", () => {
  test.use({ viewport: { width: 2520, height: 1080 } });

  test("a 1920x1080 layout opened on 2520x1080", async ({ app, page }) => {
    await app.open({ query: "?edit" });
    await page.evaluate(() => closeWelcome());
    const lab = (id, x, y) => ({ id, type: "label", label: id, x, y, bgAlpha: 0 });
    await app.importJSON({ savedAt: 5, settings: { layoutW: 1920, layoutH: 1080 },
      widgets: [lab("left", 24, 24), lab("row", 900, 1000), lab("right", 1750, 500)] });
    const at = Object.fromEntries((await app.boxes()).map(b => [b.id, b]));
    // Left third stays, middle third moves by half the extra width, right third keeps its distance from the right edge.
    expect([at.left.x, at.left.y]).toEqual([24, 24]);
    expect([at.row.x, at.row.y]).toEqual([1200, 1000]);
    expect([at.right.x, at.right.y]).toEqual([2350, 500]);
    expect(await page.evaluate(() => [profile.settings.layoutW, profile.settings.layoutH])).toEqual([2520, 1080]);
    expect(await page.evaluate(() => offscreenWidgets().length)).toBe(0);
  });
});
