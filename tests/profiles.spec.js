// Profiles saved by every earlier release still load. The fixtures in fixtures/profiles/ were made by running each
// tagged release's own StayOnTarget.html, the file's name before JOI (see tools/make-old-profiles.js); each records
// the layout that release stored and where it drew every widget. The current page must load each one, from this
// browser's storage under the old "stayontarget.profile" key (an upgrade) and through Import (a shared .json),
// without errors, with every widget, and with every widget where it was.
const fs = require("fs");
const path = require("path");
const { test, expect, fixturePath } = require("./fixtures/app");
const { DEV } = require("./fixtures/gamepad");

const DIR = fixturePath("profiles");
const FIXTURES = fs.readdirSync(DIR).filter(f => /^v\d+\.\d+\.\d+\.json$/.test(f))
  .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
const DEVICES = [DEV.virpil(), DEV.virpil(), DEV.throttle(-1), DEV.trudder()];   // as plugged in when the fixtures were made
// Which slot each widget was bound to when the fixture was made (Left/Right Stick are identical twins).
const SLOT = { "Left Stick": 0, "Right Stick": 1, Throttle: 2, Pedals: 3, Mining: 2, Fire: 0 };

test("there is a profile fixture for every release tag that exists locally", () => {
  let tags = [];
  try { tags = require("child_process").execFileSync("git", ["tag", "--list", "v*"], { cwd: path.resolve(__dirname, ".."), encoding: "utf8" }).split("\n").filter(Boolean); } catch (e) { /* no git */ }
  for (const t of tags) expect(FIXTURES, `fixture for ${t} (run node tests/tools/make-old-profiles.js ${t})`).toContain(t + ".json");
  expect(FIXTURES.length).toBeGreaterThan(0);
});

for (const file of FIXTURES) {
  const fixture = JSON.parse(fs.readFileSync(path.join(DIR, file), "utf8"));
  const { _source: source, _rendered: rendered, ...saved } = fixture;
  const tag = source.tag;

  test.describe(tag, () => {
    test.use({ viewport: source.viewport });

    async function check(app, page) {
      const st = await page.evaluate(() => ({
        widgets: profile.widgets.map(w => ({ id: w.id, type: w.type, label: w.label, x: w.x, y: w.y })),
        dom: [...document.querySelectorAll("#stage .widget")].map(e => e.dataset.id),
        built: profile.widgets.filter(w => runtime[w.id] && runtime[w.id].root && runtime[w.id].root.isConnected).length,
        failed: profile.widgets.filter(w => runtime[w.id] && runtime[w.id].failed).map(w => w.id)
      }));
      expect(st.widgets.length, "widget count").toBe(saved.widgets.length);
      expect(st.widgets.map(w => [w.id, w.type, w.label])).toEqual(saved.widgets.map(w => [w.id, w.type, w.label]));
      expect(st.widgets.map(w => [w.id, w.x, w.y]), "positions").toEqual(rendered.map(r => [r.id, r.x, r.y]));
      expect(st.dom.sort()).toEqual(saved.widgets.map(w => w.id).sort());
      expect(st.built, "every widget built").toBe(saved.widgets.length);
      expect(st.failed, "widgets that failed to draw").toEqual([]);
      expect(app.consoleErrors, "console errors").toEqual([]);
      for (const b of await app.boxes()) { expect(b.w, b.id + " width").toBeGreaterThan(0); expect(b.h, b.id + " height").toBeGreaterThan(0); }
      // Device bindings survive: each widget reads the device it was bound to.
      const slots = await page.evaluate(() => profile.widgets.filter(w => w.type !== "label")
        .map(w => { const p = padFor(w, connectedPads()); return [w.label, p ? (p.pad ? p.pad.index : p.index) : null]; }));
      expect(Object.fromEntries(slots)).toEqual(Object.fromEntries(slots.map(([l]) => [l, SLOT[l]])));
      await app.assertLive();
    }

    test("loads from this browser's storage", async ({ app, page }) => {
      await app.open({ devices: DEVICES, storage: { "stayontarget.profile": JSON.stringify(saved) }, query: "?transparent" });
      await check(app, page);
      await app.reload("?edit");
      await check(app, page);
    });

    test("loads through Import", async ({ app, page }) => {
      await app.open({ devices: DEVICES, query: "?edit" });
      await page.evaluate(() => closeWelcome());
      await app.importJSON(saved, `stayontarget-profile-${tag}.json`);
      expect(await app.toast()).toMatch(/imported/i);
      await check(app, page);
    });
  });
}

// Stay On Target's keys move to JOI's once: settings come along, a newer JOI value is never overwritten, and
// nothing is left behind for Reset All to bring back.
test("settings saved under Stay On Target's keys move to JOI's", async ({ app, page }) => {
  await app.open({ query: "?edit", tips: false, storage: {
    "stayontarget.units": "pct", "stayontarget.tips": JSON.stringify({ groups: true }),
    "joi.sections": "{}", "stayontarget.sections": JSON.stringify({ layout: true }) } });
  const st = await page.evaluate(() => Object.fromEntries(Object.keys(localStorage).sort().map(k => [k, localStorage.getItem(k)])));
  expect(Object.keys(st).filter(k => k.startsWith("stayontarget."))).toEqual([]);
  expect(st["joi.units"]).toBe("pct");
  expect(st["joi.tips"]).toBe(JSON.stringify({ groups: true }));
  expect(st["joi.sections"]).toBe("{}");
});
