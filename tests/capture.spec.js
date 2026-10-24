// Capture Game View: JOI asks OBS (its WebSocket server, protocol v5) for a screenshot of the game's capture source and
// puts it behind the editor. A fake OBS answers on ws://localhost:4455, so no OBS is needed.
const crypto = require("crypto");
const { test, expect } = require("./fixtures/app");

const sha = s => crypto.createHash("sha256").update(s).digest("base64");
const input = (inputName, kind) => ({ inputName, inputKind: kind, unversionedInputKind: kind });
// A pilot with a 2D scene (on air) and a VR scene, like AdobeWan's.
const INPUTS = [
  input("Game Capture 2", "game_capture"), input("SC Window", "window_capture"), input("JOI", "browser_source"),
  input("Desktop", "monitor_capture"), input("Mic", "wasapi_input_capture"), input("VR View", "window_capture"),
  input("Webcam", "dshow_input"), input("Spare Capture", "game_capture")
];
const SCENES = { "2D": ["SC Window", "JOI", "Mic"], VR: ["VR View", "Webcam", "JOI"], Setup: ["Desktop", "Game Capture 2"] };

// A fake OBS. `password` turns on authentication; `image(source)` answers GetSourceScreenshot (null: OBS fails to
// render it). `scenes: null` acts like an OBS that refuses the scene requests. Set it up before the page loads
// (Playwright hooks WebSocket at load); change the options later through obs.set().
async function fakeObs(page, opts = {}) {
  const log = [], o = { password: "", inputs: INPUTS, scenes: SCENES, program: "2D", image: () => null, video: null, transforms: {}, recording: false, ...opts };
  await page.routeWebSocket(/^ws:\/\/localhost:4455\/?$/, ws => {
    const { password, inputs, scenes, program } = o;
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
      const reply = (responseData, comment) => ws.send(JSON.stringify({ op: 7, d: { requestType: m.d.requestType, requestId: m.d.requestId,
        requestStatus: { result: !comment, code: comment ? 702 : 100, ...(comment ? { comment } : {}) }, responseData } }));
      const t = m.d.requestType, rd = m.d.requestData || {};
      if (t === "GetInputList") reply({ inputs });
      else if (t === "GetSceneList" && scenes) reply({ currentProgramSceneName: program, scenes: Object.keys(scenes).reverse().map((sceneName, i) => ({ sceneName, sceneIndex: i })) });
      else if (t === "GetSceneItemList" && scenes && scenes[rd.sceneName]) reply({ sceneItems: scenes[rd.sceneName].map((sourceName, i) => ({ sourceName, sceneItemId: i + 1, sourceType: "OBS_SOURCE_TYPE_INPUT", isGroup: false, sceneItemEnabled: true })) });
      else if (t === "GetVideoSettings" && o.video) reply(o.video);
      else if (t === "GetSceneItemTransform" && scenes && o.transforms[scenes[rd.sceneName][rd.sceneItemId - 1]]) reply({ sceneItemTransform: o.transforms[scenes[rd.sceneName][rd.sceneItemId - 1]] });
      else if (t === "GetRecordStatus") reply({ outputActive: o.recording });
      else if (t === "GetStreamStatus") reply({ outputActive: false });
      else if (t === "GetSourceScreenshot") { const data = o.image(rd.sourceName); reply(data ? { imageData: data } : undefined, data ? null : "Failed to render screenshot."); }
      else reply(undefined, "Unsupported");
    });
  });
  const shotReqs = () => log.filter(m => m.op === 6 && m.d.requestType === "GetSourceScreenshot").map(m => m.d.requestData);
  return { log, set: v => Object.assign(o, v), shots: () => shotReqs().map(r => r.sourceName), widths: () => shotReqs().map(r => r.imageWidth) };
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
const groups = page => page.evaluate(() => [...document.querySelectorAll("#obs-source optgroup")].map(g => [g.label, [...g.children].map(o => o.textContent)]));
const remembered = source => JSON.stringify({ port: 4455, source, password: "" });

test("first capture: every video source, grouped by scene with the one on air first, then Capture Now", async ({ app, page }) => {
  const obs = await setup(app);
  const red = await jpeg(page, "#c03030");
  obs.set({ image: n => n === "SC Window" ? red.replace("data:image/jpeg;", "data:image/jpg;") : null });   // OBS may name it jpg
  await capture(page);
  await expect(page.locator("#obs-dlg")).toHaveClass(/open/);
  await page.click("#obs-go");
  await expect(page.locator("#obs-source-row")).toBeVisible();
  // Window Capture is listed; audio and browser sources (JOI itself) are not.
  expect(await groups(page)).toEqual([
    ["2D (on air)", ["SC Window"]],
    ["VR", ["VR View", "Webcam"]],
    ["Setup", ["Game Capture 2", "Desktop"]],
    ["Not in any scene", ["Spare Capture"]]
  ]);
  await expect(page.locator("#obs-source")).toHaveValue("SC Window");   // the capture on air is picked
  await expect(page.locator("#obs-go")).toHaveText("Capture in 5 s");
  await page.click("#obs-now");
  await expect(page.locator("#obs-dlg")).not.toHaveClass(/open/);
  await expect.poll(() => background(page)).toContain(red.slice(0, 60));
  await expect(page.locator("#toast")).toHaveText("Captured SC Window.");
  expect(await stored(page)).toEqual({ port: 4455, source: "SC Window", password: "" });
  expect(await page.evaluate(() => localStorage.getItem("joi.reference"))).toBe(red);
  // It asked for the source, not the scene, as a JPEG.
  const shot = obs.log.find(m => m.op === 6 && m.d.requestType === "GetSourceScreenshot");
  expect(shot.d.requestData).toMatchObject({ sourceName: "SC Window", imageFormat: "jpeg" });
  await expect(page.locator("#panel")).toContainText("From OBS: SC Window");
});

test("the chosen source in another scene sticks, for a pilot capturing VR", async ({ app, page }) => {
  const obs = await setup(app);
  const blue = await jpeg(page, "#3050c0");
  obs.set({ image: n => n === "VR View" ? blue : null });
  await capture(page);
  await page.click("#obs-go");
  await page.selectOption("#obs-source", "VR View");
  await page.click("#obs-now");
  await expect.poll(() => background(page)).toContain(blue.slice(0, 60));
  expect((await stored(page)).source).toBe("VR View");
  expect(obs.shots()).toEqual(["VR View"]);
});

test("Capture Game View counts down so you can switch to the game, then captures", async ({ app, page }) => {
  const obs = await setup(app, {}, { storage: { "joi.obs": remembered("SC Window") } });
  const red = await jpeg(page, "#c03030");
  obs.set({ image: () => red });
  const t0 = Date.now();
  await capture(page);
  await expect(page.locator("#toast")).toContainText("Switch to your game. Capturing in 5 s");
  await page.waitForTimeout(2500);
  expect(obs.shots()).toEqual([]);   // still counting
  await expect.poll(() => background(page), { timeout: 8000 }).toContain(red.slice(0, 60));
  expect(Date.now() - t0).toBeGreaterThan(4000);
  await expect(page.locator("#toast")).toHaveText("Captured SC Window.");
});

test("C during the countdown captures right away", async ({ app, page }) => {
  const obs = await setup(app, {}, { storage: { "joi.obs": remembered("SC Window") } });
  const red = await jpeg(page, "#c03030");
  obs.set({ image: () => red });
  await pressC(page);
  await expect(page.locator("#toast")).toContainText("Capturing in 5 s");
  await pressC(page);
  await expect.poll(() => background(page), { timeout: 2000 }).toContain(red.slice(0, 60));
});

test("a source with no picture falls back to another capture on air, never a webcam", async ({ app, page }) => {
  const obs = await setup(app, {}, { storage: { "joi.obs": remembered("Game Capture 2") } });
  const red = await jpeg(page, "#c03030");
  obs.set({ image: n => n === "SC Window" || n === "Webcam" ? red : null });
  await pressC(page); await pressC(page);
  await expect.poll(() => background(page)).toContain(red.slice(0, 60));
  await expect(page.locator("#toast")).toHaveText("Captured SC Window. Game Capture 2 had no picture, so JOI uses SC Window from now on.");
  expect((await stored(page)).source).toBe("SC Window");
  expect(obs.shots()).toEqual(["Game Capture 2", "SC Window"]);
});

test("when nothing has a picture, the dialog says why and quotes OBS", async ({ app, page }) => {
  const obs = await setup(app, {}, { storage: { "joi.obs": remembered("Game Capture 2") } });
  await pressC(page); await pressC(page);
  await expect(page.locator("#obs-dlg")).toHaveClass(/open/);
  await expect(page.locator("#obs-err")).toHaveText(/None of your capture sources had a picture.*\(OBS said: Failed to render screenshot\.\)/);
  expect(obs.shots()).not.toContain("Webcam");
});

test("black captures are skipped, and all black says the game may be minimized", async ({ app, page }) => {
  const obs = await setup(app, {}, { storage: { "joi.obs": remembered("SC Window") } });
  const before = await background(page);
  const black = await jpeg(page, "#000000");
  obs.set({ image: () => black });
  await pressC(page); await pressC(page);
  await expect(page.locator("#obs-err")).toHaveText(/came back black/);
  expect(await background(page)).toBe(before);
});

test("an OBS that refuses the scene requests still lists its sources", async ({ app, page }) => {
  await setup(app, { scenes: null });
  await capture(page);
  await page.click("#obs-go");
  await expect(page.locator("#obs-source-row")).toBeVisible();
  expect(await groups(page)).toEqual([]);
  expect(await page.locator("#obs-source option").allTextContents()).toEqual(["Game Capture 2", "Spare Capture", "SC Window", "VR View", "Desktop", "Webcam"]);
});

test("no source that could show a game explains what to add", async ({ app, page }) => {
  await setup(app, { inputs: [input("JOI", "browser_source"), input("Mic", "wasapi_input_capture")] });
  await capture(page);
  await page.click("#obs-go");
  await expect(page.locator("#obs-err")).toHaveText(/No source in OBS shows a game/);
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
  await expect(page.locator("#obs-go")).toHaveText("Capture in 5 s");
  await page.click("#obs-now");
  await expect.poll(() => background(page)).toContain(red.slice(0, 60));
  expect((await stored(page)).password).toBe("hunter2 ✓");
  // The password is not part of the layout, so Profiles & Share never carries it.
  expect(await page.evaluate(() => JSON.stringify(profile))).not.toContain("hunter2");

  await page.evaluate(() => localStorage.removeItem("joi.reference"));
  await app.reload("?edit");
  await closeWelcome(page);
  await pressC(page); await pressC(page);
  await expect.poll(() => background(page)).toContain(red.slice(0, 60));
  await expect(page.locator("#obs-dlg")).not.toHaveClass(/open/);
});

test("without Remember, the password lasts until reload and is never stored", async ({ app, page }) => {
  const obs = await setup(app, { password: "pw" });
  const red = await jpeg(page, "#c03030");
  obs.set({ image: () => red });
  await capture(page);
  await page.fill("#obs-pw", "pw");
  await page.click("#obs-go");
  await page.click("#obs-now");
  await expect(page.locator("#toast")).toHaveText("Captured SC Window.");
  expect((await stored(page)).password).toBe("");
  await page.evaluate(() => toast(""));
  await pressC(page); await pressC(page);   // same session: no dialog
  await expect(page.locator("#toast")).toHaveText("Captured SC Window.");
  await expect(page.locator("#obs-dlg")).not.toHaveClass(/open/);

  await app.reload("?edit");
  await closeWelcome(page);
  await pressC(page); await pressC(page);
  await expect(page.locator("#obs-dlg")).toHaveClass(/open/);
  await expect(page.locator("#obs-err")).toHaveText(/needs the WebSocket server password/);
  await expect(page.locator("#obs-pw")).toBeFocused();
});

test("editing the password after connecting asks to connect again", async ({ app, page }) => {
  await setup(app);
  await capture(page);
  await page.click("#obs-go");
  await expect(page.locator("#obs-go")).toHaveText("Capture in 5 s");
  await page.fill("#obs-pw", "x");
  await expect(page.locator("#obs-go")).toHaveText("Connect");
  await expect(page.locator("#obs-now")).toBeHidden();
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
  await setup(app, {}, { storage: { "joi.obs": JSON.stringify({ port: 4460, source: "SC Window", password: "pw" }) } });
  expect(await page.evaluate(() => obsCfg.port)).toBe(4460);
  await page.evaluate(() => { resetAll(); });
  await page.click('#confirm [data-confirm="yes"]');
  await expect.poll(() => stored(page)).toBeNull();
  expect(await page.evaluate(() => obsCfg)).toEqual({ port: 4455, source: "", password: "" });
});

// ---------- matching the stream: output size and where the game sits in the scene ----------
const VIDEO = { baseWidth: 1920, baseHeight: 1080, outputWidth: 1280, outputHeight: 720, fpsNumerator: 60, fpsDenominator: 1 };
const tf = o => ({ positionX: 0, positionY: 0, rotation: 0, scaleX: 1, scaleY: 1, sourceWidth: 1920, sourceHeight: 1080, alignment: 5,
  boundsType: "OBS_BOUNDS_NONE", boundsWidth: 0, boundsHeight: 0, boundsAlignment: 0, cropLeft: 0, cropRight: 0, cropTop: 0, cropBottom: 0, cropToBounds: false, ...o });
// The stored background's size and the color at a few points (fractions of its width and height).
const sample = (page, pts) => page.evaluate(pts => new Promise(res => {
  const img = new Image();
  img.onload = () => {
    const c = document.createElement("canvas"); c.width = img.width; c.height = img.height;
    const g = c.getContext("2d"); g.drawImage(img, 0, 0);
    res({ w: img.width, h: img.height, px: pts.map(([x, y]) => { const d = g.getImageData(Math.floor(x * img.width), Math.floor(y * img.height), 1, 1).data; return d[0] > 120 && d[1] < 90 ? "red" : d[0] + d[1] + d[2] < 40 ? "black" : "other"; }) });
  };
  img.src = localStorage.getItem("joi.reference");
}), pts);

test("captures at OBS's output size, with the game where the scene puts it", async ({ app, page }) => {
  // The window is scaled to half size and centered: the stream shows it in the middle with black around it.
  const obs = await setup(app, { video: VIDEO, transforms: { "SC Window": tf({ positionX: 960, positionY: 540, alignment: 0, scaleX: 0.5, scaleY: 0.5 }) } },
    { storage: { "joi.obs": remembered("SC Window") } });
  const red = await jpeg(page, "#c03030");
  obs.set({ image: () => red });
  await pressC(page); await pressC(page);
  await expect(page.locator("#toast")).toHaveText("Captured SC Window.");
  expect(obs.widths()).toEqual([640]);   // only the pixels it covers: half of the 1280 px output
  expect(await sample(page, [[0.5, 0.5], [0.3, 0.3], [0.05, 0.05], [0.9, 0.5]])).toEqual({ w: 1280, h: 720, px: ["red", "red", "black", "black"] });
});

test("crop is honored: a window cropped to its left half shows on the left", async ({ app, page }) => {
  const obs = await setup(app, { video: { ...VIDEO, outputWidth: 1920, outputHeight: 1080 }, transforms: { "SC Window": tf({ cropRight: 960 }) } },
    { storage: { "joi.obs": remembered("SC Window") } });
  const red = await jpeg(page, "#c03030");
  obs.set({ image: () => red });
  await pressC(page); await pressC(page);
  await expect(page.locator("#toast")).toHaveText("Captured SC Window.");
  expect(obs.widths()).toEqual([1920]);   // the full source, so its cropped half fills its 960 px
  expect(await sample(page, [[0.25, 0.5], [0.75, 0.5]])).toEqual({ w: 1920, h: 1080, px: ["red", "black"] });
});

test("without a scene position it still captures at the output width", async ({ app, page }) => {
  const obs = await setup(app, { video: { ...VIDEO, outputWidth: 2560, outputHeight: 1440 } }, { storage: { "joi.obs": remembered("SC Window") } });
  const red = await jpeg(page, "#c03030");
  obs.set({ image: () => red });
  await pressC(page); await pressC(page);
  await expect(page.locator("#toast")).toHaveText("Captured SC Window.");
  expect(obs.widths()).toEqual([2560]);
});

test("bounds, alignment and flips land where OBS draws them", async ({ app, page }) => {
  await app.open();
  const r = await page.evaluate(() => [
    placeRect({ sourceWidth: 1920, sourceHeight: 1080, cropLeft: 0, cropRight: 0, cropTop: 0, cropBottom: 0, scaleX: -1, scaleY: 1, alignment: 0, boundsType: "OBS_BOUNDS_NONE" }),
    placeRect({ sourceWidth: 1000, sourceHeight: 1000, cropLeft: 0, cropRight: 0, cropTop: 0, cropBottom: 0, scaleX: 1, scaleY: 1, alignment: 5, boundsType: "OBS_BOUNDS_SCALE_INNER", boundsWidth: 1920, boundsHeight: 1080, boundsAlignment: 0 }),
    placeRect({ sourceWidth: 1000, sourceHeight: 1000, cropLeft: 0, cropRight: 0, cropTop: 0, cropBottom: 0, scaleX: 1, scaleY: 1, alignment: 10, boundsType: "OBS_BOUNDS_STRETCH", boundsWidth: 400, boundsHeight: 200, boundsAlignment: 0 }),
    placeRect({ sourceWidth: 1000, sourceHeight: 500, cropLeft: 0, cropRight: 0, cropTop: 0, cropBottom: 0, scaleX: 1, scaleY: 1, alignment: 5, boundsType: "OBS_BOUNDS_SCALE_OUTER", boundsWidth: 500, boundsHeight: 500, boundsAlignment: 1 })
  ]);
  expect(r[0]).toEqual({ x: -960, y: -540, w: 1920, h: 1080 });
  expect(r[1]).toEqual({ x: 420, y: 0, w: 1080, h: 1080, clip: null });              // fit, centered in the bounds
  expect(r[2]).toEqual({ x: -400, y: -200, w: 400, h: 200, clip: null });            // bottom-right anchored stretch
  expect(r[3]).toEqual({ x: 0, y: 0, w: 1000, h: 500, clip: { x: 0, y: 0, w: 500, h: 500 } });   // cover, left-aligned, clipped
});

// ---------- Live ----------
test("Live follows the game with small frames, and turning it off keeps one sharp frame", async ({ app, page }) => {
  const obs = await setup(app, { video: { ...VIDEO, outputWidth: 2560, outputHeight: 1440 } }, { storage: { "joi.obs": remembered("SC Window") } });
  const red = await jpeg(page, "#c03030"), blue = await jpeg(page, "#3050c0");
  let n = 0;
  obs.set({ image: () => (n++ % 2 ? blue : red) });
  await page.getByRole("button", { name: "Live" }).click();
  await expect(page.getByRole("button", { name: "Live" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#panel")).toContainText("Live from OBS: SC Window");
  await expect.poll(() => obs.widths().length, { timeout: 5000 }).toBeGreaterThanOrEqual(4);
  expect(Math.max(...obs.widths())).toBeLessThanOrEqual(1280);
  // About twice a second, not flat out.
  const a = obs.widths().length; await page.waitForTimeout(2000); const b = obs.widths().length;
  expect(b - a).toBeGreaterThanOrEqual(2); expect(b - a).toBeLessThanOrEqual(6);
  // Live frames aren't written to storage.
  expect(await page.evaluate(() => localStorage.getItem("joi.reference"))).toBeNull();
  await page.getByRole("button", { name: "Live" }).click();
  await expect(page.locator("#toast")).toHaveText("Captured SC Window.");
  expect(obs.widths().at(-1)).toBe(2560);
  const c = obs.widths().length; await page.waitForTimeout(1200);
  expect(obs.widths().length).toBe(c);   // stopped
  expect(await page.evaluate(() => localStorage.getItem("joi.reference"))).toMatch(/^data:image\/jpeg/);
});

test("Live pauses while OBS records and stops when the editor closes", async ({ app, page }) => {
  const obs = await setup(app, {}, { storage: { "joi.obs": remembered("SC Window") } });
  const red = await jpeg(page, "#c03030");
  obs.set({ image: () => red, recording: true });
  await page.evaluate(() => document.activeElement.blur());
  await page.keyboard.press("l");
  await expect(page.locator("#panel")).toContainText("Live is paused while OBS records or streams.");
  await page.waitForTimeout(1000);
  expect(obs.shots()).toEqual([]);
  obs.set({ recording: false });
  await expect.poll(() => obs.shots().length, { timeout: 6000 }).toBeGreaterThan(0);
  await expect(page.locator("#panel")).not.toContainText("paused");
  await page.evaluate(() => setEditing(false));
  const n = obs.shots().length; await page.waitForTimeout(1200);
  expect(obs.shots().length).toBeLessThanOrEqual(n + 1);   // at most the frame already in flight
  expect(await page.evaluate(() => localStorage.getItem("joi.reference"))).toMatch(/^data:image\/jpeg/);   // the last frame is kept
  await page.evaluate(() => setEditing(true));
  await expect(page.getByRole("button", { name: "Live" })).toHaveAttribute("aria-pressed", "false");
});

test("Live keeps trying while the game has no picture, and never swaps the source", async ({ app, page }) => {
  const obs = await setup(app, {}, { storage: { "joi.obs": remembered("SC Window") } });
  const red = await jpeg(page, "#c03030");
  obs.set({ image: n => n === "Desktop" ? red : null });
  await page.getByRole("button", { name: "Live" }).click();
  await expect(page.locator("#panel")).toContainText("Live is waiting for a picture from OBS");
  await expect.poll(() => obs.shots().length, { timeout: 5000 }).toBeGreaterThanOrEqual(2);
  expect(new Set(obs.shots())).toEqual(new Set(["SC Window"]));
  obs.set({ image: () => red });
  await expect(page.locator("#panel")).not.toContainText("waiting", { timeout: 6000 });
  expect((await stored(page)).source).toBe("SC Window");
});
