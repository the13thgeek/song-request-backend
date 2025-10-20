const express = require('express');
const router = express.Router();
const { ResponseHandler, asyncHandler } = require('../utils/ResponseHandler');
const SystemStatusService = require('../services/SystemStatusService');

/**
 * GET /status/health
 * Get overall system health (for monitoring/uptime services)
 * Public endpoint - no API key required
 */
router.get('/health', asyncHandler(async (req, res) => {
  const health = await SystemStatusService.getSystemHealth();
  
  // Return 200 if healthy, 503 if degraded
  const statusCode = health.status === 'healthy' ? 200 : 503;
  
  return res.status(statusCode).json({
    success: health.status === 'healthy',
    message: health.status === 'healthy' ? 'All systems operational' : 'Some systems degraded',
    data: health,
    timestamp: new Date().toISOString()
  });
}));

/**
 * GET /status/stats
 * Get detailed system statistics
 * Requires API key
 */
router.get('/stats', asyncHandler(async (req, res) => {
  const stats = await SystemStatusService.getSystemStats();
  
  return ResponseHandler.success(res, stats, 'System statistics retrieved');
}));

/**
 * GET /status/components
 * Get individual component statuses (for dashboard)
 * Public endpoint - useful for website widgets
 */
router.get('/components', asyncHandler(async (req, res) => {
  const health = await SystemStatusService.getSystemHealth();
  
  return ResponseHandler.success(res, {
    components: health.components,
    lastChecked: health.timestamp
  }, 'Component status retrieved');
}));

/**
 * GET /status/uptime
 * Simple uptime endpoint
 * Public endpoint
 */
router.get('/uptime', asyncHandler(async (req, res) => {
  return ResponseHandler.success(res, {
    uptime: SystemStatusService.getUptime(),
    version: SystemStatusService.version,
    startTime: new Date(SystemStatusService.startTime).toISOString()
  }, 'Uptime retrieved');
}));

module.exports = router;