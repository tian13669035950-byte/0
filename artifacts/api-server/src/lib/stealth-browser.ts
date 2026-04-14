import { chromium, BrowserContext, BrowserContextOptions } from "playwright-core";
import { spawn, execSync } from "child_process";
import fs from "fs";

const NIX_CHROMIUM = "/nix/store/qa9cnw4v5xkxyip6mb9kxqfq1z4x2dx1-chromium-138.0.7204.100/bin/chromium";
const NIX_XVFB    = "/nix/store/ykck7gdd6szwrb3qnpb5y5fvjlnmzhz0-xorg-server-21.1.18/bin/Xvfb";

const isWindows = process.platform === "win32";
const isLinux   = process.platform === "linux";

// Windows: search for Edge or Chrome in the standard install locations.
// If none found, fall through to the first candidate so Playwright gives a helpful error.
const WINDOWS_BROWSER_CANDIDATES = [
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
];

function findWindowsBrowser(): string {
  for (const p of WINDOWS_BROWSER_CANDIDATES) {
    try { if (fs.existsSync(p)) return p; } catch { /* skip */ }
  }
  // None found — return Edge path so Playwright reports a clear "not found" error
  return WINDOWS_BROWSER_CANDIDATES[0];
}

// Read lazily so dotenv has time to load before these are used.
// On Windows: auto-detect common Edge/Chrome paths when CHROMIUM_PATH is not set.
const getChromiumPath = () => {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  if (isWindows) return findWindowsBrowser();
  return NIX_CHROMIUM;
};

const getXvfbPath = () => process.env.XVFB_PATH || NIX_XVFB;

export const STEALTH_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36";

// These flags are meaningful only on Linux (sandbox / shared memory / display management).
// Passing them on Windows is harmless for --disable-dev-shm-usage, but --no-sandbox and
// --disable-setuid-sandbox can trigger "managed browser" warnings in some Edge builds.
const LINUX_ONLY_ARGS = new Set([
  "--no-sandbox",
  "--disable-setuid-sandbox",
  "--disable-dev-shm-usage",
]);

const LAUNCH_ARGS = [
  "--no-sandbox",
  "--disable-setuid-sandbox",
  "--disable-dev-shm-usage",
  "--disable-blink-features=AutomationControlled",
  "--disable-infobars",
  "--disable-notifications",
  "--disable-popup-blocking",
  "--window-size=1280,800",
  "--start-maximized",
  "--disable-gpu",
  "--disable-background-timer-throttling",
  "--disable-backgrounding-occluded-windows",
  "--disable-renderer-backgrounding",
];

// On Windows, strip the Linux-only flags before passing to Playwright.
function getLaunchArgs(): string[] {
  return isWindows ? LAUNCH_ARGS.filter(a => !LINUX_ONLY_ARGS.has(a)) : LAUNCH_ARGS;
}

// Script injected into every page before any JS runs —
// patches all common automation-detection signals.
const STEALTH_INIT_SCRIPT = `
(function () {
  // 1. Hide webdriver flag
  Object.defineProperty(navigator, 'webdriver', { get: () => undefined });

  // 2. Fake plugins (real Chrome always has some)
  const fakePlugins = [
    { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
    { name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai', description: '' },
    { name: 'Native Client', filename: 'internal-nacl-plugin', description: '' },
  ];
  Object.defineProperty(navigator, 'plugins', {
    get: () => {
      const arr = fakePlugins.map(p => {
        const plugin = Object.create(Plugin.prototype);
        Object.defineProperty(plugin, 'name',        { value: p.name });
        Object.defineProperty(plugin, 'filename',    { value: p.filename });
        Object.defineProperty(plugin, 'description', { value: p.description });
        Object.defineProperty(plugin, 'length',      { value: 0 });
        return plugin;
      });
      arr.item    = (i) => arr[i];
      arr.namedItem = (n) => arr.find(p => p.name === n) || null;
      arr.refresh = () => {};
      Object.defineProperty(arr, 'length', { value: fakePlugins.length });
      return arr;
    }
  });

  // 3. Languages
  Object.defineProperty(navigator, 'languages', { get: () => ['zh-CN', 'zh', 'en-US', 'en'] });

  // 4. hardware concurrency (real machine)
  Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 8 });

  // 5. deviceMemory
  Object.defineProperty(navigator, 'deviceMemory', { get: () => 8 });

  // 6. Restore window.chrome that headless removes
  if (!window.chrome) {
    window.chrome = {
      app: { isInstalled: false, InstallState: { DISABLED: 'disabled', INSTALLED: 'installed', NOT_INSTALLED: 'not_installed' }, RunningState: { CANNOT_RUN: 'cannot_run', READY_TO_RUN: 'ready_to_run', RUNNING: 'running' } },
      runtime: { PlatformOs: { MAC: 'mac', WIN: 'win', ANDROID: 'android', CROS: 'cros', LINUX: 'linux', OPENBSD: 'openbsd' }, PlatformArch: { ARM: 'arm', X86_32: 'x86-32', X86_64: 'x86-64' }, RequestUpdateCheckStatus: { THROTTLED: 'throttled', NO_UPDATE: 'no_update', UPDATE_AVAILABLE: 'update_available' }, OnInstalledReason: { INSTALL: 'install', UPDATE: 'update', CHROME_UPDATE: 'chrome_update', SHARED_MODULE_UPDATE: 'shared_module_update' }, OnRestartRequiredReason: { APP_UPDATE: 'app_update', OS_UPDATE: 'os_update', PERIODIC: 'periodic' } },
    };
  }

  // 7. Permissions API — avoid "denied" for notifications which headless returns
  const origQuery = window.Permissions && window.Permissions.prototype.query;
  if (origQuery) {
    window.Permissions.prototype.query = function(parameters) {
      return parameters.name === 'notifications'
        ? Promise.resolve({ state: Notification.permission })
        : origQuery.call(this, parameters);
    };
  }

  // 8. WebGL vendor / renderer strings (headless shows "Google SwiftShader")
  const getCtx = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function(type, ...args) {
    const ctx = getCtx.call(this, type, ...args);
    if (ctx && (type === 'webgl' || type === 'webgl2')) {
      const getParam = ctx.getParameter.bind(ctx);
      ctx.getParameter = (p) => {
        if (p === 37445) return 'Intel Inc.';
        if (p === 37446) return 'Intel Iris OpenGL Engine';
        return getParam(p);
      };
    }
    return ctx;
  };

  // 9. platform — headless exposes "Linux x86_64" even when UA says Windows
  Object.defineProperty(navigator, 'platform', { get: () => 'Win32' });

  // 10. maxTouchPoints — Windows desktop = 0; headless sometimes returns 0 already but make it explicit
  Object.defineProperty(navigator, 'maxTouchPoints', { get: () => 0 });

  // 11. User-Agent Client Hints (navigator.userAgentData) — must match UA string
  if (!navigator.userAgentData) {
    const brands = [
      { brand: 'Not)A;Brand', version: '99' },
      { brand: 'Google Chrome', version: '138' },
      { brand: 'Chromium',     version: '138' },
    ];
    const uaDataObj = {
      brands,
      mobile: false,
      platform: 'Windows',
      getHighEntropyValues: async () => ({
        brands,
        mobile: false,
        platform: 'Windows',
        platformVersion: '10.0.0',
        architecture: 'x86',
        bitness: '64',
        model: '',
        uaFullVersion: '138.0.0.0',
        fullVersionList: [
          { brand: 'Not)A;Brand', version: '99.0.0.0' },
          { brand: 'Google Chrome', version: '138.0.0.0' },
          { brand: 'Chromium',     version: '138.0.0.0' },
        ],
      }),
      toJSON: () => ({ brands, mobile: false, platform: 'Windows' }),
    };
    Object.defineProperty(navigator, 'userAgentData', { get: () => uaDataObj });
  }

  // 12. outerWidth / outerHeight — both are 0 in headless; real browsers add toolbar height
  try {
    if (window.outerWidth === 0) {
      Object.defineProperty(window, 'outerWidth',  { get: () => window.innerWidth });
      Object.defineProperty(window, 'outerHeight', { get: () => window.innerHeight + 88 });
    }
  } catch (_) {}

  // 13. document.hasFocus — some bot-checks verify the page is "active"
  try { document.hasFocus = () => true; } catch (_) {}

  // 14. screen dimensions — should be larger than viewport, not exactly equal
  try {
    if (window.screen.width === window.innerWidth) {
      Object.defineProperty(window.screen, 'width',       { get: () => 1920 });
      Object.defineProperty(window.screen, 'height',      { get: () => 1080 });
      Object.defineProperty(window.screen, 'availWidth',  { get: () => 1920 });
      Object.defineProperty(window.screen, 'availHeight', { get: () => 1040 });
    }
  } catch (_) {}
})();
`;

// ─── Xvfb management ─────────────────────────────────────────────────────────

let xvfbProc: ReturnType<typeof spawn> | null = null;
let xvfbDisplay = ":99";

function isDisplayInUse(display: string): boolean {
  try {
    execSync(`ls /tmp/.X${display.replace(":", "")}-lock 2>/dev/null`, { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

async function ensureXvfb(): Promise<string> {
  if (xvfbProc && !xvfbProc.killed) return xvfbDisplay;

  // Find a free display number starting at :99
  let dispNum = 99;
  while (isDisplayInUse(`:${dispNum}`)) dispNum++;
  xvfbDisplay = `:${dispNum}`;

  await new Promise<void>((resolve, reject) => {
    xvfbProc = spawn(getXvfbPath(), [
      xvfbDisplay,
      "-screen", "0", "1280x800x24",
      "-ac",
      "-nolisten", "tcp",
    ], { stdio: "ignore" });

    xvfbProc.on("error", reject);

    // Give Xvfb ~300 ms to start listening
    setTimeout(resolve, 300);
  });

  process.env.DISPLAY = xvfbDisplay;
  console.log(`[stealth] Xvfb started on display ${xvfbDisplay}`);
  return xvfbDisplay;
}

// ─── Browser launch ───────────────────────────────────────────────────────────

export async function launchStealthBrowser(headed = false) {
  if (headed) {
    // Xvfb is only needed on Linux (e.g. Replit / headless servers).
    // On Windows and macOS the machine has a real display — skip Xvfb entirely.
    if (isLinux) {
      const display = await ensureXvfb();
      process.env.DISPLAY = display;
    }
  }

  // Note: --inprivate / --incognito flags are intentionally NOT passed here.
  // Playwright's newContext() already creates a fully isolated session
  // (no shared cookies, storage, or history) equivalent to incognito mode.
  // Passing --inprivate to Edge triggers its single-instance lock and breaks
  // concurrent parallel track launches via CDP.

  return chromium.launch({
    headless: !headed,
    executablePath: getChromiumPath(),
    args: getLaunchArgs(),          // strips Linux-only flags on Windows
    env: headed ? { ...process.env } : undefined,
  });
}

export async function newStealthContext(
  browser: Awaited<ReturnType<typeof launchStealthBrowser>>,
  extra: BrowserContextOptions = {}
): Promise<BrowserContext> {
  const ctx = await browser.newContext({
    userAgent: STEALTH_UA,
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 1,
    hasTouch: false,
    isMobile: false,
    javaScriptEnabled: true,
    ...extra,
  });

  await ctx.addInitScript(STEALTH_INIT_SCRIPT);
  return ctx;
}
