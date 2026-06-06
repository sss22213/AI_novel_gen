import asyncio
import json
import os
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path

import httpx
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles

OLLAMA_URL = os.environ.get("OLLAMA_URL", "http://localhost:11434")

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


@app.get("/api/models")
async def list_models():
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            r = await client.get(f"{OLLAMA_URL}/api/tags")
            r.raise_for_status()
            data = r.json()
    except httpx.HTTPError as e:
        raise HTTPException(status_code=502, detail=f"無法連線 Ollama: {e}")

    models = sorted({m["name"] for m in data.get("models", [])})
    return {"models": models}


@app.post("/api/generate")
async def generate(req: Request):
    body = await req.json()

    model = body.get("model")
    prompt = body.get("prompt")
    if not model or not prompt:
        raise HTTPException(status_code=400, detail="缺少 model 或 prompt")

    system = body.get("system") or ""
    temperature = float(body.get("temperature", 0.8))
    num_predict = int(body.get("num_predict", 4000))

    payload = {
        "model": model,
        "prompt": prompt,
        "stream": True,
        "think": False,
        "options": {
            "temperature": temperature,
            "num_predict": num_predict,
        },
    }
    if system:
        payload["system"] = system

    async def event_stream():
        # 模型載入中時 Ollama 會回 error chunk；自動等待重試（最多約 5 分鐘）
        max_attempts = 60
        for attempt in range(1, max_attempts + 1):
            got_any = False
            loading = False
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
                                if "loading" in err_msg.lower() and not got_any:
                                    loading = True
                                    break  # 跳出重試
                                yield f"\n[錯誤] {err_msg}"
                                return

                            piece = chunk.get("response") or chunk.get("thinking") or ""
                            if piece:
                                got_any = True
                                yield piece
                            if chunk.get("done"):
                                return
            except httpx.HTTPError as e:
                yield f"\n[ERROR] 串流中斷: {e}"
                return

            if got_any:
                return
            if loading:
                await asyncio.sleep(3)
                continue
            # 既沒內容也非載入中（例如模型立即結束）：結束
            return

        yield "\n[錯誤] 模型載入逾時，請稍候重試或確認模型可用"

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
