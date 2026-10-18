// Shared test fixture for JOI.html.
//
// `test` is Playwright's test with an `app` fixture. Every page gets:
//   - the fake Gamepad API (fixtures/fake-gamepad.js), driven per animation frame,
//   - a network guard: every request that is not file:, data: or blob: and reaches the network layer is recorded in
//     app.external and aborted; app.seen also lists remote loads the page attempted that were stopped earlier
//     (for example by the page's CSP),
//   - page errors recorded in app.errors, console errors (other than file:// 404s) in app.consoleErrors.
// After each test the fixture fails the test if the page threw or tried to reach the network,
// unless the test opted out with app.allowErrors() / app.allowNetwork().
const path = require("path");
const fs = require("fs");
const { pathToFileURL } = require("url");
const base = require("@playwright/test");
const { expect } = base;
const { frames, play } = require("./gamepad");

const APP_PATH = process.env.APP ? path.resolve(process.env.APP) : path.resolve(__dirname, "..", "..", "JOI.html");
const APP_URL = pathToFileURL(APP_PATH).href;
const FAKE_GAMEPAD = path.join(__dirname, "fake-gamepad.js");
const STORE_KEY = "joi.profile";
const LOCAL = /^(file|data|blob|about):/;

const test = base.test.extend({
  app: async ({ page, context }, use) => {
    const errors = [], external = [], seen = [], consoleErrors = [];
    let checkErrors = true, checkNetwork = true;
    page.on("pageerror", e => errors.push(String(e && e.stack || e)));
    // A missing profile.js or sample image is a normal file:// 404; anything else logged as an error is kept.
    page.on("console", m => { if (m.type() === "error" && !/ERR_FILE_NOT_FOUND|Failed to load resource/.test(m.text())) consoleErrors.push(m.text()); });
    page.on("request", r => { if (!LOCAL.test(r.url())) seen.push(r.url()); });
    await context.route(u => !LOCAL.test(u.href), r => { external.push(r.request().url()); return r.abort(); });
    await page.addInitScript({ path: FAKE_GAMEPAD });

    const app = {
      page, errors, external, seen, consoleErrors, url: APP_URL, path: APP_PATH,
      allowErrors() { checkErrors = false; },
      allowNetwork() { checkNetwork = false; },
      // Seed devices and storage, then load the page. Storage is seeded once per test (not on reloads), so a
      // reload sees whatever the app itself stored.
      //   devices: fake-gamepad specs plugged before the page loads
      //   profile: object or string written to localStorage["joi.profile"]
      //   storage: extra localStorage keys
      //   tips: mark the coach tips as seen (default true) so they don't cover the stage
      async open({ devices = [], gestureGate = false, maxSlots = 4, query = "", profile = null, storage = {}, tips = true } = {}) {
        const seed = { ...storage };
        if (profile != null) seed[STORE_KEY] = typeof profile === "string" ? profile : JSON.stringify(profile);
        if (tips) seed["joi.tips"] = JSON.stringify({ groups: true });
        await page.addInitScript(([devs, cfg, seed]) => {
          window.__fakeGP.config(cfg);
          for (const d of devs) window.__fakeGP.plug(d);
          try {
            if (!sessionStorage.getItem("__seeded")) {
              for (const k in seed) localStorage.setItem(k, seed[k]);
              sessionStorage.setItem("__seeded", "1");
            }
          } catch (e) { /* storage disabled */ }
        }, [devices, { gestureGate, maxSlots }, seed]);
        await page.goto(APP_URL + query);
        await page.waitForLoadState("load");
        await frames(page, 2);
        return page;
      },
      async reload(query = "") { await page.goto(APP_URL + query); await page.waitForLoadState("load"); await frames(page, 2); },
      frames: n => frames(page, n),
      play: (timeline, tail) => play(page, timeline, tail),
      // Import a profile through the real file picker. `file` is a path, or { name, mimeType, buffer }.
      async importFile(file) {
        await page.setInputFiles("#file-in", file);
        await page.waitForTimeout(400);   // the change handler awaits File.text()
      },
      async importJSON(obj, name = "profile.json") {
        return app.importFile({ name, mimeType: "application/json", buffer: Buffer.from(typeof obj === "string" ? obj : JSON.stringify(obj)) });
      },
      toast: () => page.evaluate(() => document.querySelector("#toast").textContent),
      storedProfile: () => page.evaluate(k => { const s = localStorage.getItem(k); return s && JSON.parse(s); }, STORE_KEY),
      // Wait until the debounced save (150 ms) has reached localStorage.
      flushSave: () => page.waitForTimeout(250),
      profile: () => page.evaluate(() => JSON.parse(JSON.stringify(profile))),
      // What the page shows: each widget's box in layout pixels, read from the app's own geometry.
      boxes: () => page.evaluate(() => profile.widgets.map(w => ({ id: w.id, type: w.type, ...boxOf(w) }))),
      // Frames the page has drawn so far (the fake Gamepad API counts requestAnimationFrame ticks).
      frameCount: () => page.evaluate(() => window.__fakeGP.frame),
      // The overlay's loop is alive: when a device moves, the page keeps reading it. The loop may sleep while
      // nothing changes, so this plugs a device bound to the first input widget (or a spare one) and moves it.
      // A layout with only labels has nothing to read, so there is nothing to check.
      async assertLive() {
        const target = await page.evaluate(() => { const w = profile.widgets.find(o => o.type !== "label"); return w ? (typeof w.match === "string" && w.match) || "Spare (Vendor: 0fff Product: 0001)" : null; });
        if (!target) return;
        const before = await page.evaluate(id => {
          const slot = window.__fakeGP.plug({ id, axes: Array(10).fill(0), buttons: 32 });
          let t = 0; window.__liveT = setInterval(() => { t++; window.__fakeGP.set(slot, { axes: { 0: Math.sin(t / 3), 1: Math.cos(t / 3) }, buttons: { 0: t % 2 === 0 } }); }, 30);
          return window.__fakeGP.polls;
        }, target);
        await expect.poll(() => page.evaluate(() => window.__fakeGP.polls), { message: "overlay keeps reading input", timeout: 30_000 }).toBeGreaterThan(before + 5);
        await page.evaluate(() => clearInterval(window.__liveT));
      }
    };

    await use(app);

    if (checkErrors) expect(errors, "page errors").toEqual([]);
    if (checkNetwork) expect(external, "requests that left the machine").toEqual([]);
  }
});

const readFixture = (...p) => fs.readFileSync(path.join(__dirname, ...p), "utf8");
const fixturePath = (...p) => path.join(__dirname, ...p);

module.exports = { test, expect, APP_PATH, APP_URL, STORE_KEY, frames, play, readFixture, fixturePath };
