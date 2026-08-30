# ── build ────────────────────────────────────────────────────────────────
FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# ── runtime ──────────────────────────────────────────────────────────────
FROM node:24-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
# git = versioned ontology edits; ca-certificates = TLS to Postgres/S3
RUN apt-get update \
  && apt-get install -y --no-install-recommends git ca-certificates \
  && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY spec ./spec

# The ontology folder (types/actions/connections/connectors/pipelines/data) is
# mounted here. Its .ontology/ SQLite index lives inside; back it with Postgres
# via ontology.config.yaml + env for production.
VOLUME ["/ontology"]
EXPOSE 8787

ENTRYPOINT ["node", "dist/cli.js"]
CMD ["serve", "--http", "--port", "8787", "/ontology"]
