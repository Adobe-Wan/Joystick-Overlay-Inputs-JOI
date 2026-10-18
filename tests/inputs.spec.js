// Saved bindings read back from the device: a hat direction bound as a button, an analog button (a standard
// gamepad's trigger) bound as an axis, and normalize() keeping hat fields on Button widgets only.
const { test, expect } = require("./fixtures/app");
const { DEV, AX, HAT_IDLE } = require("./fixtures/gamepad");

// A hat reported as one axis: direction j (0 = Up, clockwise) reads -1 + j * 2/7; it idles beyond ±1.
const hat = j => -1 + j * 2 / 7;
const widget = (o, spec) => ({ x: 50, y: 50, size: 1, match: spec.id, nth: 0, ...o });
const isOn = (page, id) => page.evaluate(id => runtime[id].root.classList.contains("on"), id);

test.describe("hat direction bound as a button", () => {
  const stick = DEV.virpil();
  const profile = { savedAt: Date.now(), settings: {}, widgets: [
    widget({ id: "up", type: "button", label: "Hat Up", button: 0, hat: AX.hat, hatDir: 0 }, stick),
    widget({ id: "ur", type: "button", label: "Hat Up-Right", button: 0, hat: AX.hat, hatDir: 1 }, stick)] };

  test("a cardinal direction lights on itself and on the diagonals beside it", async ({ app, page }) => {
    await app.open({ devices: [stick], profile });
    const push = async v => { await page.evaluate(v => window.__fakeGP.set(0, { axes: { 9: v } }), v); await app.frames(4); };
    await push(HAT_IDLE);
    expect(await isOn(page, "up"), "centered").toBe(false);
    for (const [j, on] of [[0, true], [1, true], [7, true], [2, false], [4, false], [6, false]]) {
      await push(hat(j));
      expect(await isOn(page, "up"), `hat direction ${j}`).toBe(on);
    }
    await push(HAT_IDLE);
    expect(await isOn(page, "up"), "back to center").toBe(false);
  });

  test("a diagonal direction lights only on itself", async ({ app, page }) => {
    await app.open({ devices: [stick], profile });
    for (const [j, on] of [[1, true], [0, false], [2, false], [7, false]]) {
      await page.evaluate(v => window.__fakeGP.set(0, { axes: { 9: v } }), hat(j));
      await app.frames(4);
      expect(await isOn(page, "ur"), `hat direction ${j}`).toBe(on);
    }
  });
});

test("an axis index of BTN_AXIS + 7 reads buttons[7].value as -1..1", async ({ app, page }) => {
  const pad = DEV.xbox();
  const btnAxis = 64;   // BTN_AXIS in the page; checked below so the test fails loudly if it moves
  const profile = { savedAt: Date.now(), settings: {}, widgets: [
    widget({ id: "rt", type: "axis", label: "Trigger", axes: { a: btnAxis + 7 }, inv: {} }, pad)] };
  await app.open({ devices: [pad], profile });
  expect(await page.evaluate(() => BTN_AXIS)).toBe(btnAxis);
  for (const [value, want, text] of [[0, -1, "-100%"], [0.5, 0, "0%"], [1, 1, "+100%"], [0.25, -0.5, "-50%"]]) {
    await page.evaluate(v => window.__fakeGP.set(0, { buttons: { 7: v } }), value);
    await app.frames(10);   // readouts update every 66 ms
    const got = await page.evaluate(() => {
      const w = profile.widgets[0], pad = navigator.getGamepads()[0];
      return { v: readAxis(pad, w, "a"), text: runtime[w.id].spans.v.textContent };
    });
    expect(got.v, `button value ${value}`).toBeCloseTo(want, 6);
    expect(got.text, `readout at button value ${value}`).toBe(text);
  }
});

test("normalize() keeps hat and hatDir on Button widgets only", async ({ app, page }) => {
  await app.open();
  const out = await page.evaluate(() => normalize({ widgets: [
    { id: "s", type: "stick", hat: 9, hatDir: 2 },
    { id: "t", type: "throttle", hat: 9 },
    { id: "l", type: "label", hatDir: 3 },
    { id: "b", type: "button", button: 2, hat: 9, hatDir: 5 },
    { id: "h", type: "button", hat: 9 },
    { id: "n", type: "button", button: 4, hatDir: 6 }
  ] }).widgets);
  const byId = Object.fromEntries(out.map(w => [w.id, w]));
  for (const id of ["s", "t", "l", "n"]) {
    expect(byId[id], id).not.toHaveProperty("hat");
    expect(byId[id], id).not.toHaveProperty("hatDir");
  }
  expect([byId.b.hat, byId.b.hatDir]).toEqual([9, 5]);
  expect([byId.h.hat, byId.h.hatDir], "a hat without a direction defaults to Up").toEqual([9, 0]);
});
