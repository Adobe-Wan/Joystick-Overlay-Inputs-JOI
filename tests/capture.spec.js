// Capture Game View: JOI asks OBS (its WebSocket server, protocol v5) for a screenshot of the game capture source and
// puts it behind the editor. A fake OBS answers on ws://localhost:4455, so no OBS is needed.
const crypto = require("crypto");
const { test, expect } = require("./fixtures/app");

const sha = s => crypto.createHash("sha256").update(s).digest("base64");
const INPUTS = [
  { inputName: "Star Citizen", inputKind: "game_capture", unversionedInputKind: "game_capture" },
  { inputName: "JOI", inputKind: "browser_source", unversionedInputKind: "browser_source" },
  { inputName: "Desktop", inputKind: "monitor_capture", unversionedInputKind: "monitor_capture" },
  { inputName: "Launcher", inputKind: "window_capture", unversionedInputKind: "window_capture" }
];

// A fake OBS. `password` turns on authentication; `image(source)` answers GetSourceScreenshot. Set it up before the
// page loads (Playwright hooks WebSocket at load); change the options later through obs.set().
async function fakeObs(page, opts = {}) {
  const log = [], o = { password: "", inputs: INPUTS, image: () => null, ...opts };
  await page.routeWebSocket(/^ws:\/\/localhost:4455\/?$/, ws => {
    const { password, inputs, image } = o;
    if (o.down) return ws.close({ code: 1006 });
    const salt = "c2FsdA==", challenge = "Y2hhbGxlbmdl";
    ws.send(JSON.stringify({ op: 0, d: { obsWebSocketVersion: "5.5.0", rpcVersion: 1, ...(password ? { authentication: { salt, challenge } } : {}) } }));
    ws.onMessage(raw => {
      const m = JSON.parse(raw);
      log.push(m);
      if (m.op === 1) {
        if (password && m.d.authentication !== sha(sha(password + salt) + challenge)) return ws.close({ code: 4009, reason: "Authentication failed." });
        return ws.send(JSON.stringify({ op: 2, d: { negotiatedRpcVersion: 1 } }));
      }
      if (m.op !== 6) return;
      const reply = (responseData, ok = true) => ws.send(JSON.stringify({ op: 7, d: { requestType: m.d.requestType, requestId: m.d.requestId,
        requestStatus: { result: ok, code: ok ? 100 : 600, ...(ok ? {} : { comment: "No source was found." }) }, responseData } }));
      if (m.d.requestType === "GetInputList") reply({ inputs });
      else if (m.d.requestType === "GetSourceScreenshot") {
        const data = image(m.d.requestData.sourceName);
        if (data) reply({ imageData: data }); else reply(undefined, false);
      }
    });
  });
  return { log, set: v => Object.assign(o, v) };
}
// A 64x36 JPEG of one color, made by the page itself.
const jpeg = (page, color) => page.evaluate(c => { const cv = document.createElement("canvas"); cv.width = 64; cv.height = 36; const g = cv.getContext("2d"); g.fillStyle = c; g.fillRect(0, 0, 64, 36); return cv.toDataURL("image/jpeg"); }, color);
const background = page => page.evaluate(() => document.body.style.backgroundImage);
const stored = page => page.evaluate(() => JSON.parse(localStorage.getItem("joi.obs") || "null"));
const closeWelcome = page => page.evaluate(() => closeWelcome());
// The fake OBS goes in first, then the editor opens.
async function setup(app, opts, open = {}) {
  const obs = await fakeObs(app.page, opts);
  await app.open({ query: "?edit", ...open });
  await closeWelcome(app.page);
  return obs;
}
const capture = page => page.getByRole("button", { name: "Capture Game View" }).click();
const pressC = async page => { await page.evaluate(() => document.activeElement && document.activeElement.blur()); await page.keyboard.press("c"); };

test("first capture: connect, pick the game source, and the screenshot goes behind the editor", async ({ app, page }) => {
  const obs = await setup(app);
  const red = await jpeg(page, "#c03030");
  obs.set({ image: () => red.replace("data:image/jpeg;", "data:image/jpg;") });   // OBS may name it jpg
  await capture(page);
  await expect(page.locator("#obs-dlg")).toHaveClass(/open/);
  await page.click("#obs-go");
  // Only capture sources are offered, game capture first.
  await expect(page.locator("#obs-source-row")).toBeVisible();
  expect(await page.locator("#obs-source option").allTextContents()).toEqual(["Star Citizen", "Launcher", "Desktop"]);
  await expect(page.locator("#obs-go")).toHaveText("Capture");
  await page.click("#obs-go");
  await expect(page.locator("#obs-dlg")).not.toHaveClass(/open/);
  expect(await background(page)).toContain(red.slice(0, 60));
  await expect(page.locator("#toast")).toHaveText("Captured Star Citizen.");
  expect(await stored(page)).toEqual({ port: 4455, source: "Star Citizen", password: "" });
  expect(await page.evaluate(() => localStorage.getItem("joi.reference"))).toBe(red);
  // It asked for the source, not the scene, as a JPEG.
  const shot = obs.log.find(m => m.op === 6 && m.d.requestType === "GetSourceScreenshot");
  expect(shot.d.requestData).toMatchObject({ sourceName: "Star Citizen", imageFormat: "jpeg" });
  await expect(page.locator("#panel")).toContainText("From OBS: Star Citizen");
});

test("one source captures straight away, and C captures again with no dialog", async ({ app, page }) => {
  const obs = await setup(app, { inputs: [INPUTS[0], INPUTS[1]] });
  const red = await jpeg(page, "#c03030"), blue = await jpeg(page, "#3050c0");
  obs.set({ image: () => red });
  await capture(page);
  await page.click("#obs-go");
  await expect(page.locator("#obs-dlg")).not.toHaveClass(/open/);
  expect(await background(page)).toContain(red.slice(0, 60));
  obs.set({ image: () => blue });
  await pressC(page);
  await expect.poll(() => background(page)).toContain(blue.slice(0, 60));
  await expect(page.locator("#obs-dlg")).not.toHaveClass(/open/);
});

test("password: a wrong one says so, Remember keeps the right one for one-click captures after a reload", async ({ app, page }) => {
  const obs = await setup(app, { password: "hunter2 ✓" });
  const red = await jpeg(page, "#c03030");
  obs.set({ image: () => red });
  await capture(page);
  await page.click("#obs-go");
  await expect(page.locator("#obs-err")).toHaveText(/needs the WebSocket server password/);
  await page.fill("#obs-pw", "nope");
  await page.click("#obs-go");
  await expect(page.locator("#obs-err")).toHaveText(/password is wrong/);
  await page.fill("#obs-pw", "hunter2 ✓");
  await page.check("#obs-remember");
  await page.click("#obs-go");
  await expect(page.locator("#obs-go")).toHaveText("Capture");
  await page.click("#obs-go");
  await expect(page.locator("#obs-dlg")).not.toHaveClass(/open/);
  expect((await stored(page)).password).toBe("hunter2 ✓");
  // The password is not part of the layout, so Profiles & Share never carries it.
  expect(await page.evaluate(() => JSON.stringify(profile))).not.toContain("hunter2");

  await page.evaluate(() => localStorage.removeItem("joi.reference"));
  await app.reload("?edit");
  await closeWelcome(page);
  await pressC(page);
  await expect.poll(() => background(page)).toContain(red.slice(0, 60));
  await expect(page.locator("#obs-dlg")).not.toHaveClass(/open/);
});

test("without Remember, the password lasts until reload and is never stored", async ({ app, page }) => {
  const obs = await setup(app, { password: "pw", inputs: [INPUTS[0]] });
  const red = await jpeg(page, "#c03030");
  obs.set({ image: () => red });
  await capture(page);
  await page.fill("#obs-pw", "pw");
  await page.click("#obs-go");
  await expect(page.locator("#obs-dlg")).not.toHaveClass(/open/);
  expect((await stored(page)).password).toBe("");
  await page.evaluate(() => { document.body.style.backgroundImage = ""; toast(""); });
  await pressC(page);   // same session: still one click
  await expect(page.locator("#toast")).toHaveText("Captured Star Citizen.");
  await expect(page.locator("#obs-dlg")).not.toHaveClass(/open/);

  await app.reload("?edit");
  await closeWelcome(page);
  await pressC(page);
  await expect(page.locator("#obs-dlg")).toHaveClass(/open/);
  await expect(page.locator("#obs-err")).toHaveText(/needs the WebSocket server password/);
  await expect(page.locator("#obs-pw")).toBeFocused();
});

test("a black capture warns instead of replacing the background", async ({ app, page }) => {
  const obs = await setup(app, { inputs: [INPUTS[0]] });
  const before = await background(page);
  const black = await jpeg(page, "#000000");
  obs.set({ image: () => black });
  await capture(page);
  await page.click("#obs-go");
  await expect(page.locator("#obs-err")).toHaveText(/came back black/);
  expect(await background(page)).toBe(before);
});

test("no capture source in OBS explains what to add", async ({ app, page }) => {
  await setup(app, { inputs: [INPUTS[1]] });
  await capture(page);
  await page.click("#obs-go");
  await expect(page.locator("#obs-err")).toHaveText(/No Game, Window or Display Capture/);
});

test("OBS refusing the screenshot says to put the game on screen", async ({ app, page }) => {
  await setup(app, { inputs: [INPUTS[0]], image: () => null });
  await capture(page);
  await page.click("#obs-go");
  await expect(page.locator("#obs-err")).toHaveText(/couldn't take the screenshot/);
});

test("OBS not running: the dialog says it can't reach OBS, and Escape closes it", async ({ app, page }) => {
  await setup(app, { down: true });
  await capture(page);
  await page.click("#obs-go");
  await expect(page.locator("#obs-err")).toHaveText(/Can't reach OBS/);
  await page.keyboard.press("Escape");
  await expect(page.locator("#obs-dlg")).not.toHaveClass(/open/);
  await expect(page.locator("body")).toHaveClass(/editing/);   // Escape closed only the dialog
});

test("a bad port is caught before connecting", async ({ app, page }) => {
  await setup(app);
  await capture(page);
  await page.fill("#obs-port", "99999");
  await page.click("#obs-go");
  await expect(page.locator("#obs-err")).toHaveText(/port is a number/);
});

test("the built-in SHA-256 matches Node's", async ({ app, page }) => {
  await app.open();
  const cases = ["", "abc", "hunter2 ✓", "x".repeat(55), "y".repeat(56), "z".repeat(64), "🚀".repeat(40)];
  const got = await page.evaluate(cs => cs.map(s => sha256b64(s)), cases);
  expect(got).toEqual(cases.map(sha));
});

test("Reset All forgets the OBS connection", async ({ app, page }) => {
  await setup(app, {}, { storage: { "joi.obs": JSON.stringify({ port: 4460, source: "Star Citizen", password: "pw" }) } });
  expect(await page.evaluate(() => obsCfg.port)).toBe(4460);
  await page.evaluate(() => { resetAll(); });
  await page.click('#confirm [data-confirm="yes"]');
  await expect.poll(() => stored(page)).toBeNull();
  expect(await page.evaluate(() => obsCfg)).toEqual({ port: 4455, source: "", password: "" });
});
