FROM python:3.12-slim

WORKDIR /app

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
