import asyncio
import json
import os
import shlex
import shutil
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path

import httpx
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles

OLLAMA_URL = os.environ.get("OLLAMA_URL", "http://localhost:11434")

# Claude CLI 引擎：透過本機 `claude` 指令（你的訂閱登入）生成。
# 需在主機執行模式下，claude 已安裝並在 PATH。
CLAUDE_BIN = os.environ.get("CLAUDE_BIN", "claude")
# claude --model 接受別名（opus/sonnet/haiku/fable…）；用別名才不會綁死版本。
# 逗號分隔，可用環境變數 CLAUDE_MODELS 覆寫。
CLAUDE_MODELS = [
    m.strip() for m in os.environ.get("CLAUDE_MODELS", "sonnet,opus,haiku").split(",") if m.strip()
]
# 附加給 claude 的額外參數（進階用），例如 "--max-turns 1"
CLAUDE_EXTRA_ARGS = shlex.split(os.environ.get("CLAUDE_EXTRA_ARGS", ""))

_CLAUDE_LABELS = {
    "opus": "Claude Opus",
    "sonnet": "Claude Sonnet",
    "haiku": "Claude Haiku",
    "fable": "Fable",
}


def _claude_label(alias):
    return _CLAUDE_LABELS.get(alias.lower(), alias)


# OpenAI Codex CLI 引擎：透過本機 `codex` 指令（你的 ChatGPT/OpenAI 登入）生成。
# 需在主機執行模式下，codex 已安裝並在 PATH。
CODEX_BIN = os.environ.get("CODEX_BIN", "codex")
# codex -m 接受 OpenAI 模型名稱；逗號分隔，可用環境變數 CODEX_MODELS 覆寫。
# 預設僅放 gpt-5.5：ChatGPT 帳號登入只支援它；gpt-5 / gpt-5-codex 等需 API key 帳號，
# 那類帳號可自行用 CODEX_MODELS 加回。
CODEX_MODELS = [
    m.strip() for m in os.environ.get("CODEX_MODELS", "gpt-5.5").split(",") if m.strip()
]
# codex exec 沙箱模式：read-only 最安全（模型產生的指令唯讀，不會動到檔案系統）。
CODEX_SANDBOX = os.environ.get("CODEX_SANDBOX", "read-only")
# 附加給 codex 的額外參數（進階用）
CODEX_EXTRA_ARGS = shlex.split(os.environ.get("CODEX_EXTRA_ARGS", ""))


def _resolve_bin(cand, name):
    """找出 CLI 可執行路徑：設定值（絕對路徑或指令名）→ PATH → 常見安裝位置。
    找不到回 None。這樣即使 ~/.local/bin 不在 PATH 也能自動找到。"""
    # 1) 明確路徑（含分隔符）
    if os.path.sep in cand:
        return cand if os.access(cand, os.X_OK) else None
    # 2) PATH
    found = shutil.which(cand)
    if found:
        return found
    # 3) 常見安裝位置
    home = os.path.expanduser("~")
    for d in (
        os.path.join(home, ".local", "bin"),
        os.path.join(home, ".npm-global", "bin"),
        os.path.join(home, ".bun", "bin"),
        "/usr/local/bin",
        "/usr/bin",
        "/opt/homebrew/bin",
    ):
        p = os.path.join(d, name)
        if os.access(p, os.X_OK):
            return p
    return None


def _resolve_claude():
    return _resolve_bin(CLAUDE_BIN, "claude")


def _resolve_codex():
    return _resolve_bin(CODEX_BIN, "codex")


def _codex_authed():
    """codex 是否已有登入憑證（auth.json）。
    在 Docker 內 ~/.codex 對應掛載的 CODEX_CREDS_DIR；未掛載則無憑證。"""
    home = os.environ.get("CODEX_HOME") or os.path.join(os.path.expanduser("~"), ".codex")
    return os.path.isfile(os.path.join(home, "auth.json"))


BASE_DIR = Path(__file__).parent
STATIC_DIR = BASE_DIR / "static"
DATA_DIR = Path(os.environ.get("DATA_DIR", BASE_DIR / "data"))
HISTORY_FILE = DATA_DIR / "history.json"
TEMPLATES_FILE = DATA_DIR / "templates.json"

DATA_DIR.mkdir(parents=True, exist_ok=True)
_history_lock = threading.Lock()
_templates_lock = threading.Lock()


def _load_json_list(path):
    if not path.exists():
        return []
    try:
        with path.open("r", encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, list) else []
    except (json.JSONDecodeError, OSError):
        return []


def _save_json_list(path, records):
    tmp = path.with_suffix(".json.tmp")
    with tmp.open("w", encoding="utf-8") as f:
        json.dump(records, f, ensure_ascii=False, indent=2)
    tmp.replace(path)


def _load_history():
    return _load_json_list(HISTORY_FILE)


def _save_history(records):
    _save_json_list(HISTORY_FILE, records)


# 內建範本（name 為 i18n key，前端依介面語言顯示；settings.genre 用穩定 key）
BUILTIN_TEMPLATES = [
    {
        "id": "builtin-wuxia",
        "name": "tpl_wuxia",
        "builtin": True,
        "settings": {
            "genre": "wuxia",
            "language": "zh-TW",
            "length": "3000",
            "temperature": "0.85",
            "system": "",
            "keywords": "一名退隱多年的劍客，因一封舊友來信重出江湖，捲入一樁與二十年前滅門慘案有關的陰謀。",
        },
        "style_sample": "",
    },
    {
        "id": "builtin-scifi",
        "name": "tpl_scifi",
        "builtin": True,
        "settings": {
            "genre": "scifi",
            "language": "zh-TW",
            "length": "3000",
            "temperature": "0.9",
            "system": "",
            "keywords": "近未來，一名神經介面工程師發現自己記憶中的一段童年其實是被植入的廣告，於是開始追查記憶背後的真相。",
        },
        "style_sample": "",
    },
    {
        "id": "builtin-romance",
        "name": "tpl_romance",
        "builtin": True,
        "settings": {
            "genre": "romance",
            "language": "zh-TW",
            "length": "3000",
            "temperature": "0.8",
            "system": "",
            "keywords": "兩個在咖啡廳因為拿錯外帶杯而結識的陌生人，發現彼此竟是同一場婚禮上的伴郎與伴娘。",
        },
        "style_sample": "",
    },
    {
        "id": "builtin-mystery",
        "name": "tpl_mystery",
        "builtin": True,
        "settings": {
            "genre": "mystery",
            "language": "zh-TW",
            "length": "4000",
            "temperature": "0.75",
            "system": "",
            "keywords": "暴風雪山莊中，七名訪客受邀前來，主人卻在第一晚離奇死於密室，每個人都有不在場證明。",
        },
        "style_sample": "",
    },
    {
        "id": "builtin-fantasy",
        "name": "tpl_fantasy",
        "builtin": True,
        "settings": {
            "genre": "fantasy",
            "language": "zh-TW",
            "length": "3000",
            "temperature": "0.9",
            "system": "",
            "keywords": "一個被預言將毀滅世界的少年，被送進魔法學院監視，卻意外與一名魔族少女結為契約。",
        },
        "style_sample": "",
    },
]


def _builtin_copy():
    return [json.loads(json.dumps(t)) for t in BUILTIN_TEMPLATES]


class NoCacheStaticFiles(StaticFiles):
    """每次都讓瀏覽器重新驗證，避免改檔後仍用舊的 JS/CSS（不經 middleware，零風險）。"""

    async def get_response(self, path, scope):
        response = await super().get_response(path, scope)
        response.headers["Cache-Control"] = "no-cache, must-revalidate"
        return response


app = FastAPI(title="AI Novel Writer")
app.mount("/static", NoCacheStaticFiles(directory=STATIC_DIR), name="static")


@app.get("/")
async def index():
    return FileResponse(
        STATIC_DIR / "index.html",
        headers={"Cache-Control": "no-cache, must-revalidate"},
    )


@app.get("/read")
async def reader():
    # 行動裝置閱讀頁：從歷史挑一篇小說舒適閱讀
    return FileResponse(
        STATIC_DIR / "read.html",
        headers={"Cache-Control": "no-cache, must-revalidate"},
    )


@app.get("/api/models")
async def list_models(engine: str = "ollama"):
    if engine == "claude":
        resolved = _resolve_claude()
        return {
            "models": CLAUDE_MODELS,
            "labels": {m: _claude_label(m) for m in CLAUDE_MODELS},
            "available": resolved is not None,
            "path": resolved,
        }

    if engine == "codex":
        resolved = _resolve_codex()
        return {
            "models": CODEX_MODELS,
            "labels": {m: m for m in CODEX_MODELS},
            # 需同時有執行檔與登入憑證才算可用，避免「裝了但沒登入」時才在生成階段噴 401。
            "available": resolved is not None and _codex_authed(),
            "path": resolved,
        }

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            r = await client.get(f"{OLLAMA_URL}/api/tags")
            r.raise_for_status()
            data = r.json()
    except httpx.HTTPError as e:
        raise HTTPException(status_code=502, detail=f"無法連線 Ollama: {e}")

    models = sorted({m["name"] for m in data.get("models", [])})
    return {"models": models}


async def _claude_stream(model, prompt, system):
    """以本機 claude CLI（print 模式、stream-json）串流生成。
    只輸出 text_delta；thinking_delta（延伸思考）會被略過，與 Ollama 的 <think> 過濾一致。"""
    claude_bin = _resolve_claude()
    if claude_bin is None:
        yield ("[錯誤] 找不到 claude CLI。請確認主機已安裝並登入，"
               "或啟動時設定環境變數 CLAUDE_BIN=/絕對/路徑/claude（主機執行模式）。")
        return

    cmd = [
        claude_bin, "-p", prompt,
        "--model", model,
        "--output-format", "stream-json",
        "--include-partial-messages",
        "--verbose",
        "--tools", "",                 # 停用所有內建工具：純文字生成，不碰檔案系統
        "--no-session-persistence",    # 不留存 session
    ]
    if system:
        cmd += ["--system-prompt", system]
    cmd += CLAUDE_EXTRA_ARGS

    try:
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdin=asyncio.subprocess.DEVNULL,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            cwd="/tmp",
        )
    except FileNotFoundError:
        yield "[錯誤] 找不到 claude CLI。"
        return

    got = False
    final = ""
    errored = False
    try:
        async for raw in proc.stdout:
            line = raw.decode("utf-8", "ignore").strip()
            if not line:
                continue
            try:
                o = json.loads(line)
            except json.JSONDecodeError:
                continue

            typ = o.get("type")
            if typ == "stream_event":
                ev = o.get("event") or {}
                if ev.get("type") == "content_block_delta":
                    d = ev.get("delta") or {}
                    if d.get("type") == "text_delta":
                        txt = d.get("text") or ""
                        if txt:
                            got = True
                            yield txt
            elif typ == "result":
                if o.get("is_error"):
                    msg = o.get("result") or o.get("error") or "未知錯誤"
                    errored = True
                    yield f"\n[錯誤] Claude CLI：{msg}"
                    break
                final = o.get("result") or ""

        if not got and not errored:
            if final:
                yield final
            else:
                err = (await proc.stderr.read()).decode("utf-8", "ignore").strip()
                yield "\n[提示] Claude CLI 未產生內容。" + (("錯誤：" + err) if err else "")
    finally:
        if proc.returncode is None:
            try:
                proc.kill()
            except ProcessLookupError:
                pass
        await proc.wait()


async def _codex_stream(model, prompt, system):
    """以本機 codex CLI（exec 子指令、--json 事件流）非互動生成。
    取 item.completed 中 type=agent_message 的文字；reasoning / 指令事件略過。
    codex exec 沒有 system-prompt 旗標，故把 system 併入提示詞最前。"""
    codex_bin = _resolve_codex()
    if codex_bin is None:
        yield ("[錯誤] 找不到 codex CLI。請確認主機已安裝並登入，"
               "或啟動時設定環境變數 CODEX_BIN=/絕對/路徑/codex（主機執行模式）。")
        return

    full_prompt = (system + "\n\n" + prompt) if system else prompt
    cmd = [
        codex_bin, "exec",
        "--json",
        "--skip-git-repo-check",   # 工作目錄非 git repo 也能執行
        "--ephemeral",             # 不留存 session 檔
        "-s", CODEX_SANDBOX,       # 沙箱（預設 read-only，不會動到檔案系統）
    ]
    if model:
        cmd += ["-m", model]
    cmd += CODEX_EXTRA_ARGS
    cmd += [full_prompt]

    try:
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdin=asyncio.subprocess.DEVNULL,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            cwd="/tmp",
        )
    except FileNotFoundError:
        yield "[錯誤] 找不到 codex CLI。"
        return

    got = False
    errored = False
    try:
        async for raw in proc.stdout:
            line = raw.decode("utf-8", "ignore").strip()
            if not line:
                continue
            try:
                o = json.loads(line)
            except json.JSONDecodeError:
                continue

            typ = o.get("type")
            if typ == "item.completed":
                item = o.get("item") or {}
                if item.get("type") == "agent_message":
                    txt = item.get("text") or ""
                    if txt:
                        got = True
                        yield txt
            elif typ in ("turn.failed", "error", "thread.error"):
                raw_err = o.get("error")
                if isinstance(raw_err, dict):
                    msg = raw_err.get("message") or raw_err.get("type") or ""
                elif isinstance(raw_err, str):
                    msg = raw_err
                else:
                    msg = ""
                if not msg:
                    msg = o.get("message") or ""
                # message 可能是內嵌 JSON 字串，取出裡面的人類可讀錯誤
                if isinstance(msg, str) and msg.lstrip().startswith("{"):
                    try:
                        inner = json.loads(msg)
                        msg = (inner.get("error") or {}).get("message") or inner.get("message") or msg
                    except (ValueError, TypeError):
                        pass
                errored = True
                yield f"\n[錯誤] Codex CLI：{msg or '生成失敗'}"
                break

        if not got and not errored:
            err = (await proc.stderr.read()).decode("utf-8", "ignore").strip()
            yield "\n[提示] Codex CLI 未產生內容。" + (("錯誤：" + err) if err else "")
    finally:
        if proc.returncode is None:
            try:
                proc.kill()
            except ProcessLookupError:
                pass
        await proc.wait()


def _make_think_filter():
    """過濾模型在 response 中輸出的 <think>...</think> 推理區塊（串流式，可跨 chunk）。"""
    state = {"in_think": False, "carry": ""}
    TAG_OPEN, TAG_CLOSE = "<think>", "</think>"

    def _prefix_len(s, tag):
        # s 結尾有多少字元正好是 tag 的開頭（用來處理跨 chunk 被切斷的標籤）
        m = min(len(s), len(tag) - 1)
        for k in range(m, 0, -1):
            if s[-k:] == tag[:k]:
                return k
        return 0

    def feed(piece):
        s = state["carry"] + piece
        state["carry"] = ""
        out = []
        i, n = 0, len(s)
        while i < n:
            if not state["in_think"]:
                open_idx = s.find(TAG_OPEN, i)
                close_idx = s.find(TAG_CLOSE, i)
                cands = [x for x in (open_idx, close_idx) if x != -1]
                if not cands:
                    rest = s[i:]
                    p = max(_prefix_len(rest, TAG_OPEN), _prefix_len(rest, TAG_CLOSE))
                    if p:
                        out.append(rest[: len(rest) - p])
                        state["carry"] = rest[len(rest) - p :]
                    else:
                        out.append(rest)
                    break
                j = min(cands)
                out.append(s[i:j])
                if j == open_idx:
                    state["in_think"] = True
                    i = j + len(TAG_OPEN)
                else:  # 孤立的 </think>，直接移除
                    i = j + len(TAG_CLOSE)
            else:
                close_idx = s.find(TAG_CLOSE, i)
                if close_idx == -1:
                    rest = s[i:]
                    p = _prefix_len(rest, TAG_CLOSE)
                    state["carry"] = rest[len(rest) - p :] if p else ""
                    break
                state["in_think"] = False
                i = close_idx + len(TAG_CLOSE)
        return "".join(out)

    return feed


@app.post("/api/generate")
async def generate(req: Request):
    body = await req.json()

    engine = (body.get("engine") or "ollama").lower()
    model = body.get("model")
    prompt = body.get("prompt")
    if not model or not prompt:
        raise HTTPException(status_code=400, detail="缺少 model 或 prompt")

    system = body.get("system") or ""

    if engine == "claude":
        return StreamingResponse(
            _claude_stream(model, prompt, system),
            media_type="text/plain; charset=utf-8",
        )

    if engine == "codex":
        return StreamingResponse(
            _codex_stream(model, prompt, system),
            media_type="text/plain; charset=utf-8",
        )

    temperature = float(body.get("temperature", 0.8))
    # 下限 1024：思考型模型的 <think> 區塊（會被過濾）可能吃光額度，
    # 預留底線確保正文一定有生成空間。
    num_predict = max(int(body.get("num_predict", 4000)), 1024)

    payload = {
        "model": model,
        "prompt": prompt,
        "stream": True,
        "options": {
            "temperature": temperature,
            "num_predict": num_predict,
        },
    }
    if system:
        payload["system"] = system

    async def event_stream():
        # 兩種自動重試（對使用者透明）：
        #   1) 模型載入中：Ollama 回 loading error → 等待後重試（最多約 5 分鐘）
        #   2) 空輸出：部分 merge 模型第一個 token 即為結束符，隨機導致 0 內容 → 立即重試
        # 僅在出現「實質（非空白）內容」後才開始串流，讓失敗的嘗試不會顯示給使用者。
        max_loading = 60
        max_empty = 4
        loading_attempts = 0
        empty_attempts = 0

        while True:
            got_real = False   # 是否已出現實質（非空白）內容
            buffer = ""        # 實質內容出現前的前導暫存
            loading = False
            finished = False   # 是否正常收到 done
            think_filter = _make_think_filter()
            try:
                async with httpx.AsyncClient(timeout=None) as client:
                    async with client.stream(
                        "POST", f"{OLLAMA_URL}/api/generate", json=payload
                    ) as response:
                        if response.status_code != 200:
                            err = await response.aread()
                            yield f"[ERROR] Ollama 回應 {response.status_code}: {err.decode('utf-8', 'ignore')}"
                            return
                        async for line in response.aiter_lines():
                            if not line.strip():
                                continue
                            try:
                                chunk = json.loads(line)
                            except json.JSONDecodeError:
                                continue

                            err_msg = chunk.get("error")
                            if err_msg:
                                if "loading" in err_msg.lower() and not got_real:
                                    loading = True
                                    break
                                yield f"\n[錯誤] {err_msg}"
                                return

                            # 只取正文 response；thinking 欄位是模型的思考，不顯示。
                            # response 內若含 <think>...</think> 推理區塊，串流過濾掉。
                            raw = chunk.get("response") or ""
                            piece = think_filter(raw) if raw else ""
                            if piece:
                                if got_real:
                                    yield piece
                                else:
                                    buffer += piece
                                    if piece.strip():
                                        got_real = True
                                        yield buffer
                                        buffer = ""
                            if chunk.get("done"):
                                finished = True
                                break
            except httpx.HTTPError as e:
                if got_real:
                    yield f"\n[ERROR] 串流中斷: {e}"
                return

            if got_real:
                return
            if loading:
                loading_attempts += 1
                if loading_attempts > max_loading:
                    yield "\n[錯誤] 模型載入逾時，請稍候重試或確認模型可用"
                    return
                await asyncio.sleep(3)
                continue
            if finished:
                # 模型直接結束且無實質內容（隨機 EOS）→ 重試
                empty_attempts += 1
                if empty_attempts >= max_empty:
                    yield "\n[提示] 模型多次未產生內容，可能與此模型不相容，請重試或更換模型。"
                    return
                continue
            # 非 loading 非 finished（連線中斷且無 done）→ 結束
            return

    return StreamingResponse(event_stream(), media_type="text/plain; charset=utf-8")


def _summary(rec):
    """列表用的精簡版本，不含全文。"""
    content = rec.get("content", "")
    return {
        "id": rec.get("id"),
        "created_at": rec.get("created_at"),
        "title": rec.get("title"),
        "settings": rec.get("settings", {}),
        "char_count": len(content),
        "preview": content[:80],
    }


@app.get("/api/history")
def list_history():
    with _history_lock:
        records = _load_history()
    return {"history": [_summary(r) for r in records]}


@app.post("/api/history")
async def add_history(req: Request):
    body = await req.json()
    content = (body.get("content") or "").strip()
    if not content:
        raise HTTPException(status_code=400, detail="缺少 content")

    settings = body.get("settings") or {}
    title = (body.get("title") or "").strip()
    if not title:
        kw = (settings.get("keywords") or "").strip()
        title = kw[:30] if kw else content[:30]

    record = {
        "id": uuid.uuid4().hex[:12],
        "created_at": datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds"),
        "title": title,
        "settings": settings,
        "content": content,
    }

    with _history_lock:
        records = _load_history()
        records.insert(0, record)
        _save_history(records)

    return _summary(record)


@app.get("/api/history/{record_id}")
def get_history(record_id: str):
    with _history_lock:
        records = _load_history()
    for r in records:
        if r.get("id") == record_id:
            return r
    raise HTTPException(status_code=404, detail="找不到該筆歷史")


@app.delete("/api/history")
def clear_history():
    with _history_lock:
        _save_history([])
    return {"ok": True}


@app.delete("/api/history/{record_id}")
def delete_history(record_id: str):
    with _history_lock:
        records = _load_history()
        new_records = [r for r in records if r.get("id") != record_id]
        if len(new_records) == len(records):
            raise HTTPException(status_code=404, detail="找不到該筆歷史")
        _save_history(new_records)
    return {"ok": True}


# ===== 範本 =====
@app.get("/api/templates")
def list_templates():
    with _templates_lock:
        custom = _load_json_list(TEMPLATES_FILE)
    return {"templates": _builtin_copy() + custom}


@app.post("/api/templates")
async def add_template(req: Request):
    body = await req.json()
    name = (body.get("name") or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="缺少範本名稱")

    record = {
        "id": "tpl-" + uuid.uuid4().hex[:10],
        "name": name,
        "builtin": False,
        "settings": body.get("settings") or {},
        "style_sample": body.get("style_sample") or "",
    }
    with _templates_lock:
        custom = _load_json_list(TEMPLATES_FILE)
        custom.append(record)
        _save_json_list(TEMPLATES_FILE, custom)
    return record


@app.delete("/api/templates/{template_id}")
def delete_template(template_id: str):
    if template_id.startswith("builtin-"):
        raise HTTPException(status_code=400, detail="內建範本無法刪除")
    with _templates_lock:
        custom = _load_json_list(TEMPLATES_FILE)
        new_custom = [t for t in custom if t.get("id") != template_id]
        if len(new_custom) == len(custom):
            raise HTTPException(status_code=404, detail="找不到該範本")
        _save_json_list(TEMPLATES_FILE, new_custom)
    return {"ok": True}


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "app:app",
        host=os.environ.get("HOST", "127.0.0.1"),
        port=int(os.environ.get("PORT", "6789")),
        reload=False,
    )
