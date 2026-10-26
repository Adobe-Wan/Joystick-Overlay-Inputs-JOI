// Dialogs and welcome, from the October 2026 UX audit: single-axis bind steps that name the way to move, a welcome
// whose way out stays on screen, focus that goes back where it came from, a real Help dialog, a bind dialog that
// keeps clear of the widget it binds and shows the move, and one Add with one list of types.
const { test, expect } = require("./fixtures/app");
const h = require("./fixtures/gamepad");

const VID = h.DEV.virpil().id;
const stick = (o = {}) => ({ id: "s1", type: "stick", x: 400, y: 300, label: "Stick", match: VID, nth: 0, axes: { x: 0, y: 1 }, inv: {}, ...o });
const base = (widgets, extra = {}) => ({ ver: 2, savedAt: 1, settings: { background: "solid", bgColor: "#24303c" }, widgets, ...extra });
const blur = page => page.evaluate(() => { if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur(); });
const DIRECTION = /\b(up|down|left|right|forward|back)\b/i;

test.describe("R01 bind steps name a direction", () => {
  // Walk Bind Inputs with Skip for Now and note each widget's first step.
  const walk = async page => {
    const out = [];
    for (;;) {
      const st = await page.evaluate(() => wiz && wiz.remap ? { type: wiz.type || "button", label: wiz.label, title: document.getElementById("wiz-title").textContent } : null);
      if (!st) return out;
      out.push(st);
      await page.click('#wiz-body .actions button:has-text("Skip for Now")');
    }
  };
  for (const id of ["hosas-pedals", "adobewan-projections", "adobewan-minimalist"]) {
    test(`${id}: every single-axis step says which control and which way`, async ({ app, page }) => {
      await app.open({ query: "?edit", devices: [h.DEV.virpil()] });
      await page.click(`#welcome [data-welcome-preset="${id}"]`);
      const steps = await walk(page);
      const axes = steps.filter(s => s.type === "axis");
      expect(axes.length, "the setup has single axes").toBeGreaterThan(0);
      for (const s of steps) expect(s.title, s.label).toMatch(DIRECTION);
      for (const s of axes) { expect(s.title, s.label).toContain(s.label); expect(s.title).not.toMatch(/maximum/i); }
    });
  }
  test("the words match the way that reads positive, and a hand-added axis keeps the generic step", async ({ app, page }) => {
    await app.open({ query: "?edit", devices: [h.DEV.virpil()] });
    await page.click('#welcome [data-welcome-preset="hosas-pedals"]');
    const titles = await page.evaluate(() => Object.fromEntries(["Up / Down", "Roll"].map(l => { startRemap(profile.widgets.find(w => w.label === l)); return [l, document.getElementById("wiz-title").textContent]; })));
    expect(titles).toEqual({ "Up / Down": "Push the control you use for Up / Down all the way up", Roll: "Move the control you use for Roll fully right" });
    // Pushing Up / Down "up" with an axis that reads negative that way binds it inverted, so up reads positive.
    await page.evaluate(() => startRemap(profile.widgets.find(w => w.label === "Up / Down")));
    await app.play(h.throwAxis(0, 5, h.AX.twist, 0, -1));
    const w = (await app.profile()).widgets.find(o => o.label === "Up / Down");
    expect([w.axes.a, w.inv.a]).toEqual([h.AX.twist, true]);
    await page.evaluate(() => { closeWizard(); wizChooseType("axis"); });
    await expect(page.locator("#wiz-title")).toHaveText("Move the axis to its maximum");
  });
});

test.describe("R04 the welcome fits a laptop screen", () => {
  for (const [w, hgt] of [[1366, 768], [1600, 900]]) {
    test(`at ${w} x ${hgt} the foot and both template tiles are on screen, inside the dialog`, async ({ app, page }) => {
      await page.setViewportSize({ width: w, height: hgt });
      await app.open({ query: "?edit" });
      await expect(page.locator("#welcome")).toHaveClass(/open/);
      const m = await page.evaluate(() => {
        const R = e => { const b = e.getBoundingClientRect(); return { l: b.left, t: b.top, r: b.right, b: b.bottom, name: e.textContent.trim().slice(0, 30) }; };
        const d = document.querySelector("#welcome .dialog");
        return { vw: innerWidth, vh: innerHeight, dialog: R(d), whole: [d.scrollHeight, d.clientHeight], mid: R(document.getElementById("welcome-mid")),
          items: [...document.querySelectorAll("#welcome .foot button"), ...document.querySelectorAll("#welcome-templates button")].map(R) };
      });
      expect(m.whole[0], "the dialog itself never scrolls").toBeLessThanOrEqual(m.whole[1]);
      expect(m.items.length).toBe(5);   // Import a Profile, Explore on My Own, Add Devices One by One, two templates
      for (const r of m.items) {
        expect(r.l, r.name).toBeGreaterThanOrEqual(Math.max(0, m.dialog.l)); expect(r.r, r.name).toBeLessThanOrEqual(Math.min(m.vw, m.dialog.r));
        expect(r.t, r.name).toBeGreaterThanOrEqual(Math.max(0, m.dialog.t)); expect(r.b, r.name).toBeLessThanOrEqual(Math.min(m.vh, m.dialog.b));
      }
      for (const r of m.items.slice(3)) { expect(r.t, r.name + " not scrolled away").toBeGreaterThanOrEqual(m.mid.t); expect(r.b, r.name).toBeLessThanOrEqual(m.mid.b + 0.5); }
    });
  }
  test("on a shorter screen only the middle scrolls, with a scrollbar, and the foot stays in view", async ({ app, page }) => {
    await page.setViewportSize({ width: 1280, height: 560 });
    await app.open({ query: "?edit" });
    const m = await page.evaluate(() => {
      const mid = document.getElementById("welcome-mid"), d = document.querySelector("#welcome .dialog"), f = document.querySelector("#welcome .foot").getBoundingClientRect();
      return { scrolls: mid.scrollHeight > mid.clientHeight, overflow: getComputedStyle(mid).overflowY, bar: getComputedStyle(mid).scrollbarColor, whole: d.scrollHeight - d.clientHeight, footBottom: f.bottom, vh: innerHeight };
    });
    expect(m.scrolls).toBe(true);
    // Headless Chromium hides scrollbars, so check the middle asks for a classic, colored one rather than measuring it.
    expect(m.overflow).toBe("auto");
    expect(m.bar, "a scrollbar color is set").not.toBe("auto");
    expect(m.whole).toBeLessThanOrEqual(0);
    expect(m.footBottom).toBeLessThanOrEqual(m.vh);
  });
});

test.describe("R06 focus after a setup dialog closes", () => {
  const togglesPanel = async page => {
    const before = await page.evaluate(() => document.body.classList.contains("panel-hidden"));
    await page.keyboard.press("p");
    expect(await page.evaluate(() => document.body.classList.contains("panel-hidden")), "P toggles the panel").toBe(!before);
  };
  test("Escape out of Bind Inputs after a preset leaves nothing focused, so P works", async ({ app, page }) => {
    await app.open({ query: "?edit", devices: [h.DEV.virpil()] });
    await page.click('#welcome [data-welcome-preset="hosas-pedals"]');
    await expect(page.locator("#wizard")).toHaveClass(/open/);
    await page.keyboard.press("Escape");
    await expect(page.locator("#wizard")).not.toHaveClass(/open/);
    expect(await page.evaluate(() => document.activeElement === document.body)).toBe(true);
    await togglesPanel(page);
  });
  test("Skip for Now through every widget leaves nothing focused, so P works", async ({ app, page }) => {
    await app.open({ query: "?edit", devices: [h.DEV.virpil()] });
    await page.click('#welcome [data-welcome-preset="adobewan-projections"]');
    for (let i = 0; i < 4; i++) await page.click('#wiz-body .actions button:has-text("Skip for Now")');
    await expect(page.locator("#wizard")).not.toHaveClass(/open/);
    expect(await page.evaluate(() => document.activeElement === document.body)).toBe(true);
    await togglesPanel(page);
  });
  test("the wizard hands focus back to the control that opened it", async ({ app, page }) => {
    await app.open({ profile: base([stick()]), devices: [h.DEV.virpil()], query: "?edit" });
    await page.click("#toolbar [data-act=add-device]");
    await expect(page.locator("#wizard")).toHaveClass(/open/);
    await page.keyboard.press("Escape");
    await expect(page.locator("#toolbar [data-act=add-device]")).toBeFocused();
    // The round + menu: focus goes back to the +.
    await blur(page);
    await page.keyboard.press("a");
    await page.click('#fab-menu button[aria-label="Add Stick"]');
    await expect(page.locator("#wizard")).toHaveClass(/open/);
    await page.keyboard.press("Escape");
    await expect(page.locator("#fab")).toBeFocused();
  });
});

test.describe("R10 Help", () => {
  const fs = require("fs"), path = require("path");
  const slug = t => t.trim().toLowerCase().replace(/[^\w\- ]/g, "").replace(/ /g, "-");
  const anchors = fs.readFileSync(path.join(__dirname, "..", "README.md"), "utf8").split("\n").filter(l => /^#{1,6} /.test(l)).map(l => slug(l.replace(/^#+ /, "")));
  test("the toolbar's Help opens shortcuts, five how-tos with README links, and Start a New Setup; Escape goes back to Help", async ({ app, page }) => {
    await app.open({ profile: base([stick()]), devices: [h.DEV.virpil()], query: "?edit" });
    await page.click("#toolbar [data-act=help]");
    await expect(page.locator("#help")).toHaveClass(/open/);
    await expect(page.locator("#welcome")).not.toHaveClass(/open/);
    const c = await page.evaluate(() => ({
      heads: [...document.querySelectorAll("#help h3")].map(e => e.textContent),
      keys: document.querySelectorAll("#help .keys dt").length,
      howtos: [...document.querySelectorAll("#help .howto section")].map(s => ({ title: s.querySelector("h4").textContent, sentences: s.querySelector("p").textContent.split(/[.?!](\s|$)/).filter(x => x && x.trim()).length, last: s.lastElementChild.tagName, href: s.querySelector("a").href })),
      tiles: document.querySelectorAll("#help [data-welcome-preset], #help [data-preset]").length,
      setup: [...document.querySelectorAll("#help button")].map(b => b.textContent)
    }));
    expect(c.heads).toEqual(["Keyboard Shortcuts", "How To"]);
    expect(c.keys).toBeGreaterThanOrEqual(14);
    expect(c.howtos.map(o => o.title)).toEqual(["Bind or Rebind a Widget", "Arrange and Align", "Back Up and Share a Profile", "Add to OBS and Capture the Game View", "Overlay Lags While You Fly"]);
    for (const o of c.howtos) {
      expect(o.sentences, o.title).toBeGreaterThanOrEqual(2); expect(o.sentences, o.title).toBeLessThanOrEqual(3);
      expect(o.last, o.title + " ends with its link").toBe("A");
      const [url, anchor] = o.href.split("#");
      expect(url).toBe("https://github.com/Adobe-Wan/Joystick-Overlay-Inputs-JOI");
      expect(anchors, o.title).toContain(anchor);
    }
    expect(c.tiles, "no preset tiles to click by accident").toBe(0);
    expect(c.setup).toContain("Start a New Setup");
    await page.keyboard.press("Escape");
    await expect(page.locator("#help")).not.toHaveClass(/open/);
    await expect(page.locator("#toolbar [data-act=help]")).toBeFocused();
  });
  test("? opens Help, and Start a New Setup opens the welcome, which goes back to Help on Escape", async ({ app, page }) => {
    await app.open({ profile: base([stick()]), devices: [h.DEV.virpil()], query: "?edit" });
    await blur(page);
    await page.keyboard.press("?");
    await expect(page.locator("#help")).toHaveClass(/open/);
    await page.keyboard.press("Escape");
    await expect(page.locator("#help")).not.toHaveClass(/open/);
    await page.click("#toolbar [data-act=help]");
    await page.click('#help button:has-text("Start a New Setup")');
    await expect(page.locator("#help")).not.toHaveClass(/open/);
    await expect(page.locator("#welcome")).toHaveClass(/open/);
    await expect(page.locator("#welcome-presets button").first()).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(page.locator("#welcome")).not.toHaveClass(/open/);
    await expect(page.locator("#toolbar [data-act=help]")).toBeFocused();
  });
  test("Help fits 1366 x 768 with its foot in view", async ({ app, page }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await app.open({ profile: base([stick()]), devices: [h.DEV.virpil()], query: "?edit" });
    await page.click("#toolbar [data-act=help]");
    const m = await page.evaluate(() => { const d = document.querySelector("#help .dialog"), f = document.querySelector("#help .foot").getBoundingClientRect(); return { whole: d.scrollHeight - d.clientHeight, foot: f.bottom, vh: innerHeight }; });
    expect(m.whole).toBeLessThanOrEqual(0);
    expect(m.foot).toBeLessThanOrEqual(m.vh);
  });
});

test.describe("R12 the bind dialog keeps clear of the widget it binds", () => {
  const rects = page => page.evaluate(() => {
    const R = e => { const b = e.getBoundingClientRect(); return { l: b.left, t: b.top, r: b.right, b: b.bottom }; };
    return { dlg: R(document.getElementById("wiz-body")), w: R(runtime[wiz.remap].root), vw: innerWidth, vh: innerHeight };
  });
  const apart = (a, b) => a.r <= b.l || b.r <= a.l || a.b <= b.t || b.b <= a.t;
  for (const [vw, vh] of [[1600, 900], [1366, 768]]) {
    test(`Projections at ${vw} x ${vh}: no step's dialog covers its widget, and all of it is on screen`, async ({ app, page }) => {
      await page.setViewportSize({ width: vw, height: vh });
      await app.open({ query: "?edit", devices: [h.DEV.virpil()] });
      await page.click('#welcome [data-welcome-preset="adobewan-projections"]');
      for (let i = 0; i < 4; i++) {
        const m = await rects(page);
        expect(apart(m.dlg, m.w), `step ${i + 1} dialog clear of its widget`).toBe(true);
        expect(m.dlg.l).toBeGreaterThanOrEqual(0); expect(m.dlg.t).toBeGreaterThanOrEqual(0);
        expect(m.dlg.r).toBeLessThanOrEqual(m.vw); expect(m.dlg.b).toBeLessThanOrEqual(m.vh);
        await page.click('#wiz-body .actions button:has-text("Skip for Now")');
      }
    });
  }
  test("the readout in the dialog follows the stick, before and after an axis is captured", async ({ app, page }) => {
    await app.open({ query: "?edit", devices: [h.DEV.virpil()] });
    await page.click('#welcome [data-welcome-preset="adobewan-projections"]');
    await expect(page.locator("#wiz-body .kicker")).toHaveText("Bind Inputs · 1 of 4 · Strafe");
    const read = () => page.locator("#wiz-read").textContent();
    await expect.poll(read).toMatch(/^L\/R\s+0%\s+U\/D\s+–$/);
    await page.evaluate(() => window.__fakeGP.set(0, { axes: { 0: 0.3 } })); await app.frames(5);
    await expect.poll(read).toMatch(/^L\/R\s+30%/);
    await page.evaluate(() => window.__fakeGP.set(0, { axes: { 0: 0 } })); await app.frames(5);
    await app.play(h.throwAxis(0, 5, h.AX.x, 0, 1));
    await expect.poll(() => page.evaluate(() => wiz && wiz.step)).toBe(1);
    await page.evaluate(() => window.__fakeGP.set(0, { axes: { 0: -0.4 } })); await app.frames(5);
    await expect.poll(read).toMatch(/^L\/R\s+-40%\s+U\/D\s+0%$/);
  });
  test("a dialog that is not binding a widget stays in the middle", async ({ app, page }) => {
    await app.open({ profile: base([stick()]), devices: [h.DEV.virpil()], query: "?edit" });
    await page.click("#toolbar [data-act=add-device]");
    expect(await page.evaluate(() => document.getElementById("wizard").classList.contains("placed"))).toBe(false);
    await expect(page.locator("#wiz-read")).toHaveCount(0);
  });
});

test.describe("R13 and R17 one Add, one list of types", () => {
  test("the round + menu lists the wizard's types, in its order and with its names; the panel has one Add", async ({ app, page }) => {
    await app.open({ profile: base([stick()]), devices: [h.DEV.virpil()], query: "?edit" });
    const menu = await page.evaluate(() => [...document.querySelectorAll("#fab-menu button")].map(b => b.querySelector("span").textContent));
    const adds = page.locator("#panel button", { hasText: /^\+ (Add|Device|Button\/Key)$/ });
    await expect(adds).toHaveCount(1);
    await expect(adds).toHaveText("+ Add");
    await adds.click();
    await expect(page.locator("#wiz-title")).toHaveText("What Are You Adding?");
    const tiles = await page.evaluate(() => [...document.querySelectorAll("#wiz-body .types button")].map(b => b.childNodes[1].textContent));
    expect(tiles).toEqual(["Stick", "Pedals", "Button/Key", "Throttle", "Single Axis", "Label"]);
    expect(menu).toEqual(tiles);
    expect(await page.evaluate(() => [...document.querySelectorAll("#fab-menu button")].map(b => b.getAttribute("aria-label")))).toEqual(tiles.map(t => "Add " + t));
    // The toolbar's + Add opens the same step.
    await page.keyboard.press("Escape");
    await page.click("#toolbar [data-act=add-device]");
    await expect(page.locator("#wiz-title")).toHaveText("What Are You Adding?");
  });
  test("each + menu label is 12 px or larger, fits its pill and sits outside its bubble, clear of the others", async ({ app, page }) => {
    await app.open({ profile: base([stick()]), devices: [h.DEV.virpil()], query: "?edit" });
    await blur(page);
    await page.keyboard.press("a");
    await expect(page.locator("#fab-menu")).toHaveClass(/open/);
    await page.waitForTimeout(400);   // the bubbles fan out
    const items = await page.evaluate(() => [...document.querySelectorAll("#fab-menu button")].map(b => {
      const s = b.querySelector("span"), R = e => { const r = e.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom }; };
      return { t: s.textContent, size: parseFloat(getComputedStyle(s).fontSize), sw: s.scrollWidth, cw: s.clientWidth, h: s.getBoundingClientRect().height, pill: R(s), bubble: R(b) };
    }));
    const apart = (a, b) => a.r <= b.l || b.r <= a.l || a.b <= b.t || b.b <= a.t;
    for (const o of items) {
      expect(o.size, o.t).toBeGreaterThanOrEqual(12);
      expect(o.sw, o.t + " fits its pill").toBeLessThanOrEqual(o.cw);
      expect(o.h % 4, o.t + " on the 4 px grid").toBe(0);
      expect(apart(o.pill, o.bubble), o.t + " outside its bubble").toBe(true);
      for (const p of items) if (p !== o) { expect(apart(o.pill, p.pill), o.t + " / " + p.t).toBe(true); expect(apart(o.pill, p.bubble), o.t + " / " + p.t).toBe(true); }
      expect(o.pill.l, o.t + " on screen").toBeGreaterThanOrEqual(0); expect(o.pill.t).toBeGreaterThanOrEqual(0);
    }
  });
});
