# =====================================================
# Stage 1 — build
# =====================================================
FROM node:20-alpine AS builder

WORKDIR /app

# Install dependencies (all, including devDependencies for build)
COPY package*.json ./
RUN npm ci

# Copy source and compile
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# =====================================================
# Stage 2 — production
# =====================================================
FROM node:20-alpine AS runner

ENV NODE_ENV=production

WORKDIR /app

# Install production dependencies only
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Copy compiled output from builder
COPY --from=builder /app/dist ./dist

EXPOSE 8080

# Env vars are injected by Docker / orchestrator at runtime
CMD ["node", "dist/server.js"]
