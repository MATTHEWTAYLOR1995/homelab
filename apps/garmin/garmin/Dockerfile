FROM python:3.12-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Snapshot cache/data directory should persist across restarts via a volume
VOLUME ["/app/data"]

EXPOSE 5000

CMD ["python", "app.py"]
