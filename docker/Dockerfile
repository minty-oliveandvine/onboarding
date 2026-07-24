# Development image for the onboarding frontend (Next.js 16).
# Optimized for local dev with hot-reload — source is bind-mounted at runtime
# (see docker-compose.yml), so we only bake in the dependencies here.
FROM node:22-alpine

WORKDIR /app

# Install dependencies first so this layer is cached unless the lockfile changes.
# Copy only the manifest + lockfile to maximize cache hits.
COPY package.json package-lock.json ./
RUN npm ci

# App source is bind-mounted over /app at runtime for hot-reload, so we don't
# COPY it here. The bind mount excludes node_modules (see compose) to keep the
# container's installed deps.

# Next.js dev server port (kept distinct from the billing frontend on 3000).
EXPOSE 3001

# Bind to 0.0.0.0 so the dev server is reachable from the host.
CMD ["npm", "run", "dev", "--", "-H", "0.0.0.0"]
