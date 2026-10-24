// The editor's look (Verseglass): Reduce Transparency is a Settings switch that survives a reload, the editor's
// accent follows the ship maker when every widget wears the same manufacturer Color Theme, and none of it touches
// the fonts the widgets draw with on stream.
const { test, expect, readFixture } = require("./fixtures/app");

const VALID = JSON.parse(readFixture("valid.json"));
const sw = (page, label) => page.locator(`#panel input[role=switch][aria-label="${label}"]`);
const rootVar = (page, name) => page.evaluate(n => getComputedStyle(document.documentElement).getPropertyValue(n).trim(), name);
const panelStyle = page => page.evaluate(() => { const s = getComputedStyle(document.querySelector("#panel")); return { bg: s.backgroundColor, blur: s.backdropFilter }; });

test.describe("editor look", () => {
  test("Reduce transparency makes the panel opaque, and is still on after a reload", async ({ app, page }) => {
    await app.open({ profile: VALID, query: "?edit" });
    await page.evaluate(() => setSelection([], "settings"));
    expect(await page.evaluate(() => document.documentElement.dataset.vgTransparency)).toBeUndefined();
    expect(await panelStyle(page)).toEqual({ bg: "rgba(10, 16, 32, 0.86)", blur: "blur(12px) saturate(1.15)" });
    await expect(sw(page, "Reduce transparency")).not.toBeChecked();

    await sw(page, "Reduce transparency").click({ force: true });
    expect(await page.evaluate(() => document.documentElement.dataset.vgTransparency)).toBe("reduced");
    expect(await panelStyle(page)).toEqual({ bg: "rgb(10, 16, 32)", blur: "none" });
    await app.flushSave();
    expect((await app.storedProfile()).settings.reduceTransparency).toBe(true);

    await app.reload("?edit");
    expect(await page.evaluate(() => document.documentElement.dataset.vgTransparency)).toBe("reduced");
    await page.evaluate(() => setSelection([], "settings"));
    await expect(sw(page, "Reduce transparency")).toBeChecked();
    await sw(page, "Reduce transparency").click({ force: true });
    expect(await page.evaluate(() => document.documentElement.dataset.vgTransparency)).toBeUndefined();
    expect(await panelStyle(page)).toEqual({ bg: "rgba(10, 16, 32, 0.86)", blur: "blur(12px) saturate(1.15)" });
  });

  test("an unknown value in a saved profile falls back to the default", async ({ app, page }) => {
    await app.open({ profile: { ...VALID, settings: { ...VALID.settings, reduceTransparency: "yes please" } }, query: "?edit" });
    expect(await page.evaluate(() => profile.settings.reduceTransparency)).toBe(false);
    expect(await page.evaluate(() => document.documentElement.dataset.vgTransparency)).toBeUndefined();
  });

  test("the editor's accent follows a manufacturer theme on every widget, and lets go when they differ", async ({ app, page }) => {
    await app.open({ profile: VALID, query: "?edit" });
    expect(await page.evaluate(() => document.documentElement.dataset.vgTheme)).toBeUndefined();
    expect(await rootVar(page, "--vg-accent-default")).toBe("#5EAEFA");

    await page.evaluate(() => applyThemeTo(MFG_THEMES.find(t => t.id === "drake"), [], true));
    expect(await page.evaluate(() => document.documentElement.dataset.vgTheme)).toBe("drake");
    expect(await rootVar(page, "--vg-accent-default")).toBe("#E9A23B");
    await app.frames(15);   // past the button's 120 ms color transition
    const primary = await page.evaluate(() => getComputedStyle(document.querySelector("#toolbar button.primary")).backgroundColor);
    expect(primary).toBe("rgb(233, 162, 59)");

    // One widget on another theme: the chrome goes back to Verseglass blue. Featured themes never set a maker either.
    await page.evaluate(() => { const w = profile.widgets.find(x => x.type === "stick"); applyThemeTo(FEATURED_THEMES[0], [w], false); });
    expect(await page.evaluate(() => document.documentElement.dataset.vgTheme)).toBeUndefined();
    expect(await rootVar(page, "--vg-accent-default")).toBe("#5EAEFA");
    await page.evaluate(() => applyThemeTo(FEATURED_THEMES.find(t => t.id === "avs"), [], true));
    expect(await page.evaluate(() => document.documentElement.dataset.vgTheme)).toBeUndefined();
  });

  test("the widgets keep their own fonts: the design system only dresses the editor", async ({ app, page }) => {
    await app.open({ profile: VALID, query: "?edit" });
    expect(await rootVar(page, "--font")).toMatch(/^"Segoe UI"/);
    expect(await rootVar(page, "--mono")).toMatch(/^"Cascadia Mono"/);
    expect(await rootVar(page, "--vg-font-ui")).toMatch(/^"IBM Plex Sans", .*"Segoe UI"/);
    const [panelFont, readoutFont] = await page.evaluate(() => [getComputedStyle(document.querySelector("#panel")).fontFamily,
      getComputedStyle(document.querySelector(".widget .readout")).fontFamily]);
    expect(panelFont).toMatch(/^"IBM Plex Sans"/);
    expect(readoutFont).toMatch(/^"Cascadia Mono"/);
    // The editor's rem is 16px at Editor text size 100%, so every token lands on the 4px grid.
    await page.evaluate(() => { profile.settings.uiScale = 1; applySettings(); });
    expect(await page.evaluate(() => document.documentElement.style.fontSize)).toBe("16px");
    expect(await page.evaluate(() => document.querySelector("#panel").getBoundingClientRect().width)).toBe(352);
  });
});
