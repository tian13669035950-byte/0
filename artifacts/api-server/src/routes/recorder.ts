import { Router } from "express";
import { URL } from "url";

const router = Router();

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeAbsolute(href: string, base: string): string {
  if (!href) return href;
  const s = href.trim();
  if (/^(data:|blob:|javascript:|#|mailto:|tel:)/i.test(s)) return s;
  try { return new URL(s, base).href; } catch { return s; }
}

function toProxy(href: string, base: string): string {
  const abs = makeAbsolute(href, base);
  if (!abs || /^(data:|blob:|javascript:|#|mailto:|tel:)/i.test(abs)) return href;
  return `/api/record/res?url=${encodeURIComponent(abs)}`;
}

/** Rewrite all loadable resource URLs in HTML to go through our proxy */
function rewriteHtml(html: string, pageUrl: string): string {
  // Helper that replaces a captured URL group
  const rw = (url: string) => toProxy(url, pageUrl);

  // Remove existing <base> tags so they don't conflict
  html = html.replace(/<base[^>]*>/gi, "");

  // src= on media/script/img/iframe/input/source (but not <a>)
  html = html.replace(
    /(<(?:script|img|video|audio|source|input|iframe|embed)\b[^>]*?\s)src=(["']?)([^"'\s>]+)\2/gi,
    (m, pre, q, url) => `${pre}src=${q}${rw(url)}${q}`
  );

  // href= on <link> only (skip <a> — the recorder intercepts those)
  html = html.replace(
    /(<link\b[^>]*?\s)href=(["']?)([^"'\s>]+)\2/gi,
    (m, pre, q, url) => `${pre}href=${q}${rw(url)}${q}`
  );

  // srcset=
  html = html.replace(
    /\bsrcset=(["']?)([^"'>]+)\1/gi,
    (m, q, srcset) => {
      const rewritten = srcset
        .split(",")
        .map((part: string) => {
          const [u, ...rest] = part.trim().split(/\s+/);
          return u ? [rw(u), ...rest].join(" ") : part;
        })
        .join(", ");
      return `srcset=${q}${rewritten}${q}`;
    }
  );

  // action= on <form>
  html = html.replace(
    /(<form\b[^>]*?\s)action=(["']?)([^"'\s>]+)\2/gi,
    (m, pre, q, url) => `${pre}action=${q}${rw(url)}${q}`
  );

  // Strip CSP meta tags
  html = html.replace(
    /<meta[^>]*http-equiv=["']?Content-Security-Policy["']?[^>]*\/?>/gi,
    ""
  );

  return html;
}

/** Rewrite url() in CSS to go through proxy */
function rewriteCss(css: string, cssUrl: string): string {
  return css.replace(
    /url\((["']?)([^)"']+)\1\)/gi,
    (m, q, url) => {
      const u = url.trim();
      if (/^(data:|#)/i.test(u)) return m;
      const abs = makeAbsolute(u, cssUrl);
      return `url(${q}/api/record/res?url=${encodeURIComponent(abs)}${q})`;
    }
  );
}

/** JS shim injected at the top of every page: intercepts fetch + XHR so relative API calls go through our proxy */
function fetchShim(targetOrigin: string): string {
  return `<script data-recorder-shim>
(function(){
  var B='${targetOrigin}';
  var P='/api/record/res?url=';
  function rw(u){
    if(!u||typeof u!=='string')return u;
    if(u.startsWith('/api/record/'))return u;
    if(/^(data:|blob:|javascript:|#)/i.test(u))return u;
    try{
      var abs=/^https?:\\/\\//i.test(u)?u:new URL(u,B).href;
      return P+encodeURIComponent(abs);
    }catch(e){return u;}
  }
  var oF=window.fetch;
  window.fetch=function(input,init){
    if(typeof input==='string')input=rw(input);
    else if(input instanceof Request)input=new Request(rw(input.url),input);
    return oF.call(window,input,init);
  };
  var oO=XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open=function(m,url,a,u,p){
    return oO.call(this,m,rw(url),a,u,p);
  };
})();
</script>`;
}

const FETCH_OPTS = {
  headers: {
    "User-Agent":
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    Accept:
      "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
    "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
  },
  redirect: "follow" as const,
  signal: AbortSignal.timeout(15000),
};

// ─── HTML Proxy ───────────────────────────────────────────────────────────────
// GET /api/record/proxy?url=https://example.com
router.get("/record/proxy", async (req, res) => {
  const raw = req.query.url as string;
  if (!raw) return res.status(400).send("Missing ?url= parameter");

  let targetUrl = raw.trim();
  if (!/^https?:\/\//i.test(targetUrl)) targetUrl = "https://" + targetUrl;

  try {
    new URL(targetUrl); // validate
  } catch {
    return res.status(400).send("Invalid URL");
  }

  try {
    const upstream = await fetch(targetUrl, FETCH_OPTS);
    const ct = upstream.headers.get("content-type") ?? "";

    if (!ct.includes("text/html")) {
      res.setHeader("Content-Type", ct);
      res.send(Buffer.from(await upstream.arrayBuffer()));
      return;
    }

    const origin = new URL(targetUrl).origin;
    let html = await upstream.text();

    // 1. Rewrite all resource URLs
    html = rewriteHtml(html, targetUrl);

    // 2. Inject fetch shim + recorder script into <head>
    const injection = fetchShim(origin) + "\n" + recorderScript();
    if (/<head(\s[^>]*)?>/.test(html)) {
      html = html.replace(/<head(\s[^>]*)?>/i, (m) => `${m}\n${injection}`);
    } else {
      html = injection + "\n" + html;
    }

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(html);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    res
      .status(502)
      .send(
        `<html><body style="font-family:sans-serif;padding:32px;color:#333">` +
          `<h3 style="color:#c00">无法加载页面</h3><p>${msg}</p>` +
          `<p>目标地址：<code>${targetUrl}</code></p></body></html>`
      );
  }
});

// ─── Resource Proxy ───────────────────────────────────────────────────────────
// GET /api/record/res?url=https://example.com/style.css
router.get("/record/res", async (req, res) => {
  const raw = req.query.url as string;
  if (!raw) return res.status(400).send("Missing ?url= parameter");

  let targetUrl: string;
  try {
    targetUrl = decodeURIComponent(raw);
    new URL(targetUrl); // validate
  } catch {
    return res.status(400).send("Invalid URL");
  }

  try {
    const upstream = await fetch(targetUrl, {
      ...FETCH_OPTS,
      headers: {
        ...FETCH_OPTS.headers,
        Accept: "*/*",
      },
      signal: AbortSignal.timeout(10000),
    });

    const ct = upstream.headers.get("content-type") ?? "application/octet-stream";

    // Forward safe headers
    const forward = ["content-type", "cache-control", "expires", "last-modified", "etag"];
    for (const h of forward) {
      const v = upstream.headers.get(h);
      if (v) res.setHeader(h, v);
    }
    // Allow iframe to use these resources
    res.setHeader("Access-Control-Allow-Origin", "*");

    if (ct.includes("text/css")) {
      let css = await upstream.text();
      css = rewriteCss(css, targetUrl);
      res.setHeader("Content-Type", "text/css; charset=utf-8");
      res.send(css);
      return;
    }

    if (ct.includes("javascript") || ct.includes("text/js")) {
      // Inject fetch shim at the top of every JS file so relative XHR/fetch calls are intercepted
      const origin = new URL(targetUrl).origin;
      const js = await upstream.text();
      res.setHeader("Content-Type", ct);
      // Minimal shim (no HTML tags, just raw JS)
      const shim = `(function(){var B='${origin}';var P='/api/record/res?url=';function rw(u){if(!u||typeof u!=='string')return u;if(u.startsWith('/api/record/'))return u;if(/^(data:|blob:|javascript:|#)/i.test(u))return u;try{var a=/^https?:\\/\\//i.test(u)?u:new URL(u,B).href;return P+encodeURIComponent(a);}catch(e){return u;}}if(typeof window!=='undefined'){if(window.__recorderShimmed)return;window.__recorderShimmed=true;var oF=window.fetch;window.fetch=function(i,o){if(typeof i==='string')i=rw(i);else if(i&&i.url)i=new Request(rw(i.url),i);return oF.call(window,i,o);};var oO=XMLHttpRequest.prototype.open;XMLHttpRequest.prototype.open=function(m,u,a,us,p){return oO.call(this,m,rw(u),a,us,p);};}})();\n`;
      res.send(shim + js);
      return;
    }

    // Binary/other: stream as-is
    const buf = await upstream.arrayBuffer();
    res.send(Buffer.from(buf));
  } catch (e: unknown) {
    res.status(502).send(`Resource proxy error: ${e instanceof Error ? e.message : e}`);
  }
});

// ─── Recorder script injected into proxied HTML pages ────────────────────────
function recorderScript(): string {
  return `<script data-recorder>
(function () {
  'use strict';

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

  document.addEventListener('click', function(e) {
    var origin = e.target;
    var clickTarget = origin;
    var linkEl = null;
    var walk = origin;
    while (walk && walk !== document.body) {
      if (walk.tagName === 'A' && walk.href && !/^\\/api\\/record\\//.test(walk.getAttribute('href') || '')) {
        // Decode the proxied href back to the real URL
        var realHref = walk.href;
        var m = realHref.match(/\\/api\\/record\\/res\\?url=(.+)/);
        if(m){ try{ realHref = decodeURIComponent(m[1]); }catch(e){} }
        linkEl = { el: walk, href: realHref };
        break;
      }
      if (['BUTTON','INPUT','LABEL','SELECT','TEXTAREA'].indexOf(walk.tagName) !== -1) {
        clickTarget = walk;
        break;
      }
      walk = walk.parentElement;
    }

    if (linkEl) {
      e.preventDefault();
      e.stopPropagation();
      send({ type: 'navigate', href: linkEl.href, selector: getSelector(linkEl.el), label: labelOf(linkEl.el) });
    } else {
      send({ type: 'click', selector: getSelector(clickTarget), label: labelOf(clickTarget) });
    }
  }, true);

  document.addEventListener('change', function(e) {
    var t = e.target;
    if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA') {
      send({ type: 'type', selector: getSelector(t), text: t.value, label: labelOf(t) });
    } else if (t.tagName === 'SELECT') {
      var opt = t.options[t.selectedIndex];
      send({ type: 'select', selector: getSelector(t), value: t.value, label: opt ? opt.text : t.value });
    }
  }, true);

  send({ type: '_ready', url: window.location.href, title: document.title });
})();
</script>`;
}

export default router;
