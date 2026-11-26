/* BiteBalance - прототип онбординга */
(function () {
  'use strict';

  var CIRC = 439.82;

  var S = {
    step: 1,
    goal: null,
    sex: 'f',
    age: null,
    height: null,
    weight: null,
    act: 1.375,
    manual: null,
    norm: { kcal: 2100, p: 95, f: 65, c: 210 },
    onboarded: false,
    entries: [],
    reminders: [
      { id: 'b', label: 'Завтрак', time: '08:00', on: true },
      { id: 'l', label: 'Обед', time: '13:00', on: true },
      { id: 'd', label: 'Ужин', time: '19:30', on: false }
    ],
    remAsked: false,
    plan: 'free',
    photosUsed: 0,
    photoQuota: 3,
    plusUntil: null,
    timers: []
  };

  var DB = [
    { n: 'Гречка варёная', b: 'Крупы', g: 150, k: 165, p: 6.3, f: 1.7, c: 32.0 },
    { n: 'Овсяные хлопья', b: 'Крупы', g: 80, k: 282, p: 9.8, f: 4.9, c: 49.4 },
    { n: 'Куриная грудка', b: 'Мясо', g: 150, k: 206, p: 44.7, f: 2.7, c: 0.8 },
    { n: 'Творог 5%', b: 'Молочное', g: 200, k: 242, p: 34.0, f: 10.0, c: 6.0 },
    { n: 'Банан', b: 'Фрукты', g: 120, k: 115, p: 1.8, f: 0.2, c: 25.2 },
    { n: 'Кофе с молоком', b: 'Напитки', g: 200, k: 90, p: 4.6, f: 3.2, c: 9.0 },
    { n: 'Рис белый', b: 'Крупы', g: 180, k: 209, p: 4.0, f: 0.9, c: 44.8 },
    { n: 'Яблоко', b: 'Фрукты', g: 150, k: 78, p: 0.6, f: 0.6, c: 20.7 }
  ];

  var PHOTO = { n: 'Гречка варёная', b: 'Распознано по фото', g: 150, k: 132, p: 6.3, f: 1.7, c: 32.0 };
  var SCAN = { n: 'Творог 5%', b: 'Найдено по штрихкоду', g: 200, k: 242, p: 34.0, f: 10.0, c: 6.0 };

  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };

  var el = {
    layer: $('#sheetLayer'),
    sheet: $('#sheet'),
    scrim: $('#scrim'),
    dots: $$('#dots i'),
    back: $('#backBtn'),
    next: $('#nextBtn'),
    steps: $$('.step'),
    goals: $('#goals'),
    sexSeg: $('#sexSeg'),
    age: $('#age'),
    height: $('#height'),
    weight: $('#weight'),
    acts: $('#acts'),
    normPreview: $('#normPreview'),
    bigKcal: $('#bigKcal'),
    bigFill: $('#bigFill'),
    macrosPreview: $('#macrosPreview'),
    editBtn: $('#editBtn'),
    manualBox: $('#manualBox'),
    mKcal: $('#mKcal'),
    mP: $('#mP'),
    mF: $('#mF'),
    mC: $('#mC'),
    meals: $('#meals'),
    ringFill: $('#ringFill'),
    kcalVal: $('#kcalVal'),
    kcalSub: $('#kcalSub'),
    macros: $('#macros'),
    add: $('#addScreen'),
    addBody: $('#addBody'),
    addBack: $('#addBack'),
    toast: $('#toast'),
    reset: $('#resetBtn'),
    normLink: $('#normLink'),
    screen: $('#screen'),
    banner: $('#installBanner'),
    installLayer: $('#installLayer'),
    installScrim: $('#installScrim'),
    installClose: $('#installClose'),
    installDone: $('#installDone'),
    platformSeg: $('#platformSeg'),
    browsers: $('#browsers'),
    gsteps: $('#gsteps'),
    settingsBtn: $('#settingsBtn'),
    fab: $('#fabBtn'),
    addModes: $('#addModes'),
    planBadge: $('#planBadge'),
    setLayer: $('#setLayer'),
    setScrim: $('#setScrim'),
    setClose: $('#setClose'),
    planName: $('#planName'),
    planDesc: $('#planDesc'),
    planCta: $('#planCta'),
    remRow: $('#remRow'),
    remValue: $('#remValue'),
    remLayer: $('#remLayer'),
    remScrim: $('#remScrim'),
    remClose: $('#remClose'),
    remList: $('#remList'),
    remAdd: $('#remAdd'),
    remSave: $('#remSave'),
    askLayer: $('#askLayer'),
    askScrim: $('#askScrim'),
    askYes: $('#askYes'),
    askNo: $('#askNo'),
    askSub: $('#askSub'),
    exportRow: $('#exportRow'),
    exportValue: $('#exportValue'),
    histValue: $('#histValue'),
    payLayer: $('#payLayer'),
    payScrim: $('#payScrim'),
    payClose: $('#payClose'),
    payBody: $('#payBody'),
    payTitle: $('#payTitle'),
    paySub: $('#paySub'),
    payPrice: $('#payPrice'),
    payPer: $('#payPer'),
    payCta: $('#payCta'),
    payToggle: $('#payToggle'),
    payLater: $('#payLater')
  };

  function fmt(n) { return Math.round(n).toLocaleString('ru-RU'); }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

  /** Пустое или нелепое значение — null, верхнего предела достаточно. */
  function numOrNull(input, max) {
    var v = parseFloat(String(input.value).replace(',', '.'));
    if (!isFinite(v) || v <= 0) return null;
    return Math.min(v, max);
  }

  /* ---------- расчёт нормы ---------- */
  function calcNorm() {
    if (S.manual) return S.manual;
    var bmr = 10 * S.weight + 6.25 * S.height - 5 * S.age + (S.sex === 'm' ? 5 : -161);
    var tdee = bmr * S.act;
    var k = S.goal === 'lose' ? 0.85 : S.goal === 'gain' ? 1.1 : 1;
    var kcal = Math.round((tdee * k) / 10) * 10;
    kcal = Math.max(S.sex === 'm' ? 1500 : 1200, kcal);
    var p = Math.round(S.weight * 1.7);
    var f = Math.round(S.weight * 0.9);
    var c = Math.max(0, Math.round((kcal - p * 4 - f * 9) / 4));
    return { kcal: kcal, p: p, f: f, c: c };
  }

  function readInputs() {
    S.age = numOrNull(el.age, 120);
    S.height = numOrNull(el.height, 220);
    S.weight = numOrNull(el.weight, 250);
  }

  /* ---------- шаги шторки ---------- */
  function setStep(n) {
    S.step = n;
    el.steps.forEach(function (s) { s.classList.toggle('is-active', +s.dataset.step === n); });
    el.dots.forEach(function (d, i) { d.classList.toggle('is-on', i < n); });
    el.back.classList.toggle('is-hidden', n === 1);
    el.next.textContent = n === 3 ? 'Готово' : 'Дальше';
    if (n === 2) updatePreview();
    if (n === 3) prepareReview();
    updateNext();
  }

  function updateNext() {
    var ok = true;
    if (S.step === 1) ok = !!S.goal;
    if (S.step === 2) ok = !!(el.age.value && el.height.value && el.weight.value);
    el.next.disabled = !ok;
  }

  function updatePreview() {
    S.manual = null;
    readInputs();
    if (S.age === null || S.height === null || S.weight === null) {
      el.normPreview.textContent = '\u2014';
      return;
    }
    var n = calcNorm();
    el.normPreview.textContent = fmt(n.kcal) + ' ккал';
  }

  function prepareReview() {
    var n = calcNorm();
    el.bigKcal.textContent = fmt(n.kcal);
    el.macrosPreview.innerHTML =
      '<div class="mrow"><span>Белки</span><b>' + n.p + ' г</b></div>' +
      '<div class="mrow"><span>Жиры</span><b>' + n.f + ' г</b></div>' +
      '<div class="mrow"><span>Углеводы</span><b>' + n.c + ' г</b></div>';
    el.mKcal.value = n.kcal;
    el.mP.value = n.p;
    el.mF.value = n.f;
    el.mC.value = n.c;
    el.bigFill.style.strokeDashoffset = CIRC;
    requestAnimationFrame(function () {
      setTimeout(function () { el.bigFill.style.strokeDashoffset = -1.6; }, 60);
    });
  }

  function openSheet() {
    el.layer.classList.add('is-open');
    el.layer.setAttribute('aria-hidden', 'false');
    document.body.classList.add('no-scroll');
    setStep(1);
    if (S.goal) {
      $$('.goal', el.goals).forEach(function (g) { g.classList.toggle('is-on', g.dataset.goal === S.goal); });
    }
  }

  function closeSheet() {
    el.layer.classList.remove('is-open');
    el.layer.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('no-scroll');
  }

  function finishNorm() {
    var n = calcNorm();
    if (S.manual) n = S.manual;
    S.norm = n;
    S.onboarded = true;
    closeSheet();
    renderDiary();
    if (!inst.shown) {
      inst.shown = true;
      setTimeout(showBanner, 500);
      setTimeout(openInstall, 1150);
    } else {
      toast('Норма сохранена');
    }
  }

  /* ---------- дневник ---------- */
  function totals() {
    var t = { kcal: 0, p: 0, f: 0, c: 0 };
    S.entries.forEach(function (e) { t.kcal += e.k; t.p += e.p; t.f += e.f; t.c += e.c; });
    return t;
  }

  function ringTo(eaten) {
    var ratio = Math.min(1, S.norm.kcal ? eaten / S.norm.kcal : 0);
    el.ringFill.style.strokeDashoffset = CIRC * (1 - ratio);
  }

  function initMacros() {
    if (el.macros.dataset.ready) return;
    el.macros.innerHTML =
      '<div class="macro" data-m="p"><div class="macro__row"><span>Белки</span><b>0 / 0 г</b></div><div class="macro__track"><i class="macro__bar macro__bar--p"></i></div></div>' +
      '<div class="macro" data-m="f"><div class="macro__row"><span>Жиры</span><b>0 / 0 г</b></div><div class="macro__track"><i class="macro__bar macro__bar--f"></i></div></div>' +
      '<div class="macro" data-m="c"><div class="macro__row"><span>Углеводы</span><b>0 / 0 г</b></div><div class="macro__track"><i class="macro__bar macro__bar--c"></i></div></div>';
    el.macros.dataset.ready = '1';
  }

  function updateMacros(t) {
    initMacros();
    [['p', t.p, S.norm.p], ['f', t.f, S.norm.f], ['c', t.c, S.norm.c]].forEach(function (row) {
      var box = $('.macro[data-m="' + row[0] + '"]', el.macros);
      if (!box) return;
      var val = row[1], target = row[2] || 1;
      box.querySelector('.macro__row b').textContent =
        (Math.round(val * 10) / 10).toString().replace('.', ',') + ' / ' + target + ' г';
      box.querySelector('.macro__bar').style.width = Math.min(100, (val / target) * 100) + '%';
    });
  }

  function mealName(i) {
    return i < 2 ? 'Завтрак' : i < 4 ? 'Обед' : 'Ужин';
  }

  function renderMeals() {
    if (!S.entries.length) {
      el.meals.innerHTML =
        '<section class="empty">' +
          '<h3>С чего начнём?</h3>' +
          '<p>Запишите первый приём пищи, чтобы увидеть, как считается день</p>' +
          '<div class="tiles">' +
            '<button type="button" data-add-mode="photo"><svg viewBox="0 0 24 24"><path d="M3 8.5A2 2 0 0 1 5 6.5h1.6l1.2-2h7.4l1.2 2H19a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><circle cx="12" cy="12.5" r="3.6"/></svg>Сфотографировать</button>' +
            '<button type="button" data-add-mode="barcode"><svg viewBox="0 0 24 24"><path d="M4 6v12M7.5 6v12M11 6v9M14.5 6v12M18 6v12M20.5 6v12"/></svg>Штрихкод</button>' +
            '<button type="button" data-add-mode="search"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="M16.5 16.5 21 21"/></svg>Найти продукт</button>' +
          '</div>' +
          '<button class="linkbtn" type="button" id="demoDay">Посмотреть на примере дня</button>' +
        '</section>';
      return;
    }

    var groups = {};
    var order = [];
    S.entries.forEach(function (e) {
      var m = e.meal;
      if (!groups[m]) { groups[m] = { items: [], kcal: 0 }; order.push(m); }
      groups[m].items.push(e);
      groups[m].kcal += e.k;
    });

    el.meals.innerHTML = order.map(function (m) {
      var g = groups[m];
      return '<section class="mealcard">' +
        '<div class="mealcard__head"><b>' + m + '</b><span>' + fmt(g.kcal) + ' ккал</span></div>' +
        g.items.map(function (e) {
          return '<div class="mealcard__item"><span>' + e.n +
            '<small>' + e.g + ' г · Б ' + e.p + ' · Ж ' + e.f + ' · У ' + e.c + '</small></span><b>' + fmt(e.k) + '</b></div>';
        }).join('') +
        '</section>';
    }).join('');
  }

  function renderDiary() {
    if (typeof touch === 'function') touch();
    if (el.planBadge) el.planBadge.hidden = S.plan !== 'plus';
    var t = totals();
    el.kcalVal.textContent = fmt(t.kcal);
    el.kcalSub.textContent = 'из ' + fmt(S.norm.kcal) + ' ккал';
    ringTo(t.kcal);
    updateMacros(t);
    renderMeals();
  }

  /* ---------- тост ---------- */
  var toastTimer = null;
  function hideToast() {
    clearTimeout(toastTimer);
    el.toast.classList.remove('is-on');
  }
  function toast(msg) {
    el.toast.textContent = msg;
    el.toast.classList.add('is-on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.toast.classList.remove('is-on'); }, 2300);
  }

  /* ---------- добавление ---------- */
  var pending = [];
  var addState = { mode: 'search', item: null };

  function clearPending() {
    pending.forEach(function (t) { clearTimeout(t); });
    pending = [];
  }

  function later(fn, ms) {
    var id = setTimeout(fn, ms);
    pending.push(id);
    return id;
  }

  function openAdd(mode) {
    if (mode === 'photo' && S.plan !== 'plus' && remainingPhotos() <= 0) {
      if (el.add.classList.contains('is-open')) {
        closeAdd();
        setTimeout(function () { openPaywall('quota'); }, 560);
      } else {
        openPaywall('quota');
      }
      return;
    }
    clearPending();
    addState.item = null;
    el.add.classList.add('is-open');
    el.add.setAttribute('aria-hidden', 'false');
    renderAdd(mode);
  }

  function closeAdd() {
    clearPending();
    el.add.classList.remove('is-open');
    el.add.setAttribute('aria-hidden', 'true');
  }

  function resultCard(item, retryLabel) {
    return '<div class="resultcard">' +
      '<div class="resultcard__top">' +
        '<div><div class="resultcard__name">' + item.n + '</div>' +
        '<div class="resultcard__sub">' + item.g + ' г · Б ' + item.p + ' · Ж ' + item.f + ' · У ' + item.c + '</div></div>' +
        '<div class="resultcard__kcal">' + fmt(item.k) + '<span>ккал</span></div>' +
      '</div>' +
      '<button class="btn-primary" type="button" data-add="1">Добавить в дневник</button>' +
      '<button class="ghost" type="button" data-retry="1">' + retryLabel + '</button>' +
    '</div>';
  }

  function renderAdd(mode) {
    addState.mode = mode;
    addState.item = null;
    if (mode === 'search') {
      el.addBody.innerHTML =
        '<div class="searchfield">' +
          '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="M16.5 16.5 21 21"/></svg>' +
          '<input id="pq" type="text" placeholder="Название продукта" autocomplete="off">' +
        '</div>' +
        '<div class="plist" id="plist">' + DB.map(function (p, i) {
          return '<button class="pitem" type="button" data-i="' + i + '">' +
            '<span class="pitem__txt"><b>' + p.n + '</b><small>' + p.b + ' · ' + p.g + ' г</small></span>' +
            '<span class="pitem__kcal">' + fmt(p.k) + '<span>ккал</span></span>' +
          '</button>';
        }).join('') + '</div>';
      var pq = $('#pq');
      pq.addEventListener('input', function () {
        var q = pq.value.trim().toLowerCase();
        $$('#plist .pitem').forEach(function (b) {
          var item = DB[+b.dataset.i];
          b.style.display = (item.n + ' ' + item.b).toLowerCase().indexOf(q) > -1 ? '' : 'none';
        });
      });
      return;
    }

    $$('button', el.addModes).forEach(function (b) { b.classList.toggle('is-on', b.dataset.mode === mode); });
    var isPhoto = mode === 'photo';
    el.addBody.innerHTML =
      '<div class="capture">' +
        (isPhoto
          ? '<div class="capture__plate"></div>'
          : '<div class="capture__barcode"></div>') +
        '<div class="capture__frame"></div>' +
        '<div class="capture__line"></div>' +
        '<div class="capture__label">' + (isPhoto
          ? 'Снимаем блюдо · ' + (S.plan === 'plus' ? 'без лимита' : 'осталось ' + remainingPhotos())
          : 'Ищем штрихкод') + '</div>' +
      '</div>' +
      '<div class="resultcard" style="opacity:.5"><div class="resultcard__sub">Распознаём…</div></div>';

    later(function () {
      addState.item = isPhoto ? PHOTO : SCAN;
      el.addBody.innerHTML = resultCard(addState.item, isPhoto ? 'Снять ещё раз' : 'Сканировать ещё');
    }, isPhoto ? 1700 : 1400);
  }

  function addItem(item) {
    var idx = S.entries.length;
    S.entries.push({ n: item.n, g: item.g, k: item.k, p: item.p, f: item.f, c: item.c, meal: mealName(idx) });
    closeAdd();
    renderDiary();
    var left = Math.max(0, S.norm.kcal - totals().kcal);
    toast('Записали. Осталось ' + fmt(left) + ' ккал');
    if (!S.remAsked && S.entries.length === 1) {
      S.remAsked = true;
      setTimeout(openAsk, 1200);
    }
  }

  /* ---------- установка на главный экран ---------- */
  var GUIDES = {
    ios: [
      { id: 'safari', name: 'Safari', steps: [
        'Нажмите {dots} внизу справа.',
        'Нажмите «Поделиться».',
        'Нажмите «Показать больше».',
        'Выберите «На экран "Домой"».',
        'Нажмите «Добавить».'
      ] },
      { id: 'chrome', name: 'Chrome', steps: [
        'Нажмите «Поделиться» справа от адресной строки.',
        'Нажмите «Показать больше», если пункт отображается.',
        'Выберите «На экран "Домой"».',
        'Нажмите «Добавить».'
      ] },
      { id: 'yandex', name: 'Яндекс', steps: [
        'Нажмите значок меню внизу справа.',
        'Выберите «Добавить ярлык на телефон».',
        'Нажмите «Добавить на экран "Домой"».',
        'Нажмите «Добавить».'
      ] },
      { id: 'firefox', name: 'Firefox', steps: [
        'Нажмите значок «Поделиться» в адресной строке.',
        'Выберите «На экран "Домой"».',
        'Нажмите «Добавить».'
      ] },
      { id: 'other', name: 'Другие', steps: [
        'Откройте меню браузера.',
        'Найдите «Добавить на главный экран» или «Добавить ярлык».',
        'Подтвердите добавление.'
      ] }
    ],
    android: [
      { id: 'chrome', name: 'Chrome', steps: [
        'Нажмите три точки справа от адресной строки.',
        'Выберите «Добавить на главный экран».',
        'Нажмите «Установить» или «Добавить».'
      ] },
      { id: 'yandex', name: 'Яндекс', steps: [
        'Нажмите три точки внизу справа.',
        'Выберите «Добавить ярлык на телефон».',
        'Нажмите «Добавить».'
      ] },
      { id: 'firefox', name: 'Firefox', steps: [
        'Нажмите три точки в меню браузера.',
        'Выберите «Добавить на главный экран».',
        'Нажмите «Добавить», затем ещё раз, если появится подтверждение.'
      ] },
      { id: 'opera', name: 'Opera', steps: [
        'Откройте меню браузера.',
        'Найдите пункт «Добавить на главный экран».',
        'Подтвердите добавление, если появится запрос.'
      ] },
      { id: 'other', name: 'Другие', steps: [
        'Откройте меню браузера.',
        'Найдите «Добавить на главный экран» или «Добавить ярлык».',
        'Подтвердите добавление.'
      ] }
    ]
  };

  var inst = { platform: 'ios', browser: 'safari', shown: false };

  function boldUi(text) {
    return text.split(/(«[^»]*»|\{dots\})/g).map(function (part) {
      if (part === '{dots}') {
        return '<span class="ui-dots" aria-label="три точки"><svg viewBox="0 0 24 24"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg></span>';
      }
      return part.charAt(0) === '«' ? '<b>' + part + '</b>' : part;
    }).join('');
  }

  function renderGuide() {
    var list = GUIDES[inst.platform];
    if (!list.some(function (g) { return g.id === inst.browser; })) inst.browser = list[0].id;
    var guide = list.filter(function (g) { return g.id === inst.browser; })[0] || list[0];

    $$('button', el.platformSeg).forEach(function (b) {
      b.classList.toggle('is-on', b.dataset.p === inst.platform);
    });

    el.browsers.innerHTML = list.map(function (g) {
      return '<button type="button" data-b="' + g.id + '" class="' + (g.id === guide.id ? 'is-on' : '') + '">' + g.name + '</button>';
    }).join('');

    el.gsteps.innerHTML = guide.steps.map(function (s, i) {
      return '<li><span class="num" aria-hidden="true">' + (i + 1) + '</span><span class="txt">' + boldUi(s) + '</span></li>';
    }).join('');
  }

  function openInstall() {
    renderGuide();
    el.installLayer.classList.add('is-open');
    el.installLayer.setAttribute('aria-hidden', 'false');
  }

  function closeInstall() {
    el.installLayer.classList.remove('is-open');
    el.installLayer.setAttribute('aria-hidden', 'true');
  }

  function showBanner() {
    el.banner.classList.add('is-on');
    el.screen.classList.add('has-banner');
  }

  function hideBanner() {
    el.banner.classList.remove('is-on');
    el.screen.classList.remove('has-banner');
  }

  /* ---------- доступность шторок ---------- */
  function focusSheet(layer) {
    var sheet = layer.querySelector('.sheet');
    if (!sheet) return;
    if (!sheet.hasAttribute('tabindex')) sheet.setAttribute('tabindex', '-1');
    try { sheet.focus({ preventScroll: true }); } catch (err) { sheet.focus(); }
  }

  function activeLayer() {
    var order = ['sheetLayer', 'installLayer', 'setLayer', 'payLayer', 'remLayer', 'askLayer', 'addScreen'];
    for (var i = order.length - 1; i >= 0; i--) {
      var node = document.getElementById(order[i]);
      if (node && node.classList.contains('is-open')) return node;
    }
    return null;
  }

  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Tab') return;
    var layer = activeLayer();
    if (!layer) return;
    var items = Array.prototype.slice
      .call(layer.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])'))
      .filter(function (el) { return el.offsetParent !== null; });
    if (!items.length) return;
    var first = items[0], last = items[items.length - 1];
    if (!layer.contains(document.activeElement)) { e.preventDefault(); first.focus(); return; }
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });

  /* ---------- напоминания ---------- */
  var REM_LIMIT = 3;

  function activeReminders() {
    return S.reminders.filter(function (r) { return r.on; }).length;
  }

  function renderReminders() {
    el.remList.innerHTML = S.reminders.map(function (r) {
      return '<div class="remrow' + (r.on ? '' : ' is-off') + '" data-id="' + r.id + '">' +
        '<button class="switch' + (r.on ? ' is-on' : '') + '" type="button" role="switch" aria-checked="' + (r.on ? 'true' : 'false') + '" data-toggle aria-label="' + r.label + ': ' + (r.on ? 'включено' : 'выключено') + '"></button>' +
        '<span class="remrow__label">' + r.label + (r.custom ? '<small>своё</small>' : '') + '</span>' +
        '<input type="time" value="' + r.time + '" data-time aria-label="Время напоминания">' +
        (r.custom ? '<button class="remrow__del" type="button" data-del aria-label="Удалить">&#10005;</button>' : '') +
      '</div>';
    }).join('');
  }

  function openReminders() {
    hideToast();
    renderReminders();
    el.remLayer.classList.add('is-open');
    el.remLayer.setAttribute('aria-hidden', 'false');
    focusSheet(el.remLayer);
  }

  function closeReminders() {
    el.remLayer.classList.remove('is-open');
    el.remLayer.setAttribute('aria-hidden', 'true');
  }

  function askSuggestion() {
    var h = new Date().getHours();
    if (h < 11) return { label: 'Завтрак', time: '08:00' };
    if (h < 16) return { label: 'Обед', time: '13:30' };
    return { label: 'Ужин', time: '19:30' };
  }

  function openAsk() {
    hideToast();
    var s = askSuggestion();
    $('#askSub').textContent = 'Одно уведомление в ' + s.time + ', если ' + s.label.toLowerCase() + ' ещё не записан';
    $('.ask__title', el.askLayer).textContent = 'Напомнить завтра про ' + s.label.toLowerCase() + '?';
    el.askLayer.dataset.label = s.label;
    el.askLayer.dataset.time = s.time;
    el.askLayer.classList.add('is-open');
    el.askLayer.setAttribute('aria-hidden', 'false');
    focusSheet(el.askLayer);
  }

  function closeAsk() {
    el.askLayer.classList.remove('is-open');
    el.askLayer.setAttribute('aria-hidden', 'true');
  }

  /* ---------- тариф и оплата ---------- */
  var PAY = { mode: 'quota', billing: 'year' };

  var PRICES = {
    year: { price: '1 990 ₽', per: '166 ₽ в месяц · выгода 44%', term: 'в год' },
    month: { price: '299 ₽', per: 'каждый месяц', term: 'в месяц' }
  };

  var PAY_COPY = {
    quota: { title: 'Распознавания на этот месяц закончились', sub: '' },
    feature: { title: 'Экспорт доступен в Plus', sub: 'Выгрузите дневник в CSV или PDF, чтобы показать врачу или диетологу' },
    plan: { title: 'Plus для полного дневника', sub: 'Распознавание без лимита, история без обрезки и отчёты по неделям' }
  };

  function fmtDate(d) {
    var opts = { day: 'numeric', month: 'long' };
    if (d.getFullYear() !== new Date().getFullYear()) opts.year = 'numeric';
    return d.toLocaleDateString('ru-RU', opts);
  }

  function remainingPhotos() {
    return Math.max(0, S.photoQuota - S.photosUsed);
  }

  function renderSettings() {
    var plus = S.plan === 'plus';
    el.planName.textContent = plus ? 'Plus' : 'Free';
    el.planDesc.textContent = plus
      ? 'Активен до ' + fmtDate(S.plusUntil)
      : 'Распознавания: ' + S.photosUsed + ' из ' + S.photoQuota + ' · история 60 дней';
    el.planCta.textContent = plus ? 'Управлять подпиской' : 'Оформить Plus';
    el.exportValue.innerHTML = plus ? 'Скачать &#8250;' : 'Plus &#8250;';
    el.exportValue.classList.toggle('is-locked', !plus);
    el.histValue.textContent = plus ? 'Без ограничений' : '60 дней';
    el.remValue.innerHTML = activeReminders() + ' из ' + S.reminders.length + ' &#8250;';
    el.planBadge.hidden = !plus;
  }

  function openSettings() {
    hideToast();
    renderSettings();
    el.setLayer.classList.add('is-open');
    el.setLayer.setAttribute('aria-hidden', 'false');
    focusSheet(el.setLayer);
  }

  function closeSettings() {
    el.setLayer.classList.remove('is-open');
    el.setLayer.setAttribute('aria-hidden', 'true');
  }

  function renderPay() {
    var copy = PAY_COPY[PAY.mode] || PAY_COPY.plan;
    el.payTitle.textContent = copy.title;
    el.paySub.textContent = copy.sub ||
      (S.photosUsed + ' из ' + S.photoQuota + ' бесплатных распознаваний использовано');
    var pr = PRICES[PAY.billing];
    el.payPrice.textContent = pr.price;
    el.payPer.textContent = pr.per;
    $$('button', el.payToggle).forEach(function (b) {
      b.classList.toggle('is-on', b.dataset.plan === PAY.billing);
    });
  }

  function openPaywall(mode) {
    hideToast();
    PAY.mode = mode;
    closeSettings();
    el.payBody.innerHTML = BASE_PAY_HTML();
    bindPayElements();
    renderPay();
    el.payLayer.classList.add('is-open');
    el.payLayer.setAttribute('aria-hidden', 'false');
    focusSheet(el.payLayer);
  }

  function closePaywall() {
    el.payLayer.classList.remove('is-open');
    el.payLayer.setAttribute('aria-hidden', 'true');
  }

  function bindPayElements() {
    el.payTitle = $('#payTitle');
    el.paySub = $('#paySub');
    el.payPrice = $('#payPrice');
    el.payPer = $('#payPer');
    el.payToggle = $('#payToggle');
    el.payCta = $('#payCta');
    el.payLater = $('#payLater');
  }

  function BASE_PAY_HTML() {
    return '<span class="paymark">Plus</span>' +
      '<h2 class="paytitle" id="payTitle">' + PAY_COPY[PAY.mode].title + '</h2>' +
      '<p class="paysub" id="paySub"></p>' +
      '<ul class="paylist">' +
        '<li>Распознавание блюд без лимита</li>' +
        '<li>История без обрезки</li>' +
        '<li>Тренды и отчёты по неделям</li>' +
        '<li>Экспорт CSV и PDF для врача</li>' +
      '</ul>' +
      '<div class="paytoggle" id="payToggle">' +
        '<button type="button" data-plan="month">Месяц</button>' +
        '<button type="button" data-plan="year">Год</button>' +
      '</div>' +
      '<div class="payprice"><b id="payPrice"></b><span id="payPer"></span></div>' +
      '<button class="btn-primary" id="payCta" type="button">Оформить Plus</button>' +
      '<div class="paymethods"><i>Мир</i><i>СБП</i><i>T-Pay</i></div>' +
      '<button class="paylater" id="payLater" type="button">Позже</button>';
  }

  function startPayment() {
    el.payCta.disabled = true;
    el.payCta.textContent = 'Оформляем подписку…';
    later(function () {
      S.plan = 'plus';
      var d = new Date();
      if (PAY.billing === 'month') d.setMonth(d.getMonth() + 1);
      else d.setFullYear(d.getFullYear() + 1);
      S.plusUntil = d;
      renderSettings();
      var pr = PRICES[PAY.billing];
      el.payBody.innerHTML =
        '<div class="paydone">' +
          '<div class="paydone__ico">&#10003;</div>' +
          '<h2 class="paytitle">Plus активен</h2>' +
          '<p class="paysub">Списание ' + pr.price + ' ' + pr.term + '. Следующее: ' + fmtDate(d) + '.</p>' +
          '<button class="btn-primary" id="payDoneBtn" type="button">Готово</button>' +
          '<p class="payfine">Отменить можно в настройках в любой момент.</p>' +
        '</div>';
      $('#payDoneBtn').addEventListener('click', function () {
        closePaywall();
        renderDiary();
        toast('Plus активен: распознавание без лимита');
      });
    }, 1500);
  }

  /* ---------- события ---------- */
  el.goals.addEventListener('click', function (e) {
    var btn = e.target.closest('.goal');
    if (!btn) return;
    S.goal = btn.dataset.goal;
    $$('.goal', el.goals).forEach(function (g) { g.classList.toggle('is-on', g === btn); });
    updateNext();
  });

  el.sexSeg.addEventListener('click', function (e) {
    var btn = e.target.closest('button');
    if (!btn) return;
    S.sex = btn.dataset.sex;
    $$('button', el.sexSeg).forEach(function (b) { b.classList.toggle('is-on', b === btn); });
    updatePreview();
  });

  el.acts.addEventListener('click', function (e) {
    var btn = e.target.closest('button');
    if (!btn) return;
    S.act = +btn.dataset.act;
    $$('button', el.acts).forEach(function (b) { b.classList.toggle('is-on', b === btn); });
    updatePreview();
  });

  [el.age, el.height, el.weight].forEach(function (inp) {
    inp.addEventListener('input', updatePreview);
    inp.addEventListener('blur', function () {
      if (String(inp.value).trim() === '') { updatePreview(); return; }
      var v = parseFloat(String(inp.value).replace(',', '.'));
      var max = parseFloat(inp.max);
      inp.value = !isFinite(v) || v <= 0 ? '' : (isFinite(max) ? Math.min(v, max) : v);
      updatePreview();
    });
  });

  el.editBtn.addEventListener('click', function () {
    var open = el.manualBox.classList.toggle('is-open');
    el.editBtn.textContent = open ? 'Скрыть ручную настройку' : 'Поправить вручную';
    if (!open) return;
    setTimeout(function () {
      var box = el.manualBox;
      var scroller = box.closest('.sheet-body');
      var smooth = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
      if (scroller) {
        var top = box.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop - 14;
        scroller.scrollTo({ top: top, behavior: smooth });
      } else {
        box.scrollIntoView({ behavior: smooth, block: 'nearest' });
      }
    }, 140);
  });

  [el.mKcal, el.mP, el.mF, el.mC].forEach(function (inp) {
    inp.addEventListener('input', function () {
      var kcal = clamp(+el.mKcal.value || 0, 800, 6000);
      el.mKcal.value = kcal;
      S.manual = {
        kcal: kcal,
        p: clamp(+el.mP.value || 0, 0, 400),
        f: clamp(+el.mF.value || 0, 0, 300),
        c: clamp(+el.mC.value || 0, 0, 700)
      };
      el.bigKcal.textContent = fmt(S.manual.kcal);
    });
  });

  el.next.addEventListener('click', function () {
    if (S.step === 1) { S.manual = null; setStep(2); return; }
    if (S.step === 2) { readInputs(); setStep(3); return; }
    finishNorm();
  });

  el.back.addEventListener('click', function () {
    if (S.step > 1) setStep(S.step - 1);
  });

  el.scrim.addEventListener('click', function () { if (S.onboarded) closeSheet(); });

  el.normLink.addEventListener('click', function () {
    S.manual = null;
    openSheet();
  });

  el.meals.addEventListener('click', function (e) {
    var tile = e.target.closest('[data-add-mode]');
    if (tile) { openAdd(tile.dataset.addMode); return; }
    if (e.target.id === 'demoDay') {
      S.entries = [];
      [{ n: 'Овсяные хлопья', g: 80, k: 296, p: 9.8, f: 4.9, c: 49.4, meal: 'Завтрак' },
       { n: 'Кофе с молоком', g: 200, k: 90, p: 4.6, f: 3.2, c: 9.0, meal: 'Завтрак' },
       { n: 'Куриная грудка', g: 150, k: 248, p: 46.5, f: 5.4, c: 0.5, meal: 'Обед' }
      ].forEach(function (x) { S.entries.push(x); });
      renderDiary();
      toast('Так выглядит обычный день');
    }
  });

  el.addBody.addEventListener('click', function (e) {
    var item = e.target.closest('[data-i]');
    if (item) { addItem(DB[+item.dataset.i]); return; }
    if (e.target.closest('[data-add]') && addState.item) {
      if (addState.mode === 'photo' && S.plan !== 'plus') S.photosUsed++;
      addItem(addState.item);
      return;
    }
    if (e.target.closest('[data-retry]')) { renderAdd(addState.mode); return; }
  });

  el.addBack.addEventListener('click', closeAdd);
  el.fab.addEventListener('click', function () { openAdd('search'); });
  el.addModes.addEventListener('click', function (e) {
    var b = e.target.closest('button[data-mode]');
    if (!b) return;
    if (b.dataset.mode === addState.mode && addState.mode !== 'search') return;
    openAdd(b.dataset.mode);
  });

  el.settingsBtn.addEventListener('click', openSettings);
  el.remRow.addEventListener('click', function () { closeSettings(); setTimeout(openReminders, 120); });
  el.remClose.addEventListener('click', closeReminders);
  el.remScrim.addEventListener('click', closeReminders);

  el.remList.addEventListener('click', function (e) {
    var row = e.target.closest('.remrow');
    if (!row) return;
    var id = row.dataset.id;
    var r = S.reminders.filter(function (x) { return x.id === id; })[0];
    if (!r) return;
    if (e.target.closest('[data-toggle]')) { r.on = !r.on; renderReminders(); return; }
    if (e.target.closest('[data-del]')) {
      S.reminders = S.reminders.filter(function (x) { return x.id !== id; });
      renderReminders();
      toast('Напоминание удалено');
    }
  });

  el.remList.addEventListener('input', function (e) {
    var inp = e.target.closest('input[data-time]');
    if (!inp) return;
    var row = inp.closest('.remrow');
    var r = S.reminders.filter(function (x) { return x.id === row.dataset.id; })[0];
    if (r && inp.value) r.time = inp.value;
  });

  el.remAdd.addEventListener('click', function () {
    if (S.reminders.length >= REM_LIMIT) { toast('На Free до трёх напоминаний'); return; }
    S.reminders.push({ id: 'c' + Date.now(), label: 'Своё', time: '15:00', on: true, custom: true });
    renderReminders();
  });

  el.remSave.addEventListener('click', function () {
    closeReminders();
    renderSettings();
    toast('Напоминания сохранены');
  });

  el.askYes.addEventListener('click', function () {
    var label = el.askLayer.dataset.label;
    var time = el.askLayer.dataset.time;
    S.reminders.forEach(function (r) {
      if (r.label === label) { r.on = true; r.time = time; }
    });
    closeAsk();
    toast('Напомним в ' + time + ', если день не заполнен');
  });

  el.askNo.addEventListener('click', closeAsk);
  el.askScrim.addEventListener('click', closeAsk);
  el.setClose.addEventListener('click', closeSettings);
  el.setScrim.addEventListener('click', closeSettings);
  el.payClose.addEventListener('click', closePaywall);
  el.payScrim.addEventListener('click', closePaywall);

  el.planCta.addEventListener('click', function () {
    if (S.plan === 'plus') { toast('Подписка активна до ' + fmtDate(S.plusUntil)); return; }
    openPaywall('plan');
  });

  el.exportRow.addEventListener('click', function () {
    if (S.plan === 'plus') { toast('Готовим CSV, файл придёт на почту'); return; }
    openPaywall('feature');
  });

  el.payLayer.addEventListener('click', function (e) {
    var toggle = e.target.closest('[data-plan]');
    if (toggle) { PAY.billing = toggle.dataset.plan; renderPay(); return; }
    if (e.target.closest('#payCta')) { startPayment(); return; }
    if (e.target.closest('#payLater')) { closePaywall(); return; }
  });

  el.banner.addEventListener('click', openInstall);
  el.installClose.addEventListener('click', closeInstall);
  el.installDone.addEventListener('click', closeInstall);
  el.installScrim.addEventListener('click', closeInstall);

  el.platformSeg.addEventListener('click', function (e) {
    var b = e.target.closest('button[data-p]');
    if (!b) return;
    inst.platform = b.dataset.p;
    inst.browser = GUIDES[inst.platform][0].id;
    renderGuide();
  });

  el.browsers.addEventListener('click', function (e) {
    var b = e.target.closest('button[data-b]');
    if (!b) return;
    inst.browser = b.dataset.b;
    renderGuide();
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      if (el.add.classList.contains('is-open')) closeAdd();
      else if (el.askLayer.classList.contains('is-open')) closeAsk();
      else if (el.remLayer.classList.contains('is-open')) closeReminders();
      else if (el.payLayer.classList.contains('is-open')) closePaywall();
      else if (el.setLayer.classList.contains('is-open')) closeSettings();
      else if (el.installLayer.classList.contains('is-open')) closeInstall();
      else if (el.layer.classList.contains('is-open') && S.onboarded) closeSheet();
    }
  });

  el.reset.addEventListener('click', function () {
    clearPending();
    S.step = 1; S.goal = null; S.sex = 'f'; S.age = null; S.height = null; S.weight = null;
    S.act = 1.375; S.manual = null; S.norm = { kcal: 2100, p: 95, f: 65, c: 210 };
    S.onboarded = false; S.entries = [];
    el.age.value = ''; el.height.value = ''; el.weight.value = '';
    $$('.goal', el.goals).forEach(function (g) { g.classList.remove('is-on'); });
    $$('button', el.sexSeg).forEach(function (b, i) { b.classList.toggle('is-on', i === 0); });
    $$('button', el.acts).forEach(function (b, i) { b.classList.toggle('is-on', i === 1); });
    el.manualBox.classList.remove('is-open');
    el.editBtn.textContent = 'Поправить вручную';
    inst.shown = false;
    inst.platform = 'ios';
    inst.browser = 'safari';
    S.plan = 'free';
    S.photosUsed = 0;
    S.remAsked = false;
    S.reminders = [
      { id: 'b', label: 'Завтрак', time: '08:00', on: true },
      { id: 'l', label: 'Обед', time: '13:00', on: true },
      { id: 'd', label: 'Ужин', time: '19:30', on: false }
    ];
    closeAsk();
    closeReminders();
    try { localStorage.removeItem(STORE); } catch (e) {}
    S.plusUntil = null;
    PAY.billing = 'year';
    el.planBadge.hidden = true;
    closePaywall();
    closeSettings();
    closeInstall();
    hideBanner();
    closeAdd();
    closeSheet();
    renderDiary();
    setTimeout(openSheet, 650);
  });

  /* ---------- сохранение состояния демо ---------- */
  var STORE = 'bb_demo_v1';

  function saveState() {
    try {
      localStorage.setItem(STORE, JSON.stringify({
        plan: S.plan,
        photosUsed: S.photosUsed,
        plusUntil: S.plusUntil ? S.plusUntil.toISOString() : null,
        reminders: S.reminders,
        remAsked: S.remAsked,
        onboarded: S.onboarded,
        goal: S.goal, sex: S.sex, age: S.age, height: S.height, weight: S.weight, act: S.act,
        norm: S.norm,
        entries: S.entries,
        installShown: inst.shown
      }));
    } catch (e) {}
  }

  function loadState() {
    var raw = null;
    try { raw = localStorage.getItem(STORE); } catch (e) {}
    if (!raw) return false;
    try {
      var d = JSON.parse(raw);
      S.plan = d.plan || 'free';
      S.photosUsed = d.photosUsed || 0;
      S.plusUntil = d.plusUntil ? new Date(d.plusUntil) : null;
      if (Array.isArray(d.reminders) && d.reminders.length) S.reminders = d.reminders;
      S.remAsked = !!d.remAsked;
      S.onboarded = !!d.onboarded;
      S.goal = d.goal || null;
      S.sex = d.sex || 'f';
      S.age = d.age || 29;
      S.height = d.height || 168;
      S.weight = d.weight || 62;
      S.act = d.act || 1.375;
      if (d.norm) S.norm = d.norm;
      if (Array.isArray(d.entries)) S.entries = d.entries;
      inst.shown = !!d.installShown;
      el.age.value = S.age === null || S.age === undefined ? '' : S.age;
      el.height.value = S.height === null || S.height === undefined ? '' : S.height;
      el.weight.value = S.weight === null || S.weight === undefined ? '' : S.weight;
      return true;
    } catch (e) { return false; }
  }

  function clearState() {
    try { localStorage.removeItem(STORE); } catch (e) {}
  }

  var stateDirty = false;
  function touch() { stateDirty = true; }
  setInterval(function () { if (stateDirty) { stateDirty = false; saveState(); } }, 600);

  /* ---------- старт ---------- */
  var restored = loadState();
  if (!restored) { inst.shown = false; }
  renderDiary();
  setTimeout(function () { el.ringFill.style.strokeDashoffset = CIRC * (1 - Math.min(1, totals().kcal / (S.norm.kcal || 1))); }, 50);
  if (!S.onboarded) {
    setTimeout(openSheet, 900);
  } else {
    showBanner();
  }
})();
