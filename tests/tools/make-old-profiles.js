#!/usr/bin/env node
// Regenerates tests/fixtures/profiles/vX.Y.Z.json: a profile saved by each released version.
//
// For each tag it checks out that release's StayOnTarget.html (git show <tag>:StayOnTarget.html) into a temp
// folder, opens it in Chromium with fake devices plugged in, builds a representative layout with that
// version's own functions (wizFinish / addAndPlace for every device type, addLabel, applyThemeTo, a resize, a
// move, and the Projector where the release has it) and writes out what that version stored in localStorage.
// The file also records, under "_rendered", where that version drew each widget.
//
//   node tests/tools/make-old-profiles.js            # every v* tag
//   node tests/tools/make-old-profiles.js v1.9.0      # just some
const { execFileSync } = require("child_process");
const fs = require("fs"), os = require("os"), path = require("path");
const { pathToFileURL } = require("url");
const { chromium } = require("@playwright/test");
const { DEV } = require("../fixtures/gamepad");

const ROOT = path.resolve(__dirname, "..", "..");
const OUT = path.join(ROOT, "tests", "fixtures", "profiles");
const VIEWPORT = { width: 1920, height: 1080 };

const git = (...a) => execFileSync("git", a, { cwd: ROOT, encoding: "utf8", maxBuffer: 64 << 20 });
const tags = process.argv.slice(2).length ? process.argv.slice(2)
  : git("tag", "--list", "v*", "--sort=v:refname").split("\n").filter(Boolean);

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sot-old-"));
  const browser = await chromium.launch();
  for (const tag of tags) {
    const html = path.join(tmp, tag, "StayOnTarget.html");
    fs.mkdirSync(path.dirname(html), { recursive: true });
    fs.writeFileSync(html, git("show", `${tag}:StayOnTarget.html`));
    const ctx = await browser.newContext({ viewport: VIEWPORT });
    await ctx.addInitScript({ path: path.join(ROOT, "tests", "fixtures", "fake-gamepad.js") });
    await ctx.addInitScript(devs => { for (const d of devs) window.__fakeGP.plug(d); }, [DEV.virpil(), DEV.virpil(), DEV.throttle(-1), DEV.trudder()]);
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", e => errors.push(String(e)));
    await page.goto(pathToFileURL(html).href + "?edit");
    await page.waitForTimeout(300);
    const built = await page.evaluate(() => {
      closeWelcome();
      const pads = connectedPads();
      const add = (kind, type, slot, axes, inv, name, button) => {
        const d = pads.find(p => p.pad.index === slot);
        wiz = { kind, stage: "name", type, step: 0, axes, inv, button, dev: d, name };
        wizFinish();
      };
      add("device", "stick", 0, { x: 0, y: 1 }, { x: false, y: true }, "Left Stick");
      add("device", "stick", 1, { x: 0, y: 1 }, { x: false, y: true }, "Right Stick");
      add("device", "throttle", 2, { t: 2 }, { t: false }, "Throttle");
      add("device", "pedals", 3, { r: 5, bl: 0, br: 1 }, { r: false, bl: false, br: false }, "Pedals");
      add("device", "axis", 2, { a: 3 }, { a: true }, "Mining");
      add("button", undefined, 0, undefined, undefined, "Fire", 3);
      closeWizard();
      addLabel();
      const ws = profile.widgets;
      ws[ws.length - 1].label = "Pilot Cam";
      // Theme every widget, then make one widget bigger and move two around, like a user arranging the overlay.
      applyThemeTo(MFG_THEMES.find(t => t.id === "drake") || MFG_THEMES[0], [], true);
      ws[1].size = 1.3; refreshWidget(ws[1]);
      moveWidgets([ws[0]], 40, -300);
      moveWidgets([ws[1]], 0, -60);
      moveWidgets([ws[6]], -600, -700);
      ws[5].accent = "#ff4040";
      const extras = [];
      if (typeof setProjector === "function") { setProjector([ws[0]], true); refreshWidget(ws[0]); extras.push("projector"); }
      if (typeof LOOK_PRESETS !== "undefined") {
        const look = LOOK_PRESETS.find(l => l.name === "Left Screen");
        if (look) { ws[2].persp = { ...look.persp }; ws[2].proj = { ...(look.proj || {}) }; refreshWidget(ws[2]); extras.push("perspective"); }
      }
      save();
      return extras;
    });
    await page.waitForTimeout(500);   // debounced save
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("stayontarget.profile")));
    const rendered = await page.evaluate(() => profile.widgets.map(w => ({ id: w.id, type: w.type, ...boxOf(w) })));
    if (errors.length) throw new Error(`${tag}: page errors while building the layout: ${errors.join(" | ")}`);
    if (!stored || stored.widgets.length !== 7) throw new Error(`${tag}: expected 7 stored widgets, got ${stored && stored.widgets.length}`);
    const file = path.join(OUT, `${tag}.json`);
    fs.writeFileSync(file, JSON.stringify({ ...stored, _source: { tag, commit: git("rev-list", "-n1", tag).trim(), viewport: VIEWPORT, features: built }, _rendered: rendered }, null, 2) + "\n");
    console.log(`${tag}: ${stored.widgets.length} widgets${built.length ? " + " + built.join(", ") : ""} -> ${path.relative(ROOT, file)}`);
    await ctx.close();
  }
  await browser.close();
  fs.rmSync(tmp, { recursive: true, force: true });
})().catch(e => { console.error(e); process.exit(1); });
