FROM node:22-bookworm-slim AS build

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build
RUN npm prune --omit=dev

FROM node:22-bookworm-slim AS runtime

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV DATA_DIR=/data

COPY --from=build /app/build ./build
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/package-lock.json ./package-lock.json
COPY --from=build /app/.env.example ./.env.example
COPY --from=build /app/bin ./bin
COPY --from=build /app/assets/test-images ./assets/test-images
COPY --from=build /app/src/lib/server/agent/prompts ./src/lib/server/agent/prompts

EXPOSE 3000
CMD ["node", "build"]
