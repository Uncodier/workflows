# Temporal worker image for AKS (queue selected via WORKFLOW_TASK_QUEUE).
FROM node:20-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --include=dev
COPY worker.tsconfig.json ./
COPY src ./src
RUN node ./node_modules/typescript/bin/tsc --project worker.tsconfig.json \
  && npm prune --omit=dev

FROM node:20-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
# Workflow bundle may resolve paths relative to the source tree
COPY --from=build /app/src ./src
EXPOSE 8080
CMD ["node", "dist/scripts/azure-worker-startup.js"]
