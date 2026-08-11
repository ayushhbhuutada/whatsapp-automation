# Production Dockerfile for WhatsApp Automation SaaS Engine
FROM mcr.microsoft.com/playwright:v1.44.0-jammy

# Set working directory
WORKDIR /app

# Copy root package configurations and project files
COPY backend/package*.json ./backend/
COPY frontend/package*.json ./frontend/

# Install backend dependencies
WORKDIR /app/backend
RUN npm ci --only=production

# Install frontend dependencies and build production assets
WORKDIR /app/frontend
RUN npm ci
COPY frontend/ ./
RUN npm run build

# Copy backend code
WORKDIR /app/backend
COPY backend/ ./

# Copy workspace directories
COPY attachments /app/attachments
COPY database /app/database
COPY uploads /app/uploads

# Expose port
EXPOSE 5000

# Environment Defaults
ENV PORT=5000
ENV NODE_ENV=production

# Start production server
CMD ["node", "server.js"]
