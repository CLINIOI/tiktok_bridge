// ==UserScript==
// @name         TikTok Studio Upload Helper LIGHT
// @namespace    http://tampermonkey.net/
// @version      2.8-timings
// @description  Панель для TikTok Studio: разбор строки, вставка описания, отложенная публикация и загрузка видео через локальный bridge. Ручная настройка таймингов.
// @author       FANTOM
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

    const BRIDGE = 'http://127.0.0.1:8765';
    const TOKEN = '1224444';
    const PANEL_ID = 'tt-helper-light-panel';
    const LOG_PREFIX = '[TT Helper LIGHT]';
    const STORAGE_KEY = 'tt_helper_last_input';
    const TIMINGS_KEY = 'tt_helper_timings';

    // ============================================================
    // ТАЙМИНГИ — можно менять прямо в панели (мс)
    // ============================================================
    const DEFAULT_TIMINGS = {
        posleZagruzki:      3000,   // Ожидание после старта загрузки видео
        posleZapolneniya:   2000,   // Ожидание после вставки текста
        poslePereklucheniya:2000,   // Ожидание после клика "Запланировать"
        posleDaty:          400,    // Ожидание после вставки даты
        mezhduPovtorami:    500,    // Интервал между попытками найти input[type=file]
        dostupElemeta:      1200,   // Ожидание инициализации страницы при загрузке
        posleNavigacii:     1500,   // Ожидание после смены URL
    };

    let TIMINGS = Object.assign({}, DEFAULT_TIMINGS);

    function loadTimings() {
        try {
            const raw = storageGet(TIMINGS_KEY, '');
            if (raw) {
                const saved = JSON.parse(raw);
                Object.keys(DEFAULT_TIMINGS).forEach(function(k) {
                    if (typeof saved[k] === 'number') TIMINGS[k] = saved[k];
                });
            }
        } catch(_) {}
    }

    function saveTimings() {
        storageSet(TIMINGS_KEY, JSON.stringify(TIMINGS));
    }

    let parsed = { path: '', tags: '', date: '', caption: '' };

    function log() {
        const args = Array.prototype.slice.call(arguments);
        console.log.apply(console, [LOG_PREFIX].concat(args));
        const box = document.getElementById('tt-light-log');
        if (!box) return;
        const line = document.createElement('div');
        line.textContent = '[' + new Date().toLocaleTimeString() + '] ' + args.map(stringify).join(' ');
        box.appendChild(line);
        box.scrollTop = box.scrollHeight;
    }

    function stringify(x) {
        try { return typeof x === 'string' ? x : JSON.stringify(x); }
        catch (e) { return String(x); }
    }

    function escapeHtml(s) {
        return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    }

    function sleep(ms) {
        return new Promise(function(r){ setTimeout(r, Number(ms) || 0); });
    }

    function storageGet(key, fallback) {
        try { if (typeof GM_getValue === 'function') return GM_getValue(key, fallback); } catch(_) {}
        try { return localStorage.getItem(key) || fallback; } catch(_) { return fallback; }
    }

    function storageSet(key, value) {
        try { if (typeof GM_setValue === 'function') { GM_setValue(key, value); return; } } catch(_) {}
        try { localStorage.setItem(key, value); } catch(_) {}
    }

    function shouldRun() {
        const h = location.href;
        return h.indexOf('tiktokstudio') !== -1 ||
               h.indexOf('studio.tiktok.com') !== -1 ||
               h.indexOf('/upload') !== -1;
    }

    // Описания таймингов на русском для отображения в панели
    const TIMING_LABELS = {
        posleZagruzki:       'После старта загрузки видео (мс)',
        posleZapolneniya:    'После вставки текста (мс)',
        poslePereklucheniya: 'После клика "Запланировать" (мс)',
        posleDaty:           'После вставки даты (мс)',
        mezhduPovtorami:     'Интервал поиска input[file] (мс)',
        dostupElemeta:       'Ожидание инициализации страницы (мс)',
        posleNavigacii:      'Ожидание после смены URL (мс)',
    };

    function buildTimingsHTML() {
        let html = '';
        Object.keys(DEFAULT_TIMINGS).forEach(function(k) {
            html +=
                '<div class="tm-row">' +
                '<label class="tm-label" for="tm-' + k + '">' + escapeHtml(TIMING_LABELS[k]) + '</label>' +
                '<input class="tm-input" id="tm-' + k + '" type="number" min="0" step="50" value="' + TIMINGS[k] + '">' +
                '</div>';
        });
        return html;
    }

    function init() {
        if (!shouldRun()) return;
        if (document.getElementById(PANEL_ID)) return;
        if (!document.body) return;

        loadTimings();

        const panel = document.createElement('div');
        panel.id = PANEL_ID;
        panel.innerHTML =
'<style>' +
'#' + PANEL_ID + '{position:fixed;top:70px;right:12px;width:370px;max-height:90vh;overflow:auto;' +
'background:#18181b;color:#e5e7eb;border:1px solid #3f3f46;border-radius:12px;' +
'box-shadow:0 10px 30px rgba(0,0,0,.45);z-index:2147483647;' +
"font:13px/1.45 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif}" +
'#' + PANEL_ID + ' *{box-sizing:border-box}' +
'#' + PANEL_ID + ' .hdr{display:flex;justify-content:space-between;align-items:center;padding:10px 12px;background:#09090b;border-bottom:1px solid #3f3f46;cursor:move}' +
'#' + PANEL_ID + ' .ttl{font-weight:700;color:#fff}' +
'#' + PANEL_ID + ' .mini{background:none;border:none;color:#a1a1aa;cursor:pointer;font-size:14px;padding:0 4px}' +
'#' + PANEL_ID + ' .mini:hover{color:#fff}' +
'#' + PANEL_ID + ' .body{padding:12px;display:flex;flex-direction:column;gap:10px}' +
'#' + PANEL_ID + ' textarea{width:100%;min-height:88px;resize:vertical;background:#09090b;color:#e5e7eb;border:1px solid #3f3f46;border-radius:8px;padding:8px 10px;font:12px/1.5 Consolas,monospace}' +
'#' + PANEL_ID + ' button{border:none;border-radius:8px;padding:8px 10px;background:#27272a;color:#e5e7eb;cursor:pointer;font-size:12px;font-weight:600}' +
'#' + PANEL_ID + ' button:hover{background:#3f3f46}' +
'#' + PANEL_ID + ' button:disabled{opacity:.5;cursor:not-allowed}' +
'#' + PANEL_ID + ' .primary{background:#4f46e5;color:#fff}' +
'#' + PANEL_ID + ' .primary:hover{background:#4338ca}' +
'#' + PANEL_ID + ' .sched-btn{background:#0e7490;color:#fff}' +
'#' + PANEL_ID + ' .sched-btn:hover{background:#0c6a82}' +
'#' + PANEL_ID + ' .row{display:flex;gap:8px;flex-wrap:wrap}' +
'#' + PANEL_ID + ' .row button{flex:1 1 0;min-width:90px}' +
'#' + PANEL_ID + ' .box{background:#09090b;border:1px solid #3f3f46;border-radius:8px;padding:8px 10px}' +
'#' + PANEL_ID + ' .status{font-size:11px;line-height:1.5}' +
'#' + PANEL_ID + ' .ok{background:#14532d;color:#86efac}' +
'#' + PANEL_ID + ' .warn{background:#451a03;color:#fdba74}' +
'#' + PANEL_ID + ' .err{background:#450a0a;color:#fca5a5}' +
'#' + PANEL_ID + ' .info{background:#1e293b;color:#bfdbfe}' +
'#' + PANEL_ID + ' .parsed{display:none;font-size:11px;line-height:1.6}' +
'#' + PANEL_ID + ' .parsed.visible{display:block}' +
'#' + PANEL_ID + ' .log{max-height:110px;overflow:auto;font-size:10px;white-space:pre-wrap;word-break:break-word;color:#a1a1aa}' +
'#' + PANEL_ID + '.collapsed .body{display:none}' +
'#' + PANEL_ID + ' .tm-section{border:1px solid #3f3f46;border-radius:8px;overflow:hidden}' +
'#' + PANEL_ID + ' .tm-header{background:#09090b;padding:8px 10px;cursor:pointer;display:flex;justify-content:space-between;align-items:center;font-weight:600;font-size:12px;color:#7dd3fc;user-select:none}' +
'#' + PANEL_ID + ' .tm-header:hover{background:#111}' +
'#' + PANEL_ID + ' .tm-body{padding:10px;display:flex;flex-direction:column;gap:6px;background:#0d0d10}' +
'#' + PANEL_ID + ' .tm-body.hidden{display:none}' +
'#' + PANEL_ID + ' .tm-row{display:grid;grid-template-columns:1fr 80px;gap:6px;align-items:center}' +
'#' + PANEL_ID + ' .tm-label{font-size:11px;color:#94a3b8;line-height:1.3}' +
'#' + PANEL_ID + ' .tm-input{background:#09090b;border:1px solid #3f3f46;color:#e5e7eb;border-radius:6px;padding:4px 6px;font-size:12px;width:100%;text-align:right}' +
'#' + PANEL_ID + ' .tm-input:focus{outline:none;border-color:#4f46e5}' +
'#' + PANEL_ID + ' .tm-actions{display:flex;gap:6px;margin-top:4px}' +
'#' + PANEL_ID + ' .tm-actions button{flex:1;font-size:11px;padding:5px 6px}' +
'</style>' +
'<div class="hdr"><div class="ttl">TT Helper LIGHT v2.8</div>' +
'<button class="mini" id="tt-light-toggle" title="Свернуть">—</button></div>' +
'<div class="body">' +
'  <div class="box status info" id="tt-light-bridge">Bridge: проверяется…</div>' +
'  <textarea id="tt-light-input" placeholder="D:\\Videos\\cat.mp4 | #cats #funny | 2026-04-25 18:30 | caption"></textarea>' +
'  <div class="box parsed" id="tt-light-parsed"></div>' +
'  <div class="row">' +
'    <button id="tt-light-parse">Разобрать</button>' +
'    <button id="tt-light-fill">Заполнить текст</button>' +
'  </div>' +
'  <div class="row">' +
'    <button id="tt-light-schedule" class="sched-btn">Запланировать</button>' +
'    <button id="tt-light-upload">Загрузить видео</button>' +
'  </div>' +
'  <div class="row">' +
'    <button id="tt-light-all" class="primary">Сделать всё</button>' +
'  </div>' +
'  <div class="box status info" id="tt-light-status">Ожидание действия.</div>' +
'  <div class="tm-section">' +
'    <div class="tm-header" id="tt-tm-toggle">⏱ Тайминги <span id="tt-tm-arrow">▶</span></div>' +
'    <div class="tm-body hidden" id="tt-tm-body">' +
           buildTimingsHTML() +
'      <div class="tm-actions">' +
'        <button id="tt-tm-save">💾 Сохранить</button>' +
'        <button id="tt-tm-reset">↺ По умолчанию</button>' +
'      </div>' +
'    </div>' +
'  </div>' +
'  <div class="box"><div class="log" id="tt-light-log"></div></div>' +
'</div>';

        document.body.appendChild(panel);
        log('script started v2.8-timings');

        const saved = storageGet(STORAGE_KEY, '');
        if (saved) document.getElementById('tt-light-input').value = saved;

        document.getElementById('tt-light-parse').addEventListener('click', doParse);
        document.getElementById('tt-light-fill').addEventListener('click', doFill);
        document.getElementById('tt-light-schedule').addEventListener('click', function(){ doSchedule(); });
        document.getElementById('tt-light-upload').addEventListener('click', doUpload);
        document.getElementById('tt-light-all').addEventListener('click', doAll);
        document.getElementById('tt-light-toggle').addEventListener('click', toggleCollapse);
        document.getElementById('tt-light-input').addEventListener('input', function(e){
            storageSet(STORAGE_KEY, e.target.value);
        });

        // Раскрытие/скрытие секции таймингов
        document.getElementById('tt-tm-toggle').addEventListener('click', function() {
            const body = document.getElementById('tt-tm-body');
            const arrow = document.getElementById('tt-tm-arrow');
            body.classList.toggle('hidden');
            arrow.textContent = body.classList.contains('hidden') ? '▶' : '▼';
        });

        // Сохранить тайминги
        document.getElementById('tt-tm-save').addEventListener('click', function() {
            Object.keys(DEFAULT_TIMINGS).forEach(function(k) {
                const inp = document.getElementById('tm-' + k);
                if (inp) TIMINGS[k] = Math.max(0, Number(inp.value) || 0);
            });
            saveTimings();
            log('тайминги сохранены', JSON.stringify(TIMINGS));
            setStatus('ok', 'Тайминги сохранены.');
        });

        // Сбросить к значениям по умолчанию
        document.getElementById('tt-tm-reset').addEventListener('click', function() {
            TIMINGS = Object.assign({}, DEFAULT_TIMINGS);
            Object.keys(DEFAULT_TIMINGS).forEach(function(k) {
                const inp = document.getElementById('tm-' + k);
                if (inp) inp.value = DEFAULT_TIMINGS[k];
            });
            saveTimings();
            log('тайминги сброшены к умолчанию');
            setStatus('ok', 'Тайминги сброшены.');
        });

        makeDraggable(panel, panel.querySelector('.hdr'));
        checkBridge();
    }

    function toggleCollapse() {
        const panel = document.getElementById(PANEL_ID);
        if (!panel) return;
        panel.classList.toggle('collapsed');
        const btn = document.getElementById('tt-light-toggle');
        if (btn) btn.textContent = panel.classList.contains('collapsed') ? '+' : '—';
    }

    function makeDraggable(panel, handle) {
        let ox=0,oy=0,dragging=false;
        handle.addEventListener('mousedown', function(e){
            if (e.target.tagName==='BUTTON') return;
            dragging=true;
            const r=panel.getBoundingClientRect();
            ox=e.clientX-r.left; oy=e.clientY-r.top; e.preventDefault();
        });
        document.addEventListener('mousemove', function(e){
            if (!dragging) return;
            panel.style.left=(e.clientX-ox)+'px';
            panel.style.top=(e.clientY-oy)+'px';
            panel.style.right='auto';
        });
        document.addEventListener('mouseup', function(){ dragging=false; });
    }

    function setStatus(type, text) {
        const el=document.getElementById('tt-light-status');
        if (!el) return;
        el.textContent=text; el.className='box status '+type;
    }

    function setBridge(type, text) {
        const el=document.getElementById('tt-light-bridge');
        if (!el) return;
        el.textContent=text; el.className='box status '+type;
    }

    function setButtonsBusy(busy) {
        ['tt-light-parse','tt-light-fill','tt-light-schedule','tt-light-upload','tt-light-all'].forEach(function(id){
            const b=document.getElementById(id); if (b) b.disabled=busy;
        });
    }

    function checkBridge() {
        GM_xmlhttpRequest({
            method:'GET', url:BRIDGE+'/health', timeout:5000,
            onload:function(r){
                if (r.status===200){ setBridge('ok','Bridge: OK'); log('bridge ok'); }
                else setBridge('err','Bridge: HTTP '+r.status);
            },
            onerror:function(){ setBridge('err','Bridge: недоступен'); },
            ontimeout:function(){ setBridge('err','Bridge: timeout'); }
        });
    }

    function parseInputLine(line) {
        const out={path:'',tags:'',date:'',caption:''};
        if (/\bpath\s*=/.test(line)) {
            line.split(';').forEach(function(part){
                const idx=part.indexOf('='); if (idx===-1) return;
                const k=part.slice(0,idx).trim().toLowerCase();
                const v=part.slice(idx+1).trim();
                if (k in out) out[k]=v;
            });
            return out;
        }
        const parts=line.split('|').map(function(s){ return s.trim(); });
        out.path=parts[0]||'';
        out.tags=parts[1]||'';
        out.date=parts[2]||'';
        out.caption=parts[3]||'';
        return out;
    }

    function doParse() {
        const raw=(document.getElementById('tt-light-input').value||'').trim();
        if (!raw){ setStatus('err','Введи строку с данными.'); return false; }
        parsed=parseInputLine(raw);
        renderParsed(parsed);
        setStatus('ok','Строка разобрана.');
        log('parsed',parsed);
        return true;
    }

    function renderParsed(p) {
        const el=document.getElementById('tt-light-parsed');
        if (!el) return;
        const v=function(x){ return x?escapeHtml(x):'(пусто)'; };
        el.innerHTML='<b>path:</b> '+v(p.path)+'<br><b>tags:</b> '+v(p.tags)+'<br><b>date:</b> '+v(p.date)+'<br><b>caption:</b> '+v(p.caption);
        el.classList.add('visible');
    }

    // ====================================================
    // FILL
    // ====================================================
    function doFill() {
        if (!parsed.path && !parsed.tags && !parsed.date && !parsed.caption) {
            if (!doParse()) return;
        }
        const text = [parsed.caption, parsed.tags].filter(Boolean).join(' ');
        if (!text) { setStatus('warn','Нет текста для вставки.'); return; }

        const editor = findDraftEditor();
        if (!editor) {
            setStatus('warn','Поле описания не найдено.');
            log('Draft editor not found');
            return;
        }

        insertIntoDraftEditor(editor, text);
        log('caption filled:', text);
        setStatus('ok','Текст вставлен.');
    }

    function findDraftEditor() {
        const exact = document.querySelector('.public-DraftEditor-content');
        if (exact) return exact;
        const all = document.querySelectorAll('div[contenteditable="true"]');
        for (let i=0; i<all.length; i++) {
            const r = all[i].getBoundingClientRect();
            if (r.width > 100) return all[i];
        }
        return null;
    }

    function insertIntoDraftEditor(el, text) {
        el.focus();
        try {
            const sel = window.getSelection();
            const range = document.createRange();
            range.selectNodeContents(el);
            sel.removeAllRanges();
            sel.addRange(range);
            document.execCommand('selectAll', false, null);
            document.execCommand('delete', false, null);
            setTimeout(function() {
                document.execCommand('insertText', false, text);
                log('Draft.js: insertText via execCommand ok');
            }, 50);
        } catch(e) {
            log('insertText execCommand error:', e.message);
            try {
                const dt = new DataTransfer();
                dt.setData('text/plain', text);
                el.dispatchEvent(new ClipboardEvent('paste', {
                    bubbles: true, cancelable: true, clipboardData: dt
                }));
                log('Draft.js: paste via ClipboardEvent');
            } catch(e2) {
                log('ClipboardEvent error:', e2.message);
            }
        }
    }

    // ====================================================
    // SCHEDULE
    // ====================================================
    async function doSchedule() {
        if (!parsed.path && !parsed.date) { if (!doParse()) return false; }
        if (!parsed.date) {
            setStatus('warn','Дата не указана в строке.');
            log('date empty, skip schedule');
            return false;
        }

        setStatus('info','Включаю отложенную публикацию…');
        log('schedule date:', parsed.date);

        let toggled = false;

        const radioLabels = document.querySelectorAll('label.Radio__root, label[class*="Radio__root"]');
        log('Radio labels found:', radioLabels.length);
        for (let i=0; i<radioLabels.length; i++) {
            const txt = (radioLabels[i].textContent||'').trim();
            log('radio label text:', txt);
            if (txt === 'Запланировать' || txt === 'Schedule' || txt === 'Scheduled') {
                radioLabels[i].click();
                log('Clicked Radio__root label:', txt);
                toggled = true;
                break;
            }
        }

        if (!toggled) {
            const inputs = document.querySelectorAll('input.Radio__input, input[class*="Radio__input"]');
            log('Radio inputs found:', inputs.length);
            for (let i=0; i<inputs.length; i++) {
                const label = inputs[i].closest('label');
                if (label) {
                    const txt = (label.textContent||'').trim();
                    if (txt === 'Запланировать' || txt === 'Schedule') {
                        inputs[i].click();
                        log('Clicked Radio__input inside label:', txt);
                        toggled = true;
                        break;
                    }
                }
            }
        }

        if (!toggled) {
            const spans = document.querySelectorAll('span[class*="TUXText"]');
            for (let i=0; i<spans.length; i++) {
                const txt = (spans[i].textContent||'').trim();
                if (txt === 'Запланировать' || txt === 'Schedule') {
                    const label = spans[i].closest('label');
                    if (label) { label.click(); log('Clicked via TUXText span'); toggled=true; break; }
                    spans[i].click();
                    log('Clicked TUXText span directly');
                    toggled=true; break;
                }
            }
        }

        // Метод 4: поиск по тексту среди всех role=radio
        if (!toggled) {
            const roles = document.querySelectorAll('[role="radio"]');
            log('role=radio found:', roles.length);
            for (let i=0; i<roles.length; i++) {
                const txt = (roles[i].textContent||'').trim();
                if (txt === 'Запланировать' || txt === 'Schedule') {
                    roles[i].click();
                    log('Clicked role=radio:', txt);
                    toggled=true; break;
                }
            }
        }

        if (!toggled) {
            setStatus('warn','Переключатель "Запланировать" не найден.');
            log('schedule toggle NOT FOUND');
            return false;
        }

        await sleep(TIMINGS.poslePereklucheniya);

        const parts = parsed.date.trim().split(' ');
        const datePart = (parts[0]||'').trim();
        const timePart = (parts[1]||'').trim();
        log('datePart:', datePart, 'timePart:', timePart);

        if (datePart) {
            const dateInput = document.querySelector('input[type="date"]') ||
                findVisibleInput(['[placeholder*="гггг"]','[placeholder*="YYYY"]','[placeholder*="MM/DD"]',
                    '[class*="datePicker"] input','[class*="DatePicker"] input',
                    '[class*="date"] input','[class*="Date"] input']);
            if (dateInput) {
                let fmt = datePart;
                if (dateInput.type !== 'date' && /^\d{4}-\d{2}-\d{2}$/.test(datePart)) {
                    const parts2 = datePart.split('-');
                    fmt = parts2[1]+'/'+parts2[2]+'/'+parts2[0];
                }
                setNativeValue(dateInput, fmt);
                log('date set:', fmt);
            } else {
                log('date input not found after schedule toggle');
            }
        }

        await sleep(TIMINGS.posleDaty);

        if (timePart) {
            const timeInput = document.querySelector('input[type="time"]') ||
                findVisibleInput(['[placeholder*="HH"]','[placeholder*="чч"]',
                    '[class*="timePicker"] input','[class*="TimePicker"] input',
                    '[class*="time"] input']);
            if (timeInput) {
                setNativeValue(timeInput, timePart);
                log('time set:', timePart);
            } else {
                log('time input not found');
            }
        }

        setStatus('ok','Дата публикации: '+parsed.date);
        log('schedule done');
        return true;
    }

    function findVisibleInput(selectors) {
        for (let i=0; i<selectors.length; i++) {
            try {
                const els = document.querySelectorAll(selectors[i]);
                for (let j=0; j<els.length; j++) {
                    const r=els[j].getBoundingClientRect();
                    if (r.width>0&&r.height>0) return els[j];
                }
            } catch(_) {}
        }
        return null;
    }

    function setNativeValue(el, value) {
        el.focus();
        const proto = el.tagName==='INPUT'
            ? window.HTMLInputElement.prototype
            : window.HTMLTextAreaElement.prototype;
        const desc = Object.getOwnPropertyDescriptor(proto, 'value');
        if (desc && desc.set) desc.set.call(el, value);
        else el.value = value;
        el.dispatchEvent(new Event('input',{bubbles:true}));
        el.dispatchEvent(new Event('change',{bubbles:true}));
        el.dispatchEvent(new KeyboardEvent('keydown',{bubbles:true,key:'Enter',keyCode:13}));
    }

    // ====================================================
    // UPLOAD
    // ====================================================
    function doUpload() {
        if (!parsed.path){ if (!doParse()) return; }
        if (!parsed.path){ setStatus('err','Нужен путь к файлу.'); return; }
        setStatus('info','Проверяю файл через bridge…');
        setButtonsBusy(true);
        GM_xmlhttpRequest({
            method:'GET',
            url:BRIDGE+'/check?path='+encodeURIComponent(parsed.path),
            headers:{'X-Token':TOKEN},
            timeout:10000,
            onload:function(r){
                let data={};
                try{ data=JSON.parse(r.responseText); }catch(_){}
                if (r.status!==200||!data.exists){
                    setStatus('err','Файл не найден: '+(data.error||'bridge '+r.status));
                    log('check failed',r.status,data); setButtonsBusy(false); return;
                }
                log('file size',data.size);
                waitForFileInput(0);
            },
            onerror:function(){ setStatus('err','Bridge error.'); setButtonsBusy(false); },
            ontimeout:function(){ setStatus('err','Bridge timeout.'); setButtonsBusy(false); }
        });
    }

    function waitForFileInput(attempt) {
        const input=findFileInput();
        if (input){ log('file input found'); injectFile(parsed.path,input); return; }
        if (attempt>=10){
            setStatus('warn','input[type=file] не найден. Нажми «Выбрать видео» вручную.');
            setButtonsBusy(false); return;
        }
        setStatus('info','Ищу input[type=file]… попытка '+(attempt+1));
        setTimeout(function(){ waitForFileInput(attempt+1); }, TIMINGS.mezhduPovtorami);
    }

    function findFileInput() {
        const list=document.querySelectorAll('input[type="file"]');
        for (let i=0;i<list.length;i++){
            const accept=(list[i].accept||'').toLowerCase();
            if (accept.indexOf('video')!==-1||accept==='') return list[i];
        }
        return list[0]||null;
    }

    function injectFile(path, input) {
        setStatus('info','Загружаю видео через bridge…');
        GM_xmlhttpRequest({
            method:'GET',
            url:BRIDGE+'/file?path='+encodeURIComponent(path),
            headers:{'X-Token':TOKEN},
            responseType:'blob',
            timeout:600000,
            onprogress:function(ev){
                if (ev&&ev.total){
                    const pct=Math.floor((ev.loaded/ev.total)*100);
                    setStatus('info','Загружаю: '+pct+'% ('+Math.round(ev.loaded/1024/1024)+'/'+Math.round(ev.total/1024/1024)+' MB)');
                }
            },
            onload:function(r){
                if (r.status!==200&&r.status!==206){
                    setStatus('err','Bridge ответил '+r.status);
                    setButtonsBusy(false); return;
                }
                try {
                    const name=path.split(/[\\\/]/).pop();
                    const file=new File([r.response],name,{type:r.response.type||'video/mp4'});
                    const dt=new DataTransfer();
                    dt.items.add(file);
                    input.files=dt.files;
                    input.dispatchEvent(new Event('change',{bubbles:true}));
                    input.dispatchEvent(new Event('input',{bubbles:true}));
                    setStatus('ok','Видео передано в TikTok ('+Math.round(file.size/1024/1024)+' MB).');
                    log('file injected',name,file.size);
                } catch(e){
                    setStatus('err','Ошибка File/DataTransfer: '+e.message);
                    log('inject error',e.message);
                } finally {
                    setButtonsBusy(false);
                }
            },
            onerror:function(){ setStatus('err','Ошибка получения файла.'); setButtonsBusy(false); },
            ontimeout:function(){ setStatus('err','Timeout при загрузке файла.'); setButtonsBusy(false); }
        });
    }

    // ====================================================
    // DO ALL
    // ====================================================
    async function doAll() {
        if (!doParse()) return;
        doUpload();
        await sleep(TIMINGS.posleZagruzki);
        doFill();
        await sleep(TIMINGS.posleZapolneniya);
        await doSchedule();
    }

    window.addEventListener('load', function(){ setTimeout(init, TIMINGS.dostupElemeta); });
    let lastHref=location.href;
    setInterval(function(){
        if (location.href!==lastHref){ lastHref=location.href; setTimeout(init, TIMINGS.posleNavigacii); }
    }, 1000);
})();
