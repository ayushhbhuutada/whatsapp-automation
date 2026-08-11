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

dotenv.config();

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

// General API rate limiter (max 300 requests per 15 minutes per IP)
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
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

// Serve uploads as static resources (useful for previewing attachment files)
const uploadsDir = path.resolve(__dirname, '../uploads');
app.use('/uploads', express.static(uploadsDir));

const attachmentsDir = path.resolve(__dirname, '../attachments');
app.use('/attachments', express.static(attachmentsDir));

// Serve frontend production build statically in production mode
const frontendDistDir = path.resolve(__dirname, '../frontend/dist');
if (fs.existsSync(frontendDistDir)) {
  app.use(express.static(frontendDistDir));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/uploads') || req.path.startsWith('/attachments')) {
      return next();
    }
    res.sendFile(path.join(frontendDistDir, 'index.html'));
  });
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
