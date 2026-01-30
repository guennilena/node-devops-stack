# ---- deps ----
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev

# ---- runtime ----
FROM node:22-alpine AS runtime
WORKDIR /app

# Create non-root user
RUN addgroup -S app && adduser -S app -G app

# Copy app files as root first
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Fix permissions so non-root can write (e.g., create dist/)
RUN chown -R app:app /app

USER app

RUN node scripts/build.js

ENV NODE_ENV=production
EXPOSE 3000

CMD ["node", "dist/index.js"]
