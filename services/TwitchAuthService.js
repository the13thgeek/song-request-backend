const fs = require('fs');
const path = require('path');
const logger = require('../utils/Logger');
const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

class TwitchAuthService {
  constructor() {
    this.clientId = process.env.TWITCH_CLIENT_ID;
    this.clientSecret = process.env.TWITCH_CLIENT_SECRET;
    this.tokenPath = path.join(__dirname, '../.twitch-token.json');
    
    // Token data
    this.accessToken = null;
    this.refreshToken = null;
    this.expiresAt = null;
    
    // Auto-refresh timer
    this.refreshTimer = null;
  }

  /**
   * Initialize auth service - load existing token or get new one
   */
  async initialize() {
    logger.info('Initializing Twitch authentication...');

    try {
      // Try to load existing token
      const loaded = await this.loadToken();
      
      if (loaded) {
        // Check if token is still valid
        const isValid = await this.validateToken();
        
        if (isValid) {
          logger.success('Existing Twitch token is valid');
          this.scheduleRefresh();
          return true;
        } else {
          logger.warn('Existing token is invalid, getting new token...');
        }
      }

      // Get new token (first time or if refresh failed)
      await this.getAppAccessToken();
      this.scheduleRefresh();
      return true;
    } catch (error) {
      logger.error('Failed to initialize Twitch auth', { error: error.message });
      throw error;
    }
  }

  /**
   * Get App Access Token (Client Credentials flow)
   * Use this if you don't need user-specific data
   */
  async getAppAccessToken() {
    logger.info('Requesting new Twitch app access token...');

    try {
      const response = await fetch('https://id.twitch.tv/oauth2/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: new URLSearchParams({
          client_id: this.clientId,
          client_secret: this.clientSecret,
          grant_type: 'client_credentials'
        })
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Twitch API error: ${error}`);
      }

      const data = await response.json();

      this.accessToken = data.access_token;
      this.expiresAt = Date.now() + (data.expires_in * 1000);
      this.refreshToken = null; // App tokens don't have refresh tokens

      logger.success('New Twitch app access token obtained', {
        expiresIn: `${data.expires_in} seconds`
      });

      // Save token
      await this.saveToken();

      return this.accessToken;
    } catch (error) {
      logger.error('Failed to get app access token', { error: error.message });
      throw error;
    }
  }

  /**
   * Validate current token
   */
  async validateToken() {
    if (!this.accessToken) {
      return false;
    }

    logger.debug('Validating Twitch token...');

    try {
      const response = await fetch('https://id.twitch.tv/oauth2/validate', {
        headers: {
          'Authorization': `OAuth ${this.accessToken}`
        }
      });

      if (response.ok) {
        const data = await response.json();
        logger.debug('Token is valid', {
          expiresIn: `${data.expires_in} seconds`,
          clientId: data.client_id
        });
        
        // Update expiry time based on validation response
        this.expiresAt = Date.now() + (data.expires_in * 1000);
        
        return true;
      } else {
        logger.warn('Token validation failed', { status: response.status });
        return false;
      }
    } catch (error) {
      logger.error('Token validation error', { error: error.message });
      return false;
    }
  }

  /**
   * Refresh token before it expires
   */
  async refreshAccessToken() {
    logger.info('Refreshing Twitch access token...');

    // For app access tokens, just get a new one
    // (they don't support refresh, need to request new token)
    try {
      await this.getAppAccessToken();
      this.scheduleRefresh();
      return true;
    } catch (error) {
      logger.error('Failed to refresh token', { error: error.message });
      
      // Retry after 5 minutes
      logger.warn('Retrying token refresh in 5 minutes...');
      setTimeout(() => this.refreshAccessToken(), 5 * 60 * 1000);
      
      return false;
    }
  }

  /**
   * Schedule automatic token refresh
   * Refreshes 1 hour before expiry (or halfway through token lifetime)
   * Note: setTimeout max is ~24.8 days, so we use intervals for longer periods
   */
  scheduleRefresh() {
    // Clear existing timer
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
    }

    if (!this.expiresAt) {
      logger.warn('Cannot schedule refresh: no expiry time set');
      return;
    }

    const now = Date.now();
    const expiresIn = this.expiresAt - now;
    
    // Refresh 1 hour before expiry (or halfway through if token lifetime < 2 hours)
    const refreshBuffer = Math.min(60 * 60 * 1000, expiresIn / 2);
    const refreshIn = expiresIn - refreshBuffer;

    if (refreshIn <= 0) {
      logger.warn('Token expires soon, refreshing immediately');
      this.refreshAccessToken();
      return;
    }

    // JavaScript setTimeout max is ~24.8 days (2^31-1 milliseconds)
    const MAX_TIMEOUT = 2147483647; // ~24.8 days in milliseconds
    
    if (refreshIn > MAX_TIMEOUT) {
      // Token expires in more than 24 days
      // Schedule a check in 20 days instead
      const checkIn = 20 * 24 * 60 * 60 * 1000; // 20 days
      const checkDate = new Date(now + checkIn);
      
      logger.info('Token refresh check scheduled (long-lived token)', {
        expiresAt: new Date(this.expiresAt).toISOString(),
        nextCheckAt: checkDate.toISOString(),
        checkIn: this.formatDuration(checkIn)
      });

      this.refreshTimer = setTimeout(() => {
        // Re-evaluate when to refresh
        this.scheduleRefresh();
      }, checkIn);
    } else {
      // Normal case: schedule refresh directly
      const refreshDate = new Date(now + refreshIn);
      logger.info('Token refresh scheduled', {
        expiresAt: new Date(this.expiresAt).toISOString(),
        refreshAt: refreshDate.toISOString(),
        refreshIn: this.formatDuration(refreshIn)
      });

      this.refreshTimer = setTimeout(() => {
        this.refreshAccessToken();
      }, refreshIn);
    }
  }

  /**
   * Save token to file
   */
  async saveToken() {
    try {
      const tokenData = {
        accessToken: this.accessToken,
        refreshToken: this.refreshToken,
        expiresAt: this.expiresAt,
        savedAt: Date.now()
      };

      fs.writeFileSync(
        this.tokenPath,
        JSON.stringify(tokenData, null, 2),
        'utf8'
      );

      logger.debug('Token saved to file', { path: this.tokenPath });
    } catch (error) {
      logger.error('Failed to save token', { error: error.message });
    }
  }

  /**
   * Load token from file
   */
  async loadToken() {
    try {
      if (!fs.existsSync(this.tokenPath)) {
        logger.debug('No saved token file found');
        return false;
      }

      const tokenData = JSON.parse(
        fs.readFileSync(this.tokenPath, 'utf8')
      );

      this.accessToken = tokenData.accessToken;
      this.refreshToken = tokenData.refreshToken;
      this.expiresAt = tokenData.expiresAt;

      logger.debug('Token loaded from file', {
        savedAt: new Date(tokenData.savedAt).toISOString()
      });

      return true;
    } catch (error) {
      logger.error('Failed to load token', { error: error.message });
      return false;
    }
  }

  /**
   * Get current valid access token
   * Automatically refreshes if needed
   */
  async getAccessToken() {
    // Check if token exists and is not expired
    if (this.accessToken && this.expiresAt && Date.now() < this.expiresAt - 60000) {
      return this.accessToken;
    }

    // Token expired or doesn't exist, refresh it
    logger.info('Token expired or missing, refreshing...');
    await this.refreshAccessToken();
    
    return this.accessToken;
  }

  /**
   * Revoke current token (for cleanup)
   */
  async revokeToken() {
    if (!this.accessToken) {
      logger.debug('No token to revoke');
      return;
    }

    logger.info('Revoking Twitch token...');

    try {
      const response = await fetch('https://id.twitch.tv/oauth2/revoke', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: new URLSearchParams({
          client_id: this.clientId,
          token: this.accessToken
        })
      });

      if (response.ok) {
        logger.success('Token revoked successfully');
        
        // Clear token data
        this.accessToken = null;
        this.refreshToken = null;
        this.expiresAt = null;
        
        // Delete token file
        if (fs.existsSync(this.tokenPath)) {
          fs.unlinkSync(this.tokenPath);
        }
      } else {
        logger.warn('Token revocation failed', { status: response.status });
      }
    } catch (error) {
      logger.error('Error revoking token', { error: error.message });
    }
  }

  /**
   * Format duration in human-readable format
   */
  formatDuration(ms) {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) return `${days}d ${hours % 24}h`;
    if (hours > 0) return `${hours}h ${minutes % 60}m`;
    if (minutes > 0) return `${minutes}m`;
    return `${seconds}s`;
  }

  /**
   * Get token status for monitoring
   */
  getStatus() {
    if (!this.accessToken) {
      return {
        hasToken: false,
        message: 'No token available'
      };
    }

    const now = Date.now();
    const expiresIn = this.expiresAt - now;

    return {
      hasToken: true,
      isValid: expiresIn > 0,
      expiresAt: new Date(this.expiresAt).toISOString(),
      expiresIn: this.formatDuration(expiresIn),
      tokenType: this.refreshToken ? 'user' : 'app'
    };
  }
}

module.exports = new TwitchAuthService();