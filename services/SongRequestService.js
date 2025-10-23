const WebSocketService = require('./WebSocketService');
const logger = require('../utils/Logger');

class SongRequestService {
  constructor() {
    this.queue = [];
    this.requestsOpen = false;
    this.gameData = null;
    this.MAX_REQUESTS_PER_USER = 3;
  }

  /**
   * Broadcast status to mainframe via WebSocket
   */
  statusRelay() {
    if (!this.gameData) return;

    WebSocketService.broadcast({
      type: 'MAINFRAME_RELAY',
      srs: this.getStatus()
    });
  }

  /**
   * Initialize game song library
   */
  loadGame(gameId) {
    try {
      this.gameData = require(`../data/${gameId}.json`);
    } catch (error) {
      return {
        success: false,
        error: 'GAME_NOT_FOUND',
        message: `Failed to load game: ${gameId}`
      };
    }
    logger.info(`Game loaded: ${this.gameData.game_title} (${this.gameData.songs.length} songs)`);
    this.statusRelay();
    return {
      success: true,
      game: this.gameData
    };
  }

  /**
   * Get current status
   */
  getStatus() {
    if (!this.gameData) {
      return {
        status: false,
        message: 'No game initialized.',
        id: null
      };
    }

    return {
      status: true,
      message: `Now playing: ${this.gameData.game_title}`,
      id: this.gameData.game_id,
      title: this.gameData.game_title,
      year: this.gameData.game_year,
      song_count: this.gameData.songs.length,
      requests_open: this.requestsOpen,
      queue_length: this.queue.length,
      queue: this.queue
    };
  }

  /**
   * Toggle request status
   */
  setRequestStatus(isOpen) {
    if (isOpen && !this.gameData) {
      return {
        success: false,
        error: 'NO_GAME',
        message: 'Cannot open requests without initializing a game.'
      };
    }

    this.requestsOpen = isOpen;
    WebSocketService.broadcast({ 
      type: isOpen ? 'REQUEST_MODE_ON' : 'REQUEST_MODE_OFF' 
    });
    this.statusRelay();
    
    return {
      success: true,
      requests_open: this.requestsOpen,
      message: `Requests are now ${isOpen ? 'open' : 'closed'}.`
    };
  }

  /**
   * Search for song in current game
   */
  findSong(query) {
    if (!this.gameData || !this.gameData.songs) return null;

    const words = query.toLowerCase().trim().split(' ');

    return this.gameData.songs.find(song => {
      const title = song?.title?.toLowerCase() || '';
      const artist = song?.artist?.toLowerCase() || '';
      const romanizedTitle = song?.romanizedTitle?.toLowerCase() || '';
      const romanizedArtist = song?.romanizedArtist?.toLowerCase() || '';
      const id = song?.id?.toLowerCase() || '';

      return words.every(word =>
        title.includes(word) ||
        romanizedTitle.includes(word) ||
        artist.includes(word) ||
        romanizedArtist.includes(word)||
        id.includes(word)
      );
    });
  }

  /**
   * Add song request to queue
   * Returns userId if found (for EXP awarding)
   */
  async requestSong(songTitle, userName, awardExp = false, isPremium = false) {
    // Check if requests are open
    if (!this.requestsOpen) {
      return {
        success: false,
        error: 'REQUESTS_CLOSED',
        message: 'Requests are not currently open'
      };
    }

    // Check if game is initialized
    if (!this.gameData) {
      return {
        success: false,
        error: 'NO_GAME',
        message: 'No game initialized.'
      };
    }

    // Find the song
    const song = this.findSong(songTitle);
    if (!song) {
      return {
        success: false,
        error: 'SONG_NOT_FOUND',
        message: `No songs matched "${songTitle}"`
      };
    }

    // Check for duplicates
    const isDuplicate = this.queue.some(
      queued => queued.id === song.id
    );

    if (isDuplicate) {
      return {
        success: false,
        error: 'DUPLICATE',
        message: `Song already in queue: [${song.title} / ${song.artist}]`,
        song: {
          title: song.title,
          artist: song.artist
        }
      };
    }

    // Check user's request count
    const userRequestCount = this.queue.filter(
      queued => queued.user === userName
    ).length;

    if (userRequestCount >= this.MAX_REQUESTS_PER_USER) {
      return {
        success: false,
        error: 'MAX_REQUESTS',
        message: `Maximum ${this.MAX_REQUESTS_PER_USER} requests per user. Please wait.`,
        currentCount: userRequestCount,
        maxAllowed: this.MAX_REQUESTS_PER_USER
      };
    }

    // Award EXP if requested
    let userId = null;
    let userAvatar = null;

    if (awardExp) {
      const UserService = require('./UserService');
      const db = require('../config/database');
      
      // Get user's local ID
      const user = await db.executeOne(
        'SELECT id, twitch_avatar FROM tbl_users WHERE twitch_display_name = ?',
        [userName]
      );

      if (user) {
        userId = user.id;
        userAvatar = user.twitch_avatar;
        // Award 1 EXP for song request
        await UserService.awardExp(user.id, isPremium, 2);
        
        // Update stats
        await UserService.updateStat(user.id, 'song_requests', 1, true);
        
        // Check for achievements
        await UserService.checkAchievements(user.id, 'song_requests');
      }
    }

    // Add to queue
    const request = {
      id: song.id,
      title: song.title,
      artist: song.artist,
      user: userName,
      avatar: userAvatar || null
    };

    this.queue.push(request);
    WebSocketService.broadcast({ type: 'ADD_SONG', song: request });
    this.statusRelay();

    

    return { 
      success: true,
      request, 
      userId,
      expAwarded: awardExp && userId !== null
    };
  }

  /**
   * Remove played song from queue
   */
  removeSong() {
    if (this.queue.length === 0) {
      return {
        success: false,
        error: 'QUEUE_EMPTY',
        message: 'Queue is empty'
      };
    }

    const playedSong = this.queue.shift();
    WebSocketService.broadcast({ type: 'REMOVE_SONG' });
    this.statusRelay();

    return {
      success: true,
      played: playedSong,
      next: this.queue[0] || null
    };
  }

  /**
   * Clear queue
   */
  clearQueue() {
    this.queue = [];
    this.statusRelay();
  }
}

module.exports = new SongRequestService();