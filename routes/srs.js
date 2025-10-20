const express = require('express');
const router = express.Router();
const { ResponseHandler, asyncHandler } = require('../utils/ResponseHandler');
const SongRequestService = require('../services/SongRequestService');

/**
 * POST /srs/status
 * Get current SRS status
 */
router.post('/status', asyncHandler(async (req, res) => {
  const status = SongRequestService.getStatus();
  return ResponseHandler.success(res, status, status.message);
}));

/**
 * POST /srs/init-game
 * Initialize game song library
 */
router.post('/init-game', asyncHandler(async (req, res) => {
  const { game_id } = req.body;

  if (!game_id) {
    return ResponseHandler.validationError(res, { game_id: 'Required' });
  }

  const result = SongRequestService.loadGame(game_id);

  // Handle error response
  if (!result.success) {
    return ResponseHandler.error(res, `⚠️ ${result.message}`, 404);
  }

  const gameData = result.game;

  return ResponseHandler.success(res, {
    id: gameData.game_id,
    title: gameData.game_title,
    year: gameData.game_year,
    song_count: gameData.songs.length,
    requests_open: SongRequestService.requestsOpen
  }, `Game [${gameData.game_title}] initialized with ${gameData.songs.length} songs available.`);
}));

/**
 * POST /srs/request-status
 * Enable/disable song requests
 */
router.post('/request-status', asyncHandler(async (req, res) => {
  const { toggle } = req.body;

  if (!toggle) {
    return ResponseHandler.validationError(res, { toggle: 'Required (on/off)' });
  }

  const isOpen = toggle.trim().toLowerCase() === 'on';
  const result = SongRequestService.setRequestStatus(isOpen);

  // Handle error response
  if (!result.success) {
    return ResponseHandler.error(res, `⚠️ ${result.message}`, 400);
  }

  return ResponseHandler.success(res, result, result.message);
}));

/**
 * POST /srs/check-song
 * Check if song exists in current game
 */
router.post('/check-song', asyncHandler(async (req, res) => {
  const { song_title } = req.body;

  if (!song_title) {
    return ResponseHandler.validationError(res, { song_title: 'Required' });
  }

  const song = SongRequestService.findSong(song_title);

  if (!song) {
    return ResponseHandler.error(res,
      `No songs matched "${song_title}". May not be in current game.`,
      404
    );
  }

  return ResponseHandler.success(res, {
    id: song.id,
    title: song.title,
    artist: song.artist
  }, `Found: [${song.title} / ${song.artist}]. Use !req ${song_title} to request.`);
}));

/**
 * POST /srs/request-song
 * Request a song (from chat)
 */
router.post('/request-song', asyncHandler(async (req, res) => {
  const { song_title, user_name, twitch_roles } = req.body;

  if (!song_title || !user_name) {
    return ResponseHandler.validationError(res, {
      song_title: 'Required',
      user_name: 'Required'
    });
  }

  // Determine if user is premium (for EXP calculation)
  const UserService = require('../services/UserService');
  const isPremium = UserService.isPremium(twitch_roles);

  // Request song and award EXP
  const result = await SongRequestService.requestSong(
    song_title, 
    user_name,
    true,        // awardExp = true
    isPremium    // for EXP multiplier
  );

  // Handle error responses
  if (!result.success) {
    let statusCode = 400;
    let message = result.message;

    // Customize messages/codes based on error type
    switch (result.error) {
      case 'REQUESTS_CLOSED':
        message = '⚠️ Song requests are currently closed';
        break;
      case 'NO_GAME':
        message = '⚠️ No game is currently loaded';
        break;
      case 'SONG_NOT_FOUND':
        message = `⚠️ No songs matched "${song_title}". May not be in current game.`;
        statusCode = 404;
        break;
      case 'DUPLICATE':
        message = `⚠️ Song already in queue: [${result.song.title} / ${result.song.artist}]`;
        break;
      case 'MAX_REQUESTS':
        message = `⚠️ Maximum ${result.maxAllowed} requests per user. Please wait.`;
        break;
    }

    return ResponseHandler.error(res, message, statusCode);
  }

  // Success response
  const message = result.expAwarded
    ? `✅ Request added: [${result.request.title} / ${result.request.artist}] +EXP!`
    : `✅ Request added: [${result.request.title} / ${result.request.artist}]`;

  return ResponseHandler.success(res, {
    request: result.request,
    exp_awarded: result.expAwarded
  }, message);
}));

/**
 * POST /srs/request-site
 * Request a song (from website)
 */
/*
router.post('/request-site', asyncHandler(async (req, res) => {
  const { id, title, artist, user_name } = req.body;

  if (!id || !title || !artist || !user_name) {
    return ResponseHandler.validationError(res, {
      id: 'Required',
      title: 'Required',
      artist: 'Required',
      user_name: 'Required'
    });
  }

  // Check for duplicates
  const isDuplicate = SongRequestService.queue.some(song => song.id === id);
  if (isDuplicate) {
    return ResponseHandler.error(res,
      `⚠️ Song already in queue: [${title} / ${artist}]`,
      400
    );
  }

  // Check user's request count
  const userCount = SongRequestService.queue.filter(
    song => song.user === user_name
  ).length;

  if (userCount >= SongRequestService.MAX_REQUESTS_PER_USER) {
    return ResponseHandler.error(res,
      `⚠️ Maximum ${SongRequestService.MAX_REQUESTS_PER_USER} requests per user`,
      400
    );
  }

  // Add directly to queue
  const request = { id, title, artist, user: user_name };
  SongRequestService.queue.push(request);
  SongRequestService.statusRelay();

  return ResponseHandler.success(res, request,
    `✅ Request added: [${title} / ${artist}]`
  );
}));
*/

/**
 * POST /srs/remove-song
 * Remove played song from queue
 */
router.post('/remove-song', asyncHandler(async (req, res) => {
  const result = SongRequestService.removeSong();

  // Handle error response
  if (!result.success) {
    return ResponseHandler.error(res, '⚠️ Queue is already empty', 400);
  }

  // Success response
  const message = result.next
    ? `▶️ [${result.played.title}] played! Next ⏩ [${result.next.title}]`
    : `▶️ [${result.played.title}] played. Queue is empty.`;

  return ResponseHandler.success(res, result, message);
}));

module.exports = router;