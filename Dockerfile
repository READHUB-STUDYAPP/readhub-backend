# ReadHub Backend (TypeScript) — multi-stage: compile with tsc, run compiled JS
FROM node:22-alpine AS build
WORKDIR /app

# Install all deps (incl. devDeps: typescript) for the build
COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

# --- Runtime: prod deps + compiled output only ---
FROM node:22-alpine AS runtime
WORKDIR /app

# The published base image lags Alpine's own patched packages, and that is
# where the image's critical/high findings come from -- musl, libssl3, zlib and
# friends, all with fixes already released. Upgrading at build time takes the
# image to zero; without it the image is only as fresh as the last time
# upstream happened to rebuild it.
RUN apk upgrade --no-cache

COPY package*.json ./

# npm is removed once it has done its job here.
#
# It accounted for every remaining finding in this image -- 23 critical/high
# across pacote, sigstore, tar, cross-spawn, glob, minimatch and others, none
# of them the application's own dependencies, all of them inside npm's bundled
# tree at /usr/local/lib/node_modules/npm. The container starts with
# `node dist/server.js` and nothing in the infra repo shells into it with npm,
# so shipping a package manager in the runtime image only widens its surface.
RUN npm ci --omit=dev \
 && npm cache clean --force \
 && rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx /root/.npm

# Compiled JS retains the @swagger JSDoc comments, so /api-docs works from dist.
COPY --from=build /app/dist ./dist

ENV NODE_ENV=production
EXPOSE 5000

# Drop root before the app runs (Trivy DS-0002).
#
# The container ran as root, so anything that reached code execution inside it
# held full privileges over the image filesystem and any mounted volume. `node`
# is an unprivileged uid 1000 the official image already ships, so adopting it
# costs nothing.
#
# The chown is needed because both `npm ci` and the COPY above run as root, and
# the app would otherwise own none of the files it runs from.
RUN chown -R node:node /app
USER node

CMD ["node", "dist/server.js"]
