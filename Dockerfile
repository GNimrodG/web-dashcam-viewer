# Multi-stage build for web-dashcam-viewer

ARG YARN_NETWORK_TIMEOUT=600000

# Stage 1: Install dependencies (shared)
FROM node:22-alpine AS deps

ARG YARN_NETWORK_TIMEOUT

WORKDIR /app

# Copy workspace root files
COPY package.json yarn.lock ./

# Copy package files for all workspaces
COPY web/package.json ./web/
COPY server/package.json server/tsconfig.json ./server/

# Install all dependencies (workspace mode)
RUN for attempt in 1 2 3; do \
      yarn install --frozen-lockfile --network-timeout "$YARN_NETWORK_TIMEOUT" && exit 0; \
      if [ "$attempt" -lt 3 ]; then \
        echo "Yarn install failed (attempt $attempt/3), retrying..."; \
        sleep $((attempt * 10)); \
      fi; \
    done; \
    exit 1

# Stage 2: Build frontend
FROM node:22-alpine AS frontend-builder

WORKDIR /app

# Copy dependencies from deps stage
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/web/node_modules ./web/node_modules
COPY --from=deps /app/package.json /app/yarn.lock ./
COPY --from=deps /app/web/package.json ./web/

# Copy frontend source
COPY web/ ./web/

# Build frontend
WORKDIR /app/web
RUN yarn build

# Stage 3: Build backend
FROM node:22-alpine AS backend-builder

WORKDIR /app

# Copy dependencies from deps stage
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/server/node_modules ./server/node_modules
COPY --from=deps /app/package.json /app/yarn.lock ./
COPY --from=deps /app/server/package.json /app/server/tsconfig.json ./server/

# Copy backend source
COPY server/ ./server/

# Build backend
WORKDIR /app/server
RUN yarn build

# Stage 4: Production image
FROM node:22-alpine

ARG YARN_NETWORK_TIMEOUT

# Install video and metadata extraction tools
RUN apk add --no-cache ffmpeg exiftool \
    && ffprobe -version >/dev/null \
    && exiftool -ver >/dev/null

WORKDIR /app

# Copy workspace root files
COPY package.json yarn.lock ./

# Copy backend package and build
COPY server/package.json server/tsconfig.json ./server/
COPY --from=backend-builder /app/server/dist ./server/dist

# Install production dependencies only
RUN for attempt in 1 2 3; do \
      yarn install --frozen-lockfile --production --network-timeout "$YARN_NETWORK_TIMEOUT" && exit 0; \
      if [ "$attempt" -lt 3 ]; then \
        echo "Yarn install failed (attempt $attempt/3), retrying..."; \
        sleep $((attempt * 10)); \
      fi; \
    done; \
    exit 1

# Copy frontend build
COPY --from=frontend-builder /app/web/dist ./web/dist

# Set environment variables
ENV NODE_ENV=production
ENV PORT=3000
ENV SERVE_WEB=true
ENV MEDIA_DIR=/media

# Expose the server port
EXPOSE 3000

# Create media directory and define as volume
RUN mkdir -p /media
VOLUME ["/media"]

# Health check - ping the health endpoint
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD node -e "require('http').get('http://localhost:3000/api/health', (r) => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"

# Start the server (which will serve the frontend static files)
WORKDIR /app/server
CMD ["node", "dist/index.js"]
