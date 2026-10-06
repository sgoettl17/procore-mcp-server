FROM node:24-alpine

RUN apk add --no-cache curl

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
COPY data ./data
COPY scripts ./scripts

RUN npm run build

ENV NODE_ENV=production \
    PROCORE_MCP_PORT=9220 \
    PROCORE_MCP_BIND=0.0.0.0 \
    PROCORE_MCP_PATH=/mcp \
    HOME=/home/sgoettl

EXPOSE 9220

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD curl -fsS http://127.0.0.1:9220/health || exit 1

USER node
CMD ["node", "dist/src/http.js"]
