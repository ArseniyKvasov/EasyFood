(function () {
  'use strict';
  var S = { sex: 'f', age: 29, height: 168, weight: 62, act: 1.375, goal: 'keep' };
  var el = {
    kcal: document.getElementById('kcal'),
    p: document.getElementById('p'),
    f: document.getElementById('f'),
    c: document.getElementById('c'),
    note: document.getElementById('note'),
    age: document.getElementById('age'),
    height: document.getElementById('height'),
    weight: document.getElementById('weight')
  };

  function fmt(n) { return Math.round(n).toLocaleString('ru-RU'); }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

  function calc() {
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

  function render() {
    var r = calc();
    el.kcal.textContent = fmt(r.kcal);
    el.p.textContent = r.p + ' г';
    el.f.textContent = r.f + ' г';
    el.c.textContent = r.c + ' г';
    var goalText = S.goal === 'lose' ? 'мягкого дефицита' : S.goal === 'gain' ? 'небольшого профицита' : 'поддержания веса';
    el.note.textContent = 'Расчёт для ' + goalText + ' при выбранной активности. Это оценка, а не медицинская рекомендация.';
  }

  function readInputs() {
    S.age = clamp(+el.age.value || 29, 14, 90);
    S.height = clamp(+el.height.value || 168, 120, 220);
    S.weight = clamp(+el.weight.value || 62, 30, 250);
  }

  document.getElementById('sex').addEventListener('click', function (e) {
    var b = e.target.closest('button[data-sex]');
    if (!b) return;
    S.sex = b.dataset.sex;
    Array.prototype.forEach.call(this.querySelectorAll('button'), function (x) { x.classList.toggle('is-on', x === b); });
    render();
    if (window.bbTrack) window.bbTrack('calc_change', { field: 'sex' });
  });

  document.getElementById('activity').addEventListener('click', function (e) {
    var b = e.target.closest('button[data-act]');
    if (!b) return;
    S.act = +b.dataset.act;
    Array.prototype.forEach.call(this.querySelectorAll('button'), function (x) { x.classList.toggle('is-on', x === b); });
    render();
    if (window.bbTrack) window.bbTrack('calc_change', { field: 'activity' });
  });

  document.getElementById('goal').addEventListener('click', function (e) {
    var b = e.target.closest('button[data-goal]');
    if (!b) return;
    S.goal = b.dataset.goal;
    Array.prototype.forEach.call(this.querySelectorAll('button'), function (x) { x.classList.toggle('is-on', x === b); });
    render();
    if (window.bbTrack) window.bbTrack('calc_change', { field: 'goal' });
  });

  [el.age, el.height, el.weight].forEach(function (inp) {
    inp.addEventListener('input', function () { readInputs(); render(); });
    inp.addEventListener('blur', function () {
      if (!inp.value) inp.value = inp.defaultValue;
      inp.value = clamp(+inp.value, +inp.min, +inp.max);
      readInputs();
      render();
    });
  });

  var yearEl = document.getElementById('year');
  if (yearEl) yearEl.textContent = new Date().getFullYear();

  document.getElementById('leadBtn').addEventListener('click', function () {
    if (window.bbTrack) window.bbTrack('calc_lead');
    location.href = '../index.html#start';
  });

  if (window.bbTrack) window.bbTrack('view_calculator');
  render();
})();
