// Shared client-side locale hydration for index.html, test.html, results.html.
// No framework, no build step: reads /en/ vs unprefixed (French, default) from
// the URL, fetches the matching dictionary, and swaps text/HTML into
// [data-i18n] / [data-i18n-html] elements. Meta tags and initial HTML stay
// French by default, so there is a brief flash of the source-language text
// before hydration on first paint -- acceptable for Milestone 1, revisit if
// this becomes a real SEO/CLS problem.
(function () {
  var EN_PREFIX = /^\/en(\/|$)/;
  var path = window.location.pathname;
  var locale = EN_PREFIX.test(path) ? 'en' : 'fr';
  document.documentElement.lang = locale;

  var switcher = document.getElementById('langSwitch');
  if (switcher) {
    if (locale === 'en') {
      switcher.href = path.replace(EN_PREFIX, '/') || '/';
      switcher.textContent = 'FR';
    } else {
      switcher.href = '/en' + (path === '/' ? '' : path);
      switcher.textContent = 'EN';
    }
  }

  // Every page-to-page route the site has -- test.html, results.html, etc.
  // are served at both the unprefixed (French) and /en (English) URL for
  // the same file, so a plain href="/test" always lands on French. Any
  // internal link (static markup or HTML injected from the dictionary
  // below) pointing at one of these routes gets the /en prefix added back
  // in when the visitor is in the English tree. The switcher above is
  // exempt: it intentionally links to the *other* locale.
  var LOCALE_ROUTES = ['/', '/test', '/results', '/register', '/privacy', '/policies'];
  function localizeHref(raw) {
    if (locale !== 'en' || !raw) return raw;
    for (var i = 0; i < LOCALE_ROUTES.length; i++) {
      var route = LOCALE_ROUTES[i];
      var rest = raw.slice(route.length);
      if (raw === route || ((rest[0] === '?' || rest[0] === '#') && raw.indexOf(route) === 0)) {
        return '/en' + (route === '/' ? '' : route) + rest;
      }
    }
    return raw;
  }
  function localizeLinks() {
    document.querySelectorAll('a[href]').forEach(function (a) {
      if (a === switcher) return;
      var raw = a.getAttribute('href');
      var localized = localizeHref(raw);
      if (localized !== raw) a.setAttribute('href', localized);
    });
  }
  window.__takalamLocalizeHref = localizeHref;
  localizeLinks();

  // Browser-language signal only (never geo-IP, per the brief), and only on
  // a first visit to the unprefixed default with no stored preference.
  if (locale === 'fr' && !localStorage.getItem('takalam_locale')) {
    var browserLang = (navigator.language || '').toLowerCase();
    if (browserLang && browserLang.indexOf('fr') !== 0) {
      localStorage.setItem('takalam_locale', 'en');
      window.location.replace('/en' + path);
      return;
    }
  }
  localStorage.setItem('takalam_locale', locale);

  fetch('/i18n/' + locale + '.json')
    .then(function (r) { return r.json(); })
    .then(function (dict) {
      document.querySelectorAll('[data-i18n]').forEach(function (el) {
        var key = el.getAttribute('data-i18n');
        if (dict[key] != null) el.textContent = dict[key];
      });
      document.querySelectorAll('[data-i18n-html]').forEach(function (el) {
        var key = el.getAttribute('data-i18n-html');
        if (dict[key] != null) el.innerHTML = dict[key];
      });
      document.querySelectorAll('[data-i18n-placeholder]').forEach(function (el) {
        var key = el.getAttribute('data-i18n-placeholder');
        if (dict[key] != null) el.placeholder = dict[key];
      });
      document.querySelectorAll('[data-i18n-alt]').forEach(function (el) {
        var key = el.getAttribute('data-i18n-alt');
        if (dict[key] != null) el.alt = dict[key];
      });
      document.querySelectorAll('[data-i18n-aria]').forEach(function (el) {
        var key = el.getAttribute('data-i18n-aria');
        if (dict[key] != null) el.setAttribute('aria-label', dict[key]);
      });
      localizeLinks();
      window.__takalamI18n = dict;
      document.dispatchEvent(new CustomEvent('takalam:i18n-ready', { detail: dict }));
    })
    .catch(function (err) {
      console.error('[i18n] Failed to load dictionary for locale', locale, err);
    });
})();
