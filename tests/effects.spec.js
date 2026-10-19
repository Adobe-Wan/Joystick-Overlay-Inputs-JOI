// Effects: Drop Shadow and Outer Glow for a widget's text and for its container. Off by default, set in the side
// panel, saved in the profile (and cleaned on load), one undo step per change, and painted without changing size.
const { test, expect } = require("./fixtures/app");
const h = require("./fixtures/gamepad");

const VID = h.DEV.virpil().id;
const stick = (o = {}) => ({ id: "s1", type: "stick", x: 400, y: 300, label: "Stick", match: VID, nth: 0, axes: { x: 0, y: 1 }, inv: {}, ...o });
const btn = (o = {}) => ({ id: "b1", type: "button", x: 800, y: 300, label: "Fire", match: VID, nth: 0, button: 0, ...o });
const base = widgets => ({ ver: 2, savedAt: 1, settings: { background: "solid", bgColor: "#24303c" }, widgets });
const open = (app, profile) => app.open({ profile, devices: [h.DEV.virpil()], query: "?transparent" });
const edit = (page, ids) => page.evaluate(ids => { setEditing(true); setSelection(ids); }, ids);
const look = (page, id = "s1") => page.evaluate(id => {
  const r = runtime[id].root, cs = getComputedStyle(r), before = getComputedStyle(r, "::before");
  return { text: cs.textShadow, box: cs.boxShadow, layer: before.content !== "none" ? before.boxShadow : null, w: r.offsetWidth, h: r.offsetHeight };
}, id);
const toggle = (page, name) => page.evaluate(name => {
  const s = [...document.querySelectorAll("#sec-effects .trow")].filter(t => t.textContent.includes("Drop Shadow") || t.textContent.includes("Outer Glow"));
  const i = { "Text drop": 0, "Text glow": 1, "Container drop": 2, "Container glow": 3 }[name];
  s[i].querySelector("input").click();
}, name);
const slide = (page, label, v) => page.evaluate(([label, v]) => {
  const r = document.querySelector(`#sec-effects input[aria-label="${label}"]`); r.value = v; r.dispatchEvent(new Event("input", { bubbles: true }));
}, [label, v]);

test.describe("Effects", () => {
  test("all four are off by default and the widget looks as before", async ({ app, page }) => {
    await open(app, base([stick()]));
    const r = await look(page);
    expect(r.layer).toBeNull();
    expect(r.text).toBe("rgba(0, 0, 0, 0.9) 0px 1px 2px");
    expect(r.box).toBe("rgba(0, 0, 0, 0.55) 0px 4px 18px 0px");
  });

  test("the Effects section sits after Colors with a Text and a Container group, settings hidden until switched on", async ({ app, page }) => {
    await open(app, base([stick()]));
    await edit(page, ["s1"]);
    const r = await page.evaluate(() => ({
      secs: [...document.querySelectorAll("#panel .sec-t .name")].map(e => e.textContent),
      heads: [...document.querySelectorAll("#sec-effects h5")].map(e => e.textContent),
      rows: [...document.querySelectorAll("#sec-effects .trow .lab")].map(e => e.textContent),
      nests: [...document.querySelectorAll("#sec-effects .nest")].map(n => n.hidden)
    }));
    expect(r.secs.indexOf("Effects")).toBe(r.secs.indexOf("Colors") + 1);
    expect(r.heads).toEqual(["Text", "Container"]);
    expect(r.rows).toEqual(["Drop Shadow", "Outer Glow", "Drop Shadow", "Outer Glow"]);
    expect(r.nests).toEqual([true, true, true, true]);
    await toggle(page, "Text drop");
    expect(await page.evaluate(() => document.querySelectorAll("#sec-effects .nest")[0].hidden)).toBe(false);
    const ctl = await page.evaluate(() => [...document.querySelectorAll("#sec-effects .nest")[0].querySelectorAll("input[aria-label], button[aria-label]")].map(e => e.getAttribute("aria-label")));
    expect(ctl).toEqual(expect.arrayContaining(["Text drop shadow opacity", "Text drop shadow blur", "Text drop shadow X offset in pixels", "Text drop shadow Y offset in pixels"]));
    expect(ctl.some(l => l.startsWith("Text drop shadow color"))).toBe(true);
  });

  test("a text drop shadow replaces the built-in one, and its offset, blur and opacity apply", async ({ app, page }) => {
    await open(app, base([stick()]));
    await edit(page, ["s1"]);
    await toggle(page, "Text drop");
    expect((await look(page)).text).toBe("rgba(0, 0, 0, 0.8) 0px 1px 2px");
    await slide(page, "Text drop shadow blur", 5);
    await slide(page, "Text drop shadow opacity", 50);
    await page.evaluate(() => { const i = document.querySelector('#sec-effects input[aria-label="Text drop shadow X offset in pixels"]'); i.value = 3; i.dispatchEvent(new Event("change")); });
    expect((await look(page)).text).toBe("rgba(0, 0, 0, 0.5) 3px 1px 5px");
    expect(await page.evaluate(() => profile.widgets[0].fx.textShadow)).toEqual({ on: true, b: 5, a: 50, x: 3 });
  });

  test("a text glow follows the Highlight until a color is picked, and keeps the built-in shadow", async ({ app, page }) => {
    await open(app, base([stick({ accent: "#ff0000" })]));
    await edit(page, ["s1"]);
    await toggle(page, "Text glow");
    expect((await look(page)).text).toBe("rgba(255, 0, 0, 0.7) 0px 0px 6px, rgba(0, 0, 0, 0.9) 0px 1px 2px");
    await page.evaluate(() => { const w = profile.widgets[0]; w.accent = "#00ff00"; refreshWidget(w); });
    expect((await look(page)).text).toContain("rgba(0, 255, 0, 0.7) 0px 0px 6px");
    await page.evaluate(() => { const w = profile.widgets[0]; w.fx.textGlow.c = "#0000ff"; w.accent = "#ff0000"; refreshWidget(w); });
    expect((await look(page)).text).toContain("rgba(0, 0, 255, 0.7) 0px 0px 6px");
  });

  test("container effects paint on their own layer, a drop shadow replacing the built-in one", async ({ app, page }) => {
    await open(app, base([stick({ accent: "#ff0000" })]));
    await edit(page, ["s1"]);
    const before = await look(page);
    await toggle(page, "Container drop");
    await toggle(page, "Container glow");
    const r = await look(page);
    expect(r.box).toBe("none");
    expect(r.layer).toBe("rgba(0, 0, 0, 0.6) 0px 6px 16px 0px, rgba(255, 0, 0, 0.5) 0px 0px 16px 4px");
    expect([r.w, r.h]).toEqual([before.w, before.h]);   // effects never change the widget's size
    await slide(page, "Container outer glow blur", 40);
    expect((await look(page)).layer).toContain("rgba(255, 0, 0, 0.5) 0px 0px 40px 10px");
  });

  test("a container glow alone keeps the built-in drop shadow, and 3D depth's shadows stay", async ({ app, page }) => {
    await open(app, base([stick({ fx: { boxGlow: { on: true } } }), btn({ depth: 60, fx: { boxShadow: { on: true } } })]));
    const s = await look(page);
    expect(s.box).toBe("rgba(0, 0, 0, 0.55) 0px 4px 18px 0px");
    expect(s.layer).toContain("0px 0px 16px 4px");
    const b = await look(page, "b1");
    expect(b.box).toContain("inset");   // the bevel 3D depth draws is still there
    expect(b.layer).toBe("rgba(0, 0, 0, 0.6) 0px 6px 16px 0px");
  });

  test("Background opacity 0 keeps the text effects and drops the container's", async ({ app, page }) => {
    await open(app, base([stick({ bgAlpha: 0, fx: { textGlow: { on: true }, boxShadow: { on: true } } })]));
    const r = await look(page);
    expect(r.layer).toBeNull();
    expect(r.text).toContain("0px 0px 6px");
    await edit(page, ["s1"]);
    expect(await page.evaluate(() => document.querySelector("#sec-effects").textContent)).toContain("Shows once Background opacity is above 0%.");
  });

  test("Projector's glow stays under the user's text effects", async ({ app, page }) => {
    await open(app, base([stick({ proj: { glow: 50 }, fx: { textShadow: { on: true, c: "#112233" } } })]));
    const t = (await look(page)).text;
    expect(t.startsWith("rgba(17, 34, 51, 0.8) 0px 1px 2px")).toBe(true);
    expect(t.split("px,").length).toBeGreaterThan(2);   // the user's layer plus Projector's two
  });

  test("a pressed button keeps its highlight glow with container effects on", async ({ app, page }) => {
    await open(app, base([btn({ accent: "#ff0000", fx: { boxShadow: { on: true } } })]));
    await page.evaluate(() => runtime.b1.root.classList.add("on"));
    await page.waitForTimeout(150);   // past the press transition
    const r = await look(page, "b1");
    expect(r.box).toContain("rgb(255, 0, 0) 0px 0px 14px");
    expect(r.layer).toContain("0px 6px 16px");
  });

  test("changes apply to every selected widget and each is one undo step", async ({ app, page }) => {
    await open(app, base([stick(), btn()]));
    await edit(page, ["s1", "b1"]);
    await toggle(page, "Container glow");
    expect(await page.evaluate(() => profile.widgets.map(w => w.fx.boxGlow.on))).toEqual([true, true]);
    await page.waitForTimeout(450);
    await slide(page, "Container outer glow opacity", 90);
    await page.waitForTimeout(450);
    await page.evaluate(() => undo());
    expect(await page.evaluate(() => profile.widgets.map(w => w.fx.boxGlow))).toEqual([{ on: true }, { on: true }]);
    await page.evaluate(() => undo());
    expect(await page.evaluate(() => profile.widgets.map(w => w.fx && w.fx.boxGlow && w.fx.boxGlow.on))).toEqual([undefined, undefined]);
    expect((await look(page)).layer).toBeNull();
    await page.evaluate(() => redo());
    expect((await look(page)).layer).toContain("0px 0px 16px 4px");
  });

  test("effects survive a reload, and Use for All and Reset Effects work", async ({ app, page }) => {
    await open(app, base([stick(), btn()]));
    await edit(page, ["s1"]);
    await toggle(page, "Text glow");
    await page.waitForTimeout(300);
    await page.reload(); await app.frames(2);
    expect(await page.evaluate(() => profile.widgets[0].fx)).toEqual({ textGlow: { on: true } });
    await edit(page, ["s1"]);
    await page.evaluate(() => [...document.querySelectorAll("#sec-effects button")].find(b => b.textContent === "Use These Effects for All Widgets").click());
    expect(await page.evaluate(() => profile.widgets[1].fx)).toEqual({ textGlow: { on: true } });
    await page.evaluate(() => [...document.querySelectorAll("#sec-effects button")].find(b => b.textContent === "Reset Effects").click());
    expect(await page.evaluate(() => profile.widgets[0].fx)).toBeUndefined();
    expect((await look(page)).text).toBe("rgba(0, 0, 0, 0.9) 0px 1px 2px");
  });

  test("normalize() keeps valid effect fields and drops the rest", async ({ app, page }) => {
    await open(app, base([]));
    const got = await page.evaluate(() => normalize({ ver: 2, widgets: [
      { id: "a", type: "label", fx: { textShadow: { on: true, c: "#ABC", a: 500, b: -3, x: 10, y: "4", evil: "url(x)" }, boxGlow: "no", junk: { on: true } } },
      { id: "b", type: "label", fx: { boxShadow: { c: "red; background:url(x)" } } }
    ] }).widgets.map(w => w.fx));
    expect(got[0]).toEqual({ textShadow: { on: true, c: "#aabbcc", a: 100, b: 0, x: 10, y: 4 } });
    expect(got[1]).toEqual({ boxShadow: {} });
  });
});
