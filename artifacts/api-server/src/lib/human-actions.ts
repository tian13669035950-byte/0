import type { Page } from "playwright-core";

export interface MouseWaypoint { x: number; y: number; }

/**
 * Move mouse to (tx, ty) via a natural trajectory.
 * If waypoints (pixel coords) are provided use them, otherwise generate a bezier curve.
 */
async function moveTo(
  page: Page,
  tx: number, ty: number,
  waypoints?: MouseWaypoint[],
) {
  if (waypoints && waypoints.length >= 3) {
    for (const wp of waypoints) {
      // Small positional jitter so exact replay isn't detected
      await page.mouse.move(
        wp.x + (Math.random() - 0.5) * 6,
        wp.y + (Math.random() - 0.5) * 6,
      );
      await page.waitForTimeout(8 + Math.random() * 20);
    }
  } else {
    // Bezier-style ease-in/out with randomised start position
    const sx = Math.max(10, tx - 220 + Math.random() * 440);
    const sy = Math.max(10, ty - 160 + Math.random() * 120);
    const steps = 6 + Math.floor(Math.random() * 5);
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const ease = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
      await page.mouse.move(
        sx + (tx - sx) * ease + (Math.random() - 0.5) * 8,
        sy + (ty - sy) * ease + (Math.random() - 0.5) * 8,
      );
      await page.waitForTimeout(12 + Math.random() * 22);
    }
  }
  // Land exactly on target
  await page.mouse.move(tx, ty);
}

// ─── Public API ───────────────────────────────────────────────────────────────

export interface HumanClickOpts {
  /** Pixel-coord waypoints recorded from the user's actual mouse path */
  mousePath?: MouseWaypoint[];
}

export interface HumanTypeOpts extends HumanClickOpts {
  /**
   * Array of inter-keystroke delays in ms, captured from the user's actual typing.
   * Index i = delay AFTER typing character i.
   * Applied with ±15 % jitter to avoid exact-replay fingerprinting.
   */
  keyDelays?: number[];
}

/** Move mouse along a recorded/generated path, then click the element. */
export async function humanClick(
  page: Page, selector: string, opts?: HumanClickOpts,
): Promise<{ tx: number; ty: number }> {
  const el = await page.$(selector);
  if (!el) throw new Error(`humanClick: element not found — ${selector}`);
  const box = await el.boundingBox();
  if (!box) throw new Error(`humanClick: no bounding box — ${selector}`);

  const tx = box.x + box.width  * (0.3 + Math.random() * 0.4);
  const ty = box.y + box.height * (0.3 + Math.random() * 0.4);

  await moveTo(page, tx, ty, opts?.mousePath);
  await page.waitForTimeout(60 + Math.random() * 120);
  await page.mouse.click(tx, ty);
  return { tx, ty };
}

/** Move mouse naturally then right-click. */
export async function humanRightClick(
  page: Page, selector: string, opts?: HumanClickOpts,
) {
  const el = await page.$(selector);
  const box = el ? await el.boundingBox() : null;
  if (box) {
    const tx = box.x + box.width  * (0.3 + Math.random() * 0.4);
    const ty = box.y + box.height * (0.3 + Math.random() * 0.4);
    await moveTo(page, tx, ty, opts?.mousePath);
    await page.waitForTimeout(40 + Math.random() * 60);
    await page.mouse.click(tx, ty, { button: "right" });
  } else {
    await page.click(selector, { button: "right" });
  }
}

/** Move mouse naturally then double-click. */
export async function humanDoubleClick(
  page: Page, selector: string, opts?: HumanClickOpts,
) {
  const { tx, ty } = await humanClick(page, selector, opts);
  await page.waitForTimeout(30 + Math.random() * 40);
  await page.mouse.dblclick(tx, ty);
}

/**
 * Simulate a paste operation: click the field, write text to clipboard, then Ctrl+V.
 * Falls back to execCommand insertText → fast-type if clipboard API is unavailable.
 */
export async function humanPaste(
  page: Page, selector: string, text: string, opts?: HumanClickOpts,
) {
  await humanClick(page, selector, opts);
  await page.keyboard.press("Control+a");
  await page.waitForTimeout(40 + Math.random() * 60);

  // Strategy 1: real clipboard paste (most realistic)
  const ok = await page.evaluate(async (t: string) => {
    try { await navigator.clipboard.writeText(t); return true; } catch { return false; }
  }, text);

  if (ok) {
    await page.waitForTimeout(20 + Math.random() * 40);
    await page.keyboard.press("Control+v");
  } else {
    // Strategy 2: execCommand insertText (works in most browsers, triggers React events)
    const done = await page.evaluate((t: string) =>
      document.execCommand("insertText", false, t), text);
    if (!done) {
      // Strategy 3: zero-delay type (no per-char timing ≈ paste)
      await page.keyboard.press("Delete");
      await page.keyboard.type(text, { delay: 0 });
    }
  }
  await page.waitForTimeout(50 + Math.random() * 100);
}

/**
 * Click the field, clear it, then type text character by character.
 *
 * If keyDelays is provided (from a real recording), delays are played back
 * with ±15 % jitter.  Otherwise a random human-like distribution is used.
 */
export async function humanType(
  page: Page, selector: string, text: string, opts?: HumanTypeOpts,
) {
  await humanClick(page, selector, opts);
  await page.keyboard.press("Control+a");
  await page.keyboard.press("Delete");
  // Brief pause before starting to type (collecting thoughts)
  await page.waitForTimeout(180 + Math.random() * 220);

  const chars = [...text];
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    await page.keyboard.type(ch);

    let delay: number;
    const recorded = opts?.keyDelays?.[i];
    if (recorded !== undefined && recorded > 0) {
      // Replay the user's actual rhythm with ±15 % jitter
      const base = Math.max(30, recorded);
      delay = base * (0.85 + Math.random() * 0.30);
    } else if (Math.random() < 0.08) {
      // ~8 % chance of a longer hesitation (fat-finger moment)
      delay = 400 + Math.random() * 500;
    } else if (ch === " " || ch === "." || ch === "," || ch === "@") {
      delay = 150 + Math.random() * 180;
    } else {
      delay = 80 + Math.random() * 140;
    }
    await page.waitForTimeout(delay);
  }
}
