require('dotenv').config();
const express = require('express');
const cors = require('cors');
const cron = require('node-cron');

const authRoutes      = require('./src/routes/auth.routes');
const sampleRoutes    = require('./src/routes/samples.routes');
const resultRoutes    = require('./src/routes/results.routes');
const dashboardRoutes = require('./src/routes/dashboard.routes');
const lookupRoutes    = require('./src/routes/lookup.routes');
const { expireOldSessions } = require('./src/utils/sessionCleanup');

const app  = express();
const PORT = process.env.PORT || 5000;

// ── Middleware ─────────────────────────────────────────────
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:3000',
  credentials: true,
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ── Request logger ─────────────────────────────────────────
app.use((req, _res, next) => {
  console.log(`[${new Date().toLocaleTimeString()}] ${req.method} ${req.path}`);
  next();
});

// ── Routes ─────────────────────────────────────────────────
app.use('/api/auth',      authRoutes);
app.use('/api/samples',   sampleRoutes);
app.use('/api/results',   resultRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/lookup',    lookupRoutes);

// ── Health check ───────────────────────────────────────────
app.get('/api/health', (_req, res) => {
  res.json({
    status : 'BUL QC Backend is running ✅',
    time   : new Date().toLocaleString(),
    version: '1.0.0',
  });
});

// ── 404 handler ────────────────────────────────────────────
app.use((_req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// ── Global error handler ───────────────────────────────────
app.use((err, _req, res, _next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// ── Cron: expire sessions every minute ────────────────────
cron.schedule('* * * * *', () => {
  expireOldSessions();
});

// ── Start server ───────────────────────────────────────────
app.listen(PORT, () => {
  console.log('');
  console.log('  ╔══════════════════════════════════════╗');
  console.log('  ║   BUL QC LIMS Backend Starting...   ║');
  console.log(`  ║   Running on http://localhost:${PORT}  ║`);
  console.log('  ╚══════════════════════════════════════╝');
  console.log('');
});