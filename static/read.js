(function () {
if (!window.NOVEL_I18N) {
    document.body.textContent = 'i18n.js 載入失敗，請重新整理。';
    throw new Error('window.NOVEL_I18N is missing');
}
const { LANGS, t } = window.NOVEL_I18N;

let uiLang = localStorage.getItem('novel_ui_lang') || 'zh-TW';
if (!(uiLang in LANGS)) uiLang = 'zh-TW';

function tt(key, vars) {
    let s = t(key, uiLang);
    if (vars) for (const k in vars) s = s.split('{' + k + '}').join(vars[k]);
    return s;
}

const els = {
    listView: document.getElementById('list-view'),
    readView: document.getElementById('read-view'),
    list: document.getElementById('list'),
    empty: document.getElementById('empty'),
    uiLangSel: document.getElementById('ui-lang'),
    back: document.getElementById('back'),
    rTitle: document.getElementById('r-title'),
    content: document.getElementById('content'),
    rMeta: document.getElementById('r-meta'),
    fontDec: document.getElementById('font-dec'),
    fontInc: document.getElementById('font-inc'),
    themeBtn: document.getElementById('theme-btn'),
    progress: document.getElementById('progress'),
};

let summaries = [];

/* ===== i18n ===== */
function applyI18n() {
    document.documentElement.lang = uiLang;
    document.querySelectorAll('[data-i18n]').forEach((el) => {
        el.textContent = tt(el.dataset.i18n);
    });
    document.querySelectorAll('[data-i18n-title]').forEach((el) => {
        el.title = tt(el.dataset.i18nTitle);
    });
}

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
        renderList();
        if (!els.readView.hidden && current) renderMeta(current);
    });
}

/* ===== 主題 / 字級 ===== */
const THEMES = ['dark', 'sepia', 'light'];
const THEME_COLOR = { dark: '#14171f', sepia: '#f3ead6', light: '#ffffff' };

function applyTheme(theme) {
    if (!THEMES.includes(theme)) theme = 'dark';
    document.body.setAttribute('data-theme', theme);
    const m = document.querySelector('meta[name="theme-color"]');
    if (m) m.setAttribute('content', THEME_COLOR[theme]);
    localStorage.setItem('reader_theme', theme);
}
function cycleTheme() {
    const cur = document.body.getAttribute('data-theme') || 'dark';
    applyTheme(THEMES[(THEMES.indexOf(cur) + 1) % THEMES.length]);
}

const FONT_MIN = 14, FONT_MAX = 30;
function applyFont(px) {
    px = Math.max(FONT_MIN, Math.min(FONT_MAX, px));
    document.documentElement.style.setProperty('--reader-font', px + 'px');
    localStorage.setItem('reader_font', String(px));
    return px;
}
function curFont() {
    return parseInt(localStorage.getItem('reader_font')) || 19;
}

/* ===== 日期格式 ===== */
function fmtDate(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d)) return iso;
    try {
        return d.toLocaleString(uiLang, {
            year: 'numeric', month: '2-digit', day: '2-digit',
            hour: '2-digit', minute: '2-digit',
        });
    } catch (e) {
        return iso.replace('T', ' ').slice(0, 16);
    }
}

/* ===== 列表 ===== */
async function loadList() {
    try {
        const res = await fetch('/api/history');
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const data = await res.json();
        summaries = data.history || [];
    } catch (e) {
        summaries = [];
    }
    renderList();
}

function renderList() {
    els.list.innerHTML = '';
    if (!summaries.length) {
        els.empty.hidden = false;
        return;
    }
    els.empty.hidden = true;
    const unit = tt('char_unit');
    for (const s of summaries) {
        const card = document.createElement('div');
        card.className = 'novel-card';

        const h = document.createElement('h2');
        h.textContent = s.title || '(untitled)';
        card.appendChild(h);

        const meta = document.createElement('div');
        meta.className = 'meta';
        const model = (s.settings && s.settings.model) ? s.settings.model : '';
        const bits = [fmtDate(s.created_at), (s.char_count || 0) + ' ' + unit];
        if (model) bits.push(model);
        meta.textContent = bits.join('  ·  ');
        card.appendChild(meta);

        const pv = document.createElement('div');
        pv.className = 'preview';
        pv.textContent = s.preview || '';
        card.appendChild(pv);

        card.addEventListener('click', () => openReader(s.id));
        els.list.appendChild(card);
    }
}

/* ===== 閱讀 ===== */
let current = null;

function renderMeta(rec) {
    const unit = tt('char_unit');
    const s = rec.settings || {};
    const bits = [fmtDate(rec.created_at), (rec.content || '').length + ' ' + unit];
    if (s.engine) bits.push(s.engine);
    if (s.model) bits.push(s.model);
    els.rMeta.textContent = bits.join('  ·  ');
}

async function openReader(id) {
    try {
        const res = await fetch('/api/history/' + id);
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const rec = await res.json();
        current = rec;
        els.rTitle.textContent = rec.title || '';
        els.content.textContent = rec.content || '';
        renderMeta(rec);
        els.listView.hidden = true;
        els.readView.hidden = false;
        if (location.hash !== '#' + id) {
            history.pushState({ id }, '', '#' + id);
        }
        window.scrollTo(0, 0);
        updateProgress();
    } catch (e) {
        alert(tt('reader_load_fail') + (e.message || ''));
    }
}

function showList() {
    els.readView.hidden = true;
    els.listView.hidden = false;
    current = null;
    els.progress.style.width = '0';
    if (location.hash) history.pushState({}, '', location.pathname);
}

/* ===== 閱讀進度條 ===== */
function updateProgress() {
    if (els.readView.hidden) { els.progress.style.width = '0'; return; }
    const doc = document.documentElement;
    const max = doc.scrollHeight - doc.clientHeight;
    const pct = max > 0 ? (doc.scrollTop || window.scrollY) / max * 100 : 0;
    els.progress.style.width = Math.max(0, Math.min(100, pct)) + '%';
}

/* ===== 事件 ===== */
els.back.addEventListener('click', showList);
els.themeBtn.addEventListener('click', cycleTheme);
els.fontDec.addEventListener('click', () => applyFont(curFont() - 1));
els.fontInc.addEventListener('click', () => applyFont(curFont() + 1));
window.addEventListener('scroll', updateProgress, { passive: true });
window.addEventListener('resize', updateProgress);

// 瀏覽器返回鍵：在閱讀視圖時回到列表
window.addEventListener('popstate', () => {
    const id = location.hash.slice(1);
    if (id) openReader(id);
    else showList();
});

/* ===== 初始化 ===== */
applyTheme(localStorage.getItem('reader_theme') || 'dark');
applyFont(curFont());
renderUiLangSwitch();
applyI18n();
loadList().then(() => {
    const id = location.hash.slice(1);
    if (id) openReader(id);
});
})();
