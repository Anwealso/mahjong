# Build the client and bundle the server, then ship just the two build outputs on a slim Node image.
FROM node:24-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/engine/package.json packages/engine/
COPY packages/protocol/package.json packages/protocol/
COPY packages/server/package.json packages/server/
COPY packages/client/package.json packages/client/
RUN npm ci
COPY . .
RUN npm run build

FROM node:24-slim
WORKDIR /app
ENV NODE_ENV=production PORT=8080
# The bundle finds the client at ../../client/dist relative to itself.
COPY --from=build /app/packages/server/dist packages/server/dist
COPY --from=build /app/packages/client/dist packages/client/dist
USER node
EXPOSE 8080
CMD ["node", "packages/server/dist/server.mjs"]
