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

CMD ["node", "dist/server.js"]
