# AI Novel Generator

A web tool for writing novels with local [Ollama](https://ollama.com/) models. Enter a keyword or outline, pick a model, genre, language and length, then stream a novel in real time — with automatic history saving.

> ### 🤝 About this project
> **This project was built collaboratively by a human and an AI (Anthropic Claude).**
> The human provided the direction, requirements, decisions and testing; the AI wrote the code, documentation and translations. Neither side did it alone — it is the product of human–AI collaboration. Please review and test before use.

---

## ✨ Features

- **Streaming generation** — text appears word by word as it's written, ChatGPT-style; stop any time.
- **Model dropdown** — automatically lists every model installed in your local Ollama; refreshable on demand.
- **Rich writing controls**
  - Genre / style (Wuxia, Sci-Fi, Romance, Mystery, Fantasy, Adult… 12 in total)
  - Length (short / medium / long / very long / custom)
  - Creativity (Temperature)
  - Custom system prompt
  - **Reference style sample** — paste a passage and let the AI imitate its tone (without copying its content)
- **Multi-language novel output** — choose the output language (Traditional/Simplified Chinese, English, Japanese, Korean, Spanish, French, German, Russian, Portuguese, Vietnamese, Thai — 12 in total).
- **Multi-language UI (i18n)** — interface available in 繁體中文 / English / 日本語 / 简体中文 / 한국어, switchable instantly from the top-right and remembered across sessions.
- **Template system**
  - 5 built-in starter templates (Wuxia, Sci-Fi, Romance, Mystery, Fantasy)
  - Save the current settings (including the reference style sample) as a custom template for reuse
- **History** — every completed generation is saved automatically with its settings and full text; browse, copy, download, load settings, and **delete individually** or **clear all**.
- **Robust handling** — automatically deals with "thinking" models (`think:false`) and waits/retries while a model is loading, so it no longer hangs.

---

## 🧱 Tech Stack

| Layer | Technology |
|---|---|
| Backend | Python + [FastAPI](https://fastapi.tiangolo.com/) + [httpx](https://www.python-httpx.org/) (streaming proxy to Ollama) |
| Frontend | Vanilla HTML / CSS / JavaScript (no framework, no build step) |
| Model | Local [Ollama](https://ollama.com/) |
| Deployment | Docker / Docker Compose |
| Storage | JSON files (history, custom templates), persisted via a mounted volume |

---

## 📋 Requirements

- [Docker](https://docs.docker.com/get-docker/) and Docker Compose
- [Ollama](https://ollama.com/) installed and running on the host, with at least one model pulled
- Enough RAM / VRAM to load the models you intend to use

---

## 🚀 Quick Start

```bash
# 1. Make sure Ollama is running and has at least one model
ollama list

# 2. Start the service
docker compose up -d --build

# 3. Open your browser
#    http://localhost:6789
```

The service listens on port **6789** by default. The container reaches the host's Ollama through `host.docker.internal` (`docker-compose.yml` already configures `host-gateway`).

### Without Docker (run locally)

```bash
pip install -r requirements.txt
python app.py
# Listens on 127.0.0.1:6789 by default; configurable via environment variables
```

---

## ⚙️ Configuration

Set via environment variables (in `docker-compose.yml` or your shell):

| Variable | Default | Description |
|---|---|---|
| `OLLAMA_URL` | `http://host.docker.internal:11434` | Ollama API address |
| `HOST` | `0.0.0.0` (in container) | Bind address |
| `PORT` | `6789` | Port |
| `DATA_DIR` | `./data` | Directory for history and templates |

> **Can't reach Ollama?** Make sure Ollama listens on all interfaces: `OLLAMA_HOST=0.0.0.0 ollama serve`, or switch the compose file to `network_mode: host`.

---

## 📡 API

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/models` | List installed Ollama models |
| `POST` | `/api/generate` | Stream-generate a novel (plain-text stream) |
| `GET` | `/api/history` | History list (summaries) |
| `POST` | `/api/history` | Add a history record |
| `GET` | `/api/history/{id}` | Get one record (full text + settings) |
| `DELETE` | `/api/history/{id}` | Delete one record |
| `DELETE` | `/api/history` | Clear all history |
| `GET` | `/api/templates` | List templates (built-in + custom) |
| `POST` | `/api/templates` | Add a custom template |
| `DELETE` | `/api/templates/{id}` | Delete a custom template (built-ins cannot be deleted) |

---

## 📁 Project Structure

```
.
├── app.py                # FastAPI backend (models, generation stream, history, templates)
├── requirements.txt
├── Dockerfile
├── docker-compose.yml
├── static/
│   ├── index.html        # UI structure
│   ├── style.css         # Styles
│   ├── app.js            # Frontend logic (generation, history, templates, i18n)
│   └── i18n.js           # Language dictionary and genre mapping
├── data/                 # Created at runtime: history.json / templates.json (gitignored)
├── LICENSE               # GPL-3.0
└── README.md
```

---

## 💡 Tips

- **Pick the right model**: for fiction, prefer non-"thinking" instruct models (e.g. Gemma, Qwen2.5-Instruct, Llama). "Thinking" models such as `qwen3*` / `gpt-oss` spend their budget on internal reasoning; the app mitigates this with `think:false`, but instruct models still give the best experience.
- **First load takes time**: large models (20GB+) need tens of seconds to load on the first generation. The screen stays on "Generating…" during this — that's normal; output begins once loading finishes.
- **"Adult" genre**: ordinary instruct models may refuse; pair it with an uncensored / abliterated model.
- **Your data**: history and custom templates live in `data/`. Back it up yourself; `docker compose down` does not delete it (it's a host-mounted volume).

---

## 📄 License

This project is licensed under the **GNU General Public License v3.0 (GPL-3.0)** — see [LICENSE](LICENSE).

```
Copyright (C) 2026
This program is free software: you can redistribute it and/or modify
it under the terms of the GNU General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU General Public License for more details.
```
