// The full-featured profile at common stream and monitor resolutions: no errors, every widget built, every widget
// on screen, in overlay (OBS) mode and in the editor.
const { test, expect, readFixture } = require("./fixtures/app");

const VALID = JSON.parse(readFixture("valid.json"));
const SIZES = [[1920, 1080], [2560, 1440], [3840, 2160], [2560, 1080], [5120, 1440]];

for (const [width, height] of SIZES) {
  test.describe(`${width}x${height}`, () => {
    test.use({ viewport: { width, height } });

    for (const query of ["?transparent", "?edit"]) {
      test(query.slice(1), async ({ app, page }) => {
        await app.open({ profile: VALID, query });
        const st = await page.evaluate(() => ({
          count: profile.widgets.length,
          dom: document.querySelectorAll("#stage .widget").length,
          offscreen: offscreenWidgets().map(w => w.id),
          failed: profile.widgets.filter(w => runtime[w.id] && runtime[w.id].failed).map(w => w.id),
          // Where each widget really is on the screen, in CSS pixels.
          rects: [...document.querySelectorAll("#stage .widget")].map(e => { const r = e.getBoundingClientRect(); return { id: e.dataset.id, l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height }; })
        }));
        expect(st.count).toBe(VALID.widgets.length);
        expect(st.dom).toBe(VALID.widgets.length);
        expect(st.failed).toEqual([]);
        expect(st.offscreen, "widgets outside the canvas").toEqual([]);
        for (const r of st.rects) {
          expect(r.w, `${r.id} has a size`).toBeGreaterThan(0);
          expect(r.l, `${r.id} left edge`).toBeGreaterThanOrEqual(-1);
          expect(r.t, `${r.id} top edge`).toBeGreaterThanOrEqual(-1);
          expect(r.r, `${r.id} right edge`).toBeLessThanOrEqual(width + 1);
          expect(r.b, `${r.id} bottom edge`).toBeLessThanOrEqual(height + 1);
        }
        expect(app.consoleErrors).toEqual([]);
      await app.assertLive();
      });
    }
  });
}
