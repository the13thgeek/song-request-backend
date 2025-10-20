const fs = require('fs');
const path = require('path');
const logger = require('../utils/Logger');
const FileUtils = require('../utils/FileUtils');
const TwitchAuthService = require('./TwitchAuthService');
const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

class TwitchService {
  constructor() {
    this.clientId = process.env.TWITCH_CLIENT_ID;
    this.username = process.env.TWITCH_CHANNEL_NAME || 'the13thgeek';
    this.twitchId = process.env.TWITCH_USER_ID || '806548553';
    this.workdir = path.join(__dirname, '../public/twitch-live');
    
    // Thumbnail update state
    this.updateInterval = null;
    this.isLive = false;
    this.updateFrequency = 5 * 60 * 1000; // 5 minutes
  }

  /**
   * Get access token from auth service
   */
  async getAccessToken() {
    return await TwitchAuthService.getAccessToken();
  }

  /**
   * Fetch live stream data from Twitch API
   */
  async getLiveData() {
    logger.service('TwitchService', 'getLiveData', { username: this.username });

    const requestUrl = `https://api.twitch.tv/helix/streams?user_login=${this.username}`;

    try {
      const accessToken = await this.getAccessToken();
      
      const response = await fetch(requestUrl, {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Client-Id': this.clientId
        }
      });

      if (!response.ok) {
        throw new Error(`Twitch API returned ${response.status}`);
      }

      const data = await response.json();
      const streamData = data.data[0];

      if (streamData) {
        // Stream is live
        this.isLive = true;
        streamData.thumbnail_url = this.resizeThumbnail(streamData.thumbnail_url, 640, 360);
        
        logger.info(`Stream is live [@${process.env.TWITCH_CHANNEL_NAME}]`, {
          title: streamData.title,
          game: streamData.game_name,
          viewers: streamData.viewer_count
        });

        return streamData;
      } else {
        // Stream is offline
        this.isLive = false;
        logger.debug(`Stream is offline [@${process.env.TWITCH_CHANNEL_NAME}]`);
        return null;
      }
    } catch (error) {
      logger.error('Failed to fetch live data', {
        error: error.message,
        username: this.username
      });
      throw error;
    }
  }

  /**
   * Retrieve recent VODs from Twitch API
   */
  async getVODs() {
    logger.service('TwitchService', 'getVODs', { userId: this.twitchId });

    const requestUrl = `https://api.twitch.tv/helix/videos?user_id=${this.twitchId}&type=archive&first=8`;
    
    try {
      const accessToken = await this.getAccessToken();
      
      const response = await fetch(requestUrl, {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Client-Id': this.clientId
        }
      });

      if (!response.ok) {
        throw new Error(`Twitch API returned ${response.status}`);
      }

      const data = await response.json();
      
      logger.debug('VODs retrieved', { count: data.data.length });
      
      return data.data;
    } catch (error) {
      logger.error('Failed to fetch VOD data', {
        error: error.message,
        userId: this.twitchId
      });
      throw error;
    }
  }

  /**
   * Retrieve recent Clips from Twitch API
   */
  async getClips() {
    logger.service('TwitchService', 'getClips', { userId: this.twitchId });

    const requestUrl = `https://api.twitch.tv/helix/clips?broadcaster_id=${this.twitchId}&first=20`;

    try {
      const accessToken = await this.getAccessToken();
      
      const response = await fetch(requestUrl, {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Client-Id': this.clientId
        }
      });

      if (!response.ok) {
        throw new Error(`Twitch API returned ${response.status}`);
      }

      const data = await response.json();
      
      logger.debug('Clips retrieved', { count: data.data.length });
      
      return data.data;
    } catch (error) {
      logger.error('Failed to fetch Clips data', {
        error: error.message,
        userId: this.twitchId
      });
      throw error;
    }
  }

  /**
   * Resize thumbnail URL
   */
  resizeThumbnail(url, width, height) {
    if (typeof url === 'undefined') {
      logger.warn('Thumbnail URL is undefined', { width, height });
      return null;
    }

    return url
      .replace(/%\{width\}|\{width\}/g, width)
      .replace(/%\{height\}|\{height\}/g, height);
  }

  /**
   * Fetch thumbnail URL from Twitch
   */
  async fetchThumbnailUrl() {
    logger.debug('Fetching thumbnail from Twitch API');

    const requestUrl = `https://api.twitch.tv/helix/streams?user_login=${this.username}`;

    try {
      const accessToken = await this.getAccessToken();
      
      const response = await fetch(requestUrl, {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Client-Id': this.clientId
        }
      });

      const data = await response.json();
      
      if (data.data && data.data.length > 0) {
        const thumbnailUrl = data.data[0].thumbnail_url
          .replace('{width}', '640')
          .replace('{height}', '360')
          + `?rand=${Date.now()}`; // Prevent caching

        return thumbnailUrl;
      }

      return null;
    } catch (error) {
      logger.error('Failed to fetch thumbnail URL', { error: error.message });
      throw error;
    }
  }

  /**
   * Hash a file for comparison
   */
  async hashFile(filepath) {
    return await FileUtils.hashFile(filepath);
  }

  /**
   * Hash a buffer for comparison
   */
  hashBuffer(buffer) {
    return FileUtils.hashBuffer(buffer);
  }

  /**
   * Update and shift thumbnail images
   */
  async updateThumbnails() {
    logger.debug('Checking stream status for thumbnail update...');

    try {
      const thumbnailUrl = await this.fetchThumbnailUrl();

      if (!thumbnailUrl) {
        logger.info('Stream is offline, stopping thumbnail updates');
        this.stopThumbnailUpdates();
        return;
      }

      logger.debug('Stream is live, updating thumbnails...');

      const path0min = path.join(this.workdir, '0min.jpg');
      const path5min = path.join(this.workdir, '5min.jpg');
      const path10min = path.join(this.workdir, '10min.jpg');
      const tempPath = path.join(this.workdir, 'temp_now.jpg');

      // Download new thumbnail to temp
      const response = await fetch(thumbnailUrl);
      if (!response.ok) {
        throw new Error(`Failed to fetch thumbnail: ${response.statusText}`);
      }

      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      fs.writeFileSync(tempPath, buffer);

      // Compare with current 0min.jpg
      const currentHash = await this.hashFile(path0min);
      const newHash = await this.hashFile(tempPath);

      if (currentHash !== newHash) {
        logger.info('New thumbnail detected, performing shift');

        // Shift: 5min → 10min
        if (fs.existsSync(path5min)) {
          fs.copyFileSync(path5min, path10min);
        }

        // Shift: 0min → 5min
        if (fs.existsSync(path0min)) {
          fs.copyFileSync(path0min, path5min);
        }

        // Move temp → 0min
        fs.renameSync(tempPath, path0min);

        logger.success('Thumbnails updated successfully');
      } else {
        logger.debug('Thumbnail unchanged, skipping shift');
        // Clean up temp file
        if (fs.existsSync(tempPath)) {
          fs.unlinkSync(tempPath);
        }
      }
    } catch (error) {
      logger.error('Error updating thumbnails', { error: error.message });
    }
  }

  /**
   * Initialize placeholder thumbnails
   */
  initializeThumbnails() {
    logger.debug('Initializing placeholder thumbnails');

    const placeholderPath = path.join(this.workdir, 'placeholder.jpg');
    const paths = ['0min.jpg', '5min.jpg', '10min.jpg'];

    paths.forEach(filename => {
      const targetPath = path.join(this.workdir, filename);
      if (fs.existsSync(placeholderPath)) {
        fs.copyFileSync(placeholderPath, targetPath);
      }
    });

    logger.debug('Placeholder thumbnails initialized');
  }

  /**
   * Reset thumbnails to placeholder
   */
  resetThumbnails() {
    logger.debug('Resetting thumbnails to placeholder');

    const placeholderPath = path.join(this.workdir, 'placeholder.jpg');
    const paths = ['0min.jpg', '5min.jpg', '10min.jpg'];

    if (!fs.existsSync(placeholderPath)) {
      logger.warn('Placeholder image not found', { path: placeholderPath });
      return;
    }

    paths.forEach(filename => {
      const targetPath = path.join(this.workdir, filename);
      fs.copyFileSync(placeholderPath, targetPath);
    });

    logger.info('Thumbnails reset to placeholder');
  }

  /**
   * Start automatic thumbnail updates
   */
  startThumbnailUpdates() {
    if (this.updateInterval) {
      logger.warn('Thumbnail update service already running');
      return;
    }

    logger.info('Starting thumbnail update service', {
      frequency: `${this.updateFrequency / 1000 / 60} minutes`,
      username: this.username
    });

    // Initialize thumbnails
    this.initializeThumbnails();

    // Run first update immediately
    this.updateThumbnails();

    // Set up interval
    this.updateInterval = setInterval(
      () => this.updateThumbnails(),
      this.updateFrequency
    );
  }

  /**
   * Stop automatic thumbnail updates
   */
  stopThumbnailUpdates() {
    if (!this.updateInterval) {
      logger.debug('Thumbnail update service is not running');
      return;
    }

    clearInterval(this.updateInterval);
    this.updateInterval = null;
    this.isLive = false;

    logger.info('Thumbnail update service stopped');

    // Reset to placeholders
    this.resetThumbnails();
  }

  /**
   * Get current service status
   */
  getStatus() {
    return {
      isRunning: this.updateInterval !== null,
      isLive: this.isLive,
      username: this.username,
      updateFrequency: this.updateFrequency / 1000 / 60 // in minutes
    };
  }
}

module.exports = new TwitchService();