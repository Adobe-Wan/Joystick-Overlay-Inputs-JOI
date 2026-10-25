// October 2026 UX audit, stage and overlay: editor notes stay out of the stream (R11).
const { test, expect } = require("./fixtures/app");
const h = require("./fixtures/gamepad");

const VID = h.DEV.virpil().id;
const stick = (o = {}) => ({ id: "s1", type: "stick", x: 400, y: 300, label: "Stick", match: VID, nth: 0, axes: { x: 0, y: 1 }, inv: {}, ...o });
const base = (widgets, extra = {}) => ({ ver: 2, savedAt: 1, settings: { background: "solid", bgColor: "#24303c" }, widgets, ...extra });

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

