FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

WORKDIR /app

COPY pyproject.toml ./
COPY smm ./smm
COPY smm_engine ./smm_engine
RUN pip install --no-cache-dir .

ENV SMM_ENGINE_HOST=0.0.0.0
ENV SMM_ENGINE_PORT=50051

EXPOSE 50051

CMD ["python", "-m", "smm_engine"]
