/* BiteBalance landing - поведение */
(function () {
  'use strict';

  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------- появление страницы ---------- */
  function ready() {
    document.body.classList.add('is-loaded');
    requestAnimationFrame(function () { document.body.classList.add('is-revealed'); });
  }
  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    setTimeout(ready, 120);
  } else {
    document.addEventListener('DOMContentLoaded', function () { setTimeout(ready, 120); });
  }

  /* ---------- скролл-ревил ---------- */
  var revealEls = Array.prototype.slice.call(document.querySelectorAll('.reveal'));
  if ('IntersectionObserver' in window && !reduce) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) {
          e.target.classList.add('is-in');
          io.unobserve(e.target);
        }
      });
    }, { rootMargin: '0px 0px -12% 0px', threshold: 0.12 });
    revealEls.forEach(function (el) { io.observe(el); });
  } else {
    revealEls.forEach(function (el) { el.classList.add('is-in'); });
  }

  /* ---------- шапка, прогресс, мобильная кнопка ---------- */
  var header = document.getElementById('header');
  var progress = document.getElementById('progress');
  var mobilebar = document.getElementById('mobilebar');
  var lastY = window.scrollY;

  function onScroll() {
    var y = window.scrollY;
    header.classList.toggle('is-scrolled', y > 20);
    var h = document.documentElement.scrollHeight - window.innerHeight;
    progress.style.width = (h > 0 ? (y / h) * 100 : 0) + '%';
    if (mobilebar) mobilebar.classList.toggle('is-on', y > window.innerHeight * 0.75);
    lastY = y;
  }
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  /* ---------- мобильное меню ---------- */
  var burger = document.getElementById('burger');
  var nav = document.getElementById('nav');
  if (burger && nav) {
    burger.addEventListener('click', function () {
      var open = nav.classList.toggle('is-open');
      burger.classList.toggle('is-open', open);
      burger.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && nav.classList.contains('is-open')) {
        nav.classList.remove('is-open');
        burger.classList.remove('is-open');
        burger.setAttribute('aria-expanded', 'false');
        burger.focus();
      }
    });
    nav.addEventListener('click', function (e) {
      if (e.target.tagName === 'A') {
        nav.classList.remove('is-open');
        burger.classList.remove('is-open');
        burger.setAttribute('aria-expanded', 'false');
      }
    });
  }

  /* ---------- кольцо калорий в телефоне ---------- */
  var ring = document.getElementById('ringFill');
  var kcalEl = document.getElementById('kcalValue');
  var KCAL = 1251, TARGET = 2100, CIRC = 2 * Math.PI * 86;

  function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }

  function animateNumber(el, from, to, dur) {
    var start = performance.now();
    function frame(now) {
      var t = Math.min(1, (now - start) / dur);
      var v = Math.round(from + (to - from) * easeOutCubic(t));
      el.textContent = v.toLocaleString('ru-RU');
      if (t < 1) requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }

  if (ring && kcalEl) {
    if (reduce) {
      ring.style.strokeDashoffset = CIRC * (1 - KCAL / TARGET);
      kcalEl.textContent = KCAL.toLocaleString('ru-RU');
    } else {
      setTimeout(function () {
        ring.style.strokeDashoffset = CIRC * (1 - KCAL / TARGET);
        animateNumber(kcalEl, 0, KCAL, 2800);
      }, 900);
    }
  }

  /* ---------- медленный параллакс героя ---------- */
  var visual = document.getElementById('heroVisual');
  if (visual && !reduce && window.matchMedia('(pointer:fine)').matches) {
    var tx = 0, ty = 0, cx = 0, cy = 0, raf = null, idle = true;
    window.addEventListener('pointermove', function (e) {
      tx = (e.clientX / window.innerWidth - 0.5) * 2;
      ty = (e.clientY / window.innerHeight - 0.5) * 2;
      if (idle) { idle = false; loop(); }
    }, { passive: true });

    function loop() {
      cx += (tx - cx) * 0.028;
      cy += (ty - cy) * 0.028;
      visual.style.transform = 'rotateY(' + (cx * 5).toFixed(2) + 'deg) rotateX(' + (-cy * 4).toFixed(2) + 'deg) translate3d(' + (cx * -10).toFixed(1) + 'px,' + (cy * -8).toFixed(1) + 'px,0)';
      if (Math.abs(tx - cx) < 0.001 && Math.abs(ty - cy) < 0.001) { idle = true; raf = null; return; }
      raf = requestAnimationFrame(loop);
    }
  }

  /* ---------- актуальные даты ---------- */
  var appDateEl = document.getElementById('appDate');
  if (appDateEl) {
    var dparts = new Date().toLocaleDateString('ru-RU', { weekday: 'short', day: 'numeric', month: 'long' }).split(',');
    appDateEl.textContent = (dparts[0] || '').toUpperCase().replace('.', '') + ' · ' + (dparts[1] || '').trim();
  }
  var yearEl = document.getElementById('year');
  if (yearEl) yearEl.textContent = new Date().getFullYear();

  /* ---------- календарь ---------- */
  var calGrid = document.getElementById('calGrid');
  var calWeek = document.getElementById('calWeek');
  var calTip = document.getElementById('calTip');
  if (calGrid && calWeek) {
    ['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс'].forEach(function (d) {
      var s = document.createElement('span');
      s.textContent = d;
      calWeek.appendChild(s);
    });

    var now = new Date();
    var year = now.getFullYear();
    var month = now.getMonth();
    var today = now.getDate();
    var monthDays = new Date(year, month + 1, 0).getDate();
    var lead = (new Date(year, month, 1).getDay() + 6) % 7;
    var monthTitles = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
    var monthGen = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];

    var monthEl = document.getElementById('calMonth');
    var daysEl = document.getElementById('calDays');
    if (monthEl) monthEl.textContent = monthTitles[month] + ' ' + year;
    if (daysEl) daysEl.textContent = monthDays + ' дней';

    function kcalFor(day) { return 1680 + ((day * 137) % 620); }
    function stateFor(day) {
      if (day > today) return 'future';
      var h = (day * 37 + month * 11) % 10;
      if (h < 2) return 'over';
      if (h === 2) return 'none';
      return 'ok';
    }

    for (var i = 0; i < lead; i++) {
      var blank = document.createElement('div');
      blank.className = 'cal__day cal__day--empty';
      calGrid.appendChild(blank);
    }

    var cells = [];
    for (var d = 1; d <= monthDays; d++) {
      var cell = document.createElement('div');
      var state = stateFor(d);
      var future = state === 'future';
      cell.className = 'cal__day' + (future ? ' cal__day--none' : ' cal__day--' + state) + (d === today ? ' cal__day--today' : '');
      cell.textContent = d;
      cell.style.transitionDelay = (i * 18) + 'ms';
      cell.dataset.day = d;
      cell.dataset.state = state;
      calGrid.appendChild(cell);
      cells.push(cell);
      i++;
    }

    if ('IntersectionObserver' in window && !reduce) {
      var cio = new IntersectionObserver(function (entries) {
        entries.forEach(function (e) {
          if (e.isIntersecting) {
            cells.forEach(function (c, idx) { setTimeout(function () { c.classList.add('is-in'); }, idx * 20); });
            cio.disconnect();
          }
        });
      }, { threshold: 0.2 });
      cio.observe(calGrid);
    } else {
      cells.forEach(function (c) { c.classList.add('is-in'); });
    }

    calGrid.addEventListener('mouseover', function (e) {
      var cell = e.target.closest('.cal__day');
      if (!cell || !cell.dataset.day) return;
      var day = +cell.dataset.day, state = cell.dataset.state;
      var label = state === 'ok' ? 'в норме' : state === 'over' ? 'перебор' : state === 'none' ? 'не записано' : 'ещё впереди';
      var kcal = state === 'ok' || state === 'over' ? kcalFor(day).toLocaleString('ru-RU') + ' ккал · ' : '';
      calTip.textContent = day + ' ноября · ' + kcal + label;
    });
    calGrid.addEventListener('mouseleave', function () { calTip.textContent = 'Наведите на день'; });
  }

  /* ---------- демо-поиск ---------- */
  var DB = [
    { name: 'Гречка варёная', brand: 'Своя база', kcal: 110, p: 4.2, f: 1.1, c: 21.3 },
    { name: 'Банан', brand: 'Фрукты', kcal: 96, p: 1.5, f: 0.2, c: 21.0 },
    { name: 'Творог 5%', brand: 'Молочное', kcal: 121, p: 17.0, f: 5.0, c: 3.0 },
    { name: 'Куриная грудка варёная', brand: 'Мясо', kcal: 137, p: 29.8, f: 1.8, c: 0.5 },
    { name: 'Овсяные хлопья', brand: 'Крупы', kcal: 352, p: 12.3, f: 6.1, c: 61.8 },
    { name: 'Рис белый отварной', brand: 'Крупы', kcal: 116, p: 2.2, f: 0.5, c: 24.9 },
    { name: 'Яблоко', brand: 'Фрукты', kcal: 52, p: 0.4, f: 0.4, c: 13.8 },
    { name: 'Кофе с молоком', brand: 'Напитки', kcal: 45, p: 2.3, f: 1.6, c: 4.5 },
    { name: 'Хлеб цельнозерновой', brand: 'Выпечка', kcal: 247, p: 9.1, f: 3.3, c: 41.4 },
    { name: 'Оливковое масло', brand: 'Масла', kcal: 898, p: 0, f: 99.8, c: 0 }
  ];

  function norm(s) {
    return s.toLowerCase().replace(/ё/g, 'е').replace(/[^a-zа-я0-9]+/gi, '');
  }
  function bigrams(s) {
    var out = {}, i;
    for (i = 0; i < s.length - 1; i++) {
      var g = s.slice(i, i + 2);
      out[g] = (out[g] || 0) + 1;
    }
    return out;
  }
  function dice(a, b) {
    if (!a || !b) return 0;
    if (a === b) return 1;
    var A = bigrams(a), B = bigrams(b), inter = 0, total = 0, k;
    for (k in A) { if (B[k]) inter += Math.min(A[k], B[k]); total += A[k]; }
    for (k in B) total += B[k];
    return (2 * inter) / total;
  }

  function search(q) {
    var query = norm(q);
    if (!query) return null;
    var best = null, bestScore = 0;
    DB.forEach(function (item) {
      var s = Math.max(dice(query, norm(item.name)), dice(query, norm(item.brand)));
      if (s > bestScore) { bestScore = s; best = item; }
    });
    if (bestScore >= 0.35) return { item: best, score: bestScore };
    return { item: null, score: bestScore };
  }

  var input = document.getElementById('q');
  var result = document.getElementById('result');
  var chips = document.getElementById('chips');

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function bar(label, val, max, cls) {
    var w = Math.min(100, Math.round((val / max) * 100));
    return '<div class="pbar"><div class="pbar__row"><span>' + label + '</span><b>' + String(val).replace('.', ',') + ' г</b></div>' +
      '<div class="pbar__track"><i class="' + cls + '" style="--w:' + w + '%"></i></div></div>';
  }

  function renderProduct(item, ms) {
    result.classList.add('is-filled');
    result.innerHTML =
      '<div class="product">' +
        '<div class="product__top">' +
          '<div><div class="product__name">' + esc(item.name) + '</div>' +
          '<div class="product__brand">' + esc(item.brand) + ' · на 100 г</div></div>' +
          '<div class="product__kcal"><b>' + item.kcal + '</b><span>ккал</span></div>' +
        '</div>' +
        '<div class="product__bars">' +
          bar('Белки', item.p, 30, 'pbar--p') +
          bar('Жиры', item.f, 30, 'pbar--f') +
          bar('Углеводы', item.c, 60, 'pbar--c') +
        '</div>' +
        '<div class="product__foot">' +
          '<span class="product__tag"><svg viewBox="0 0 24 24" aria-hidden="true"><use href="#i-check"/></svg>Найдено за ' + (ms / 1000).toFixed(2).replace('.', ',') + ' с</span>' +
          '<span>Добавить в дневник →</span>' +
        '</div>' +
      '</div>';
  }

  function renderEmpty(q) {
    result.classList.add('is-filled');
    result.innerHTML =
      '<div class="product product--nope">' +
        '<div class="product__name">Ничего не нашли по запросу «' + esc(q) + '»</div>' +
        '<div class="product__brand" style="margin-top:8px">В приложении запрос уходит в Open Food Facts и Nutriapix, а затем продукт можно создать вручную.</div>' +
      '</div>';
  }

  var timer = null;
  function run(q) {
    var raw = q.trim();
    if (!raw) {
      result.classList.remove('is-filled');
      result.innerHTML = '<div class="result__empty"><svg viewBox="0 0 24 24" aria-hidden="true"><use href="#i-spark"/></svg><span>Здесь появится карточка продукта с КБЖУ</span></div>';
      return;
    }
    if (/^[0-9\s]{8,14}$/.test(raw)) {
      result.classList.add('is-filled');
      result.innerHTML = '<div class="product product--nope"><div class="product__name">Штрихкод ' + esc(raw.replace(/\s/g, '')) + ' не входит в демо-базу</div>' +
        '<div class="product__brand" style="margin-top:8px">В приложении он уходит в Open Food Facts - и продукт тут же появляется в дневнике.</div></div>';
      return;
    }
    var t0 = performance.now();
    var found = search(raw);
    var ms = Math.max(120, performance.now() - t0 + 180);
    if (found.item) renderProduct(found.item, ms);
    else renderEmpty(raw);
  }

  if (input && result) {
    input.addEventListener('input', function () {
      clearTimeout(timer);
      var v = input.value;
      timer = setTimeout(function () { run(v); }, 420);
    });
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { clearTimeout(timer); run(input.value); }
    });
    if (chips) {
      chips.addEventListener('click', function (e) {
        var b = e.target.closest('button[data-q]');
        if (!b) return;
        input.value = b.dataset.q;
        clearTimeout(timer);
        run(b.dataset.q);
        input.focus();
      });
    }
  }

  /* ---------- камера (ZXing подгружается по требованию) ---------- */
  var camBtn = document.getElementById('camBtn');
  var camReader = null;

  function loadZXing() {
    return new Promise(function (resolve, reject) {
      if (window.ZXing) return resolve(true);
      var s = document.createElement('script');
      s.src = 'https://unpkg.com/@zxing/library@0.21.3/umd/index.min.js';
      s.onload = function () { resolve(true); };
      s.onerror = function () { reject(new Error('network')); };
      document.head.appendChild(s);
      setTimeout(function () { if (!window.ZXing) reject(new Error('timeout')); }, 9000);
    });
  }

  function stopCam() {
    if (camReader) { try { camReader.reset(); } catch (err) {} camReader = null; }
  }

  if (camBtn && result) {
    camBtn.addEventListener('click', function () {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        result.classList.add('is-filled');
        result.innerHTML = '<div class="product product--nope"><div class="product__name">Браузер не даёт доступ к камере</div><div class="product__brand" style="margin-top:8px">Попробуйте поиск по названию - он работает всегда.</div></div>';
        return;
      }
      result.classList.add('is-filled');
      result.innerHTML = '<div class="cam"><video id="camVideo" playsinline muted></video><div class="cam__frame"></div><div class="cam__line"></div>' +
        '<button class="cam__close" id="camClose" type="button" aria-label="Закрыть"><svg viewBox="0 0 24 24" style="width:15px;height:15px"><use href="#i-close"/></svg></button></div>' +
        '<p class="demo__hint" style="margin-top:10px">Наведите на штрихкод. Работает только по HTTPS.</p>';

      var video = document.getElementById('camVideo');
      document.getElementById('camClose').addEventListener('click', function () {
        stopCam();
        if (video && video.srcObject) video.srcObject.getTracks().forEach(function (t) { t.stop(); });
        run(input ? input.value : '');
      });

      function fail(title, note) {
        stopCam();
        if (video && video.srcObject) video.srcObject.getTracks().forEach(function (t) { t.stop(); });
        result.classList.add('is-filled');
        result.innerHTML = '<div class="product product--nope"><div class="product__name">' + title + '</div>' +
          '<div class="product__brand" style="margin-top:8px">' + note + '</div></div>';
      }

      loadZXing().then(function () {
        var reader = new ZXing.BrowserMultiFormatReader();
        camReader = reader;
        return reader.decodeFromVideoDevice(null, video, function (res) {
          if (!res) return;
          stopCam();
          if (video && video.srcObject) video.srcObject.getTracks().forEach(function (t) { t.stop(); });
          var code = res.getText();
          result.classList.add('is-filled');
          result.innerHTML = '<div class="product product--nope"><div class="product__name">Штрихкод ' + esc(code) + '</div>' +
            '<div class="product__brand" style="margin-top:8px">Декодер работает. Такой код не входит в демо-базу - в приложении он уйдёт в Open Food Facts.</div></div>';
        });
      }).catch(function (err) {
        if (window.ZXing) {
          fail('Камера недоступна', 'Браузер не дал доступ или камера занята. Разрешение можно выдать в настройках сайта - а пока попробуйте поиск по названию.');
        } else {
          fail('Не удалось загрузить декодер', 'Похоже, нет сети. В приложении сканер работает офлайн. А здесь попробуйте поиск по названию.');
        }
      });
    });
  }

  /* ---------- faq: плавное закрытие соседей ---------- */
  var items = Array.prototype.slice.call(document.querySelectorAll('.qa'));
  items.forEach(function (el) {
    el.addEventListener('toggle', function () {
      if (el.open) {
        items.forEach(function (o) { if (o !== el) o.open = false; });
      }
    });
  });
})();


/* ---------- согласие, заявка, события, service worker ---------- */
(function () {
  'use strict';
  var CFG = window.BB_CONFIG || {};
  var track = function (name, props) { if (window.bbTrack) window.bbTrack(name, props); };

  /* cookie */
  var banner = document.getElementById('consent');
  var stored = null;
  try { stored = localStorage.getItem('bb_consent'); } catch (e) {}
  if (banner && !stored) {
    banner.hidden = false;
    document.body.classList.add('has-consent');
  }
  function decide(value) {
    if (window.bbConsent) window.bbConsent(value);
    if (banner) banner.hidden = true;
    document.body.classList.remove('has-consent');
    track('consent_' + value);
  }
  var allBtn = document.getElementById('consentAll');
  var minBtn = document.getElementById('consentMin');
  if (allBtn) allBtn.addEventListener('click', function () { decide('all'); });
  if (minBtn) minBtn.addEventListener('click', function () { decide('necessary'); });

  /* вход через Яндекс */
  var loginUrl = CFG.loginUrl || '/app/';
  Array.prototype.forEach.call(document.querySelectorAll('[data-login]'), function (link) {
    link.setAttribute('href', loginUrl);
    link.addEventListener('click', function () { track('login_click'); });
  });

  /* события по секциям и ссылкам */
  var seen = {};
  if ('IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (!en.isIntersecting || seen[en.target.id]) return;
        seen[en.target.id] = true;
        track('view_' + en.target.id);
      });
    }, { threshold: 0.35 });
    ['pricing', 'demo', 'reviews', 'faq'].forEach(function (id) {
      var node = document.getElementById(id);
      if (node) io.observe(node);
    });
  }

  document.addEventListener('click', function (e) {
    var link = e.target.closest('a[href]');
    if (!link) return;
    var href = link.getAttribute('href') || '';
    if (link.hasAttribute('data-lead')) return;
    if (href.indexOf('onboarding/') === 0) track('open_prototype');
    else if (href.indexOf('calculator/') === 0) track('open_calculator');
    else if (href === '#demo') track('click_demo');
    else if (href === '#start') track('click_start');
  });

  /* service worker */
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('/sw.js').catch(function () {});
    });
  }
})();
