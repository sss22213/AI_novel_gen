# AI Novel Generator

A web tool for writing novels with **local [Ollama](https://ollama.com/) models, the [Claude](https://claude.com/claude-code) CLI, or the [OpenAI Codex](https://github.com/openai/codex) CLI** (using your Claude / ChatGPT subscription login). Enter a keyword or outline, pick an engine and model, genre, language and length, then stream a novel in real time — with automatic history saving.

> ### 🤝 About this project
> **This project was built collaboratively by a human and an AI (Anthropic Claude).**
> The human provided the direction, requirements, decisions and testing; the AI wrote the code, documentation and translations. Neither side did it alone — it is the product of human–AI collaboration. Please review and test before use.

---

## ✨ Features

- **Three AI engines** — generate with local **Ollama** models, the **Claude CLI** (Claude subscription), or the **OpenAI Codex CLI** (ChatGPT / OpenAI login), switchable from an *AI engine* dropdown. See [Enabling the Claude / Codex engines](#enabling-the-claude-engine).
- **Streaming generation** — text appears word by word as it's written, ChatGPT-style; stop any time. (For Claude "thinking" models the internal reasoning is filtered out; Codex returns the finished story when its run completes.)
- **Model dropdown** — lists the models for the selected engine: every model installed in your local Ollama (refreshable on demand), the configured Claude aliases (`opus` / `sonnet` / `haiku`), or the configured Codex models (`gpt-5.5`…).
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
- **Robust handling** — filters out "thinking" models' internal reasoning, retries on empty output, and waits/retries while an Ollama model is loading, so it no longer hangs.

---

## 🧱 Tech Stack

| Layer | Technology |
|---|---|
| Backend | Python + [FastAPI](https://fastapi.tiangolo.com/) + [httpx](https://www.python-httpx.org/) (streaming proxy to Ollama) + `claude` / `codex` CLI subprocesses |
| Frontend | Vanilla HTML / CSS / JavaScript (no framework, no build step) |
| Engines | Local [Ollama](https://ollama.com/) · [Claude](https://claude.com/claude-code) CLI · [OpenAI Codex](https://github.com/openai/codex) CLI |
| Deployment | Docker / Docker Compose |
| Storage | JSON files (history, custom templates), persisted via a mounted volume |

---

## 📋 Requirements

- [Docker](https://docs.docker.com/get-docker/) and Docker Compose
- [Ollama](https://ollama.com/) installed and running on the host, with at least one model pulled
- Enough RAM / VRAM to load the models you intend to use
- *(Optional — for the Claude engine)* the [Claude CLI](https://claude.com/claude-code) logged in. It's bundled into the Docker image; you only need to mount your credentials (see [Enabling the Claude / Codex engines](#enabling-the-claude-engine)). For local runs, install and log in to `claude` on the host.
- *(Optional — for the Codex engine)* the [OpenAI Codex CLI](https://github.com/openai/codex) logged in. Same as above: bundled into the image, mount your `~/.codex` credentials; for local runs, install and `codex login` on the host.

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

Configuration is done entirely through environment variables. For Docker, copy
the template to `.env` and edit it — Docker Compose reads `.env` automatically:

```bash
cp .env.example .env
```

| Variable | Default | Description |
|---|---|---|
| `PORT` | `6789` | WebUI port |
| `OLLAMA_URL` | `http://host.docker.internal:11434` | Ollama API address. Inside the container, reach the host via `host.docker.internal` — do **not** use `localhost`. |
| `HOST` | `0.0.0.0` (in container) | Bind address |
| `DATA_DIR` | `./data` | Directory for history and templates |
| `CLAUDE_CREDS_DIR` | *(empty)* | Absolute path to your logged-in Claude credentials (usually `~/.claude`), mounted into the container to enable the Claude engine. Empty → Claude engine stays unavailable (Ollama still works). |
| `CLAUDE_MODELS` | `sonnet,opus,haiku` | Comma-separated Claude model aliases shown in the dropdown (`claude --model` accepts aliases). |
| `CLAUDE_BIN` | `claude` | Path to the `claude` executable (defaults to the version installed in the image). |
| `CODEX_CREDS_DIR` | *(empty)* | Absolute path to your logged-in Codex credentials (usually `~/.codex`), mounted into the container to enable the Codex engine. Empty → Codex engine stays unavailable. |
| `CODEX_MODELS` | `gpt-5.5` | Comma-separated Codex models (`codex exec -m`). ChatGPT-account logins only support `gpt-5.5`; `gpt-5` / `gpt-5-codex` etc. need an API-key account. |
| `CODEX_BIN` | `codex` | Path to the `codex` executable (defaults to the version installed in the image). |

> **Can't reach Ollama?** Make sure Ollama listens on all interfaces: `OLLAMA_HOST=0.0.0.0 ollama serve`, or switch the compose file to `network_mode: host`.

### Enabling the Claude engine

The app can generate with either **local Ollama** or the **Claude CLI** (your
Claude subscription login), selectable from the **AI engine** dropdown.

- **Docker:** the image installs the `claude` CLI for you; point `CLAUDE_CREDS_DIR`
  at your host `~/.claude` so the container can authenticate:

  ```bash
  echo "CLAUDE_CREDS_DIR=$HOME/.claude" >> .env
  docker compose up -d --build
  ```

- **Local (no Docker):** just have `claude` installed and logged in on the host;
  it is auto-detected (via `PATH` or common install locations such as
  `~/.local/bin/claude`). Set `CLAUDE_BIN` to an absolute path to override.

### Enabling the Codex engine

Works the same way as Claude, using the [OpenAI Codex CLI](https://github.com/openai/codex).

- **Docker:** the image installs `codex`; point `CODEX_CREDS_DIR` at your host
  `~/.codex`:

  ```bash
  echo "CODEX_CREDS_DIR=$HOME/.codex" >> .env
  docker compose up -d --build
  ```

- **Local (no Docker):** have `codex` installed and `codex login` done on the
  host; it is auto-detected (`PATH` or `~/.local/bin/codex`).

Notes:

- The engine shows as **unavailable** unless both the `codex` binary *and* a
  login (`~/.codex/auth.json`) are present — so you get an upfront warning
  instead of a failure at generation time.
- With a **ChatGPT-account** login, only `gpt-5.5` is available; `gpt-5`,
  `gpt-5.1` and `gpt-5-codex` require an **API-key** account (add them via
  `CODEX_MODELS`).
- ChatGPT-login credentials may not authenticate from inside a container; if
  Codex 401s under Docker, run the app on the host instead.

---

## 📡 API

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/models?engine=ollama\|claude\|codex` | List models for the engine: installed Ollama models, or Claude / Codex models (with availability + resolved path) |
| `POST` | `/api/generate` | Stream-generate a novel (plain-text stream). Request body includes `engine` (`ollama`, `claude` or `codex`) |
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
├── app.py                # FastAPI backend (Ollama + Claude + Codex engines, generation stream, history, templates)
├── requirements.txt
├── Dockerfile            # Python image; also installs the claude & codex CLIs
├── docker-compose.yml
├── .env.example          # Configuration template (copy to .env)
├── static/
│   ├── index.html        # UI structure
│   ├── style.css         # Styles
│   ├── app.js            # Frontend logic (engine/model select, generation, history, templates, i18n)
│   └── i18n.js           # Language dictionary and genre mapping
├── data/                 # Created at runtime: history.json / templates.json (gitignored)
├── ARCHITECTURE.md       # Architecture notes
├── LICENSE               # GPL-3.0
└── README.md
```

---

## 💡 Tips

- **Pick the right model**: for fiction on Ollama, prefer non-"thinking" instruct models (e.g. Gemma, Qwen2.5-Instruct, Llama). "Thinking" models such as `qwen3*` / `gpt-oss` spend part of their budget on internal reasoning; the app filters that out and gives the story room to generate, but instruct models still give the best experience. On the **Claude** engine, `opus` gives the strongest prose and `haiku` the fastest. On the **Codex** engine with a ChatGPT-account login, use `gpt-5.5`.
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
