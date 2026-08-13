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
      window.__takalamI18n = dict;
      document.dispatchEvent(new CustomEvent('takalam:i18n-ready', { detail: dict }));
    })
    .catch(function (err) {
      console.error('[i18n] Failed to load dictionary for locale', locale, err);
    });
})();
