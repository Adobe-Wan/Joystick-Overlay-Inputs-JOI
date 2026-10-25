// Dialogs and welcome, from the October 2026 UX audit: single-axis bind steps that name the way to move, a welcome
// whose way out stays on screen, focus that goes back where it came from, a real Help dialog, a bind dialog that
// keeps clear of the widget it binds and shows the move, and one Add with one list of types.
const { test, expect } = require("./fixtures/app");
const h = require("./fixtures/gamepad");

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
