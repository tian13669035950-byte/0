import type { Page } from "playwright-core";

/** Move mouse along a curved ease-in-out path then click — avoids the "teleport" tell */
export async function humanClick(page: Page, selector: string) {
  const el = await page.$(selector);
  if (!el) throw new Error(`humanClick: element not found — ${selector}`);
  const box = await el.boundingBox();
  if (!box) throw new Error(`humanClick: no bounding box — ${selector}`);

  const tx = box.x + box.width  * (0.25 + Math.random() * 0.5);
  const ty = box.y + box.height * (0.25 + Math.random() * 0.5);
  const sx = Math.max(10, tx - 200 + Math.random() * 400);
  const sy = Math.max(10, ty - 150 + Math.random() * 100);

  const steps = 4 + Math.floor(Math.random() * 4);
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const ease = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
    const x = sx + (tx - sx) * ease + (Math.random() - 0.5) * 8;
    const y = sy + (ty - sy) * ease + (Math.random() - 0.5) * 8;
    await page.mouse.move(x, y);
    await page.waitForTimeout(15 + Math.random() * 25);
  }
  await page.mouse.move(tx, ty);
  await page.waitForTimeout(60 + Math.random() * 120);
  await page.mouse.click(tx, ty);
  return { tx, ty };
}

/** Move mouse naturally then right-click */
export async function humanRightClick(page: Page, selector: string) {
  const el = await page.$(selector);
  const box = el ? await el.boundingBox() : null;
  if (box) {
    const tx = box.x + box.width  * (0.3 + Math.random() * 0.4);
    const ty = box.y + box.height * (0.3 + Math.random() * 0.4);
    await page.mouse.move(tx - 80 + Math.random() * 160, ty - 40 + Math.random() * 80);
    await page.waitForTimeout(40 + Math.random() * 60);
    await page.mouse.move(tx, ty);
    await page.waitForTimeout(50 + Math.random() * 80);
    await page.mouse.click(tx, ty, { button: "right" });
  } else {
    await page.click(selector, { button: "right" });
  }
}

/** Move mouse naturally then double-click at exact coordinates */
export async function humanDoubleClick(page: Page, selector: string) {
  const { tx, ty } = await humanClick(page, selector);
  await page.waitForTimeout(30 + Math.random() * 40);
  await page.mouse.dblclick(tx, ty);
}

/** Type text character by character with human-like random delays */
export async function humanType(page: Page, selector: string, text: string) {
  await humanClick(page, selector);
  await page.keyboard.press("Control+a");
  await page.keyboard.press("Delete");
  await page.waitForTimeout(80 + Math.random() * 80);
  for (const ch of text) {
    await page.keyboard.type(ch);
    const delay = Math.random() < 0.12
      ? 200 + Math.random() * 300
      : 40  + Math.random() * 60;
    await page.waitForTimeout(delay);
  }
}
