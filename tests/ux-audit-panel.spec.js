// The widget panel and Settings after the October 2026 UX audit: a focus ring that stays distinct under warm ship-maker
// themes, section edges in one accent, one name per look and per binding action, a Display section in Settings,
// value readouts big enough to hit, and quiet buttons that line up with the content above them.
const { test, expect } = require("./fixtures/app");
const h = require("./fixtures/gamepad");

const VID = h.DEV.virpil().id;
const stick = (o = {}) => ({ id: "s1", type: "stick", x: 400, y: 300, label: "Stick", match: VID, nth: 0, axes: { x: 0, y: 1 }, inv: {}, ...o });
const base = (widgets, extra = {}) => ({ ver: 2, savedAt: 1, settings: { background: "solid", bgColor: "#24303c" }, widgets, ...extra });
const edit = (page, ids, mode) => page.evaluate(([ids, mode]) => { setEditing(true); setSelection(ids, mode); }, [ids, mode]);
const openAll = page => page.evaluate(() => { for (const t of document.querySelectorAll('#panel .sec-t[aria-expanded="false"]')) t.click(); });

const STEEL_50 = "rgb(242, 247, 253)", AMBER_FOCUS = "rgb(255, 209, 102)";
const OK = "rgb(126, 226, 174)", WARN = "rgb(255, 200, 110)", VIOLET = "rgb(181, 156, 255)";

// R02: under a warm maker the accent is amber or yellow, so the ring turns near white; cool themes keep amber.
async function focusedToolbarRing(page) {
  await page.evaluate(() => { if (document.activeElement) document.activeElement.blur(); });
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press("Tab");
    if (await page.evaluate(() => !!document.activeElement.closest("#toolbar") && document.activeElement.tagName === "BUTTON")) break;
  }
  return page.evaluate(() => { const b = document.activeElement, cs = getComputedStyle(b);
    return { inBar: !!b.closest("#toolbar"), fv: b.matches(":focus-visible"), style: cs.outlineStyle, color: cs.outlineColor }; });
}
for (const [theme, ring] of [["drake", STEEL_50], ["argo", STEEL_50], ["banu", STEEL_50], ["", AMBER_FOCUS], ["aegis", AMBER_FOCUS]]) {
  test(`focus ring on the ${theme || "default"} theme is ${ring === STEEL_50 ? "near white" : "amber"} and differs from the selected tile`, async ({ app, page }) => {
    await app.open({ profile: base([stick({ theme }), stick({ id: "s2", x: 800, theme })]), devices: [h.DEV.virpil()], query: "?edit" });
    await edit(page, [], "settings");
    expect(await page.evaluate(() => document.documentElement.dataset.vgTheme || "")).toBe(theme);
    const f = await focusedToolbarRing(page);
    expect(f).toMatchObject({ inBar: true, fv: true, style: "solid", color: ring });
    const tile = await page.locator('#panel button.on, #panel button[aria-pressed="true"]').first().evaluate(b => getComputedStyle(b).borderTopColor);
    expect(tile).not.toBe(f.color);
    const primary = await page.locator("#toolbar button.primary").first().evaluate(b => getComputedStyle(b).backgroundColor);
    expect(primary).not.toBe(f.color);
  });
}

// R05: family eyebrows stay, but every section edge is the accent or a neutral line; green and amber mean status only.
test("section edges in the stick panel use the accent or a neutral line, never a status color or violet", async ({ app, page }) => {
  await app.open({ profile: base([stick({ match: undefined, axes: {} })]), devices: [h.DEV.virpil()], query: "?transparent" });
  await edit(page, ["s1"]);
  await expect(page.locator("#panel .fam")).not.toHaveCount(0);
  const check = async () => {
    const edges = await page.evaluate(() => [...document.querySelectorAll("#panel .sec, #panel .fam")].map(e => {
      const cs = getComputedStyle(e), a = getComputedStyle(e, "::after"), b = getComputedStyle(e, "::before"), ico = e.querySelector(".sec-t .ico");
      return { name: e.textContent.trim().slice(0, 24), colors: [cs.borderLeftColor, cs.borderTopColor, cs.color, a.backgroundColor, b.backgroundColor, ico ? getComputedStyle(ico).color : ""] };
    }));
    expect(edges.length).toBeGreaterThan(8);
    for (const e of edges) for (const c of e.colors) expect([OK, WARN, VIOLET], e.name).not.toContain(c);
    return edges;
  };
  await check();
  await openAll(page);
  await check();
  // Real status keeps its color.
  await expect(page.locator("#panel .bind-row .hint")).toHaveText("Not bound yet");
  expect(await page.locator("#panel .bind-row .hint").evaluate(e => getComputedStyle(e).color)).toBe(WARN);
  expect(await page.content()).not.toMatch(/#B59CFF/i);
});

// R07: Flat is the Style (Flat or Projector) and nothing else; the first Screens look is Straight On.
test("Cockpit Look: Flat is only the Style, the default screen look is Straight On, and Reset Look restores both", async ({ app, page }) => {
  await app.open({ profile: base([stick()]), devices: [h.DEV.virpil()], query: "?transparent" });
  await edit(page, ["s1"]);
  const look = page.locator("#sec-look");
  const head = page.locator('#panel .sec-t[aria-controls="sec-look"]');
  await head.click();
  await expect(page.locator('#panel [aria-label="Cockpit Look style"] button')).toHaveText(["Flat", "Projector"]);
  const screens = look.locator('.looks[aria-label="Screens"] .look-tile');
  await expect(screens.first()).toHaveAttribute("aria-label", "Straight On");
  await expect(screens.first()).toHaveText("Straight On");
  await expect(screens.first()).toHaveAttribute("aria-pressed", "true");
  await expect(look.locator(".look-tile", { hasText: /^Flat$/ })).toHaveCount(0);
  await expect(head.locator(".sum")).toHaveText("Flat · Straight On");
  await look.locator('.look-tile[aria-label="Left Screen"]').click();
  await expect(page.locator('#panel .sec-t[aria-controls="sec-look"] .sum')).toHaveText("Flat · Left Screen");
  await expect(page.locator("#sec-look button", { hasText: "Reset to" })).toHaveCount(0);
  await page.locator("#sec-look button", { hasText: "Reset Look" }).click();
  await expect(page.locator('#panel .sec-t[aria-controls="sec-look"] .sum')).toHaveText("Flat · Straight On");
  await expect(page.locator('#sec-look .look-tile[aria-label="Straight On"]')).toHaveAttribute("aria-pressed", "true");
  expect(app.consoleErrors).toEqual([]);
});
