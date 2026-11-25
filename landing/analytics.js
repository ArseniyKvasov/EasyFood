/* BiteBalance: согласие, UTM, события, Яндекс.Метрика */
(function () {
  'use strict';

  var CFG = window.BB_CONFIG || {};
  var KEY_CONSENT = 'bb_consent';
  var KEY_UTM = 'bb_utm';
  var KEY_SID = 'bb_sid';
  var consent = null;
  var queue = [];
  var loaded = false;

  function read(key) {
    try { return localStorage.getItem(key); } catch (e) { return null; }
  }
  function write(key, value) {
    try { localStorage.setItem(key, value); } catch (e) {}
  }
  function sessionId() {
    var id = read(KEY_SID);
    if (!id) {
      id = 's_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
      write(KEY_SID, id);
    }
    return id;
  }

  /* UTM ловим при первом заходе и держим весь сеанс */
  function captureUtm() {
    var params = new URLSearchParams(location.search);
    var keys = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'ref'];
    var found = {};
    keys.forEach(function (k) { if (params.get(k)) found[k] = params.get(k); });
    if (Object.keys(found).length) found.ts = Date.now();
    if (Object.keys(found).length) write(KEY_UTM, JSON.stringify(found));
    try { return JSON.parse(read(KEY_UTM) || '{}'); } catch (e) { return {}; }
  }

  function loadMetrica(id) {
    if (loaded || !id) return;
    loaded = true;
    (function (m, e, t, r, i, k, a) {
      m[i] = m[i] || function () { (m[i].a = m[i].a || []).push(arguments); };
      m[i].l = 1 * new Date();
      for (var j = 0; j < document.scripts.length; j++) { if (document.scripts[j].src === r) return; }
      k = e.createElement(t); a = e.getElementsByTagName(t)[0];
      k.async = 1; k.src = r; a.parentNode.insertBefore(k, a);
    })(window, document, 'script', 'https://mc.yandex.ru/metrika/tag.js', 'ym');
    window.ym(id, 'init', {
      ssr: true,
      webvisor: true,
      clickmap: true,
      ecommerce: 'dataLayer',
      referrer: document.referrer,
      url: location.href,
      accurateTrackBounce: true,
      trackLinks: true
    });
  }

  function loadClarity(id) {
    if (!id || window.clarity) return;
    (function (c, l, a2, r, i, t, y) {
      c[a2] = c[a2] || function () { (c[a2].q = c[a2].q || []).push(arguments); };
      t = l.createElement(r); t.async = 1; t.src = 'https://www.clarity.ms/tag/' + i;
      y = l.getElementsByTagName(r)[0]; y.parentNode.insertBefore(t, y);
    })(window, document, 'clarity', 'script', id);
  }

  function flush() {
    while (queue.length) send(queue.shift());
  }

  function send(payload) {
    if (window.ym && CFG.metrikaId) {
      try { window.ym(CFG.metrikaId, 'reachGoal', payload.name, payload.props); } catch (e) {}
    }
    if (window.dataLayer) window.dataLayer.push(Object.assign({ event: payload.name }, payload.props));
    if (window.clarity) { try { window.clarity('event', payload.name); } catch (e) {} }
    if (CFG.debug) console.info('[track]', payload.name, payload.props);
  }

  /* Публичная функция: bbTrack('purchase', {plan:'year'}) */
  window.bbTrack = function (name, props) {
    var payload = {
      name: name,
      props: Object.assign({ page: location.pathname, sid: sessionId() }, captureUtm(), props || {})
    };
    if (consent === 'all') send(payload);
    else queue.push(payload);
  };

  function applyConsent(value) {
    consent = value;
    write(KEY_CONSENT, value);
    if (value === 'all') {
      if (CFG.metrikaId) loadMetrica(CFG.metrikaId);
      if (CFG.clarityId) loadClarity(CFG.clarityId);
      flush();
    } else {
      queue = [];
    }
    document.documentElement.setAttribute('data-consent', value);
    document.dispatchEvent(new CustomEvent('bb:consent', { detail: value }));
  }

  window.bbConsent = function (value) { applyConsent(value || 'all'); };

  document.addEventListener('DOMContentLoaded', function () {
    captureUtm();
    sessionId();
    consent = read(KEY_CONSENT);
    document.documentElement.setAttribute('data-consent', consent || 'unset');
    if (consent === 'all') {
      if (CFG.metrikaId) loadMetrica(CFG.metrikaId);
      if (CFG.clarityId) loadClarity(CFG.clarityId);
      flush();
    }
  });
})();
