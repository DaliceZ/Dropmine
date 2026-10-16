FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY frontend/package.json ./frontend/package.json
COPY backend/package.json ./backend/package.json
RUN npm ci
COPY tsconfig.json ./
COPY shared ./shared
COPY backend ./backend
RUN npm run build -w backend

FROM node:22-alpine AS runtime
ENV NODE_ENV=production SERVE_FRONTEND=false PORT=3001
WORKDIR /app
COPY package.json package-lock.json ./
COPY frontend/package.json ./frontend/package.json
COPY backend/package.json ./backend/package.json
RUN npm ci --omit=dev --workspace backend --include-workspace-root=false && npm cache clean --force
COPY --from=build --chown=node:node /app/backend/dist ./backend/dist
WORKDIR /app/backend
USER node
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD node -e "fetch('http://127.0.0.1:' + process.env.PORT + '/api/health').then(response => process.exit(response.ok ? 0 : 1)).catch(() => process.exit(1))"
CMD ["node", "dist/index.js"]
