import { chromium, BrowserContext, BrowserContextOptions } from "playwright-core";

export const CHROMIUM_PATH =
  process.env.CHROMIUM_PATH ||
  "/nix/store/qa9cnw4v5xkxyip6mb9kxqfq1z4x2dx1-chromium-138.0.7204.100/bin/chromium";

export const STEALTH_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36";

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

  // 8. Hide headless in userAgent (already set via context but belt-and-suspenders)
  Object.defineProperty(navigator, 'userAgent', {
    get: () => navigator.userAgent.replace('HeadlessChrome', 'Chrome'),
  });

  // 9. WebGL vendor / renderer strings (headless shows "Google SwiftShader")
  const getCtx = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function(type, ...args) {
    const ctx = getCtx.call(this, type, ...args);
    if (ctx && (type === 'webgl' || type === 'webgl2')) {
      const getParam = ctx.getParameter.bind(ctx);
      ctx.getParameter = (p) => {
        if (p === 37445) return 'Intel Inc.';         // UNMASKED_VENDOR_WEBGL
        if (p === 37446) return 'Intel Iris OpenGL Engine'; // UNMASKED_RENDERER_WEBGL
        return getParam(p);
      };
    }
    return ctx;
  };
})();
`;

export async function launchStealthBrowser() {
  return chromium.launch({
    headless: true,
    executablePath: CHROMIUM_PATH,
    args: LAUNCH_ARGS,
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
