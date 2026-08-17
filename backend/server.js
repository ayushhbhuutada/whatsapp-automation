import fs from 'fs';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import apiRouter from './routes.js';
import runner from './services/automationRunner.js';
import { getUploadsDir, getAttachmentsDir } from './paths.js';

dotenv.config();

process.on('unhandledRejection', (reason) => {
  console.error('[Process Warning] Unhandled Rejection:', reason?.message || reason);
});

process.on('uncaughtException', (err) => {
  console.error('[Process Warning] Uncaught Exception:', err?.message || err);
});

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 5000;

// Apply security headers
app.use(helmet({
  contentSecurityPolicy: false, // Allow inline scripts/styles for frontend React SPA
  crossOriginResourcePolicy: { policy: 'cross-origin' }
}));

// Rate limiting for auth endpoints (max 15 login/register attempts per 15 minutes)
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 15,
  message: { error: 'Too many login or registration attempts. Please try again in 15 minutes.' }
});

// General API rate limiter (max 5000 requests per 15 minutes per IP to allow real-time UI polling)
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5000,
  message: { error: 'Rate limit exceeded. Please try again later.' }
});

// Enable CORS with configurable origin
const allowedOrigin = process.env.CORS_ORIGIN || '*';
app.use(cors({
  origin: allowedOrigin,
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

app.use('/api/auth/login', authLimiter);
app.use('/api/auth/register', authLimiter);
app.use('/api', apiLimiter);

// Register API Routes
app.use('/api', apiRouter);

// JSON 404 handler for unmatched /api/* routes
app.all('/api/*', (req, res) => {
  res.status(404).json({ error: 'Endpoint not found' });
});

// Serve uploads as static resources (useful for previewing attachment files)
const uploadsDir = getUploadsDir();
app.use('/uploads', express.static(uploadsDir));

const attachmentsDir = getAttachmentsDir();
app.use('/attachments', express.static(attachmentsDir));

// Resolve frontend dist directory across all production packaging environments
function getFrontendDistDir() {
  const possiblePaths = [
    path.resolve(__dirname, '../frontend/dist'),
    process.resourcesPath ? path.join(process.resourcesPath, 'app.asar.unpacked', 'frontend', 'dist') : null,
    process.resourcesPath ? path.join(process.resourcesPath, 'app.asar', 'frontend', 'dist') : null,
    path.resolve(__dirname, '../../frontend/dist'),
    path.resolve(__dirname, 'public')
  ].filter(Boolean);

  for (const p of possiblePaths) {
    try {
      if (fs.existsSync(p) && fs.existsSync(path.join(p, 'index.html'))) {
        return p;
      }
    } catch (e) {}
  }
  return path.resolve(__dirname, '../frontend/dist');
}

const frontendDistDir = getFrontendDistDir();
if (fs.existsSync(frontendDistDir)) {
  console.log(`[Server] Serving frontend build from: ${frontendDistDir}`);
  app.use(express.static(frontendDistDir));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/uploads') || req.path.startsWith('/attachments')) {
      return next();
    }
    res.sendFile(path.join(frontendDistDir, 'index.html'));
  });
} else {
  console.warn(`[Server Warning] Frontend dist directory not found at: ${frontendDistDir}`);
}

// Fallback error handler
app.use((err, req, res, next) => {
  console.error('Express server error:', err);
  res.status(500).json({ error: err.message || 'Internal Server Error' });
});

// Start Server (Bind to 0.0.0.0 for universal IPv4 / loopback access on all PCs)
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`WhatsApp Automation API Server running on port ${PORT}`);
});

server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`\n❌ ERROR: Port ${PORT} is already in use by another process!`);
    console.error(`Please close any existing "WhatsApp Backend" command prompt window or run 'stop_all.bat' to free port ${PORT}.\n`);
  } else {
    console.error('❌ Server startup error:', error);
  }
  process.exit(1);
});

// Graceful shutdown handling
const shutdown = async () => {
  console.log('Shutting down server...');
  // Ensure process exits even if browser cleanup hangs
  const forceExit = setTimeout(() => {
    console.log('Forced exit timeout reached.');
    process.exit(0);
  }, 5000);

  try {
    await runner.cleanup();
  } catch (e) {
    console.error('Error during runner cleanup:', e);
  }

  server.close(() => {
    clearTimeout(forceExit);
    console.log('Server process terminated.');
    process.exit(0);
  });
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
