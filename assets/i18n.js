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

  // ---------- language switcher: turn #langSwitch into a <select> ----------
  var sw = document.getElementById('langSwitch');
  if (sw) {
    var sel = document.createElement('select');
    sel.id = 'langSwitch';
    sel.className = sw.className || 'lang-switch';
    sel.setAttribute('aria-label', 'Language');
    sel.style.cssText = '-webkit-appearance:none;-moz-appearance:none;appearance:none;cursor:pointer;padding-right:2em;' +
      'background-image:url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' viewBox=\'0 0 12 12\'%3E%3Cpath d=\'M2 4l4 4 4-4\' stroke=\'%234b5563\' stroke-width=\'1.6\' fill=\'none\' stroke-linecap=\'round\'/%3E%3C/svg%3E");' +
      'background-repeat:no-repeat;background-position:right .6em center;background-size:11px;';
    LOCALES.forEach(function (l) {
      var o = document.createElement('option');
      o.value = l.code;
      o.textContent = l.label;
      if (l.code === locale) o.selected = true;
      sel.appendChild(o);
    });
    sel.addEventListener('change', function () {
      try { localStorage.setItem('takalam_locale', sel.value); } catch (e) {}
      window.location.href = withLocale(route, sel.value) + window.location.search + window.location.hash;
    });
    sw.parentNode.replaceChild(sel, sw);
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
      if (a.id === 'langSwitch') return;
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
