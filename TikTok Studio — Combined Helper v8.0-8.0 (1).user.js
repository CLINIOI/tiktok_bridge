// ==UserScript==
// @name         TikTok Studio — Combined Helper v8.0
// @namespace    https://tampermonkey.net/
// @version      8.0
// @description  Панель TikTok Studio. Одиночная публикация + пакетная загрузка в одном окне.
// @author       FANTOM + merged + batch queue v8
// @match        https://www.tiktok.com/*
// @match        https://studio.tiktok.com/*
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @connect      127.0.0.1
// @run-at       document-idle
// ==/UserScript==

(function () {
'use strict';

const BRIDGE      = 'http://127.0.0.1:8765';
const TOKEN       = '1224444';
const PANEL_ID    = 'tt-helper-panel';
const STORAGE_KEY = 'tt_helper_last_input';
const BATCH_STORAGE_KEY = 'tt_helper_batch_input';
const TIMINGS_KEY = 'tt_helper_timings';
const LOG_PREFIX  = '[TT v8]';

const DEFAULT_TIMINGS = {
  posleZagruzki:       3000,
  posleZapolneniya:    2000,
  poslePereklucheniya: 3500,
  posleDaty:           900,
  posleVremeni:        700,
  mezhduPovtorami:     500,
  dostupElemeta:       1200,
  posleNavigacii:      1500,
  poslePublikacii:     5000,
  ozhidanieStranici:   8000,
};
const TIMING_LABELS = {
  posleZagruzki:       'После старта загрузки видео (мс)',
  posleZapolneniya:    'После вставки текста (мс)',
  poslePereklucheniya: 'Ожидание появления пикеров (мс)',
  posleDaty:           'Пауза после установки даты (мс)',
  posleVremeni:        'Пауза после установки времени (мс)',
  mezhduPovtorami:     'Интервал поиска input[file] (мс)',
  dostupElemeta:       'Ожидание инициализации (мс)',
  posleNavigacii:      'Ожидание после смены URL (мс)',
  poslePublikacii:     '[BATCH] Пауза после публикации (мс)',
  ozhidanieStranici:   '[BATCH] Ожидание загрузки страницы (мс)',
};
let TIMINGS = Object.assign({}, DEFAULT_TIMINGS);
let parsed  = { path:'', tags:'', date:'', caption:'' };

/* ──────── BATCH STATE ──────────────────────────────────────── */
let batchQueue   = [];
let batchIndex   = 0;
let batchRunning = false;
let batchStopped = false;

/* ─── УТИЛИТЫ ───────────────────────────────────────────────── */
const sleep = ms => new Promise(r => setTimeout(r, Number(ms)||0));

function log(...args) {
  console.log(LOG_PREFIX, ...args);
  const t = new Date().toLocaleTimeString();
  const msg = args.map(x=>typeof x==='string'?x:JSON.stringify(x)).join(' ');
  const html = '<span style="color:#1a4040">['+t+']</span> <span style="color:#4a8080">'+escapeHtml(msg)+'</span>';
  ['tt-log','tt-batch-log'].forEach(id=>{
    const box = document.getElementById(id);
    if (!box) return;
    const d = document.createElement('div');
    d.innerHTML = html;
    box.appendChild(d);
    box.scrollTop = box.scrollHeight;
  });
}
function escapeHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
function storageGet(key, fb) {
  try { if (typeof GM_getValue==='function') return GM_getValue(key, fb); } catch(_){}
  try { return localStorage.getItem(key)||fb; } catch(_){ return fb; }
}
function storageSet(key, val) {
  try { if (typeof GM_setValue==='function'){ GM_setValue(key, val); return; } } catch(_){}
  try { localStorage.setItem(key, val); } catch(_){}
}
function loadTimings() {
  try {
    const raw = storageGet(TIMINGS_KEY,'');
    if (raw) { const s=JSON.parse(raw); Object.keys(DEFAULT_TIMINGS).forEach(k=>{ if(typeof s[k]==='number') TIMINGS[k]=s[k]; }); }
  } catch(_){}
}
function shouldRun() {
  const h = location.href;
  return h.includes('tiktokstudio')||h.includes('studio.tiktok.com')||h.includes('/upload');
}
function setStatus(type, text) {
  const el = document.getElementById('tt-status');
  if (el) { el.textContent=text; el.className='status-box tt-'+type; }
  const el2 = document.getElementById('tt-batch-status');
  if (el2) { el2.textContent=text; el2.className='status-box tt-'+type; }
}
function setBridge(type, text) {
  const bar = document.getElementById('tt-bridge');
  const txt = document.getElementById('tt-bridge-txt');
  if (!bar) return;
  bar.className = 'bridge-bar' + (type==='ok' ? ' ok' : type==='err' ? ' err' : '');
  if (txt) txt.textContent = text;
}
function setButtonsBusy(busy) {
  ['tt-parse','tt-fill','tt-schedule','tt-upload','tt-all','tt-batch-start'].forEach(id=>{
    const b=document.getElementById(id); if(b) b.disabled=busy;
  });
}

/* ─── ПАРСИНГ ───────────────────────────────────────────────── */
function parseInputLine(line) {
  const out = {path:'',tags:'',date:'',caption:''};
  if (line.includes('=')) {
    line.split('|').forEach(part=>{
      const idx=part.indexOf('='); if(idx<0) return;
      const k=part.slice(0,idx).trim().toLowerCase(), v=part.slice(idx+1).trim();
      if (k in out) out[k]=v;
    });
  } else {
    const p=line.split('|').map(s=>s.trim());
    out.path=p[0]||''; out.tags=p[1]||''; out.date=p[2]||''; out.caption=p[3]||'';
  }
  // Если caption не задан — берём имя файла без расширения из path
  if (!out.caption && out.path) {
    const fname = out.path.replace(/\\/g,'/').split('/').pop() || '';
    out.caption = fname.replace(/\.[^.]+$/, ''); // убираем расширение (.mov, .mp4 и т.д.)
  }
  return out;
}
function doParse() {
  const raw=(document.getElementById('tt-input')||{}).value||'';
  if (!raw.trim()) { setStatus('err','Введите строку!'); return false; }
  parsed = parseInputLine(raw.trim());
  const el = document.getElementById('tt-parsed');
  if (el) {
    const v=x=>x?'<span class="pval">'+escapeHtml(x)+'</span>':'<span class="pempty">—</span>';
    el.innerHTML='<b>path:</b> '+v(parsed.path)+'<br><b>tags:</b> '+v(parsed.tags)+'<br><b>date:</b> '+v(parsed.date)+'<br><b>caption:</b> '+v(parsed.caption);
  }
  setStatus('ok','✅ Разобрано.'); log('parsed',parsed); return true;
}


/* ─── BATCH: ПАРСИНГ ВСЕХ СТРОК ─────────────────────────────── */
function parseAllLines() {
  const raw = (document.getElementById('tt-batch-input')||{}).value||'';
  const lines = raw.split('\n').map(l=>l.trim()).filter(l=>l.length>0);
  if (lines.length === 0) { setStatus('err','Введите хотя бы одну строку!'); return false; }
  batchQueue = lines.map(parseInputLine);
  batchIndex = 0;
  renderBatchQueue();
  setStatus('ok', '✅ Разобрано ' + batchQueue.length + ' видео в очереди.');
  log('parseAllLines: ' + batchQueue.length + ' items');
  return true;
}

function updateParsedDisplay() {
  const el = document.getElementById('tt-parsed');
  if (el) {
    const v=x=>x?'<span class="pval">'+escapeHtml(x)+'</span>':'<span class="pempty">—</span>';
    el.innerHTML='<b>path:</b> '+v(parsed.path)+'<br><b>tags:</b> '+v(parsed.tags)+'<br><b>date:</b> '+v(parsed.date)+'<br><b>caption:</b> '+v(parsed.caption);
  }
}

function renderBatchQueue() {
  const el = document.getElementById('tt-queue-list');
  if (!el) return;
  if (batchQueue.length === 0) {
    el.innerHTML = '<div class="batch-empty">Очередь пуста. Введите несколько строк выше.</div>';
    return;
  }
  el.innerHTML = batchQueue.map((item, i) => {
    let icon = '⏳', cls = 'queue-pending';
    if (i < batchIndex)                        { icon = '✅'; cls = 'queue-done'; }
    else if (i === batchIndex && batchRunning) { icon = '▶'; cls = 'queue-active'; }
    const fname = (item.path||'').replace(/\\/g,'/').split('/').pop() || '(нет пути)';
    return '<div class="queue-item '+cls+'">'
      + '<span class="queue-icon">'+icon+'</span>'
      + '<span class="queue-name" title="'+escapeHtml(item.path||'')+'">'+escapeHtml(fname)+'</span>'
      + '<span class="queue-date">'+escapeHtml(item.date||'')+'</span>'
      + '</div>';
  }).join('');
}

/* ─── ВСТАВКА ТЕКСТА ────────────────────────────────────────── */
/* Симулирует реальный ввод символов через KeyboardEvent + InputEvent */
/* ─── ВСТАВКА ТЕКСТА: надёжные методы для TikTok Studio ─── */

/* Метод A: React Fiber — напрямую дёргаем onChange через внутренний fiber */
function fillViaReactFiber(editor, text) {
  try {
    // Ищем React fiber на элементе или его дочерних узлах
    const fiberKey = Object.keys(editor).find(k => k.startsWith('__reactFiber') || k.startsWith('__reactInternalInstance'));
    if (!fiberKey) return false;
    let fiber = editor[fiberKey];
    // Ищем stateNode с props.onChange вверх по дереву fiber
    let node = fiber;
    for (let i = 0; i < 30 && node; i++) {
      const props = node.memoizedProps || node.pendingProps;
      if (props && typeof props.onChange === 'function') {
        // Создаём синтетический event как ожидает React
        const fakeEvent = { target: { value: text }, currentTarget: { value: text },
          preventDefault(){}, stopPropagation(){}, nativeEvent: {}, bubbles: true };
        props.onChange(fakeEvent);
        log('fillViaReactFiber: onChange called OK');
        return true;
      }
      node = node.return;
    }
    log('fillViaReactFiber: no onChange found in fiber tree');
    return false;
  } catch(e) { log('fillViaReactFiber err:', e.message); return false; }
}

/* Метод B: nativeInputValueSetter — обходит React для обычных input/textarea */
function fillViaNativeSetter(el, text) {
  try {
    const proto = Object.getPrototypeOf(el);
    const desc = Object.getOwnPropertyDescriptor(proto, 'value');
    if (desc && desc.set) {
      desc.set.call(el, text);
      el.dispatchEvent(new Event('input',  {bubbles:true}));
      el.dispatchEvent(new Event('change', {bubbles:true}));
      log('fillViaNativeSetter: OK');
      return true;
    }
    return false;
  } catch(e) { log('fillViaNativeSetter err:', e.message); return false; }
}

/* Метод C: ClipboardEvent paste — работает с Draft.js если он слушает paste */
async function fillViaPaste(editor, text) {
  try {
    editor.focus();
    await sleep(60);
    // Выделяем всё чтобы заменить
    document.execCommand('selectAll', false, null);
    await sleep(30);
    const dt = new DataTransfer();
    dt.setData('text/plain', text);
    editor.dispatchEvent(new ClipboardEvent('paste', {bubbles:true, cancelable:true, clipboardData:dt}));
    await sleep(100);
    return true;
  } catch(e) { log('fillViaPaste err:', e.message); return false; }
}

/* Метод D: прямая запись в DOM + React fiber update */
async function fillViaDOMWrite(editor, text) {
  try {
    editor.focus();
    await sleep(60);
    // Напрямую пишем в innerText (обходит все события)
    editor.innerText = text;
    // Уведомляем React что DOM изменился
    editor.dispatchEvent(new Event('input',  {bubbles:true}));
    editor.dispatchEvent(new Event('change', {bubbles:true}));
    editor.dispatchEvent(new InputEvent('input', {bubbles:true, inputType:'insertText', data:text}));
    await sleep(60);
    log('fillViaDOMWrite: OK');
    return true;
  } catch(e) { log('fillViaDOMWrite err:', e.message); return false; }
}

/* Главная функция вставки — пробует все методы по очереди */
async function insertIntoEditor(editor, text) {
  if (!editor || !text) return false;
  editor.focus();
  await sleep(100);

  // Выделяем всё содержимое перед вставкой
  try {
    const sel = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(editor);
    sel.removeAllRanges();
    sel.addRange(range);
  } catch(_) {}
  await sleep(40);

  // 1. React Fiber onChange (самый прямой путь)
  if (fillViaReactFiber(editor, text)) {
    await sleep(80);
    if (editor.textContent.replace(/\u200B/g,'').trim().length > 0) return true;
    log('fiber: onChange called but text empty, continue...');
  }

  // 2. ClipboardEvent paste
  await fillViaPaste(editor, text);
  await sleep(80);
  if (editor.textContent.replace(/\u200B/g,'').trim().length > 0) {
    log('insertIntoEditor: paste OK');
    return true;
  }
  log('paste: text still empty, continue...');

  // 3. InputEvent beforeinput (Draft.js слушает этот ивент)
  try {
    editor.dispatchEvent(new InputEvent('beforeinput', {
      bubbles:true, cancelable:true, inputType:'insertText', data:text,
    }));
    await sleep(40);
    editor.dispatchEvent(new InputEvent('input', {
      bubbles:true, cancelable:true, inputType:'insertText', data:text,
    }));
    await sleep(80);
    if (editor.textContent.replace(/\u200B/g,'').trim().length > 0) {
      log('insertIntoEditor: InputEvent OK');
      return true;
    }
    log('InputEvent: text still empty, continue...');
  } catch(e) { log('InputEvent err:', e.message); }

  // 4. Прямая запись в DOM (грубо, но работает как last resort)
  await fillViaDOMWrite(editor, text);
  await sleep(80);
  if (editor.textContent.replace(/\u200B/g,'').trim().length > 0) {
    log('insertIntoEditor: DOMWrite OK');
    return true;
  }

  // 5. execCommand (устаревший)
  try {
    editor.focus();
    document.execCommand('selectAll', false, null);
    if (document.execCommand('insertText', false, text)) {
      log('insertIntoEditor: execCommand OK');
      return true;
    }
  } catch(e) { log('execCommand err:', e.message); }

  log('insertIntoEditor: ALL methods failed');
  return false;
}

/* Ждёт появления редакторов (до 8 сек) */
async function waitForEditors() {
  for (let i = 0; i < 40; i++) {
    const eds = Array.from(document.querySelectorAll(
      '.public-DraftEditor-content, div[contenteditable=true]'
    )).filter(e => { const r=e.getBoundingClientRect(); return r.width>50 && r.height>10; });
    if (eds.length > 0) return eds;
    await sleep(200);
  }
  return [];
}

/* Выводит в лог все найденные редакторы — помогает при отладке */
function debugEditors() {
  const eds = Array.from(document.querySelectorAll(
    '.public-DraftEditor-content, div[contenteditable=true]'
  )).filter(e => e.getBoundingClientRect().width > 50);
  log('=== DEBUG: editors found: ' + eds.length + ' ===');
  eds.forEach((ed, i) => {
    const r = ed.getBoundingClientRect();
    const ph = ed.getAttribute('placeholder') || '—';
    let parents = [];
    let cur = ed.parentElement;
    for (let d=0; d<5 && cur; d++, cur=cur.parentElement) {
      const c = (cur.className||'').substring(0,50);
      const t = (cur.getAttribute?.('data-testid') || '');
      if (c||t) parents.push((t?'['+t+'] ':'')+c);
    }
    const fiberKey = Object.keys(ed).find(k=>k.startsWith('__reactFiber')||k.startsWith('__reactInternalInstance'));
    log('['+i+'] ph="'+ph+'" '+Math.round(r.width)+'x'+Math.round(r.height)+' top='+Math.round(r.top)+' fiber='+(fiberKey?'YES':'NO'));
    log('    cls: '+ed.className.substring(0,80));
    log('    parents: '+parents.join(' > '));
    log('    text: "'+ed.textContent.replace(/\u200B/g,'').substring(0,50)+'"');
  });
  log('=== END DEBUG ===');
  setStatus('info', 'Редакторов: '+eds.length+'. Смотри лог ↓');
}

async function doFill() {
  if (!parsed.caption && !parsed.tags) { if (!doParse()) return; }
  if (!parsed.caption && !parsed.tags) { setStatus('warn','Нет текста.'); return; }

  const editors = await waitForEditors();
  if (editors.length === 0) { setStatus('warn','Редактор не найден. Нажми 🔍 Debug.'); return; }

  // Сортируем по вертикальной позиции (сверху вниз)
  const sorted = editors.slice().sort((a,b) =>
    a.getBoundingClientRect().top - b.getBoundingClientRect().top
  );

  log('editors: ' + sorted.length);

  let captionEditor = null;
  let tagsEditor    = null;

  for (const ed of sorted) {
    const ph = (ed.getAttribute('placeholder') || '').toLowerCase();
    let domHint = '';
    let cur = ed; let depth = 0;
    while (cur && depth < 8) {
      const cls = (cur.className || '').toLowerCase();
      const tid = (cur.getAttribute?.('data-testid') || '').toLowerCase();
      if (cls.includes('hashtag') || tid.includes('hashtag') || cls.includes('-tag') || tid.includes('tag')) { domHint='tags'; break; }
      if (cls.includes('caption') || tid.includes('caption') || cls.includes('description') || tid.includes('description')) { domHint='caption'; break; }
      cur = cur.parentElement; depth++;
    }
    const isTagsField    = domHint==='tags'    || ph.includes('hashtag') || ph.includes('tag') || ph.includes('хештег') || ph.includes('теги');
    const isCaptionField = domHint==='caption' || ph.includes('caption') || ph.includes('description') || ph.includes('описани') || ph.includes('подпис');

    if      (!captionEditor && isCaptionField) { captionEditor = ed; log('caption: by hint "'+domHint+'/'+ph+'"'); }
    else if (!tagsEditor    && isTagsField)    { tagsEditor    = ed; log('tags:    by hint "'+domHint+'/'+ph+'"'); }
  }

  if (!captionEditor) { captionEditor = sorted[0]; log('caption: fallback [0]'); }
  if (!tagsEditor && sorted.length > 1) { tagsEditor = sorted[1]; log('tags: fallback [1]'); }

  let filledCaption = false;
  let filledTags    = false;

  if (parsed.caption && captionEditor) {
    filledCaption = await insertIntoEditor(captionEditor, parsed.caption);
    await sleep(250);
  }

  if (parsed.tags) {
    if (tagsEditor) {
      filledTags = await insertIntoEditor(tagsEditor, parsed.tags);
    } else {
      log('no tagsEditor — appending tags to caption');
      const combined = [parsed.caption, parsed.tags].filter(Boolean).join(' ');
      filledCaption = await insertIntoEditor(captionEditor || sorted[0], combined);
      filledTags = filledCaption;
    }
  }

  const ok = filledCaption || filledTags;
  setStatus(ok ? 'ok' : 'err', ok ? '✅ Описание вставлено.' : '❌ Не удалось. Нажми 🔍 Debug.');
  log('fill done, caption='+filledCaption+' tags='+filledTags);
}

/* ══════════════════════════════════════════════════════════════
   ОРИГИНАЛЬНЫЙ КОД SCHEDULER v4 — работает через клики по
   внутренним элементам TikTok пикеров. Это единственный способ
   который реально работает т.к. TikTok readonly инпуты не
   принимают значения напрямую.
══════════════════════════════════════════════════════════════ */

function realClick(el) {
  el.dispatchEvent(new MouseEvent('mousedown', {bubbles:true, cancelable:true}));
  el.dispatchEvent(new MouseEvent('mouseup',   {bubbles:true, cancelable:true}));
  el.dispatchEvent(new MouseEvent('click',     {bubbles:true, cancelable:true}));
}

function roundMinutes(mm) { return Math.round(mm/5)*5%60; }

/* Кликает по элементу TikTok чтобы открыть пикер, потом кликает нужное значение */
function applyTime(hh, mm) {
  const tp = document.querySelector('.tiktok-timepicker-time-picker-container');
  if (!tp) { log('timepicker NOT FOUND'); return false; }
  tp.style.removeProperty('display');
  tp.classList.remove('tiktok-timepicker-invisible');

  const tH = String(hh).padStart(2,'0');
  const tM = String(roundMinutes(mm)).padStart(2,'0');
  let okH=false, okM=false;

  tp.querySelectorAll('.tiktok-timepicker-option-text.tiktok-timepicker-left').forEach(el=>{
    if (el.textContent.trim()===tH) { realClick(el); okH=true; }
  });
  tp.querySelectorAll('.tiktok-timepicker-option-text.tiktok-timepicker-right').forEach(el=>{
    if (el.textContent.trim()===tM) { realClick(el); okM=true; }
  });

  tp.style.display='none';
  log('applyTime H='+tH+' ok='+okH+' M='+tM+' ok='+okM);
  return okH && okM;
}

const MONTHS_RU=['январ','феврал','март','апрел','май','июн','июл','август','сентябр','октябр','ноябр','декабр'];

function getCalMonthYear() {
  const cal=document.querySelector('.calendar-wrapper'); if(!cal) return null;
  const mText=(cal.querySelector('.month-title')||{}).textContent||'';
  const yText=(cal.querySelector('.year-title') ||{}).textContent||'';
  const mIdx=MONTHS_RU.findIndex(m=>mText.toLowerCase().startsWith(m));
  return {cal, month:mIdx, year:parseInt(yText,10)};
}

function applyDate(yyyy, mm, dd) {
  const state=getCalMonthYear(); if(!state) { log('calendar NOT FOUND'); return false; }
  const {cal}=state;
  cal.style.removeProperty('display');

  let attempts=0;
  while (attempts++<24) {
    const cur=getCalMonthYear(); if(!cur) break;
    const diff=(yyyy*12+(mm-1))-(cur.year*12+cur.month);
    if (diff===0) break;
    const arrows=cal.querySelectorAll('.arrow');
    if (diff>0 && arrows[1]) realClick(arrows[1]);
    else if (diff<0 && arrows[0]) realClick(arrows[0]);
    else break;
  }

  let clicked=false;
  cal.querySelectorAll('.day-span-container').forEach(container=>{
    if (clicked) return;
    const span=container.querySelector('.day.valid');
    if (!span) return;
    if (parseInt(span.textContent.trim(),10)===dd) { realClick(span); clicked=true; }
  });

  cal.style.display='none';
  log('applyDate',yyyy,mm,dd,'clicked='+clicked);
  return clicked;
}

/* ── Нативные инпуты (оригинальный v4) ────────────────────── */
function styleInput(el, type) {
  el.style.cssText=[
    'font-family:inherit','font-size:14px','padding:0 10px','height:36px',
    'border:1px solid #ccc','border-radius:8px','background:#fff','color:#161823',
    'cursor:pointer','outline:none','vertical-align:middle','box-sizing:border-box',
    'width:'+(type==='date'?'160px':'120px'),
  ].join(';');
}

// Ссылки на вставленные нативные инпуты — нужны для doSchedule
const nativeRefs = { date: null, time: null };

function processInput(roInput) {
  if (roInput.dataset.ttv7) return;
  roInput.dataset.ttv7='1';

  const val=roInput.value.trim();
  const isTime=/^\d{1,2}:\d{2}$/.test(val);
  const isDate=/^\d{4}-\d{2}-\d{2}$/.test(val);
  if (!isTime && !isDate) return;

  const type=isTime?'time':'date';
  const native=document.createElement('input');
  native.type=type;
  native.value=isTime?val.padStart(5,'0'):val;
  styleInput(native, type);

  // Сохраняем ссылку
  nativeRefs[type]=native;

  native.addEventListener('change', async ()=>{
    if (!native.value) return;
    if (isTime) {
      const [h,m]=native.value.split(':').map(Number);
      // Открываем time picker кликом на само TikTok-поле
      realClick(roInput);
      await sleep(150);
      const ok=applyTime(h,m);
      if (!ok) log('[native time] picker click failed');
      // React fallback
      const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;
      setter.call(roInput, native.value);
      roInput.dispatchEvent(new Event('input',  {bubbles:true}));
      roInput.dispatchEvent(new Event('change', {bubbles:true}));
      // После смены времени — переставляем дату (защита от сброса)
      await sleep(500);
      if (nativeRefs.date && nativeRefs.date.value) {
        const dateRo=document.querySelector('.scheduled-picker input.TUXTextInputCore-input[readonly][value*="-"]')
          ||[...document.querySelectorAll('.scheduled-picker input.TUXTextInputCore-input[readonly]')]
              .find(e=>/^\d{4}-\d{2}-\d{2}$/.test(e.value.trim()));
        if (dateRo) {
          const [y,mo,d]=nativeRefs.date.value.split('-').map(Number);
          realClick(dateRo);
          await sleep(150);
          applyDate(y,mo,d);
          const s2=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;
          s2.call(dateRo, nativeRefs.date.value);
          dateRo.dispatchEvent(new Event('input',  {bubbles:true}));
          dateRo.dispatchEvent(new Event('change', {bubbles:true}));
          log('[native time] date re-applied:', nativeRefs.date.value);
        }
      }
    } else {
      const [y,mo,d]=native.value.split('-').map(Number);
      // Открываем calendar кликом на само TikTok-поле
      realClick(roInput);
      await sleep(150);
      const ok=applyDate(y,mo,d);
      if (!ok) log('[native date] calendar click failed');
      const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;
      setter.call(roInput, native.value);
      roInput.dispatchEvent(new Event('input',  {bubbles:true}));
      roInput.dispatchEvent(new Event('change', {bubbles:true}));
    }
  });

  const box=roInput.closest('.TUXInputBox');
  if (box) { box.style.display='none'; box.insertAdjacentElement('beforebegin',native); }
  else     { roInput.style.display='none'; roInput.insertAdjacentElement('beforebegin',native); }
  log('native '+type+' inserted val='+native.value);
}

function scan() {
  document.querySelectorAll('.scheduled-picker input.TUXTextInputCore-input[readonly]').forEach(processInput);
  document.querySelectorAll('.tiktok-timepicker-time-picker-container,.calendar-wrapper').forEach(el=>{
    if (!el.dataset.ttOpen) el.style.display='none';
  });
}

/* Программно меняет нативный инпут и стреляет change */
function triggerNative(inputEl, value) {
  if (!inputEl) return;
  const desc=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value');
  if (desc&&desc.set) desc.set.call(inputEl,value); else inputEl.value=value;
  inputEl.dispatchEvent(new Event('input',  {bubbles:true}));
  inputEl.dispatchEvent(new Event('change', {bubbles:true}));
}

/* ══════════════════════════════════════════════════════════════
   ПЛАНИРОВАНИЕ doSchedule

   ИСПРАВЛЕНИЕ БАГА "15 минут / 1 июн":
   ──────────────────────────────────────
   Порядок: ДАТА первой → ВРЕМЯ вторым.

   Когда TikTok получает дату первой — он знает что публикация
   в будущем. После этого установка времени (даже меньше
   текущего) воспринимается правильно — как время ТОГО дня.

   Открываем пикеры кликом на само TikTok readonly-поле
   (не через style.display) — это единственный надёжный способ.
══════════════════════════════════════════════════════════════ */
async function doSchedule() {
  if (!parsed.date) { if(!doParse()) return false; }
  if (!parsed.date) { setStatus('warn','Дата не указана.'); return false; }

  setStatus('info','Переключаю «Запланировать»...');
  const toggled = await clickScheduleToggle();
  if (!toggled) { setStatus('err','Переключатель не найден.'); return false; }

  await sleep(TIMINGS.poslePereklucheniya);
  scan(); // вставляем нативные инпуты
  await sleep(400);

  const parts    = parsed.date.trim().split(/\s+/);
  const datePart = parts[0]||'';
  const timePart = (parts[1]||'').padStart(5,'0');

  if (!/^\d{4}-\d{2}-\d{2}$/.test(datePart)) {
    setStatus('err','Неверный формат. Нужно: YYYY-MM-DD HH:MM'); return false;
  }

  log('scheduling: date='+datePart+' time='+timePart);
  log('nativeRefs.date='+( nativeRefs.date?nativeRefs.date.value:'NULL'));
  log('nativeRefs.time='+( nativeRefs.time?nativeRefs.time.value:'NULL'));

  // ── ШАГ 1: ДАТА (через нативный инпут → его change handler
  //           кликает TikTok calendar) ─────────────────────
  setStatus('info','Устанавливаю дату...');
  if (nativeRefs.date) {
    triggerNative(nativeRefs.date, datePart);
    log('date triggered via native');
  } else {
    // Нативный инпут не найден — кликаем напрямую
    log('nativeRefs.date=NULL, прямой клик');
    const dateRo=[...document.querySelectorAll('.scheduled-picker input.TUXTextInputCore-input[readonly]')]
      .find(e=>/^\d{4}-\d{2}-\d{2}$/.test(e.value.trim()));
    if (dateRo) {
      realClick(dateRo);
      await sleep(200);
      const [y,mo,d]=datePart.split('-').map(Number);
      applyDate(y,mo,d);
    }
  }
  await sleep(TIMINGS.posleDaty);

  // ── ШАГ 2: ВРЕМЯ (через нативный инпут → его change handler
  //           сначала кликает поле чтобы открыть пикер,
  //           потом кликает нужный час/минуту) ─────────────
  if (timePart && timePart!=='00:00') {
    setStatus('info','Устанавливаю время...');
    if (nativeRefs.time) {
      triggerNative(nativeRefs.time, timePart);
      log('time triggered via native');
    } else {
      log('nativeRefs.time=NULL, прямой клик');
      const timeRo=[...document.querySelectorAll('.scheduled-picker input.TUXTextInputCore-input[readonly]')]
        .find(e=>/^\d{1,2}:\d{2}$/.test(e.value.trim()));
      if (timeRo) {
        realClick(timeRo);
        await sleep(200);
        const [h,m]=timePart.split(':').map(Number);
        applyTime(h,m);
      }
    }
    await sleep(TIMINGS.posleVremeni);
  }

  // ── ШАГ 3: Проверяем дату, при сбросе ставим снова ────────
  await sleep(400);
  const dateRoCheck=[...document.querySelectorAll('.scheduled-picker input.TUXTextInputCore-input[readonly]')]
    .find(e=>/^\d{4}-\d{2}-\d{2}$/.test(e.value.trim()));
  if (dateRoCheck && dateRoCheck.value.trim()!==datePart) {
    log('дата сбросилась ('+dateRoCheck.value+'), исправляю...');
    if (nativeRefs.date) {
      triggerNative(nativeRefs.date, datePart);
    } else {
      realClick(dateRoCheck);
      await sleep(200);
      const [y,mo,d]=datePart.split('-').map(Number);
      applyDate(y,mo,d);
    }
    await sleep(400);
    log('дата после исправления:', dateRoCheck.value);
  } else {
    log('дата OK:', dateRoCheck?dateRoCheck.value:'не найдена');
  }

  setStatus('ok','✅ Запланировано: '+parsed.date);
  log('schedule done');
  return true;
}

async function clickScheduleToggle() {
  const kw=['Schedule','Scheduled','Запланировать'];
  const fns=[
    ()=>[...document.querySelectorAll('label.Radioroot,label[class*=Radioroot],label[class*=Radio__root]')],
    ()=>[...document.querySelectorAll('[role=radio]')],
    ()=>[...document.querySelectorAll('span[class*=TUXText]')],
  ];
  for (const fn of fns) {
    for (const el of fn()) {
      if (!kw.includes(el.textContent.trim())) continue;
      const t=el.tagName==='INPUT'?el:(el.closest('label')||el);
      realClick(t);
      log('toggle clicked:', el.textContent.trim());
      await sleep(300);
      return true;
    }
  }
  return false;
}

/* ─── ЗАГРУЗКА ВИДЕО ────────────────────────────────────────── */
function doUpload() {
  if (!parsed.path) { if(!doParse()) return; }
  if (!parsed.path) { setStatus('err','Путь не указан.'); return; }
  setStatus('info','Проверяю файл...'); setButtonsBusy(true);
  GM_xmlhttpRequest({
    method:'GET', url:BRIDGE+'/check?path='+encodeURIComponent(parsed.path),
    headers:{'X-Token':TOKEN}, timeout:10000,
    onload(r) {
      let d={}; try{d=JSON.parse(r.responseText);}catch(_){}
      if (r.status!==200||!d.exists) { setStatus('err',d.error||'bridge '+r.status); setButtonsBusy(false); return; }
      log('file ok, size',d.size); waitForFileInput(0);
    },
    onerror()  { setStatus('err','Bridge недоступен.'); setButtonsBusy(false); },
    ontimeout(){ setStatus('err','Bridge timeout.');    setButtonsBusy(false); },
  });
}
function waitForFileInput(attempt) {
  const el=Array.from(document.querySelectorAll('input[type=file]')).find(e=>e.accept.toLowerCase().includes('video'))
           ||document.querySelector('input[type=file]');
  if (el) { injectFile(parsed.path,el); return; }
  if (attempt>10) { setStatus('warn','input[type=file] не найден.'); setButtonsBusy(false); return; }
  setStatus('info','Жду input[type=file]... '+(attempt+1));
  setTimeout(()=>waitForFileInput(attempt+1), TIMINGS.mezhduPovtorami);
}
function injectFile(path, input) {
  setStatus('info','Загружаю файл...');
  GM_xmlhttpRequest({
    method:'GET', url:BRIDGE+'/file?path='+encodeURIComponent(path),
    headers:{'X-Token':TOKEN}, responseType:'blob', timeout:600000,
    onprogress(ev) {
      if (ev&&ev.total) setStatus('info',Math.floor(ev.loaded/ev.total*100)+'% — '+Math.round(ev.loaded/1048576)+'/'+Math.round(ev.total/1048576)+' MB');
    },
    onload(r) {
      if (r.status!==200&&r.status!==206) { setStatus('err','Bridge '+r.status); setButtonsBusy(false); return; }
      try {
        const name=path.split(/[\\/]/).pop();
        const file=new File([r.response],name,{type:r.response.type||'video/mp4'});
        const dt=new DataTransfer(); dt.items.add(file);
        input.files=dt.files;
        input.dispatchEvent(new Event('change',{bubbles:true}));
        input.dispatchEvent(new Event('input', {bubbles:true}));
        setStatus('ok','✅ Файл загружен ('+Math.round(file.size/1048576)+' MB).');
        log('injected',name,file.size);
      } catch(e) { setStatus('err','Ошибка: '+e.message); }
      finally { setButtonsBusy(false); }
    },
    onerror()  { setStatus('err','Ошибка загрузки.');  setButtonsBusy(false); },
    ontimeout(){ setStatus('err','Timeout загрузки.'); setButtonsBusy(false); },
  });
}

async function doAll() {
  if (!doParse()) return;
  doUpload();
  await sleep(TIMINGS.posleZagruzki);
  await doFill();  // теперь doFill async — ждём завершения
  await sleep(TIMINGS.posleZapolneniya);
  await doSchedule();
}

/* ─── BATCH: ASYNC ЗАГРУЗКА ──────────────────────────────────── */
function doUploadAsync(videoPath) {
  return new Promise((resolve, reject) => {
    setStatus('info','Проверяю файл...');
    GM_xmlhttpRequest({
      method:'GET', url:BRIDGE+'/check?path='+encodeURIComponent(videoPath),
      headers:{'X-Token':TOKEN}, timeout:10000,
      onload(r) {
        let d={}; try{d=JSON.parse(r.responseText);}catch(_){}
        if (r.status!==200||!d.exists) { reject(new Error(d.error||'bridge '+r.status)); return; }
        log('file ok, size',d.size);
        waitForFileInputAsync(videoPath, 0, resolve, reject);
      },
      onerror() { reject(new Error('Bridge недоступен.')); },
      ontimeout(){ reject(new Error('Bridge timeout.')); },
    });
  });
}

function waitForFileInputAsync(path, attempt, resolve, reject) {
  const el=Array.from(document.querySelectorAll('input[type=file]')).find(e=>e.accept.toLowerCase().includes('video'))
    ||document.querySelector('input[type=file]');
  if (el) {
    log('waitForFileInputAsync: found input after '+attempt+' attempts');
    injectFileAsync(path, el, resolve, reject, 1);
    return;
  }
  if (attempt>40) { reject(new Error('input[type=file] не найден после 40 попыток. Страница не загрузилась?')); return; }
  setStatus('info','Жду страницу загрузки... '+(attempt+1));
  setTimeout(()=>waitForFileInputAsync(path, attempt+1, resolve, reject), TIMINGS.mezhduPovtorami);
}

function injectFileAsync(path, input, resolve, reject, attempt) {
  attempt = attempt || 1;
  setStatus('info','Загружаю файл... (попытка '+attempt+')');
  log('injectFileAsync attempt='+attempt+' path='+path);
  const url = BRIDGE+'/file?path='+encodeURIComponent(path);
  log('request url='+url.substring(0,120));
  GM_xmlhttpRequest({
    method:'GET', url:url,
    headers:{'X-Token':TOKEN}, responseType:'blob', timeout:600000,
    onprogress(ev) {
      if (ev&&ev.total) setStatus('info',Math.floor(ev.loaded/ev.total*100)+'% — '+Math.round(ev.loaded/1048576)+'/'+Math.round(ev.total/1048576)+' MB');
    },
    onload(r) {
      log('injectFileAsync onload status='+r.status+' blobSize='+(r.response?r.response.size:0));
      if (r.status!==200&&r.status!==206) { reject(new Error('Bridge HTTP '+r.status)); return; }
      if (!r.response || r.response.size === 0) {
        if (attempt < 3) {
          log('injectFileAsync: empty blob, retry in 2s...');
          setTimeout(()=>injectFileAsync(path, input, resolve, reject, attempt+1), 2000);
        } else {
          reject(new Error('Bridge вернул пустой файл после 3 попыток'));
        }
        return;
      }
      try {
        const name=path.replace(/\\/g,'/').split('/').pop();
        const mime=r.response.type||'video/mp4';
        const file=new File([r.response],name,{type:mime});
        const dt=new DataTransfer(); dt.items.add(file);
        input.files=dt.files;
        input.dispatchEvent(new Event('change',{bubbles:true}));
        input.dispatchEvent(new Event('input', {bubbles:true}));
        setStatus('ok','✅ Файл загружен ('+Math.round(file.size/1048576)+' MB).');
        log('injected OK: '+name+' '+file.size+' bytes');
        resolve();
      } catch(e) {
        log('injectFileAsync inject error: '+e.message);
        reject(e);
      }
    },
    onerror(e) {
      log('injectFileAsync onerror: '+(e&&e.error?e.error:'unknown')+' status='+(e&&e.status?e.status:'?'));
      if (attempt < 3) {
        log('retry in 3s...');
        setTimeout(()=>injectFileAsync(path, input, resolve, reject, attempt+1), 3000);
      } else {
        reject(new Error('Bridge onerror после '+attempt+' попыток. Проверь Bridge-сервер.'));
      }
    },
    ontimeout(){
      log('injectFileAsync timeout attempt='+attempt);
      if (attempt < 2) {
        log('retry after timeout...');
        setTimeout(()=>injectFileAsync(path, input, resolve, reject, attempt+1), 2000);
      } else {
        reject(new Error('Timeout загрузки файла'));
      }
    },
  });
}

/* ─── BATCH: ЛОГИКА ОЧЕРЕДИ ──────────────────────────────────── */
async function clickPublishButton() {
  const kwPublish = ['Post','Опубликовать','Publish','Schedule','Запланировать'];
  const candidates = [
    ...document.querySelectorAll('button[data-testid*="post"],button[data-testid*="publish"],button[data-testid*="submit"]'),
    ...document.querySelectorAll('button[class*="publish"],button[class*="post-btn"],button[class*="submit"]'),
    ...document.querySelectorAll('button[type=submit]'),
  ];
  for (const btn of candidates) {
    const txt = btn.textContent.trim();
    if (kwPublish.some(kw=>txt.includes(kw)) && !btn.disabled) {
      realClick(btn); log('clickPublishButton: clicked "'+txt+'"'); return true;
    }
  }
  for (const btn of document.querySelectorAll('button')) {
    const txt = btn.textContent.trim();
    if (kwPublish.some(kw=>txt===kw) && !btn.disabled) {
      realClick(btn); log('clickPublishButton: fallback "'+txt+'"'); return true;
    }
  }
  log('clickPublishButton: NOT FOUND');
  return false;
}

async function handleConfirmDialog() {
  await sleep(1500);
  const dialogs = document.querySelectorAll('[role=dialog],[role=alertdialog],.modal,.popup');
  for (const dlg of dialogs) {
    if (!dlg.offsetParent) continue;
    const btns = dlg.querySelectorAll('button');
    for (const btn of btns) {
      const txt = btn.textContent.trim();
      if (['Опубликовать','Publish','Post','Confirm','Подтвердить','OK','ОК'].includes(txt) && !btn.disabled) {
        realClick(btn); log('handleConfirmDialog: confirmed with "'+txt+'"'); return true;
      }
    }
  }
  return false;
}

async function clickUploadNewButton() {
  const kw = ['Upload','Загрузить','Загрузить видео','New upload','Ещё видео','Опубликовать ещё'];
  for (let attempt = 0; attempt < 15; attempt++) {
    for (const btn of document.querySelectorAll('button,a[role=button],[role=button]')) {
      const txt = btn.textContent.trim();
      if (kw.some(k=>txt.includes(k)) && !btn.disabled) {
        realClick(btn); log('clickUploadNewButton: clicked "'+txt+'"'); return true;
      }
    }
    const uploadLink = document.querySelector('a[href*="/upload"]');
    if (uploadLink) { realClick(uploadLink); log('clickUploadNewButton: nav via link'); return true; }
    await sleep(700);
  }
  log('clickUploadNewButton: navigating to upload page directly');
  location.href = 'https://www.tiktok.com/tiktokstudio/upload';
  return true;
}

async function waitForUploadPage(maxWaitMs) {
  maxWaitMs = maxWaitMs || 30000;
  const step = 500;
  let waited = 0;
  while (waited < maxWaitMs) {
    const fileInput = Array.from(document.querySelectorAll('input[type=file]'))
      .find(e=>e.accept.toLowerCase().includes('video'));
    if (fileInput) { log('waitForUploadPage: found input[type=file]'); return true; }
    await sleep(step); waited += step;
  }
  log('waitForUploadPage: TIMEOUT');
  return false;
}

async function processBatchItem(item) {
  parsed = Object.assign({}, item);
  nativeRefs.date = null;
  nativeRefs.time = null;
  log('=== BATCH ['+(batchIndex+1)+'/'+batchQueue.length+'] '+item.path+' ===');
  setStatus('info', '['+(batchIndex+1)+'/'+batchQueue.length+'] Загружаю: '+item.path.split(/[\\\\/]/).pop());
  try {
    await doUploadAsync(item.path);
  } catch(e) {
    log('doUploadAsync ERROR:', e.message);
    setStatus('err', '❌ Ошибка загрузки #'+(batchIndex+1)+': '+e.message);
    throw e;
  }
  await sleep(TIMINGS.posleZagruzki);
  setStatus('info', '['+(batchIndex+1)+'/'+batchQueue.length+'] Вставляю описание...');
  await doFill();
  await sleep(TIMINGS.posleZapolneniya);
  if (item.date) {
    setStatus('info', '['+(batchIndex+1)+'/'+batchQueue.length+'] Планирую: '+item.date);
    await doSchedule();
    await sleep(500);
  }
  setStatus('info', '['+(batchIndex+1)+'/'+batchQueue.length+'] Нажимаю «Запланировать»...');
  await clickPublishButton();
  await handleConfirmDialog();
  await sleep(TIMINGS.poslePublikacii);
  log('=== BATCH ['+(batchIndex+1)+'/'+batchQueue.length+'] DONE ===');
}

async function doBatchRun() {
  if (batchRunning) { log('batch already running'); return; }
  if (!parseAllLines()) return;
  if (batchQueue.length === 0) { setStatus('err','Очередь пуста.'); return; }
  batchRunning = true; batchStopped = false; batchIndex = 0;
  const stopBtn  = document.getElementById('tt-batch-stop');
  const startBtn = document.getElementById('tt-batch-start');
  if (stopBtn)  stopBtn.style.display='inline-flex';
  if (startBtn) startBtn.disabled = true;
  setButtonsBusy(true);
  renderBatchQueue();
  log('=== BATCH START: '+batchQueue.length+' videos ===');
  for (batchIndex = 0; batchIndex < batchQueue.length; batchIndex++) {
    if (batchStopped) { setStatus('warn','⚠️ Очередь остановлена пользователем.'); break; }
    renderBatchQueue();
    try {
      await processBatchItem(batchQueue[batchIndex]);
    } catch(e) {
      log('BATCH item '+(batchIndex+1)+' ERROR: '+e.message);
      setStatus('err', '❌ Ошибка в видео #'+(batchIndex+1)+'. Пропускаю...');
      await sleep(3000);
    }
    if (batchIndex < batchQueue.length - 1 && !batchStopped) {
      setStatus('info','Перехожу к следующему видео...');
      await clickUploadNewButton();
      const ready = await waitForUploadPage(TIMINGS.ozhidanieStranici * 4);
      if (!ready) { location.href='https://www.tiktok.com/tiktokstudio/upload'; await sleep(TIMINGS.ozhidanieStranici); }
      else { await sleep(TIMINGS.posleNavigacii); }
    }
  }
  batchRunning = false;
  if (stopBtn)  stopBtn.style.display='none';
  if (startBtn) startBtn.disabled = false;
  setButtonsBusy(false);
  renderBatchQueue();
  if (!batchStopped) {
    setStatus('ok','🎉 Готово! Обработано '+batchQueue.length+' видео.');
    log('=== BATCH COMPLETE: '+batchQueue.length+' videos ===');
  }
}

function stopBatch() {
  batchStopped = true;
  batchRunning = false;
  setStatus('warn','⏹ Остановка после текущего видео...');
  log('BATCH: stop requested');
}

function checkBridge() {
  GM_xmlhttpRequest({
    method:'GET', url:BRIDGE+'/health', timeout:5000,
    onload(r)  { r.status===200?setBridge('ok','✅ Bridge OK'):setBridge('err','Bridge HTTP '+r.status); },
    onerror()  { setBridge('err','Bridge недоступен'); },
    ontimeout(){ setBridge('err','Bridge timeout'); },
  });
}

/* ─── ПАНЕЛЬ ────────────────────────────────────────────────── */

function buildTimingsHTML() {
  return Object.keys(DEFAULT_TIMINGS).map(k=>
    `<div class="tm-row"><label class="tm-lbl" for="tt-tm-${k}">${escapeHtml(TIMING_LABELS[k]||k)}</label>`+
    `<input class="tm-inp" id="tt-tm-${k}" type="number" min="0" step="50" value="${TIMINGS[k]}"></div>`
  ).join('');
}

function init() {
  if (!shouldRun()||document.getElementById(PANEL_ID)||!document.body) return;
  loadTimings();
  const panel=document.createElement('div');
  panel.id=PANEL_ID;
  panel.innerHTML=`<style>
/* ── RESET ── */
#${PANEL_ID},#${PANEL_ID} *{box-sizing:border-box;margin:0;padding:0}

/* ── PANEL ── */
#${PANEL_ID}{
  position:fixed;top:64px;right:14px;width:380px;max-height:93vh;
  overflow-y:auto;overflow-x:hidden;
  background:#0a0a0a;color:#d4d4d4;
  border:1px solid #1e2e2e;
  border-radius:14px;
  box-shadow:0 0 0 1px #0ff2,0 20px 60px rgba(0,0,0,.8),0 0 40px rgba(0,255,200,.04);
  z-index:2147483647;
  font:13px/1.5 -apple-system,system-ui,sans-serif;
  scrollbar-width:thin;scrollbar-color:#1e2e2e transparent;
}
#${PANEL_ID}::-webkit-scrollbar{width:4px}
#${PANEL_ID}::-webkit-scrollbar-track{background:transparent}
#${PANEL_ID}::-webkit-scrollbar-thumb{background:#1e2e2e;border-radius:4px}

/* ── HEADER ── */
#${PANEL_ID} .hdr{
  display:flex;justify-content:space-between;align-items:center;
  padding:11px 14px;
  background:linear-gradient(135deg,#0d1a1a 0%,#0a1010 100%);
  border-bottom:1px solid #1e2e2e;
  border-radius:14px 14px 0 0;
  cursor:move;user-select:none;
  position:sticky;top:0;z-index:10;
}
#${PANEL_ID} .hdr-left{display:flex;align-items:center;gap:8px}
#${PANEL_ID} .hdr-dot{width:8px;height:8px;border-radius:50%;background:#00e5c0;box-shadow:0 0 8px #00e5c066;flex-shrink:0}
#${PANEL_ID} .ttl{font-weight:700;color:#fff;font-size:13px;letter-spacing:.3px}
#${PANEL_ID} .ttl span{color:#00e5c0}
#${PANEL_ID} .hdr-right{display:flex;align-items:center;gap:4px}
#${PANEL_ID} .mini{
  background:none;border:none;color:#4a5a5a;cursor:pointer;
  font-size:14px;padding:3px 7px;border-radius:5px;line-height:1;
  transition:color .15s,background .15s;
}
#${PANEL_ID} .mini:hover{color:#00e5c0;background:#00e5c011}

/* ── TABS ── */
#${PANEL_ID} .tabs{
  display:flex;border-bottom:1px solid #1a2e2e;
  background:#060e0e;
  position:sticky;top:42px;z-index:9;
}
#${PANEL_ID} .tab{
  flex:1;padding:9px 4px;text-align:center;
  font-size:11px;font-weight:600;letter-spacing:.2px;color:#3a6060;
  cursor:pointer;user-select:none;border:none;background:none;
  border-bottom:2px solid transparent;
  transition:color .15s,border-color .15s,background .15s;
}
#${PANEL_ID} .tab:hover{color:#00e5c0;background:#00e5c008}
#${PANEL_ID} .tab.active{color:#00e5c0;border-bottom-color:#00e5c0;background:#00e5c009}

/* ── TAB PANELS ── */
#${PANEL_ID} .tab-panel{display:none !important}
#${PANEL_ID} .tab-panel.active{display:flex !important;flex-direction:column;gap:8px;padding:12px}

/* ── BODY ── */
#${PANEL_ID} .body{padding:12px;display:flex;flex-direction:column;gap:8px}
#${PANEL_ID}.collapsed .tabs{display:none}
#${PANEL_ID}.collapsed .tab-panel{display:none !important}
#${PANEL_ID}.collapsed .tab-panel.active{display:none !important}

/* ── BRIDGE STATUS ── */
#${PANEL_ID} .bridge-bar{
  display:flex;align-items:center;gap:7px;
  padding:6px 10px;border-radius:8px;
  background:#0d1010;border:1px solid #1a2a2a;
  font-size:11px;color:#5a7a7a;
}
#${PANEL_ID} .bridge-bar .bdot{width:6px;height:6px;border-radius:50%;background:#2a3a3a;flex-shrink:0;transition:background .3s,box-shadow .3s}
#${PANEL_ID} .bridge-bar.ok .bdot{background:#00e5c0;box-shadow:0 0 6px #00e5c080}
#${PANEL_ID} .bridge-bar.ok{color:#00e5c0;border-color:#00e5c022}
#${PANEL_ID} .bridge-bar.err .bdot{background:#ff4466}
#${PANEL_ID} .bridge-bar.err{color:#ff4466;border-color:#ff446622}

/* ── INPUT AREA ── */
#${PANEL_ID} .input-wrap{position:relative}
#${PANEL_ID} .input-label{font-size:10px;text-transform:uppercase;letter-spacing:.8px;color:#3a5a5a;margin-bottom:5px;font-weight:600}
#${PANEL_ID} textarea{
  width:100%;min-height:72px;resize:vertical;
  background:#060e0e;color:#c8e8e0;
  border:1px solid #1a2e2e;border-radius:9px;
  padding:9px 11px;font:12px/1.55 'Consolas','Courier New',monospace;
  outline:none;transition:border-color .2s,box-shadow .2s;
}
#${PANEL_ID} textarea:focus{
  border-color:#00e5c055;
  box-shadow:0 0 0 3px #00e5c010,inset 0 0 20px #00e5c005;
}
#${PANEL_ID} textarea::placeholder{color:#2a4a4a}

/* ── MAIN ACTION BUTTON ── */
#${PANEL_ID} .btn-main{
  width:100%;padding:10px;border:none;border-radius:9px;cursor:pointer;
  background:linear-gradient(135deg,#00c4a8,#00e5c0);
  color:#001a16;font-size:13px;font-weight:700;letter-spacing:.2px;
  box-shadow:0 4px 20px #00e5c030;
  transition:transform .15s,box-shadow .15s,filter .15s;
}
#${PANEL_ID} .btn-main:hover{transform:translateY(-1px);box-shadow:0 6px 28px #00e5c050;filter:brightness(1.05)}
#${PANEL_ID} .btn-main:active{transform:translateY(0);box-shadow:0 2px 10px #00e5c030}
#${PANEL_ID} .btn-main:disabled{opacity:.4;cursor:not-allowed;transform:none;box-shadow:none}

/* ── BATCH START BUTTON ── */
#${PANEL_ID} .btn-batch{
  width:100%;padding:10px;border:none;border-radius:9px;cursor:pointer;
  background:linear-gradient(135deg,#005a9a,#0080d0);
  color:#e8f4ff;font-size:13px;font-weight:700;letter-spacing:.2px;
  box-shadow:0 4px 20px #0080d030;
  transition:transform .15s,box-shadow .15s,filter .15s;
}
#${PANEL_ID} .btn-batch:hover{transform:translateY(-1px);box-shadow:0 6px 28px #0080d050;filter:brightness(1.08)}
#${PANEL_ID} .btn-batch:active{transform:translateY(0)}
#${PANEL_ID} .btn-batch:disabled{opacity:.4;cursor:not-allowed;transform:none;box-shadow:none}

/* ── STOP BUTTON ── */
#${PANEL_ID} .btn-stop{
  width:100%;padding:10px;border:none;border-radius:9px;cursor:pointer;
  background:linear-gradient(135deg,#7a1020,#cc2040);
  color:#ffe8ec;font-size:13px;font-weight:700;letter-spacing:.2px;
  box-shadow:0 4px 20px #cc204030;
  display:none;
  transition:transform .15s,box-shadow .15s,filter .15s;
}
#${PANEL_ID} .btn-stop:hover{transform:translateY(-1px);filter:brightness(1.1)}
#${PANEL_ID} .btn-stop:active{transform:translateY(0)}

/* ── SECTION (collapsible) ── */
#${PANEL_ID} .sec{border:1px solid #141e1e;border-radius:10px;overflow:hidden}
#${PANEL_ID} .sec-hdr{
  display:flex;justify-content:space-between;align-items:center;
  padding:9px 12px;cursor:pointer;user-select:none;
  background:#0d1515;
  transition:background .15s;
}
#${PANEL_ID} .sec-hdr:hover{background:#101c1c}
#${PANEL_ID} .sec-hdr-left{display:flex;align-items:center;gap:7px}
#${PANEL_ID} .sec-icon{font-size:13px;width:20px;text-align:center}
#${PANEL_ID} .sec-title{font-size:12px;font-weight:600;color:#a0c8c0;letter-spacing:.2px}
#${PANEL_ID} .sec-arr{font-size:10px;color:#3a5a5a;transition:transform .2s}
#${PANEL_ID} .sec-arr.open{transform:rotate(90deg)}
#${PANEL_ID} .sec-body{
  background:#080f0f;padding:10px;
  display:flex;flex-direction:column;gap:7px;
  border-top:1px solid #141e1e;
}
#${PANEL_ID} .sec-body.hidden{display:none}

/* ── GRID BUTTONS inside sections ── */
#${PANEL_ID} .btn-grid{display:grid;grid-template-columns:1fr 1fr;gap:6px}
#${PANEL_ID} .btn-grid-3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px}

/* ── GENERIC BUTTONS ── */
#${PANEL_ID} button{
  border:none;border-radius:7px;padding:8px 10px;cursor:pointer;
  font-size:11px;font-weight:600;letter-spacing:.1px;
  display:flex;align-items:center;justify-content:center;gap:5px;
  transition:background .15s,transform .1s,box-shadow .15s;
}
#${PANEL_ID} button:hover{transform:translateY(-1px)}
#${PANEL_ID} button:active{transform:translateY(0)}
#${PANEL_ID} button:disabled{opacity:.4;cursor:not-allowed;transform:none}

#${PANEL_ID} .btn-teal{background:#00302a;color:#00e5c0;border:1px solid #00e5c022}
#${PANEL_ID} .btn-teal:hover{background:#003d34;box-shadow:0 3px 12px #00e5c020}

#${PANEL_ID} .btn-blue{background:#001530;color:#4090d0;border:1px solid #4090d022}
#${PANEL_ID} .btn-blue:hover{background:#001e40;box-shadow:0 3px 12px #4090d020}

#${PANEL_ID} .btn-dark{background:#111a1a;color:#7aa0a0;border:1px solid #1a2a2a}
#${PANEL_ID} .btn-dark:hover{background:#162020;color:#a0c8c0}

#${PANEL_ID} .btn-warn{background:#1a1000;color:#e5a000;border:1px solid #e5a00022}
#${PANEL_ID} .btn-warn:hover{background:#221500;box-shadow:0 3px 12px #e5a00020}

#${PANEL_ID} .btn-red{background:#1a0008;color:#ff4466;border:1px solid #ff446622}
#${PANEL_ID} .btn-red:hover{background:#220010;box-shadow:0 3px 12px #ff446620}

#${PANEL_ID} .btn-ghost{background:transparent;color:#3a6060;border:1px solid #1a2a2a}
#${PANEL_ID} .btn-ghost:hover{color:#00e5c0;border-color:#00e5c033;background:#00e5c008}

/* ── STATUS BOX ── */
#${PANEL_ID} .status-box{
  padding:8px 11px;border-radius:8px;font-size:11px;line-height:1.5;
  background:#0d1010;border:1px solid #1a2a2a;color:#5a7a7a;
  transition:background .3s,border-color .3s,color .3s;
}
#${PANEL_ID} .status-box.tt-ok{background:#002a1a;color:#00e5c0;border-color:#00e5c030}
#${PANEL_ID} .status-box.tt-warn{background:#1a1200;color:#e5a000;border-color:#e5a00030}
#${PANEL_ID} .status-box.tt-err{background:#1a0008;color:#ff4466;border-color:#ff446630}
#${PANEL_ID} .status-box.tt-info{background:#001020;color:#4090d0;border-color:#4090d030}

/* ── TIMINGS ── */
#${PANEL_ID} .tm-row{display:grid;grid-template-columns:1fr 78px;gap:6px;align-items:center}
#${PANEL_ID} .tm-lbl{font-size:11px;color:#4a6a6a}
#${PANEL_ID} .tm-inp{
  background:#060e0e;border:1px solid #1a2a2a;color:#a0c8c0;
  border-radius:6px;padding:4px 7px;font-size:12px;text-align:right;outline:none;
  transition:border-color .2s;
}
#${PANEL_ID} .tm-inp:focus{border-color:#00e5c044}

/* ── PARSED PREVIEW ── */
#${PANEL_ID} .preview{
  display:none;padding:9px 11px;border-radius:8px;
  background:#060e0e;border:1px solid #1a2a2a;
  font-size:11px;line-height:1.8;
}
#${PANEL_ID} .preview b{color:#00e5c0;font-weight:600;margin-right:4px}
#${PANEL_ID} .preview .pval{color:#c8e8e0}
#${PANEL_ID} .preview .pempty{color:#2a4040}

/* ── BATCH QUEUE ── */
#${PANEL_ID} .queue-box{
  border:1px solid #1a2a2a;border-radius:8px;
  background:#060e0e;max-height:130px;overflow-y:auto;
  padding:6px;
  scrollbar-width:thin;scrollbar-color:#1a2a2a transparent;
}
#${PANEL_ID} .queue-box::-webkit-scrollbar{width:3px}
#${PANEL_ID} .queue-box::-webkit-scrollbar-thumb{background:#1a2a2a;border-radius:3px}
#${PANEL_ID} .queue-item{
  display:flex;align-items:center;gap:6px;
  padding:4px 6px;border-radius:5px;margin-bottom:2px;
  transition:background .2s;
}
#${PANEL_ID} .queue-item:last-child{margin-bottom:0}
#${PANEL_ID} .queue-pending{background:transparent}
#${PANEL_ID} .queue-active{background:#001a30}
#${PANEL_ID} .queue-done{background:#001510}
#${PANEL_ID} .queue-icon{font-size:12px;width:16px;text-align:center;flex-shrink:0}
#${PANEL_ID} .queue-name{flex:1;font-size:11px;color:#7aa0a0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#${PANEL_ID} .queue-active .queue-name{color:#4090d0}
#${PANEL_ID} .queue-done .queue-name{color:#00a080}
#${PANEL_ID} .queue-date{font-size:10px;color:#3a5a5a;flex-shrink:0}
#${PANEL_ID} .batch-empty{color:#2a4040;font-size:11px;padding:6px 2px}

/* ── LOG ── */
#${PANEL_ID} .log{
  max-height:120px;overflow-y:auto;
  font-size:10px;line-height:1.6;white-space:pre-wrap;word-break:break-all;
  color:#2a5050;background:#050c0c;
  border:1px solid #101a1a;border-radius:7px;padding:7px 9px;
  scrollbar-width:thin;scrollbar-color:#1a2a2a transparent;
}
#${PANEL_ID} .log::-webkit-scrollbar{width:3px}
#${PANEL_ID} .log::-webkit-scrollbar-thumb{background:#1a2a2a;border-radius:3px}
#${PANEL_ID} .log div{border-bottom:1px solid #0d1515;padding-bottom:2px;margin-bottom:2px}
#${PANEL_ID} .log div:last-child{border-bottom:none}
#${PANEL_ID} .divider{height:1px;background:linear-gradient(90deg,transparent,#1a2e2e,transparent);margin:2px 0}
</style>

<div class="hdr">
  <div class="hdr-left">
    <div class="hdr-dot"></div>
    <span class="ttl">TT <span>Studio</span> Helper</span>
  </div>
  <div class="hdr-right">
    <div class="bridge-bar" id="tt-bridge"><div class="bdot"></div><span id="tt-bridge-txt">Bridge…</span></div>
    <button class="mini" id="tt-toggle" title="Свернуть">−</button>
  </div>
</div>

<!-- ВКЛАДКИ -->
<div class="tabs">
  <button class="tab active" data-tab="single">⚡ Одиночная</button>
  <button class="tab" data-tab="batch">🚀 Пакетная</button>
</div>

<!-- ══════════════════════════════════════════
     ВКЛАДКА 1: ОДИНОЧНАЯ ЗАГРУЗКА
     ══════════════════════════════════════════ -->
<div class="tab-panel active" id="tab-single">

  <div>
    <div class="input-label">Строка задания</div>
    <textarea id="tt-input" placeholder="C:/video.mp4 | #теги | 2026-05-20 14:30&#10;или: path=... | tags=... | date=... | caption=..."></textarea>
  </div>

  <button class="btn-main" id="tt-all">▶ &nbsp;Запустить всё</button>

  <div class="divider"></div>

  <div class="sec" id="sec-actions">
    <div class="sec-hdr" data-sec="actions">
      <div class="sec-hdr-left"><span class="sec-icon">⚡</span><span class="sec-title">Действия по отдельности</span></div>
      <span class="sec-arr" id="arr-actions">▶</span>
    </div>
    <div class="sec-body hidden" id="body-actions">
      <div class="btn-grid">
        <button class="btn-teal" id="tt-parse">📋 Разобрать строку</button>
        <button class="btn-teal" id="tt-upload">📤 Загрузить видео</button>
      </div>
      <div class="btn-grid">
        <button class="btn-teal" id="tt-fill">✏️ Вставить текст</button>
        <button class="btn-teal" id="tt-schedule">📅 Запланировать</button>
      </div>
      <button class="btn-ghost" id="tt-debug">🔍 Debug редакторов</button>
    </div>
  </div>

  <div class="status-box tt-info" id="tt-status">Готов к работе.</div>

  <div class="sec" id="sec-timings">
    <div class="sec-hdr" data-sec="timings">
      <div class="sec-hdr-left"><span class="sec-icon">⚙</span><span class="sec-title">Тайминги</span></div>
      <span class="sec-arr" id="arr-timings">▶</span>
    </div>
    <div class="sec-body hidden" id="body-timings">
      ${buildTimingsHTML()}
      <div class="btn-grid" style="margin-top:4px">
        <button class="btn-teal" id="tt-tm-save">💾 Сохранить</button>
        <button class="btn-ghost" id="tt-tm-reset">↺ Сброс</button>
      </div>
    </div>
  </div>

  <div class="sec" id="sec-preview">
    <div class="sec-hdr" data-sec="preview">
      <div class="sec-hdr-left"><span class="sec-icon">🔎</span><span class="sec-title">Разбор строки</span></div>
      <span class="sec-arr" id="arr-preview">▶</span>
    </div>
    <div class="sec-body hidden" id="body-preview">
      <div class="preview" id="tt-parsed" style="display:block">
        <span class="pempty">Нажми «Разобрать строку» или «Запустить всё»</span>
      </div>
    </div>
  </div>

  <div class="sec" id="sec-log">
    <div class="sec-hdr" data-sec="log">
      <div class="sec-hdr-left"><span class="sec-icon">📋</span><span class="sec-title">Лог</span></div>
      <span class="sec-arr" id="arr-log">▶</span>
    </div>
    <div class="sec-body hidden" id="body-log">
      <div class="log" id="tt-log"></div>
    </div>
  </div>

</div>

<!-- ══════════════════════════════════════════
     ВКЛАДКА 2: ПАКЕТНАЯ ЗАГРУЗКА
     ══════════════════════════════════════════ -->
<div class="tab-panel" id="tab-batch">

  <div>
    <div class="input-label">Список видео (каждая строка — одно видео)</div>
    <textarea id="tt-batch-input" rows="5" placeholder="C:\video1.mp4 | #теги | 2026-05-20 10:00 | Описание 1&#10;C:\video2.mp4 | #теги | 2026-05-20 11:00 | Описание 2&#10;C:\video3.mp4 | #теги | 2026-05-20 12:00 | Описание 3" style="min-height:90px;"></textarea>
  </div>

  <button class="btn-batch" id="tt-batch-start">🚀 &nbsp;Запустить очередь</button>
  <button class="btn-stop" id="tt-batch-stop">⏹ &nbsp;Остановить</button>

  <div class="divider"></div>

  <!-- Очередь -->
  <div class="sec" id="sec-queue">
    <div class="sec-hdr" data-sec="queue">
      <div class="sec-hdr-left"><span class="sec-icon">📂</span><span class="sec-title">Очередь видео</span></div>
      <span class="sec-arr open" id="arr-queue">▶</span>
    </div>
    <div class="sec-body" id="body-queue">
      <div class="queue-box" id="tt-queue-list">
        <div class="batch-empty">Очередь пуста. Введите список видео выше.</div>
      </div>
    </div>
  </div>

  <!-- Разобрать вручную -->
  <div class="sec" id="sec-batch-actions">
    <div class="sec-hdr" data-sec="batch-actions">
      <div class="sec-hdr-left"><span class="sec-icon">⚡</span><span class="sec-title">Ручные операции</span></div>
      <span class="sec-arr" id="arr-batch-actions">▶</span>
    </div>
    <div class="sec-body hidden" id="body-batch-actions">
      <div class="input-label" style="margin-bottom:4px;">Для ручных операций используется первая строка из поля выше</div>
      <div class="btn-grid">
        <button class="btn-blue" id="tt-batch-parse">📋 Разобрать список</button>
        <button class="btn-ghost" id="tt-batch-debug">🔍 Debug</button>
      </div>
    </div>
  </div>

  <!-- Статус batch -->
  <div class="status-box tt-info" id="tt-batch-status">Готов к пакетной загрузке.</div>

  <!-- Лог batch -->
  <div class="sec" id="sec-batch-log">
    <div class="sec-hdr" data-sec="batch-log">
      <div class="sec-hdr-left"><span class="sec-icon">📋</span><span class="sec-title">Лог пакетной загрузки</span></div>
      <span class="sec-arr" id="arr-batch-log">▶</span>
    </div>
    <div class="sec-body hidden" id="body-batch-log">
      <div class="log" id="tt-batch-log"></div>
    </div>
  </div>

</div>`;

  document.body.appendChild(panel);

  /* ── Сохраняем ввод ── */
  const savedSingle = storageGet(STORAGE_KEY,'');
  if (savedSingle) document.getElementById('tt-input').value = savedSingle;
  const savedBatch = storageGet(BATCH_STORAGE_KEY,'');
  if (savedBatch) document.getElementById('tt-batch-input').value = savedBatch;

  /* ── Tabs ── */
  panel.querySelectorAll('.tab').forEach(tab=>{
    tab.addEventListener('click',()=>{
      panel.querySelectorAll('.tab').forEach(t=>t.classList.remove('active'));
      panel.querySelectorAll('.tab-panel').forEach(p=>p.classList.remove('active'));
      tab.classList.add('active');
      document.getElementById('tab-'+tab.dataset.tab).classList.add('active');
    });
  });

  /* ── Сворачивание ── */
  document.getElementById('tt-toggle').onclick=function(){
    panel.classList.toggle('collapsed');
    this.textContent=panel.classList.contains('collapsed')?'+':'−';
  };

  /* ── Одиночные кнопки ── */
  document.getElementById('tt-parse').onclick    = doParse;
  document.getElementById('tt-fill').onclick     = doFill;
  document.getElementById('tt-debug').onclick    = debugEditors;
  document.getElementById('tt-schedule').onclick = ()=>doSchedule();
  document.getElementById('tt-upload').onclick   = doUpload;
  document.getElementById('tt-all').onclick      = ()=>doAll();
  document.getElementById('tt-input').addEventListener('input',e=>storageSet(STORAGE_KEY,e.target.value));

  /* ── Batch кнопки ── */
  document.getElementById('tt-batch-start').onclick = doBatchRun;
  document.getElementById('tt-batch-stop').onclick  = stopBatch;
  document.getElementById('tt-batch-parse').onclick = parseAllLines;
  document.getElementById('tt-batch-debug').onclick = debugEditors;
  document.getElementById('tt-batch-input').addEventListener('input',e=>{
    storageSet(BATCH_STORAGE_KEY,e.target.value);
  });

  /* ── Collapsible sections (одиночная вкладка) ── */
  ['actions','timings','preview','log'].forEach(sec=>{
    const hdr=document.querySelector('#sec-'+sec+' .sec-hdr');
    if (!hdr) return;
    hdr.addEventListener('click',()=>{
      const body=document.getElementById('body-'+sec);
      const arr =document.getElementById('arr-'+sec);
      if (!body) return;
      const isOpen=!body.classList.contains('hidden');
      body.classList.toggle('hidden',isOpen);
      if (arr) arr.classList.toggle('open',!isOpen);
    });
  });

  /* ── Collapsible sections (batch вкладка) ── */
  ['queue','batch-actions','batch-log'].forEach(sec=>{
    const hdr=document.querySelector('#sec-'+sec+' .sec-hdr');
    if (!hdr) return;
    hdr.addEventListener('click',()=>{
      const body=document.getElementById('body-'+sec);
      const arr =document.getElementById('arr-'+sec);
      if (!body) return;
      const isOpen=!body.classList.contains('hidden');
      body.classList.toggle('hidden',isOpen);
      if (arr) arr.classList.toggle('open',!isOpen);
    });
  });

  /* ── Тайминги ── */
  document.getElementById('tt-tm-save').onclick=function(){
    Object.keys(DEFAULT_TIMINGS).forEach(k=>{
      const inp=document.getElementById('tt-tm-'+k);
      if(inp) TIMINGS[k]=Math.max(0,Number(inp.value)||0);
    });
    storageSet(TIMINGS_KEY,JSON.stringify(TIMINGS));
    setStatus('ok','✅ Тайминги сохранены.');
  };
  document.getElementById('tt-tm-reset').onclick=function(){
    TIMINGS=Object.assign({},DEFAULT_TIMINGS);
    Object.keys(DEFAULT_TIMINGS).forEach(k=>{ const inp=document.getElementById('tt-tm-'+k); if(inp) inp.value=DEFAULT_TIMINGS[k]; });
    storageSet(TIMINGS_KEY,JSON.stringify(TIMINGS));
    setStatus('ok','✅ Тайминги сброшены.');
  };

  /* ── Переопределяем log и setStatus для поддержки batch-вкладки ── */
  const origLog = log;
  window._ttActiveTab = 'single';
  panel.querySelectorAll('.tab').forEach(t=>{
    t.addEventListener('click',()=>{ window._ttActiveTab = t.dataset.tab; });
  });

  /* Патчим log: дублируем в batch-log когда активна batch-вкладка */
  const origSetStatus = setStatus;

  /* ── Drag ── */
  let ox=0,oy=0,drag=false;
  const hdr=panel.querySelector('.hdr');
  hdr.addEventListener('mousedown',e=>{ if(e.target.tagName==='BUTTON') return; drag=true; const r=panel.getBoundingClientRect(); ox=e.clientX-r.left; oy=e.clientY-r.top; e.preventDefault(); });
  document.addEventListener('mousemove',e=>{ if(!drag) return; panel.style.left=e.clientX-ox+'px'; panel.style.top=e.clientY-oy+'px'; panel.style.right='auto'; });
  document.addEventListener('mouseup',()=>drag=false);

  checkBridge();
  log('TikTok Combined Helper v8.0 initialized');
}

/* ─── ЗАПУСК ────────────────────────────────────────────────── */
new MutationObserver(scan).observe(document.body,{childList:true,subtree:true});
[600,1800,4000].forEach(t=>setTimeout(scan,t));

window.addEventListener('load',()=>setTimeout(init,DEFAULT_TIMINGS.dostupElemeta));
let lastHref=location.href;
setInterval(()=>{
  if(location.href!==lastHref){
    lastHref=location.href;
    nativeRefs.date=null; nativeRefs.time=null;
    setTimeout(init,DEFAULT_TIMINGS.posleNavigacii);
  }
},1000);

})();