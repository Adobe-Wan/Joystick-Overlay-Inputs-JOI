// Templates: two of AdobeWan's own screens as starting points, next to the starter presets. Each builds a finished
// layout at fixed places on the 1920 x 1080 baseline, moves with the canvas, lands on the 4 px grid inside the safe
// margin, starts unbound and walks straight into Bind Inputs.
const { test, expect } = require("./fixtures/app");

const TEMPLATES = [
  { id: "adobewan-projections", name: "AdobeWan Projections Layout",
    hint: "Two floating sticks beside the reticle with Roll and Pedals under it, in the projected look.",
    widgets: [["stick", "Strafe", "strafe"], ["stick", "Pitch / Yaw", "flight"], ["axis", "Roll", undefined], ["pedals", "Pedals", undefined]],
    at: [[620, 476], [1144, 476], [932, 688], [904, 756]],
    looks: ["Visor HUD", "Visor HUD", "Visor HUD", "Visor HUD"] },
  { id: "adobewan-minimalist", name: "AdobeWan Minimalist (Advanced HUD Off)",
    hint: "Small sticks beside the center console with Roll and Rev / Fwd, nothing else on the glass.",
    widgets: [["stick", "Strafe", "strafe"], ["stick", "Pitch / Yaw", "flight"], ["axis", "Roll", undefined], ["axis", "Rev / Fwd", undefined]],
    at: [[800, 904], [1020, 904], [932, 864], [904, 948]],
    looks: ["Dash Projector", "Dash Projector", "Hologram", "Dash Projector"] }
];
const TEMPLATE_NAMES = TEMPLATES.map(t => t.name);

// Opens the editor on an empty profile with the welcome closed; manual: Scale 100 % instead of auto, so the canvas
// is the whole viewport.
async function openEmpty(app, page, { manual = false } = {}) {
  const settings = manual ? { scaleMode: "manual", scale: 1 } : {};
  await app.open({ profile: { ver: 3, savedAt: 1, settings, widgets: [] }, query: "?edit" });
  await page.evaluate(() => closeWelcome());
}
const build = (page, id) => page.evaluate(id => {
  addPreset(id);
  const kicker = document.querySelector("#wiz-body .kicker");
  return { kicker: kicker && kicker.textContent, name: activeLayout().name, preset: activeLayout().preset };
}, id);
// Every widget's fields and the box that has to stay on screen (the projector base included).
const state = page => page.evaluate(() => ({
  C: canvasSize(), margin: profile.settings.margin,
  ws: profile.widgets.map(w => { const b = boxOf(w), f = footprintOf(w);
    return { type: w.type, label: w.label, axisNames: w.axisNames, x: w.x, y: w.y, w: b.w, h: b.h, f, unbound: isUnbound(w), holo: !!(w.holo && w.holo.on), base: f.h > b.h }; })
}));
function expectOnGridInMargin(st, tag) {
  for (const w of st.ws) {
    expect(w.x % 4, `${tag} ${w.label} x on the 4 px grid`).toBe(0);
    expect(w.y % 4, `${tag} ${w.label} y on the 4 px grid`).toBe(0);
    expect(w.f.x, `${tag} ${w.label} left`).toBeGreaterThanOrEqual(st.margin);
    expect(w.f.y, `${tag} ${w.label} top`).toBeGreaterThanOrEqual(st.margin);
    expect(w.f.x + w.f.w, `${tag} ${w.label} right`).toBeLessThanOrEqual(st.C.w - st.margin + 0.01);
    expect(w.f.y + w.f.h, `${tag} ${w.label} bottom`).toBeLessThanOrEqual(st.C.h - st.margin + 0.01);
  }
}

for (const t of TEMPLATES) {
  test.describe(t.name, () => {
    for (const [vw, vh] of [[1920, 1080], [2560, 1440]]) {
      test(`builds its widgets at the measured places at ${vw} x ${vh}, unbound, and starts Bind Inputs`, async ({ app, page }) => {
        await page.setViewportSize({ width: vw, height: vh });
        await openEmpty(app, page);
        const r = await build(page, t.id);
        expect(r.name).toBe(t.name);
        expect(r.preset).toBe(t.id);
        expect(r.kicker).toBe(`Bind Inputs · 1 of ${t.widgets.length} · Strafe`);
        const st = await state(page);
        expect([st.C.w, st.C.h].map(Math.round)).toEqual([1920, 1080]);   // auto scale: a 16:9 screen is the 1080p baseline at any size
        expect(st.ws.map(w => [w.type, w.label, w.axisNames])).toEqual(t.widgets);
        expect(st.ws.map(w => [w.x, w.y])).toEqual(t.at);
        expect(st.ws.every(w => w.unbound)).toBe(true);
        expectOnGridInMargin(st, `${vw}x${vh}`);
        expect(await page.evaluate(() => document.querySelectorAll("#stage .widget.unbound").length)).toBe(t.widgets.length);
        expect(app.consoleErrors).toEqual([]);
      });
    }

    test("on a 2560 x 1440 canvas (Scale 100 %) the widgets keep their place on the screen, on the grid and inside the margin", async ({ app, page }) => {
      await page.setViewportSize({ width: 2560, height: 1440 });
      await openEmpty(app, page, { manual: true });
      await build(page, t.id);
      const st = await state(page);
      expect(st.C).toEqual({ w: 2560, h: 1440 });
      expectOnGridInMargin(st, "2560x1440 manual");
      // Each center sits where the baseline center would, scaled with the canvas, give or take the grid and margin.
      st.ws.forEach((w, i) => {
        const [bx, by] = t.at[i];
        expect(Math.abs(w.x + w.w / 2 - (bx + w.w / 2) * 2560 / 1920), w.label + " center x").toBeLessThanOrEqual(4);
        if (!w.base) expect(Math.abs(w.y + w.h / 2 - (by + w.h / 2) * 1440 / 1080), w.label + " center y").toBeLessThanOrEqual(4);
      });
    });

    test("carries the Cockpit Look fields its tiles set, and survives a reload unchanged", async ({ app, page }) => {
      await openEmpty(app, page);
      await build(page, t.id);
      await page.evaluate(() => closeWizard());
      const looks = await page.evaluate(names => profile.widgets.map((w, i) => {
        const l = LOOK_PRESETS.find(o => o.name === names[i]);
        return { persp: JSON.stringify(w.persp) === JSON.stringify(lookPersp(l)), proj: JSON.stringify(w.proj) === JSON.stringify(lookProj(l)),
          alpha: w.bgAlpha === l.alpha, holo: !!(w.holo && w.holo.on) === !!(l.holo && l.holo.on) };
      }), t.looks);
      for (const [i, l] of looks.entries()) expect(l, `${t.widgets[i][1]}: ${t.looks[i]}`).toEqual({ persp: true, proj: true, alpha: true, holo: true });
      const before = await app.profile();
      // The save is debounced: wait until it has reached storage, not a fixed time (a busy machine is slower).
      await expect.poll(async () => ((await app.storedProfile()) || {}).savedAt, { timeout: 10_000 }).toBeGreaterThanOrEqual(before.savedAt);
      // Compare the reload with what was actually written: a late layout pass can still stamp a widget after the
      // snapshot above, and that write is the one a reload reads.
      const written = await app.storedProfile();
      expect(written.widgets.length).toBe(before.widgets.length);
      await app.reload("?edit");
      const after = await app.profile();
      expect(after.widgets).toEqual(written.widgets);
      expect(after.layouts.list.find(e => e.id === after.layouts.active).name).toBe(t.name);
    });
  });
}

test.describe("template tiles", () => {
  test("the welcome lists both templates under their own heading, and a tile builds that template", async ({ app, page }) => {
    await app.open({ query: "?edit" });
    await expect(page.locator("#welcome")).toHaveClass(/open/);
    await expect(page.locator("#welcome-templates-title")).toHaveText("Templates");
    await expect(page.locator("#welcome-templates-hint")).not.toBeEmpty();
    const tiles = await page.evaluate(() => [...document.querySelectorAll("#welcome-templates button")].map(b => ({
      id: b.dataset.welcomePreset, name: b.childNodes[1].textContent, hint: b.querySelector("small").textContent, icons: b.querySelectorAll("svg").length })));
    expect(tiles.map(o => o.id)).toEqual(TEMPLATES.map(o => o.id));
    expect(tiles.map(o => o.name)).toEqual(TEMPLATE_NAMES);
    expect(tiles.map(o => o.hint)).toEqual(TEMPLATES.map(o => o.hint));
    for (const o of tiles) expect(o.icons, o.name + " icons").toBeGreaterThan(0);
    // The starter setups are unchanged: no template among them.
    expect(await page.evaluate(() => [...document.querySelectorAll("#welcome-presets button")].map(b => b.dataset.welcomePreset)))
      .toEqual(["wasd-mouse", "hosas-pedals", "hotas-pedals", "hosam", "directional"]);
    await page.click('#welcome-templates button[data-welcome-preset="adobewan-minimalist"]');
    await expect(page.locator("#welcome")).not.toHaveClass(/open/);
    expect(await page.evaluate(() => [activeLayout().name, profile.widgets.length])).toEqual(["AdobeWan Minimalist (Advanced HUD Off)", 4]);
    await expect(page.locator("#wiz-body .kicker")).toHaveText("Bind Inputs · 1 of 4 · Strafe");
  });

  test("Profiles & Share shows a Templates heading under the presets, and a tile adds the template as a new profile", async ({ app, page }) => {
    await app.open({ query: "?edit" });
    await page.evaluate(() => closeWelcome());
    await page.click("#toolbar [data-act=profiles]");
    const heads = await page.evaluate(() => [...document.querySelectorAll("#panel h5")].map(e => e.textContent));
    expect(heads.slice(-2)).toEqual(["Start From a Preset", "Templates"]);
    await expect(page.locator("#profile-templates button")).toHaveText(TEMPLATES.map(o => new RegExp(o.name.replace(/[()]/g, "\\$&"))));
    await page.click('#profile-templates button[data-preset="adobewan-projections"]');
    await expect(page.locator("#wiz-body .kicker")).toHaveText("Bind Inputs · 1 of 4 · Strafe");
    expect(await page.evaluate(() => [activeLayout().name, profile.widgets.map(w => w.label)])).toEqual(["AdobeWan Projections Layout", ["Strafe", "Pitch / Yaw", "Roll", "Pedals"]]);
    // Added next to a profile that already has widgets, it becomes a profile of its own.
    await page.evaluate(() => { closeWizard(); addPreset("adobewan-minimalist"); closeWizard(); });
    expect(await page.evaluate(() => profile.layouts.list.map(e => e.name))).toEqual(TEMPLATE_NAMES);
  });
});
