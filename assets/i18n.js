// Shared client-side locale hydration for every page on the site.
// No framework, no build step. English is the default and lives at the
// unprefixed URLs (/, /tutors, ...); every other language lives under a
// /<code>/ prefix (/fr/tutors, /ar, ...). This script reads the locale
// from the path, swaps text into [data-i18n*] elements from the matching
// /i18n/<code>.json dictionary, localises internal links, sets <html lang>
// and dir, translates <title>/<meta description>, and points the canonical
// link at the current locale. The raw HTML ships in English, so there is a
// brief flash of English before hydration on non-English pages.
(function () {
  // First entry is the default locale (no URL prefix). Order = switcher order.
  var LOCALES = [
    { code: 'en', label: 'English',    dir: 'ltr' },
    { code: 'fr', label: 'Français',   dir: 'ltr' },
    { code: 'es', label: 'Español',    dir: 'ltr' },
    { code: 'ar', label: 'العربية',    dir: 'rtl' },
    { code: 'de', label: 'Deutsch',    dir: 'ltr' },
    { code: 'pt', label: 'Português',  dir: 'ltr' },
    { code: 'it', label: 'Italiano',   dir: 'ltr' },
    { code: 'nl', label: 'Nederlands', dir: 'ltr' }
  ];
  var DEFAULT = LOCALES[0].code;
  var CODES = LOCALES.map(function (l) { return l.code; });
  var PREFIXED = CODES.filter(function (c) { return c !== DEFAULT; });
  var PREFIX_RE = new RegExp('^\\/(' + PREFIXED.join('|') + ')(\\/|$)');

  var path = window.location.pathname;
  var pm = path.match(PREFIX_RE);
  var locale = pm ? pm[1] : DEFAULT;
  // The site route with any locale prefix stripped, e.g. "/tutors" or "/".
  var route = pm ? (path.slice(pm[1].length + 1) || '/') : path;
  var meta = LOCALES.filter(function (l) { return l.code === locale; })[0] || LOCALES[0];

  document.documentElement.lang = locale;
  document.documentElement.dir = meta.dir;

  var ORIGIN = 'https://takalamenglish.ma';
  var LOCALE_ROUTES = ['/', '/test', '/results', '/register', '/privacy', '/policies', '/tutors', '/reviews'];

  // Build the URL path for `sroute` (an unprefixed site route) in `code`.
  function withLocale(sroute, code) {
    if (code === DEFAULT) return sroute;
    if (sroute === '/') return '/' + code;
    return '/' + code + sroute;
  }

  // ---------- language switcher: turn #langSwitch into a custom dropdown ----------
  var sw = document.getElementById('langSwitch');
  if (sw) {
    if (!document.getElementById('tk-lang-css')) {
      var st = document.createElement('style');
      st.id = 'tk-lang-css';
      st.textContent =
        '.tk-lang{position:relative;display:inline-flex;font-family:"Inter",system-ui,-apple-system,sans-serif}' +
        '.tk-lang-btn{display:inline-flex;align-items:center;gap:.45em;font:600 .82rem/1 "Inter",system-ui,sans-serif;letter-spacing:.02em;color:#4b5563;background:transparent;border:1.5px solid rgba(26,35,50,.22);border-radius:999px;padding:.55em .85em;cursor:pointer;transition:color .2s,border-color .2s,background .2s}' +
        '.tk-lang-btn:hover,.tk-lang.open .tk-lang-btn{color:#1a2332;border-color:rgba(26,35,50,.42);background:rgba(26,35,50,.04)}' +
        '.tk-lang-btn:focus-visible{outline:2px solid #31c48d;outline-offset:2px}' +
        '.tk-lang-btn .tk-globe{width:14px;height:14px;opacity:.85;flex:none}' +
        '.tk-lang-btn .tk-caret{width:10px;height:10px;flex:none;transition:transform .22s cubic-bezier(.22,.61,.36,1)}' +
        '.tk-lang.open .tk-caret{transform:rotate(180deg)}' +
        '.tk-lang-menu{position:absolute;top:calc(100% + 8px);right:0;min-width:172px;list-style:none;margin:0;padding:6px;background:#fffdf7;border:1px solid rgba(13,79,55,.16);border-radius:14px;box-shadow:0 20px 46px -22px rgba(13,79,55,.45),0 4px 14px rgba(26,35,50,.09);opacity:0;transform:translateY(-6px) scale(.98);transform-origin:top right;pointer-events:none;transition:opacity .18s ease,transform .18s ease;z-index:250}' +
        '[dir="rtl"] .tk-lang-menu{right:auto;left:0;transform-origin:top left}' +
        '.tk-lang.open .tk-lang-menu{opacity:1;transform:none;pointer-events:auto}' +
        '.tk-lang-menu li{margin:0}' +
        '.tk-lang-menu a{display:flex;align-items:center;justify-content:space-between;gap:1.2em;padding:.52em .7em;border-radius:9px;font-size:.88rem;font-weight:500;color:#1a2332;text-decoration:none;white-space:nowrap;transition:background .15s}' +
        '.tk-lang-menu a:hover{background:rgba(13,79,55,.07)}' +
        '.tk-lang-menu a:focus-visible{outline:none;background:rgba(13,79,55,.1)}' +
        '.tk-lang-menu a[aria-current="true"]{color:#0d4f37;font-weight:600}' +
        '.tk-lang-menu a[aria-current="true"]::after{content:"";width:6px;height:6px;border-radius:50%;background:#31c48d;flex:none}' +
        '@media (prefers-reduced-motion:reduce){.tk-lang-menu,.tk-caret{transition:none}}';
      document.head.appendChild(st);
    }

    var wrap = document.createElement('div');
    wrap.className = 'tk-lang ' + (sw.className || '');
    var GLOBE = '<svg class="tk-globe" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.6 2.8 2.6 15.2 0 18M12 3c-2.6 2.8-2.6 15.2 0 18"/></svg>';
    var CARET = '<svg class="tk-caret" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 4.5 6 7.5l3-3"/></svg>';

    var btn = document.createElement('button');
    btn.type = 'button';
    btn.id = 'langSwitch';
    btn.className = 'tk-lang-btn';
    btn.setAttribute('aria-haspopup', 'listbox');
    btn.setAttribute('aria-expanded', 'false');
    btn.setAttribute('aria-label', 'Choose language');
    btn.innerHTML = GLOBE + '<span class="tk-lang-label">' + meta.label + '</span>' + CARET;

    var menu = document.createElement('ul');
    menu.className = 'tk-lang-menu';
    menu.setAttribute('role', 'listbox');
    LOCALES.forEach(function (l) {
      var li = document.createElement('li');
      var a = document.createElement('a');
      a.setAttribute('role', 'option');
      a.href = withLocale(route, l.code) + window.location.search + window.location.hash;
      a.textContent = l.label;
      if (l.code === locale) { a.setAttribute('aria-current', 'true'); a.setAttribute('aria-selected', 'true'); }
      a.addEventListener('click', function () {
        try { localStorage.setItem('takalam_locale', l.code); } catch (e) {}
      });
      li.appendChild(a);
      menu.appendChild(li);
    });

    wrap.appendChild(btn);
    wrap.appendChild(menu);
    sw.parentNode.replaceChild(wrap, sw);

    function setOpen(open) {
      wrap.classList.toggle('open', open);
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    }
    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      setOpen(!wrap.classList.contains('open'));
    });
    document.addEventListener('click', function (e) {
      if (!wrap.contains(e.target)) setOpen(false);
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && wrap.classList.contains('open')) { setOpen(false); btn.focus(); }
    });
  }

  // ---------- keep the locale prefix on internal links ----------
  function localizeHref(raw) {
    if (locale === DEFAULT || !raw) return raw;
    for (var i = 0; i < LOCALE_ROUTES.length; i++) {
      var r = LOCALE_ROUTES[i];
      var rest = raw.slice(r.length);
      if (raw === r || ((rest[0] === '?' || rest[0] === '#') && raw.indexOf(r) === 0)) {
        return withLocale(r, locale) + rest;
      }
    }
    return raw;
  }
  function localizeLinks() {
    document.querySelectorAll('a[href]').forEach(function (a) {
      if (a.id === 'langSwitch' || (a.closest && a.closest('.tk-lang'))) return;
      var raw = a.getAttribute('href');
      var loc = localizeHref(raw);
      if (loc !== raw) a.setAttribute('href', loc);
    });
  }
  window.__takalamLocalizeHref = localizeHref;
  localizeLinks();

  // ---------- point <link rel=canonical> at this locale ----------
  var canon = document.querySelector('link[rel="canonical"]');
  if (canon) {
    var cpath = withLocale(route, locale);
    canon.setAttribute('href', ORIGIN + (cpath === '/' ? '/' : cpath));
  }

  // ---------- first-visit browser-language redirect ----------
  // Only from the default locale, only with no stored preference.
  if (locale === DEFAULT && !localStorage.getItem('takalam_locale')) {
    var bl = (navigator.language || '').toLowerCase().slice(0, 2);
    if (bl && bl !== DEFAULT && CODES.indexOf(bl) !== -1) {
      try { localStorage.setItem('takalam_locale', bl); } catch (e) {}
      window.location.replace(withLocale(route, bl) + window.location.search + window.location.hash);
      return;
    }
  }
  try { localStorage.setItem('takalam_locale', locale); } catch (e) {}

  // ---------- hydrate text ----------
  fetch('/i18n/' + locale + '.json')
    .then(function (r) { return r.json(); })
    .then(function (dict) {
      function swap(attr, apply) {
        document.querySelectorAll('[' + attr + ']').forEach(function (el) {
          var key = el.getAttribute(attr);
          if (dict[key] != null) apply(el, dict[key]);
        });
      }
      swap('data-i18n', function (el, v) { el.textContent = v; });
      swap('data-i18n-html', function (el, v) { el.innerHTML = v; });
      swap('data-i18n-placeholder', function (el, v) { el.placeholder = v; });
      swap('data-i18n-alt', function (el, v) { el.alt = v; });
      swap('data-i18n-aria', function (el, v) { el.setAttribute('aria-label', v); });

      var tKey = document.documentElement.getAttribute('data-i18n-title');
      if (tKey && dict[tKey]) document.title = dict[tKey];
      var dKey = document.documentElement.getAttribute('data-i18n-desc');
      var descEl = document.querySelector('meta[name="description"]');
      if (dKey && dict[dKey] && descEl) descEl.setAttribute('content', dict[dKey]);

      localizeLinks();
      window.__takalamI18n = dict;
      document.dispatchEvent(new CustomEvent('takalam:i18n-ready', { detail: dict }));
    })
    .catch(function (err) {
      console.error('[i18n] Failed to load dictionary for locale', locale, err);
    });
})();
