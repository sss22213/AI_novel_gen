(function () {
if (!window.NOVEL_I18N) {
    document.body.innerHTML =
        '<div style="max-width:640px;margin:80px auto;padding:32px;color:#e4e7ec;' +
        'font-family:sans-serif;background:#181c24;border:1px solid #2c333d;border-radius:12px;line-height:1.7">' +
        '<h2 style="margin-top:0;color:#ef4444">載入錯誤：i18n.js 未載入</h2>' +
        '<p>語言資料檔 <code>/static/i18n.js</code> 沒有成功載入，因此介面無法初始化。</p>' +
        '<p>請依序檢查：</p><ol>' +
        '<li>在網址列直接開啟 <code>/static/i18n.js</code>，應看到 JS 程式碼（HTTP 200）；若是 404，代表容器內缺少該檔，請重新 <code>docker compose up -d --build</code>。</li>' +
        '<li>硬刷新瀏覽器：<b>Ctrl + Shift + R</b>。</li>' +
        '</ol></div>';
    throw new Error('window.NOVEL_I18N is missing — i18n.js failed to load');
}

const { LANGS, OUTPUT_LANGS, GENRES, I18N, PROMPT_TMPL, t } = window.NOVEL_I18N;

let uiLang = localStorage.getItem('novel_ui_lang') || 'zh-TW';
if (!(uiLang in LANGS)) uiLang = 'zh-TW';

function tt(key, vars) {
    let s = t(key, uiLang);
    if (vars) for (const k in vars) s = s.split('{' + k + '}').join(vars[k]);
    return s;
}

const els = {
    uiLangSel: document.getElementById('ui-lang'),
    model: document.getElementById('model'),
    refreshModels: document.getElementById('refresh-models'),
    template: document.getElementById('template'),
    saveTemplate: document.getElementById('save-template'),
    deleteTemplate: document.getElementById('delete-template'),
    genre: document.getElementById('genre'),
    language: document.getElementById('language'),
    length: document.getElementById('length'),
    lengthCustom: document.getElementById('length-custom'),
    temperature: document.getElementById('temperature'),
    tempValue: document.getElementById('temp-value'),
    system: document.getElementById('system'),
    styleSample: document.getElementById('style-sample'),
    keywords: document.getElementById('keywords'),
    generate: document.getElementById('generate'),
    stop: document.getElementById('stop'),
    output: document.getElementById('output'),
    status: document.getElementById('status'),
    copy: document.getElementById('copy'),
    download: document.getElementById('download'),
    clear: document.getElementById('clear'),
    historyList: document.getElementById('history-list'),
    historyCount: document.getElementById('history-count'),
    historyRefresh: document.getElementById('history-refresh'),
    historyClearAll: document.getElementById('history-clear-all'),
    historyEmpty: document.getElementById('history-empty'),
    historyDetail: document.getElementById('history-detail'),
    detailTitle: document.getElementById('detail-title'),
    detailMeta: document.getElementById('detail-meta'),
    detailContent: document.getElementById('detail-content'),
    detailLoad: document.getElementById('detail-load'),
    detailCopy: document.getElementById('detail-copy'),
    detailDownload: document.getElementById('detail-download'),
    detailDelete: document.getElementById('detail-delete'),
};

let abortController = null;
let currentDetail = null;
let templatesCache = [];

function setStatus(msg, kind = '') {
    els.status.textContent = msg;
    els.status.className = 'status' + (kind ? ' ' + kind : '');
}

function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
}

function genreLabel(key) {
    const g = GENRES.find((x) => x.key === key);
    return g ? (g.labels[uiLang] || g.labels['zh-TW']) : key;
}

function outputLangName(code) {
    const l = OUTPUT_LANGS.find((x) => x.code === code);
    return l ? l.name : code;
}

/* ===== i18n 套用 ===== */
function renderUiLangSwitch() {
    els.uiLangSel.innerHTML = '';
    for (const code in LANGS) {
        const opt = document.createElement('option');
        opt.value = code;
        opt.textContent = LANGS[code];
        els.uiLangSel.appendChild(opt);
    }
    els.uiLangSel.value = uiLang;
    els.uiLangSel.addEventListener('change', () => {
        uiLang = els.uiLangSel.value;
        localStorage.setItem('novel_ui_lang', uiLang);
        applyI18n();
    });
}

function renderGenre() {
    const prev = els.genre.value;
    els.genre.innerHTML = '';
    for (const g of GENRES) {
        const opt = document.createElement('option');
        opt.value = g.key;
        opt.textContent = g.labels[uiLang] || g.labels['zh-TW'];
        els.genre.appendChild(opt);
    }
    if (prev) els.genre.value = prev;
}

function renderOutputLangs() {
    els.language.innerHTML = '';
    for (const l of OUTPUT_LANGS) {
        const opt = document.createElement('option');
        opt.value = l.code;
        opt.textContent = l.name;
        els.language.appendChild(opt);
    }
    // 預設跟隨介面語言（若該語言可輸出）
    els.language.value = OUTPUT_LANGS.some((l) => l.code === uiLang) ? uiLang : 'zh-TW';
}

function renderTemplates(list) {
    templatesCache = list || [];
    const prev = els.template.value;
    els.template.innerHTML = '';
    const none = document.createElement('option');
    none.value = '';
    none.textContent = tt('opt_no_template');
    els.template.appendChild(none);
    for (const tpl of templatesCache) {
        const opt = document.createElement('option');
        opt.value = tpl.id;
        let label = tpl.builtin ? t(tpl.name, uiLang) : tpl.name;
        if (tpl.builtin) label += ' · ' + tt('builtin_badge');
        opt.textContent = label;
        els.template.appendChild(opt);
    }
    if (prev && [...els.template.options].some((o) => o.value === prev)) {
        els.template.value = prev;
    }
    const cur = templatesCache.find((x) => x.id === els.template.value);
    els.deleteTemplate.hidden = !(cur && !cur.builtin);
}

function applyI18n() {
    document.documentElement.lang = uiLang;
    document.querySelectorAll('[data-i18n]').forEach((el) => {
        el.textContent = tt(el.dataset.i18n);
    });
    document.querySelectorAll('[data-i18n-ph]').forEach((el) => {
        const v = tt(el.dataset.i18nPh);
        if ('placeholder' in el) el.placeholder = v;
        else el.setAttribute('data-placeholder', v);
    });
    document.querySelectorAll('[data-i18n-title]').forEach((el) => {
        el.title = tt(el.dataset.i18nTitle);
    });
    renderGenre();
    renderTemplates(templatesCache);
    // 模型下拉首項提示（語言切換時同步更新）
    if (els.model.options.length && els.model.options[0].value === '') {
        els.model.options[0].textContent = tt('model_hint', { n: els.model.options.length - 1 });
    }
}

/* ===== 模型 ===== */
async function loadModels() {
    setStatus(tt('status_loading_models'));
    try {
        const res = await fetch('/api/models');
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.detail || ('HTTP ' + res.status));
        }
        const data = await res.json();
        const prev = els.model.value;
        els.model.innerHTML = '';
        // 首項為提示（value 空字串），取代原本的「已載入 N 個模型」狀態文字
        const hint = document.createElement('option');
        hint.value = '';
        hint.textContent = tt('model_hint', { n: data.models.length });
        els.model.appendChild(hint);
        for (const m of data.models) {
            const opt = document.createElement('option');
            opt.value = m;
            opt.textContent = m;
            els.model.appendChild(opt);
        }
        els.model.value = (prev && data.models.includes(prev)) ? prev : '';
        setStatus('');
    } catch (e) {
        setStatus(tt('status_load_models_fail') + e.message, 'error');
    }
}

/* ===== 範本 ===== */
async function loadTemplates() {
    try {
        const res = await fetch('/api/templates');
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const data = await res.json();
        renderTemplates(data.templates || []);
    } catch (e) {
        console.warn('載入範本失敗：', e);
    }
}

els.template.addEventListener('change', () => {
    const id = els.template.value;
    const tpl = templatesCache.find((x) => x.id === id);
    els.deleteTemplate.hidden = !(tpl && !tpl.builtin);
    if (!id || !tpl) return;
    applySettings(tpl.settings);
    if (tpl.style_sample != null) els.styleSample.value = tpl.style_sample;
    setStatus(tt('status_template_loaded'), 'success');
});

els.saveTemplate.addEventListener('click', async () => {
    const name = window.prompt(tt('prompt_template_name'));
    if (!name || !name.trim()) return;
    try {
        const res = await fetch('/api/templates', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                name: name.trim(),
                settings: gatherSettings(),
                style_sample: els.styleSample.value,
            }),
        });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const created = await res.json();
        await loadTemplates();
        els.template.value = created.id;
        els.deleteTemplate.hidden = false;
        setStatus(tt('status_template_saved'), 'success');
    } catch (e) {
        setStatus(tt('status_delete_fail') + e.message, 'error');
    }
});

els.deleteTemplate.addEventListener('click', async () => {
    const id = els.template.value;
    const tpl = templatesCache.find((x) => x.id === id);
    if (!tpl || tpl.builtin) return;
    if (!confirm(tt('confirm_delete_template'))) return;
    try {
        const res = await fetch('/api/templates/' + id, { method: 'DELETE' });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        await loadTemplates();
        els.template.value = '';
        els.deleteTemplate.hidden = true;
    } catch (e) {
        setStatus(tt('status_delete_fail') + e.message, 'error');
    }
});

/* ===== 連動 UI ===== */
els.temperature.addEventListener('input', () => {
    els.tempValue.textContent = parseFloat(els.temperature.value).toFixed(2);
});

els.length.addEventListener('change', () => {
    els.lengthCustom.hidden = els.length.value !== 'custom';
    if (els.length.value === 'custom') els.lengthCustom.focus();
});

els.refreshModels.addEventListener('click', loadModels);

function getWordCount() {
    if (els.length.value === 'custom') {
        const v = parseInt(els.lengthCustom.value);
        return isFinite(v) && v > 0 ? v : 3000;
    }
    return parseInt(els.length.value);
}

/* ===== 設定收集 / 套用 ===== */
function gatherSettings() {
    return {
        model: els.model.value,
        genre: els.genre.value,
        language: els.language.value,
        length: els.length.value,
        lengthCustom: els.lengthCustom.value,
        temperature: els.temperature.value,
        system: els.system.value,
        styleSample: els.styleSample.value,
        keywords: els.keywords.value,
    };
}

function applySettings(s) {
    if (!s) return;
    if (s.model && [...els.model.options].some((o) => o.value === s.model)) {
        els.model.value = s.model;
    }
    if (s.genre && [...els.genre.options].some((o) => o.value === s.genre)) {
        els.genre.value = s.genre;
    }
    if (s.language && [...els.language.options].some((o) => o.value === s.language)) {
        els.language.value = s.language;
    }
    if (s.length) els.length.value = s.length;
    if (s.lengthCustom != null) els.lengthCustom.value = s.lengthCustom;
    if (s.temperature != null) els.temperature.value = s.temperature;
    if (s.system != null) els.system.value = s.system;
    if (s.styleSample != null) els.styleSample.value = s.styleSample;
    if (s.keywords != null) els.keywords.value = s.keywords;
    els.lengthCustom.hidden = els.length.value !== 'custom';
    els.tempValue.textContent = parseFloat(els.temperature.value || 0).toFixed(2);
}

/* ===== Prompt 組裝 =====
   指令用「輸出語言」本身撰寫（中文輸出→中文指令）。
   英文指令會讓部分中文模型完全不輸出，故依語言切換。 */
function promptTmplKey(code) {
    if (code === 'zh-TW' || code === 'zh-CN') return 'zh';
    return PROMPT_TMPL[code] ? code : 'en';
}

function buildPrompt() {
    const keywords = els.keywords.value.trim();
    const genre = GENRES.find((g) => g.key === els.genre.value);
    const wordCount = getWordCount();
    const langObj = OUTPUT_LANGS.find((l) => l.code === els.language.value) || OUTPUT_LANGS[0];
    const styleSample = els.styleSample.value.trim();

    const T = PROMPT_TMPL[promptTmplKey(langObj.code)];
    const genreName = genre ? (genre.labels[langObj.code] || genre.prompt) : '';

    const lines = [];
    if (genreName) lines.push(T.genre + genreName);
    lines.push(T.length(wordCount));
    lines.push(T.premise + keywords);
    if (styleSample) lines.push(T.sample + '\n' + styleSample);
    lines.push(T.body);
    lines.push(T.lang(langObj.name));
    return lines.join('\n\n');
}

function defaultSystem(langObj) {
    return PROMPT_TMPL[promptTmplKey(langObj.code)].system(langObj.name);
}

/* ===== 生成 ===== */
async function generate() {
    const model = els.model.value;
    if (!model) {
        setStatus(tt('status_select_model'), 'error');
        return;
    }
    if (!els.keywords.value.trim()) {
        setStatus(tt('status_need_keywords'), 'error');
        return;
    }

    const prompt = buildPrompt();
    const wordCount = getWordCount();
    // +1024 token 餘裕：思考型模型會先輸出 <think> 推理區塊（會被過濾掉），
    // 若預算太小，推理會吃光額度導致正文無法生成。額外餘裕確保正文一定有空間。
    const numPredict = Math.min(Math.ceil(wordCount * 2.5) + 1024, 32768);
    const langObj = OUTPUT_LANGS.find((l) => l.code === els.language.value) || OUTPUT_LANGS[0];
    const system = els.system.value.trim() || defaultSystem(langObj);
    const settings = gatherSettings();

    els.output.textContent = '';
    setStatus(tt('status_generating'), 'streaming');
    els.generate.disabled = true;
    els.stop.hidden = false;

    abortController = new AbortController();
    let charCount = 0;

    try {
        const res = await fetch('/api/generate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model,
                prompt,
                system,
                temperature: parseFloat(els.temperature.value),
                num_predict: numPredict,
            }),
            signal: abortController.signal,
        });

        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.detail || ('HTTP ' + res.status));
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder('utf-8');
        const start = Date.now();
        let lastTick = 0;
        const unit = tt('char_unit');

        while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            const text = decoder.decode(value, { stream: true });
            els.output.textContent += text;
            charCount += text.length;
            els.output.scrollTop = els.output.scrollHeight;

            const now = Date.now();
            if (now - lastTick > 100) {
                const elapsed = ((now - start) / 1000).toFixed(1);
                setStatus(tt('status_generating_progress', { n: charCount, unit, t: elapsed }), 'streaming');
                lastTick = now;
            }
        }

        const elapsed = ((Date.now() - start) / 1000).toFixed(1);
        if (charCount > 0) {
            await saveHistory(settings, els.output.textContent);
            setStatus(tt('status_done_saved', { n: charCount, unit, t: elapsed }), 'success');
        } else {
            setStatus(tt('status_no_content', { t: elapsed }), 'error');
        }
    } catch (e) {
        if (e.name === 'AbortError') {
            if (charCount > 0) await saveHistory(settings, els.output.textContent);
            setStatus(charCount > 0 ? tt('status_stopped_saved') : tt('status_stopped'));
        } else {
            setStatus(tt('status_gen_fail') + e.message, 'error');
        }
    } finally {
        els.generate.disabled = false;
        els.stop.hidden = true;
        abortController = null;
    }
}

async function saveHistory(settings, content) {
    try {
        const res = await fetch('/api/history', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ settings, content }),
        });
        if (!res.ok) throw new Error('HTTP ' + res.status);
    } catch (e) {
        console.warn('存入歷史失敗：', e);
    }
}

els.generate.addEventListener('click', generate);
els.stop.addEventListener('click', () => abortController?.abort());

/* ===== 輸出工具列 ===== */
function downloadText(text, prefix) {
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    a.href = url;
    a.download = `${prefix}_${stamp}.txt`;
    a.click();
    URL.revokeObjectURL(url);
}

async function copyText(text, btn) {
    if (!text) return;
    try {
        await navigator.clipboard.writeText(text);
        const prev = btn.textContent;
        btn.textContent = tt('copied');
        setTimeout(() => (btn.textContent = prev), 1500);
    } catch {
        setStatus(tt('status_copy_fail'), 'error');
    }
}

els.copy.addEventListener('click', () => copyText(els.output.textContent, els.copy));
els.download.addEventListener('click', () => {
    if (els.output.textContent) downloadText(els.output.textContent, 'novel');
});
els.clear.addEventListener('click', () => {
    if (!els.output.textContent) return;
    if (confirm(tt('confirm_clear'))) {
        els.output.textContent = '';
        setStatus('');
    }
});

/* ===== 分頁 ===== */
document.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
        const tab = btn.dataset.tab;
        document.querySelectorAll('.tab-btn').forEach((b) => b.classList.toggle('active', b === btn));
        document.querySelectorAll('.tab-panel').forEach((p) => {
            p.classList.toggle('active', p.id === 'tab-' + tab);
        });
        if (tab === 'history') loadHistory();
    });
});

/* ===== 歷史頁 ===== */
function fmtTime(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d)) return iso;
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

async function loadHistory() {
    els.historyList.innerHTML = `<div class="history-empty">${tt('history_loading')}</div>`;
    try {
        const res = await fetch('/api/history');
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const data = await res.json();
        renderHistoryList(data.history || []);
    } catch (e) {
        els.historyList.innerHTML = `<div class="history-empty">${tt('status_load_history_list_fail')}${escapeHtml(e.message)}</div>`;
    }
}

function renderHistoryList(items) {
    els.historyCount.textContent = items.length;
    if (!items.length) {
        els.historyList.innerHTML = `<div class="history-empty">${tt('history_no_records')}</div>`;
        return;
    }
    els.historyList.innerHTML = '';
    for (const item of items) {
        const card = document.createElement('div');
        card.className = 'history-card';
        card.dataset.id = item.id;

        const s = item.settings || {};
        const gl = s.genre ? genreLabel(s.genre) : '';
        const model = s.model || '?';

        const title = document.createElement('div');
        title.className = 'history-card-title';
        title.textContent = item.title || '(—)';

        const meta = document.createElement('div');
        meta.className = 'history-card-meta';
        meta.innerHTML =
            `<span class="chip">${fmtTime(item.created_at)}</span>` +
            (gl ? `<span class="chip">${escapeHtml(gl)}</span>` : '') +
            (s.language ? `<span class="chip">${escapeHtml(outputLangName(s.language))}</span>` : '') +
            `<span class="chip">${item.char_count} ${tt('char_unit')}</span>`;

        const preview = document.createElement('div');
        preview.className = 'history-card-preview';
        preview.textContent = item.preview || '';

        const modelChip = document.createElement('div');
        modelChip.className = 'history-card-meta';
        modelChip.innerHTML = `<span class="chip">${escapeHtml(model)}</span>`;

        const del = document.createElement('button');
        del.className = 'history-card-del';
        del.textContent = '×';
        del.title = tt('btn_delete');
        del.addEventListener('click', (e) => {
            e.stopPropagation();
            deleteHistoryItem(item.id);
        });

        card.append(title, meta, modelChip, preview, del);
        card.addEventListener('click', () => openDetail(item.id, card));
        els.historyList.appendChild(card);
    }
}

async function openDetail(id, card) {
    document.querySelectorAll('.history-card').forEach((c) => c.classList.toggle('active', c === card));
    try {
        const res = await fetch('/api/history/' + id);
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const rec = await res.json();
        currentDetail = rec;
        showDetail(rec);
    } catch (e) {
        setStatus(tt('status_load_history_fail') + e.message, 'error');
    }
}

function showDetail(rec) {
    els.historyEmpty.hidden = true;
    els.historyDetail.hidden = false;
    els.detailTitle.textContent = rec.title || '(—)';

    const s = rec.settings || {};
    const wordCount = s.length === 'custom' ? (s.lengthCustom || '?') : (s.length || '?');
    const chip = (label, val) => `<span class="chip"><b>${label}</b> ${escapeHtml(val)}</span>`;
    els.detailMeta.innerHTML =
        chip(tt('meta_time'), fmtTime(rec.created_at)) +
        chip(tt('meta_model'), s.model || '?') +
        chip(tt('meta_genre'), s.genre ? genreLabel(s.genre) : '?') +
        (s.language ? chip(tt('label_language'), outputLangName(s.language)) : '') +
        chip(tt('meta_wordcount'), String(wordCount)) +
        chip(tt('meta_temp'), s.temperature || '?') +
        chip(tt('meta_actual'), (rec.content || '').length + ' ' + tt('char_unit'));

    els.detailContent.textContent = rec.content || '';
}

els.historyRefresh.addEventListener('click', loadHistory);

els.detailLoad.addEventListener('click', () => {
    if (!currentDetail) return;
    applySettings(currentDetail.settings);
    document.querySelector('.tab-btn[data-tab="create"]').click();
    setStatus(tt('status_settings_loaded'), 'success');
});

els.detailCopy.addEventListener('click', () => {
    if (currentDetail) copyText(currentDetail.content, els.detailCopy);
});

els.detailDownload.addEventListener('click', () => {
    if (currentDetail) downloadText(currentDetail.content, 'novel');
});

async function deleteHistoryItem(id) {
    if (!confirm(tt('confirm_delete_history'))) return;
    try {
        const res = await fetch('/api/history/' + id, { method: 'DELETE' });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        if (currentDetail && currentDetail.id === id) {
            currentDetail = null;
            els.historyDetail.hidden = true;
            els.historyEmpty.hidden = false;
        }
        await loadHistory();
    } catch (e) {
        setStatus(tt('status_delete_fail') + e.message, 'error');
    }
}

els.detailDelete.addEventListener('click', () => {
    if (currentDetail) deleteHistoryItem(currentDetail.id);
});

els.historyClearAll.addEventListener('click', async () => {
    if (!confirm(tt('confirm_clear_all'))) return;
    try {
        const res = await fetch('/api/history', { method: 'DELETE' });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        currentDetail = null;
        els.historyDetail.hidden = true;
        els.historyEmpty.hidden = false;
        await loadHistory();
    } catch (e) {
        setStatus(tt('status_delete_fail') + e.message, 'error');
    }
});

/* ===== 可搜尋下拉選單（純原生，無套件） =====
   把原生 <select> 隱藏，疊上一個可打字過濾的 input + 選項面板。
   - 外部用 select.value = x 設定時，攔截 value setter 即時同步顯示文字
   - 選項被重新 render（innerHTML 重建）時，用 MutationObserver 同步 */
const SS_NO_MATCH = {
    'zh-TW': '無相符項目', 'zh-CN': '无相符项目',
    'en': 'No matches', 'ja': '該当なし', 'ko': '일치 항목 없음',
};

function makeSearchable(select) {
    if (!select) return;
    const valDesc = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value');

    const wrap = document.createElement('div');
    wrap.className = 'ss-wrap';
    select.parentNode.insertBefore(wrap, select);
    wrap.appendChild(select);
    select.classList.add('ss-native');

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'ss-input';
    input.autocomplete = 'off';
    input.spellcheck = false;
    wrap.appendChild(input);

    const panel = document.createElement('div');
    panel.className = 'ss-panel';
    panel.hidden = true;
    wrap.appendChild(panel);

    let opts = [];          // 目前面板中（過濾後）的選項 [{value,label}]
    let activeIndex = -1;

    function currentLabel() {
        const o = select.options[select.selectedIndex];
        return o ? o.textContent : '';
    }
    function sync() {
        // 不要在使用者正在輸入時覆蓋
        if (document.activeElement !== input) input.value = currentLabel();
    }
    function highlight() {
        [...panel.children].forEach((c, i) => c.classList.toggle('active', i === activeIndex));
        const el = panel.children[activeIndex];
        if (el && el.scrollIntoView) el.scrollIntoView({ block: 'nearest' });
    }
    function renderPanel(filter) {
        const f = (filter || '').trim().toLowerCase();
        opts = [...select.options]
            .map((o) => ({ value: o.value, label: o.textContent }))
            .filter((o) => !f || o.label.toLowerCase().includes(f));
        panel.innerHTML = '';
        if (!opts.length) {
            const e = document.createElement('div');
            e.className = 'ss-empty';
            e.textContent = SS_NO_MATCH[uiLang] || SS_NO_MATCH['en'];
            panel.appendChild(e);
            activeIndex = -1;
            return;
        }
        const selVal = select.value;
        opts.forEach((o) => {
            const d = document.createElement('div');
            d.className = 'ss-option' + (o.value === selVal ? ' selected' : '');
            d.textContent = o.label;
            d.addEventListener('mousedown', (ev) => {
                ev.preventDefault();      // 搶在 input blur 之前選取
                choose(o.value);
            });
            panel.appendChild(d);
        });
        activeIndex = opts.findIndex((o) => o.value === selVal);
        if (activeIndex < 0) activeIndex = 0;
        highlight();
    }
    function open() {
        renderPanel('');
        panel.hidden = false;
    }
    function close() {
        panel.hidden = true;
        activeIndex = -1;
        input.value = currentLabel();
    }
    function choose(value) {
        select.value = value;     // 觸發攔截的 setter → sync()
        select.dispatchEvent(new Event('change', { bubbles: true }));
        close();
    }

    input.addEventListener('focus', () => { input.select(); open(); });
    input.addEventListener('input', () => { renderPanel(input.value); panel.hidden = false; });
    input.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            if (panel.hidden) open();
            else { activeIndex = Math.min(activeIndex + 1, opts.length - 1); highlight(); }
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            activeIndex = Math.max(activeIndex - 1, 0); highlight();
        } else if (e.key === 'Enter') {
            if (!panel.hidden && opts[activeIndex]) { e.preventDefault(); choose(opts[activeIndex].value); }
        } else if (e.key === 'Escape') {
            close(); input.blur();
        }
    });
    input.addEventListener('blur', () => { setTimeout(close, 120); });

    // 攔截外部 select.value = x，讓顯示文字同步
    Object.defineProperty(select, 'value', {
        configurable: true,
        get() { return valDesc.get.call(select); },
        set(v) { valDesc.set.call(select, v); sync(); },
    });
    // 選項被重建時同步顯示
    new MutationObserver(() => sync()).observe(select, { childList: true });

    sync();
}

/* ===== 初始化 ===== */
[els.uiLangSel, els.model, els.template, els.genre, els.language, els.length].forEach(makeSearchable);
renderUiLangSwitch();
renderOutputLangs();
applyI18n();
loadModels();
loadTemplates();
})();
