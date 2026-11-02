FROM node:24-bookworm-slim AS build
WORKDIR /workspace
RUN corepack enable && corepack prepare pnpm@11.25.0 --activate
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json .npmrc ./
COPY packages/shared/package.json packages/shared/package.json
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
RUN pnpm install --frozen-lockfile
COPY . .
ARG VITE_FIREBASE_API_KEY=fake-api-key
ARG VITE_FIREBASE_AUTH_DOMAIN=localhost
ARG VITE_FIREBASE_PROJECT_ID=ticket-maestro-local
ARG VITE_FIREBASE_AUTH_EMULATOR_URL=http://localhost:9099
ENV VITE_FIREBASE_API_KEY=$VITE_FIREBASE_API_KEY \
    VITE_FIREBASE_AUTH_DOMAIN=$VITE_FIREBASE_AUTH_DOMAIN \
    VITE_FIREBASE_PROJECT_ID=$VITE_FIREBASE_PROJECT_ID \
    VITE_FIREBASE_AUTH_EMULATOR_URL=$VITE_FIREBASE_AUTH_EMULATOR_URL
RUN pnpm build
RUN CI=true pnpm install --prod --filter @ticket-maestro/api... --frozen-lockfile

FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production PORT=8080
WORKDIR /app
COPY --from=build /workspace/node_modules ./node_modules
COPY --from=build /workspace/apps/api/node_modules ./apps/api/node_modules
COPY --from=build /workspace/apps/api/package.json ./apps/api/package.json
COPY --from=build /workspace/apps/api/openapi.json ./apps/api/openapi.json
COPY --from=build /workspace/apps/api/dist ./apps/api/dist
COPY --from=build /workspace/apps/web/dist ./apps/web/dist
COPY --from=build /workspace/packages/shared/package.json ./packages/shared/package.json
COPY --from=build /workspace/packages/shared/node_modules ./packages/shared/node_modules
COPY --from=build /workspace/packages/shared/dist ./packages/shared/dist
EXPOSE 8080
CMD ["node", "apps/api/dist/server.js"]
