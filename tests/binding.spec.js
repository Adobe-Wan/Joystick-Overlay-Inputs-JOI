// Device, axis and button detection: the 44 scenarios from the detection audit, run against the real UI
// (first-run Get Started -> Add a Device -> type tile) with the fake Gamepad API. Expectations are the
// target behavior of the proposed detection algorithm, so a scenario fails until the app implements it.
const { test, expect } = require("./fixtures/app");
const h = require("./fixtures/gamepad");
const scenarios = require("./fixtures/binding-scenarios");

test.describe("binding", () => {
  for (const sc of scenarios) {
    test(sc.name, async ({ app, page }) => {
      test.info().annotations.push({ type: "scenario", description: sc.about });
      await app.open(sc.open || {});
      const observed = await sc.run(page, h);
      const verdict = sc.expect(observed);
      expect(verdict, `${sc.about}\nobserved: ${JSON.stringify(observed)}`).toBe(true);
    });
  }
});
