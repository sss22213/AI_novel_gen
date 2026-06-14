FROM python:3.12-slim

WORKDIR /app

# 安裝 claude CLI（Claude 引擎用，與 Ollama 二選一）。官方安裝腳本是自帶執行
# 環境的單檔，不需 Node。認證另由 compose 掛載主機的 ~/.claude 提供。
# 安裝失敗（如 build 時無網路）不影響其他功能，Claude 引擎只會顯示為不可用。
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && (curl -fsSL https://claude.ai/install.sh | bash || echo "claude install skipped")
ENV PATH="/root/.local/bin:${PATH}"

# 安裝 codex CLI（OpenAI Codex 引擎用）。透過 npm 取得對應平台的二進位，需 Node，
# 故一併安裝。認證另由 compose 掛載主機的 ~/.codex 提供。失敗（如 build 無網路）
# 不影響其他功能，Codex 引擎只會顯示為不可用。
RUN (apt-get update \
     && apt-get install -y --no-install-recommends nodejs npm \
     && npm install -g @openai/codex \
     && rm -rf /var/lib/apt/lists/*) \
    || echo "codex install skipped"

RUN pip install --no-cache-dir --upgrade pip

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app.py .
COPY static ./static

ENV HOST=0.0.0.0 \
    PORT=6789 \
    OLLAMA_URL=http://host.docker.internal:11434

EXPOSE 6789

CMD ["python", "app.py"]
