const express = require('express');
const wSocket = require('ws');
const http = require('http');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const { ResponseHandler } = require('./utils/ResponseHandler');
const WebSocketService = require('./services/WebSocketService');
const TwitchAuthService = require('./services/TwitchAuthService');
const logger = require('./utils/Logger');
const requestLogger = require('./middleware/requestLogger');

const app = express();
const PORT = process.env.PORT || 8080;
const API_KEY = process.env.GEEK_API_KEY || 'XX13XX';

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use(requestLogger);

// CORS Configuration
const ALLOWED_ORIGINS = [
  'http://localhost:5173',
  'https://mainframe.the13thgeek.com',
  'https://the13thgeek.github.io',
  'https://www.the13thgeek.com',
  'https://the13thgeek.com',
];

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || ALLOWED_ORIGINS.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Unauthorized access'));
    }
  }
}));

// API Key Authentication Middleware
const PUBLIC_PATHS = [
  '/twitch-live/',
  '/mainframe/supersonic',
  '/health',
  '/status/'
];

app.use((req, res, next) => {
  // Allow public access to certain paths
  if (PUBLIC_PATHS.some(path => req.path.startsWith(path))) {
    return next();
  }

  const clientApiKey = req.headers['x-api-key'];
  if (clientApiKey !== API_KEY) {
    return ResponseHandler.unauthorized(res);
  }

  next();
});

// WebSocket Setup
const wss = new wSocket.Server({ noServer: true });
WebSocketService.initialize(wss);

// Initialize Twitch authentication
async function initializeTwitchAuth() {
  try {
    await TwitchAuthService.initialize();
    logger.success('Twitch authentication initialized');
  } catch (error) {
    logger.error('Failed to initialize Twitch auth', { error: error.message });
    logger.warn('API calls to Twitch will fail until this is fixed');
  }
}

// Create HTTP Server
const server = app.listen(PORT, async () => {
  logger.success(`theCloud System v${process.env.GEEK_NODE_VER || '1.0.0'}`);
  logger.info(`Server running on port ${PORT}`);
  
  // Initialize Twitch auth
  await initializeTwitchAuth();
  
  // Get public IP
  setTimeout(() => {
    http.get({ host: 'api.ipify.org', port: 80, path: '/' }, (resp) => {
      resp.on('data', (ip) => {
        logger.info(`Server IP: ${ip}`);
      });
    });
  }, 3000);
});

// Routes
app.use('/srs', require('./routes/srs'));
app.use('/twitch', require('./routes/twitch'));
app.use('/mainframe', require('./routes/mainframe'));
app.use('/status', require('./routes/status'));

// Health check endpoint
app.get('/health', (req, res) => {
  ResponseHandler.success(res, {
    status: 'healthy',
    uptime: process.uptime(),
    version: process.env.GEEK_NODE_VER || '1.0.0'
  }, 'Server is running');
});

// 404 Handler
app.use((req, res) => {
  ResponseHandler.notFound(res, 'Endpoint');
});

// Global Error Handler
app.use((err, req, res, next) => {
  logger.error('Unhandled error', { error: err.message, stack: err.stack });
  ResponseHandler.serverError(res, err);
});

// WebSocket Upgrade Handler
server.on('upgrade', (request, socket, head) => {
  wss.handleUpgrade(request, socket, head, (ws) => {
    wss.emit('connection', ws, request);
  });
});

// Graceful Shutdown
process.on('SIGTERM', () => {
  logger.warn('SIGTERM received, closing server...');
  
  // Close WebSocket connections
  WebSocketService.closeAll(1000, 'Server shutting down');
  
  server.close(() => {
    logger.info('Server closed gracefully');
    process.exit(0);
  });
});

module.exports = app;