FROM node:20-alpine

WORKDIR /app

# Install dependencies
COPY package.json package-lock.json* bun.lock* ./
RUN npm install

# Copy application source code
COPY . .

# Build client distribution
RUN npm run build

EXPOSE 3000

ENV PORT=3000
ENV NODE_ENV=production

# Run the 24/7 Telegram bot and web dashboard server
CMD ["npx", "tsx", "server.ts"]
