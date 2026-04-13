import { Router } from "express";
import { URL } from "url";

const router = Router();

// ─── HTML proxy for visual recorder ──────────────────────────────────────────
// GET /api/record/proxy?url=https://example.com
// Fetches the target page, strips frame-blocking headers, injects recorder script
router.get("/record/proxy", async (req, res) => {
  const raw = req.query.url as string;
  if (!raw) return res.status(400).send("Missing ?url= parameter");

  let targetUrl = raw.trim();
  if (!/^https?:\/\//i.test(targetUrl)) targetUrl = "https://" + targetUrl;

  let parsed: URL;
  try {
    parsed = new URL(targetUrl);
  } catch {
    return res.status(400).send("Invalid URL");
  }

  try {
    const upstream = await fetch(targetUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(15000),
    });

    const ct = upstream.headers.get("content-type") ?? "";
    if (!ct.includes("text/html")) {
      // Non-HTML: proxy as-is (CSS, images, fonts called via base-href)
      res.setHeader("Content-Type", ct);
      const buf = await upstream.arrayBuffer();
      res.send(Buffer.from(buf));
      return;
    }

    let html = await upstream.text();

    // Normalize base so relative URLs resolve to the real origin
    const base = `<base href="${parsed.origin}${parsed.pathname}">`;

    // Strip CSP meta tags that would block our injected script
    html = html.replace(
      /<meta[^>]*http-equiv=["']?Content-Security-Policy["']?[^>]*\/?>/gi,
      ""
    );

    const script = recorderScript();

    // Inject into <head> or prepend
    if (/<head(\s[^>]*)?>/.test(html)) {
      html = html.replace(/<head(\s[^>]*)?>/i, (m) => `${m}\n${base}\n${script}`);
    } else {
      html = base + "\n" + script + "\n" + html;
    }

    // We control our own response headers — do NOT forward upstream blocking headers
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(html);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    res.status(502).send(
      `<html><body style="font-family:sans-serif;padding:32px;color:#333">` +
        `<h3 style="color:#c00">无法加载页面</h3>` +
        `<p>${msg}</p>` +
        `<p>目标地址：<code>${targetUrl}</code></p>` +
        `</body></html>`
    );
  }
});

// ─── Inline recorder script injected into every proxied page ─────────────────
function recorderScript(): string {
  return `<script>
(function () {
  'use strict';

  /* ── CSS selector generator ── */
  function esc(id) {
    try { return CSS.escape(id); } catch(e) { return id.replace(/[^a-zA-Z0-9_-]/g, '\\\\$&'); }
  }

  function getSelector(el) {
    if (!el || el.nodeType !== 1) return '';
    if (el === document.body) return 'body';
    var parts = [];
    var cur = el;
    for (var depth = 0; depth < 8; depth++) {
      if (!cur || cur === document.documentElement) break;
      if (cur.id && /^[a-zA-Z][\\w:-]*$/.test(cur.id)) {
        parts.unshift('#' + esc(cur.id));
        break;
      }
      var tag = cur.tagName.toLowerCase();
      var parent = cur.parentElement;
      if (parent) {
        var sibs = Array.from(parent.children).filter(function(c) { return c.tagName === cur.tagName; });
        if (sibs.length > 1) tag += ':nth-of-type(' + (sibs.indexOf(cur) + 1) + ')';
      }
      parts.unshift(tag);
      cur = cur.parentElement;
    }
    return parts.join(' > ');
  }

  function labelOf(el) {
    var t = (el.getAttribute('aria-label') || el.getAttribute('title') ||
              el.getAttribute('placeholder') || el.getAttribute('name') ||
              el.textContent || '').replace(/\\s+/g, ' ').trim();
    return t.slice(0, 60);
  }

  function send(data) {
    try { window.parent.postMessage(Object.assign({ __recorder: true }, data), '*'); } catch(e) {}
  }

  /* ── Click: intercept links so we stay in the proxy session ── */
  document.addEventListener('click', function(e) {
    var origin = e.target;

    // Walk up to find meaningful clickable ancestor
    var clickTarget = origin;
    var linkEl = null;
    var walk = origin;
    while (walk && walk !== document.body) {
      if (walk.tagName === 'A' && walk.href && !walk.href.startsWith('javascript:')) {
        linkEl = walk;
        break;
      }
      if (['BUTTON','INPUT','LABEL','SELECT','TEXTAREA'].indexOf(walk.tagName) !== -1) {
        clickTarget = walk;
        break;
      }
      walk = walk.parentElement;
    }

    var sel = getSelector(linkEl || clickTarget);
    var label = labelOf(linkEl || clickTarget);

    if (linkEl) {
      e.preventDefault();
      e.stopPropagation();
      send({ type: 'navigate', href: linkEl.href, selector: sel, label: label });
    } else {
      send({ type: 'click', selector: sel, label: label });
    }
  }, true);

  /* ── Input / textarea ── */
  document.addEventListener('change', function(e) {
    var t = e.target;
    if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA') {
      send({ type: 'type', selector: getSelector(t), text: t.value, label: labelOf(t) });
    } else if (t.tagName === 'SELECT') {
      var opt = t.options[t.selectedIndex];
      send({ type: 'select', selector: getSelector(t), value: t.value, label: opt ? opt.text : t.value });
    }
  }, true);

  /* ── Ready signal ── */
  send({ type: '_ready', url: window.location.href, title: document.title });
})();
</script>`;
}

export default router;
