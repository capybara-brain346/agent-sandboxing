FROM node:22-bookworm-slim

WORKDIR /workspace

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates git \
  && rm -rf /var/lib/apt/lists/*

COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /usr/local/bin/

ENV UV_CACHE_DIR=/opt/uv-cache
ENV UV_PYTHON_INSTALL_DIR=/opt/uv-python
ENV npm_config_store_dir=/opt/pnpm-store

RUN mkdir -p /opt/uv-cache /opt/uv-python /opt/pnpm-store \
  && uv python install 3.12 \
  && chmod -R a+rwX /opt/uv-cache /opt/uv-python /opt/pnpm-store

RUN mkdir -p /opt/capynodes-backend
COPY repo/capynodes-backend/pyproject.toml repo/capynodes-backend/uv.lock /opt/capynodes-backend/
RUN cd /opt/capynodes-backend \
  && uv sync --locked --python 3.12

RUN corepack enable \
  && corepack prepare pnpm@10.7.1 --activate

RUN mkdir -p /opt/capynodes-frontend
COPY repo/capynodes-backend/capynodes-frontend/package.json repo/capynodes-backend/capynodes-frontend/pnpm-lock.yaml repo/capynodes-backend/capynodes-frontend/pnpm-workspace.yaml /opt/capynodes-frontend/
RUN cd /opt/capynodes-frontend \
  && pnpm install --frozen-lockfile --store-dir /opt/pnpm-store

CMD ["sleep", "infinity"]
