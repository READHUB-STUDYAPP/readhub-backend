# ReadHub Backend (TypeScript) — multi-stage: compile with tsc, run compiled JS
FROM node:20-alpine AS build
WORKDIR /app

# Install all deps (incl. devDeps: typescript) for the build
COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

# --- Runtime: prod deps + compiled output only ---
FROM node:20-alpine AS runtime
WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

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
