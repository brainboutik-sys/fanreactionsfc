/* ═══════════════════════════════════════════════════════════════════════════
   FanReactionsFC — Analytics (Google Analytics 4, consent-gated)

   HOW TO TURN ON:
   1. Create a GA4 property at analytics.google.com and copy its Measurement
      ID (looks like G-ABCD1234EF).
   2. Replace GA_MEASUREMENT_ID below with it.
   That's it. Until a real ID is set this module is a complete no-op — no
   script loads, no cookie banner shows, nothing is tracked.

   PRIVACY: GA4 sets cookies, so EU visitors must opt in first. On the first
   visit we show a small consent bar; GA only loads after the user clicks
   "Accept". "Decline" is remembered and GA never loads. Because it's a SPA,
   pageviews are sent manually on each route change (send_page_view is off).
   ═══════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  const GA_MEASUREMENT_ID = 'G-5HNGEQLJR2';
  const CONSENT_KEY = 'frfc_analytics_consent';
  const PLACEHOLDER = 'G-XXXXXXXXXX';

  let loaded = false;

  function isConfigured() {
    return GA_MEASUREMENT_ID && GA_MEASUREMENT_ID !== PLACEHOLDER;
  }

  function getConsent() {
    try { return localStorage.getItem(CONSENT_KEY); } catch (_) { return null; }
  }
  function setConsent(v) {
    try { localStorage.setItem(CONSENT_KEY, v); } catch (_) {}
  }

  function loadGA() {
    if (loaded || !isConfigured()) return;
    loaded = true;
    const s = document.createElement('script');
    s.async = true;
    s.src = 'https://www.googletagmanager.com/gtag/js?id=' + GA_MEASUREMENT_ID;
    document.head.appendChild(s);
    window.dataLayer = window.dataLayer || [];
    window.gtag = function () { window.dataLayer.push(arguments); };
    window.gtag('js', new Date());
    // send_page_view:false — this is a client-side-routed SPA, so we emit
    // page_view ourselves on every route change (see trackPageview).
    window.gtag('config', GA_MEASUREMENT_ID, { send_page_view: false });
    trackPageview(location.pathname + location.search);
  }

  function trackPageview(path) {
    if (!loaded || !window.gtag) return;
    window.gtag('event', 'page_view', {
      page_path: path,
      page_location: location.href,
      page_title: document.title,
    });
  }

  function dismissBanner() {
    const el = document.getElementById('cookieConsent');
    if (el) el.remove();
  }

  function showBanner() {
    if (document.getElementById('cookieConsent')) return;
    const bar = document.createElement('div');
    bar.id = 'cookieConsent';
    bar.className = 'cookie-consent';
    bar.setAttribute('role', 'dialog');
    bar.setAttribute('aria-label', 'Cookie consent');
    bar.innerHTML =
      '<p class="cookie-consent-text">We use analytics cookies to understand how the site is used. ' +
      'You can accept or decline — declining keeps everything working, just untracked.</p>' +
      '<div class="cookie-consent-actions">' +
        '<button class="btn btn-ghost btn-sm" id="cookieDecline">Decline</button>' +
        '<button class="btn btn-primary btn-sm" id="cookieAccept">Accept</button>' +
      '</div>';
    document.body.appendChild(bar);
    document.getElementById('cookieAccept').onclick = function () {
      setConsent('granted'); dismissBanner(); loadGA();
    };
    document.getElementById('cookieDecline').onclick = function () {
      setConsent('denied'); dismissBanner();
    };
  }

  function init() {
    if (!isConfigured()) return;              // dormant until a real ID is set
    const consent = getConsent();
    if (consent === 'granted') loadGA();
    else if (consent !== 'denied') showBanner();
    // 'denied' → do nothing
  }

  window.Analytics = { init: init, trackPageview: trackPageview };
})();
