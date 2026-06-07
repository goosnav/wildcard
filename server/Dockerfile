# Wild Card — single-container image. The Node API server ALSO serves the built
# web app (WC_WEB_DIR), so this one image is the whole product: API + SPA on one
# origin (no CORS, no API-base config). Based on the official Playwright image so
# headless Chromium (the CMP-05 validator) and its system deps are present and
# version-matched to @playwright/test (keep this tag in sync with package.json).
#
# Build from the REPO ROOT (it needs all workspaces):
#   docker build -f server/Dockerfile -t wildcard .
#   docker run -p 8787:8787 --env-file .env wildcard
FROM mcr.microsoft.com/playwright:v1.60.0-jammy

WORKDIR /app
ENV NODE_ENV=production

# Install workspace deps first for better layer caching. Copy only manifests so a
# code-only change doesn't bust the npm layer.
COPY package.json package-lock.json ./
COPY runtime/package.json runtime/
COPY server/package.json server/
COPY host-web/package.json host-web/
RUN npm ci

# Copy the rest of the source and build what the server needs at runtime:
#  - runtime/dist            the WC.* SDK (imported by the server)
#  - runtime/dist/runtime.global.js  the IIFE bundle the validator injects
#  - host-web/dist           the static web app the server serves
COPY . .
RUN npm --workspace @wildcard/runtime run build \
 && npm --workspace @wildcard/runtime run build:global \
 && npm --workspace @wildcard/host-web run build

# Serve the web app from this server; bind the port the platform expects. Use an
# ABSOLUTE path: `npm --workspace` runs with cwd=/app/server, so a relative path
# would resolve under server/ and miss the built app at /app/host-web/dist.
ENV PORT=8787
ENV WC_WEB_DIR=/app/host-web/dist
EXPOSE 8787

# tsx runs the TypeScript server directly (no separate server compile step).
CMD ["npm", "--workspace", "@wildcard/server", "start"]
