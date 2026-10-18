// Hostile and malformed profiles, from the security audit. Every case checks that:
//   - the page throws no errors (the fixture fails the test on any pageerror),
//   - nothing leaves the machine (the fixture fails the test on any request that isn't file:, data: or blob:),
//   - the overlay keeps drawing frames,
//   - edit mode is still reachable after a reload, and Object.prototype is untouched.
const fs = require("fs");
const { test, expect, fixturePath } = require("./fixtures/app");

const PAYLOADS = fixturePath("payloads");
const payload = name => JSON.parse(fs.readFileSync(`${PAYLOADS}/${name}`, "utf8"));

// Larger payloads are built here instead of committed.
const generated = {
  "many-widgets": () => ({ savedAt: 1, widgets: Array.from({ length: 2000 }, (_, i) =>
    ({ id: "n" + i, type: "stick", label: "s", match: "x", axes: { x: 0, y: 1 }, x: i % 1900, y: i % 1000 })) }),
  // About 0.3 MB, under the import cap. Built as text: JSON.stringify would overflow Node's stack.
  "deep-nesting": () => '{"savedAt":1,"widgets":[{"id":"d","type":"label","label":"d","holo":' + '{"a":'.repeat(50_000) + "{}" + "}".repeat(50_000) + "}]}",
  "long-label": () => ({ savedAt: 1, widgets: [{ id: "s", type: "label", label: "A".repeat(500_000), x: 10, y: 10 }] }),
  "wrong-types": () => ({ savedAt: "x", settings: [], widgets: { 0: 1 } }),
  "nulls": () => ({ savedAt: null, settings: null, widgets: [null, 1, "x", [], { id: 5, type: "stick" }, { id: "ok", type: "nope" }] }),
  "button-not-object": () => ({ savedAt: 1, widgets: [{ id: "b", type: "button", label: "b", match: "x", button: "__proto__" }] }),
  "array-root": () => [1, 2, 3]
};

const FILES = ["rich.json", "xss.json", "proto.json", "ctor.json", "selid.json", "missingaxes.json", "nan.json",
  "hugesize.json", "hugesize2.json", "hugescale.json", "hugebox.json", "holo.json", "nomatch.json", "good.json"];
const CASES = [...FILES.map(f => [f.replace(/\.json$/, ""), () => payload(f)]), ...Object.entries(generated)];

// State that must hold however bad the profile was.
async function assertHealthy(app, { editing = true } = {}) {
  const page = app.page;
  await app.assertLive();
  // Not even an attempt that the CSP then blocked: the profile checks alone must keep remote URLs out.
  expect(app.seen, "remote loads attempted (blocked or not)").toEqual([]);
  const st = await page.evaluate(() => ({
    polluted: Object.getOwnPropertyNames(Object.prototype).filter(k => !["constructor", "__defineGetter__", "__defineSetter__",
      "hasOwnProperty", "__lookupGetter__", "__lookupSetter__", "isPrototypeOf", "propertyIsEnumerable", "toString", "valueOf",
      "__proto__", "toLocaleString"].includes(k)),
    pwned: window.__pwned || null,
    editing: document.body.classList.contains("editing"),
    panel: (document.querySelector("#panel") || {}).textContent?.length || 0,
    profileOk: typeof profile === "object" && Array.isArray(profile.widgets)
  }));
  expect(st.polluted, "Object.prototype polluted").toEqual([]);
  expect(st.pwned, "injected script ran").toBeNull();
  expect(st.profileOk).toBe(true);
  if (editing) { expect(st.editing, "edit mode is on").toBe(true); expect(st.panel, "panel rendered").toBeGreaterThan(0); }
}

test.describe("hostile profile imported through the file picker", () => {
  test.setTimeout(120_000);   // many-widgets: 2000 live widgets redraw slowly once their device moves
  for (const [name, make] of CASES) {
    test(name, async ({ app, page }) => {
      await app.open({ query: "?edit" });
      await page.evaluate(() => closeWelcome());
      await app.importJSON(make(), name + ".json");
      await assertHealthy(app);
      await app.flushSave();
      // Edit mode after a reload: a stored bad profile must not brick the app.
      await app.reload("?edit");
      await assertHealthy(app);
      // Overlay mode, as OBS shows it, with every button lit (that is when a remote accent url() would load).
      await app.reload("?transparent");
      await page.evaluate(() => document.querySelectorAll(".btn-widget").forEach(b => b.classList.add("on")));
      await page.waitForTimeout(300);
      await assertHealthy(app, { editing: false });
    });
  }
});

test.describe("hostile profile planted in localStorage", () => {
  test.setTimeout(120_000);
  // In Chromium every file:// page shares one localStorage, so any local HTML file can write these keys.
  for (const [name, make] of CASES) {
    test(name, async ({ app }) => {
      await app.open({ query: "?edit", profile: make() });
      await assertHealthy(app);
      await app.reload("?transparent");
      await assertHealthy(app, { editing: false });
    });
  }

  test("unparseable JSON is set aside and the app starts empty", async ({ app, page }) => {
    await app.open({ query: "?edit", profile: "{broken" });
    await assertHealthy(app);
    const st = await page.evaluate(() => ({ backup: localStorage.getItem("joi.profile.unreadable"), widgets: profile.widgets.length }));
    expect(st.backup).toBe("{broken");
    expect(st.widgets).toBe(0);
  });

  test("reference image string that breaks out of url(\"...\")", async ({ app, page }) => {
    await app.open({ query: "?edit", profile: payload("good.json"),
      storage: { "joi.reference": 'x"), url("http://127.0.0.1:8998/ref-beacon.png' } });
    await assertHealthy(app);
    expect(await page.evaluate(() => getComputedStyle(document.body).backgroundImage)).not.toContain("127.0.0.1");
  });
});

test.describe("imports that must be refused", () => {
  test("oversize file (20 MB) is refused and the layout is kept", async ({ app, page }, testInfo) => {
    await app.open({ query: "?edit", profile: payload("good.json") });
    const before = await app.profile();
    const big = testInfo.outputPath("big.json");
    fs.writeFileSync(big, JSON.stringify({ savedAt: 1, widgets: [{ id: "s", type: "label", label: "A".repeat(20_000_000) }] }));
    await page.setInputFiles("#file-in", big, { timeout: 30_000 });
    await page.waitForTimeout(400);
    expect(await app.toast()).toMatch(/Couldn't read that file/);
    expect((await app.profile()).widgets).toEqual(before.widgets);
    await assertHealthy(app);
  });

  test("deeply nested file over the size cap is refused", async ({ app }) => {
    await app.open({ query: "?edit", profile: payload("good.json") });
    let s = '{"savedAt":1,"widgets":[{"id":"d","type":"label","label":"d","holo":';
    s += '{"a":'.repeat(200_000) + "{}" + "}".repeat(200_000) + "}]}";
    await app.importJSON(s, "deep.json");
    expect(await app.toast()).toMatch(/Couldn't read that file/);
    await assertHealthy(app);
  });

  test("not JSON at all", async ({ app }) => {
    await app.open({ query: "?edit", profile: payload("good.json") });
    await app.importJSON("<html><script>window.__pwned=1</script>", "evil.json");
    expect(await app.toast()).toMatch(/Couldn't read that file/);
    await assertHealthy(app);
  });

  test("profile.js with code around the object is parsed, never run", async ({ app }) => {
    await app.open({ query: "?edit" });
    await app.importFile({ name: "profile.js", mimeType: "text/javascript",
      buffer: Buffer.from('window.__pwned = 1;\nwindow.JOI_PROFILE = {"savedAt":1,"widgets":[{"id":"a","type":"label","label":"x"}]};\n') });
    await assertHealthy(app);
  });
});

test.describe("reference screenshot", () => {
  test("a PNG upload is applied as a data: URL", async ({ app, page }) => {
    await app.open({ query: "?edit", profile: payload("good.json") });
    await page.setInputFiles("#ref-in", `${PAYLOADS}/ref.png`);
    await page.waitForTimeout(400);
    expect(await page.evaluate(() => getComputedStyle(document.body).backgroundImage)).toMatch(/^url\("data:image\/png;base64,/);
    await assertHealthy(app);
  });

  test("an unsupported or broken image is rejected", async ({ app, page }) => {
    await app.open({ query: "?edit", profile: payload("good.json") });
    for (const [name, mimeType, buffer] of [
      ["x.gif", "image/gif", Buffer.from("R0lGODlhAQABAAAAACw=", "base64")],
      ["broken.png", "image/png", Buffer.from("not really a png")],
      ["x.svg", "image/svg+xml", Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><image href="https://evil.example/x.png"/></svg>')]]) {
      await page.setInputFiles("#ref-in", { name, mimeType, buffer });
      await page.waitForTimeout(400);
      const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundImage);
      expect(bg, name).not.toMatch(/image\/(gif|svg)/);
    }
    await assertHealthy(app);
  });
});

test.describe("storage quota", () => {
  test("a full localStorage warns on save and keeps running", async ({ app, page }) => {
    await app.open({ query: "?edit" });
    await page.evaluate(() => {
      let lo = 0, hi = 6e6;
      while (hi - lo > 100) { const m = (lo + hi) >> 1; try { localStorage.setItem("junk", "A".repeat(m)); lo = m; } catch (e) { hi = m; } }
      localStorage.setItem("junk", "A".repeat(Math.max(0, lo - 50)));
    });
    await app.importJSON(payload("rich.json"));
    await app.flushSave();
    expect(await app.toast()).toMatch(/storage is full/i);
    await assertHealthy(app);
  });

  test("a large stored reference screenshot gives way so the layout is saved", async ({ app, page }) => {
    await app.open({ query: "?edit" });
    await page.evaluate(() => {
      let lo = 0, hi = 6e6;
      while (hi - lo > 1000) { const m = (lo + hi) >> 1; try { localStorage.setItem("joi.reference", "data:image/png;base64," + "A".repeat(m)); lo = m; } catch (e) { hi = m; } }
      localStorage.setItem("joi.reference", "data:image/png;base64," + "A".repeat(lo - 200));
    });
    await app.importJSON(payload("rich.json"));
    await app.flushSave();
    const shown = await page.evaluate(() => profile.widgets.length);
    await app.reload("?edit");
    expect(await page.evaluate(() => profile.widgets.length), "layout survives a reload").toBe(shown);
    await assertHealthy(app);
  });
});

test.describe("Content-Security-Policy", () => {
  test("the page carries a strict CSP meta tag", async ({ app, page }) => {
    await app.open();
    const csp = await page.evaluate(() => {
      const m = document.querySelector('meta[http-equiv="Content-Security-Policy" i]');
      return m && { content: m.getAttribute("content"), first: m === document.head.querySelector("meta[http-equiv]") };
    });
    expect(csp, "CSP meta tag").not.toBeNull();
    const dir = Object.fromEntries(csp.content.split(";").map(s => s.trim().split(/\s+/)).filter(a => a[0]).map(([k, ...v]) => [k, v]));
    expect(dir["default-src"]).toEqual(["'none'"]);
    expect(dir["img-src"]).toEqual(expect.arrayContaining(["'self'", "data:"]));
    expect(dir["img-src"]).not.toContain("*");
    expect(dir["script-src"] || []).not.toContain("'unsafe-eval'");
    expect(dir["script-src"] || []).not.toContain("*");
    expect(dir["object-src"]).toEqual(["'none'"]);
    expect(dir["base-uri"]).toEqual(["'none'"]);
    expect(dir["connect-src"] === undefined || dir["connect-src"].join(" ") === "'none'").toBe(true);
  });

  test("the network guard itself catches a remote load (self-test)", async ({ app, page }) => {
    app.allowNetwork();
    await page.setContent('<img src="https://example.invalid/guard.png">');
    await expect.poll(() => app.external.length).toBeGreaterThan(0);
    expect(app.external[0]).toContain("https://example.invalid/guard.png");
  });

  test("the CSP is live: a remote url() is refused", async ({ app, page }) => {
    await app.open({ query: "?edit" });
    const v = await page.evaluate(() => new Promise(r => {
      document.addEventListener("securitypolicyviolation", e => r(e.violatedDirective + " " + e.blockedURI));
      document.body.style.backgroundImage = "url(https://example.invalid/x.png)";
      setTimeout(() => r("no violation"), 1500);
    }));
    expect(v).toMatch(/^img-src/);
    expect(app.external).toEqual([]);
  });
});
