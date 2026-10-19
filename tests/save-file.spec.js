// Save and Share writes profile.js and .json files. A normal browser downloads them. OBS's browser has no downloads
// (a download link does nothing there, silently), so inside OBS the same buttons show the file's text in a dialog
// to copy into Notepad. Either way the saved text must load back as the same layout.
const { test, expect, readFixture } = require("./fixtures/app");

const VALID = JSON.parse(readFixture("valid.json"));
const asOBS = page => page.addInitScript(() => { window.obsstudio = { pluginVersion: "test" }; });
const openExport = page => page.click("#toolbar [data-act=export]");
const layoutOf = p => p.widgets.map(w => [w.id, w.type, w.x, w.y]);
// The object in a profile.js, cut out the same way Import reads it.
const fromScript = text => JSON.parse(text.slice(text.indexOf("window.JOI_PROFILE = ") + 21, text.lastIndexOf(";")));

test("outside OBS, Download profile.js downloads a file that loads back", async ({ app, page }) => {
  await app.open({ profile: VALID, query: "?edit" });
  await openExport(page);
  const [dl] = await Promise.all([page.waitForEvent("download"), page.click("#panel button:has-text('Download profile.js')")]);
  expect(dl.suggestedFilename()).toBe("profile.js");
  const text = require("fs").readFileSync(await dl.path(), "utf8");
  expect(layoutOf(fromScript(text))).toEqual(layoutOf(await app.profile()));
  await expect(page.locator("#save-copy")).not.toHaveClass(/open/);
});

test.describe("inside OBS", () => {
  test("Download profile.js shows the file to copy instead of a download that would do nothing", async ({ app, page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await asOBS(page);
    await app.open({ profile: VALID, query: "?edit" });
    await openExport(page);
    await expect(page.locator("#panel")).toContainText("OBS can't download files");
    let downloads = 0; page.on("download", () => downloads++);
    await page.click("#panel button:has-text('Download profile.js')");
    const d = page.locator("#save-copy");
    await expect(d).toHaveClass(/open/);
    await expect(page.locator("#save-copy-title")).toHaveText("Save profile.js");
    await expect(d).toContainText("same folder as JOI.html");
    const text = await page.locator("#save-copy-text").inputValue();
    expect(layoutOf(fromScript(text))).toEqual(layoutOf(await app.profile()));

    await d.locator("[data-copy=copy]").click();
    await expect(page.locator("#save-copy-status")).toHaveText(/Copied/);
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(text);

    await page.keyboard.press("Escape");
    await expect(d).not.toHaveClass(/open/);
    expect(downloads).toBe(0);

    // What the user pastes into profile.js loads back through Import.
    await page.evaluate(() => { profile.widgets = []; rebuildAll(); });
    await app.importFile({ name: "profile.js", mimeType: "text/javascript", buffer: Buffer.from(text) });
    expect(layoutOf(await app.profile())).toEqual(layoutOf(fromScript(text)));
    expect(app.consoleErrors).toEqual([]);
  });

  test("Download .json shows the shareable file, and Close returns focus", async ({ app, page }) => {
    await asOBS(page);
    await app.open({ profile: VALID, query: "?edit" });
    await openExport(page);
    const btn = page.locator("#panel button:has-text('Download .json')");
    await btn.click();
    await expect(page.locator("#save-copy-title")).toHaveText("Save joi-profile.json");
    await expect(page.locator("#save-copy")).toContainText("Send that file to the other pilot");
    expect(layoutOf(JSON.parse(await page.locator("#save-copy-text").inputValue()))).toEqual(layoutOf(await app.profile()));
    await page.click("#save-copy [data-copy=close]");
    await expect(page.locator("#save-copy")).not.toHaveClass(/open/);
    await expect(btn).toBeFocused();
  });

  test("when copying is blocked, the text is selected for Ctrl+C", async ({ app, page }) => {
    await asOBS(page);
    await page.addInitScript(() => {
      document.execCommand = () => false;
      Object.defineProperty(navigator, "clipboard", { value: { writeText: () => Promise.reject(new Error("blocked")) } });
    });
    await app.open({ profile: VALID, query: "?edit" });
    await openExport(page);
    await page.click("#panel button:has-text('Download profile.js')");
    await page.click("#save-copy [data-copy=copy]");
    await expect(page.locator("#save-copy-status")).toHaveText(/press Ctrl\+C/);
    const sel = await page.evaluate(() => { const a = document.activeElement; return a.id === "save-copy-text" && a.selectionEnd - a.selectionStart === a.value.length; });
    expect(sel).toBe(true);
  });
});
