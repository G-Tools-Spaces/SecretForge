# ── Build stage ──────────────────────────────────────────────────────────────
FROM node:20-alpine AS build
WORKDIR /repo

# Copy manifests first so dependency layers cache independently of source.
COPY package.json package-lock.json* ./
COPY apps/api/package.json apps/api/
RUN npm install

COPY apps/api apps/api
RUN npx prisma generate --schema apps/api/prisma/schema.prisma
RUN npm run build --workspace @gtools-spaces/api

# ── Runtime stage ───────────────────────────────────────────────────────────
FROM node:20-alpine
WORKDIR /repo
ENV NODE_ENV=production

COPY --from=build /repo/package.json ./
COPY --from=build /repo/node_modules ./node_modules
COPY --from=build /repo/apps/api/package.json apps/api/
COPY --from=build /repo/apps/api/dist apps/api/dist
COPY --from=build /repo/apps/api/prisma apps/api/prisma

EXPOSE 4000

# Apply pending migrations, then start. The master key and other secrets come
# from the environment (docker-compose `env_file`) — never baked into the image.
CMD ["sh", "-c", "npx prisma migrate deploy --schema apps/api/prisma/schema.prisma && node apps/api/dist/main.js"]
