// Bind and Rebind when nothing registers: after the hint delay the dialog names every device JOI sees, flags one
// that is listed but silent, warns when the browser's 4 controller slots are full, and offers Check Devices.
// Also the spacing of the bind row under the widget's name.
const { test, expect } = require("./fixtures/app");
const h = require("./fixtures/gamepad");

const STICK = { ver: 3, savedAt: 1, settings: {}, widgets: [{ id: "w1", type: "stick", label: "Pitch / Yaw", x: 800, y: 700, axes: { x: 0, y: 1 }, inv: {} }] };
const HINT_WAIT = 8600;   // DET.HINT_MS plus a margin

async function openBind(app, page, devices) {
  await app.open({ profile: STICK, query: "?edit", devices });
  await page.locator("[data-id=w1]").first().click();
  await page.locator("#panel").getByRole("button", { name: "Bind", exact: true }).click();
  await expect(page.locator("#wiz-title")).toHaveText("Move the stick fully right");
}

test.describe("bind diagnosis", () => {
  test("names every device JOI sees once nothing has moved, and opens Check Devices", async ({ app, page }) => {
    await openBind(app, page, [h.DEV.virpil(), h.DEV.virpil(), h.DEV.trudder()]);
    const diag = page.locator("#wiz-diag");
    await page.waitForTimeout(2000);
    await expect(diag).toBeHidden();
    await page.waitForTimeout(HINT_WAIT - 2000);
    await expect(diag).toBeVisible();
    await expect(diag).toContainText("Nothing moving yet. JOI sees VPC Alpha Prime R #1, VPC Alpha Prime R #2 and T-Rudder.");
    await expect(diag).toContainText("joy.cpl");
    await expect(diag).not.toContainText("sends no data");
    await expect(diag.locator(".warn-box")).toHaveCount(0);
    await diag.getByRole("button", { name: "Check Devices" }).click();
    await expect(page.locator("#wizard")).not.toHaveClass(/open/);
    await expect(page.locator("#panel h3").first()).toHaveText("Check Devices");
  });

  test("flags a device that is listed but sends no data", async ({ app, page }) => {
    await openBind(app, page, [h.DEV.virpil(), h.DEV.virpil({ axes: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0] })]);
    await page.waitForTimeout(HINT_WAIT);
    const diag = page.locator("#wiz-diag");
    await expect(diag).toContainText("VPC Alpha Prime R #2 (sends no data)");
    await expect(diag.locator(".warn")).toHaveCount(1);
  });

  test("warns when all 4 controller slots are taken", async ({ app, page }) => {
    await openBind(app, page, [h.DEV.virpil(), h.DEV.trudder(), h.DEV.throttle(), h.DEV.xbox()]);
    await page.waitForTimeout(HINT_WAIT);
    await expect(page.locator("#wiz-diag .warn-box")).toContainText("All 4 controller slots are taken");
  });

  test("goes away once the stick moves, and the move still binds", async ({ app, page }) => {
    await openBind(app, page, [h.DEV.virpil()]);
    await page.waitForTimeout(HINT_WAIT);
    await expect(page.locator("#wiz-diag")).toBeVisible();
    await app.play(h.move(0, 0, 12, { 0: [0, 1] }).concat(h.hold(0, 13, 30, { 0: 1 })), 10);
    await expect(page.locator("#wiz-title")).toHaveText("Push the stick fully forward");
    await expect(page.locator("#wiz-diag")).toBeHidden();
  });
});

test("the bind row clears the Name field above and the controls below on the 4 px grid", async ({ app, page }) => {
  await app.open({ profile: STICK, query: "?edit", devices: [h.DEV.virpil()] });
  await page.locator("[data-id=w1]").first().click();
  const row = page.locator("#panel .bind-row").first();
  await expect(row).toContainText("Not bound yet");
  const gaps = await row.evaluate(r => {
    const box = r.getBoundingClientRect(), btn = r.querySelector("button").getBoundingClientRect();
    const above = r.previousElementSibling.getBoundingClientRect();
    let next = r.parentElement; while (next && !next.nextElementSibling) next = next.parentElement;
    const below = next.nextElementSibling.getBoundingClientRect();
    return { above: Math.round(btn.top - above.bottom), below: Math.round(below.top - btn.bottom), inside: btn.top >= box.top && btn.bottom <= box.bottom };
  });
  expect(gaps.inside).toBe(true);
  expect(gaps.above).toBeGreaterThanOrEqual(12);
  expect(gaps.below).toBeGreaterThanOrEqual(12);
  expect(gaps.above % 4).toBe(0);
});
