const express = require('express');
const router = express.Router();
const { ResponseHandler, asyncHandler } = require('../utils/ResponseHandler');
const TwitchService = require('../services/TwitchService');
const logger = require('../utils/Logger');

/**
 * POST /twitch/live-data
 * Get current live stream data
 */
router.post('/live-data', asyncHandler(async (req, res) => {
  logger.endpoint(req.method, req.path);

  const liveData = await TwitchService.getLiveData();

  if (!liveData) {
    return ResponseHandler.success(res, null, 'Stream is currently offline');
  }

  return ResponseHandler.success(res, liveData, 'Live stream data retrieved');
}));

/**
 * POST /twitch/live-vods
 * Get recent VODs from Twitch channel
 */
router.post('/live-vods', asyncHandler(async (req, res) => {
  logger.endpoint(req.method, req.path); 
  const vodData = await TwitchService.getVODs();
  
  return ResponseHandler.success(res, vodData, 'VOD data retrieved');
}));

router.post('/live-clips', asyncHandler(async (req, res) => {
  logger.endpoint(req.method, req.path); 
  const clipsData = await TwitchService.getClips();
  
  return ResponseHandler.success(res, clipsData, 'Clips data retrieved');
}));

/**
 * POST /twitch/live-update/start
 * Start automatic thumbnail update service
 */
router.post('/live-update/start', asyncHandler(async (req, res) => {
  logger.endpoint(req.method, req.path);

  TwitchService.startThumbnailUpdates();

  const status = TwitchService.getStatus();

  return ResponseHandler.success(res, status, 
    `Thumbnail update service started (every ${status.updateFrequency} minutes)`
  );
}));

/**
 * POST /twitch/live-update/stop
 * Stop automatic thumbnail update service
 */
router.post('/live-update/stop', asyncHandler(async (req, res) => {
  logger.endpoint(req.method, req.path);

  TwitchService.stopThumbnailUpdates();

  const status = TwitchService.getStatus();

  return ResponseHandler.success(res, status, 'Thumbnail update service stopped');
}));

/**
 * GET /twitch/live-update/status
 * Get thumbnail update service status
 */
router.get('/live-update/status', asyncHandler(async (req, res) => {
  const status = TwitchService.getStatus();

  return ResponseHandler.success(res, status, 'Service status retrieved');
}));

module.exports = router;