const db = require('../config/database');
const TwitchService = require('./TwitchService');
const SongRequestService = require('./SongRequestService');
const logger = require('../utils/Logger');

class SystemStatusService {
  constructor() {
    this.startTime = Date.now();
    this.version = process.env.GEEK_NODE_VER || '1.0.0';
  }

  /**
   * Get overall system health
   */
  async getSystemHealth() {
    logger.service('SystemStatusService', 'getSystemHealth');

    const [dbHealth, twitchHealth, srsHealth] = await Promise.allSettled([
      this.checkDatabase(),
      this.checkTwitchService(),
      this.checkSRSService()
    ]);

    const components = {
      database: this.extractResult(dbHealth),
      twitch: this.extractResult(twitchHealth),
      srs: this.extractResult(srsHealth)
    };

    // Overall health is healthy if all components are healthy
    const overallHealthy = Object.values(components).every(c => c.healthy);

    return {
      status: overallHealthy ? 'healthy' : 'degraded',
      version: this.version,
      uptime: this.getUptime(),
      timestamp: new Date().toISOString(),
      components
    };
  }

  /**
   * Extract result from Promise.allSettled
   */
  extractResult(settledPromise) {
    if (settledPromise.status === 'fulfilled') {
      return settledPromise.value;
    } else {
      return {
        healthy: false,
        message: settledPromise.reason?.message || 'Unknown error'
      };
    }
  }

  /**
   * Check database connectivity
   */
  async checkDatabase() {
    try {
      const startTime = Date.now();
      
      // Simple query to test connection
      await db.execute('SELECT 1');
      
      const responseTime = Date.now() - startTime;

      // Get some basic stats
      const [userCount] = await db.execute(
        'SELECT COUNT(*) as count FROM tbl_users'
      );

      return {
        healthy: true,
        responseTime: `${responseTime}ms`,
        message: 'Database connected',
        stats: {
          totalUsers: userCount[0].count
        }
      };
    } catch (error) {
      logger.error('Database health check failed', { error: error.message });
      return {
        healthy: false,
        message: `Database error: ${error.message}`
      };
    }
  }

  /**
   * Check Twitch service status
   */
  async checkTwitchService() {
    try {
      const status = TwitchService.getStatus();
      
      return {
        healthy: true,
        message: status.isLive ? 'Stream is live' : 'Stream is offline',
        isLive: status.isLive,
        updateService: status.isRunning ? 'running' : 'stopped',
        username: status.username
      };
    } catch (error) {
      logger.error('Twitch health check failed', { error: error.message });
      return {
        healthy: false,
        message: `Twitch service error: ${error.message}`
      };
    }
  }

  /**
   * Check SRS service status
   */
  async checkSRSService() {
    try {
      const status = SongRequestService.getStatus();
      
      return {
        healthy: true,
        message: status.status ? 'SRS initialized' : 'SRS not initialized',
        gameLoaded: status.id || null,
        gameTitle: status.title || null,
        requestsOpen: status.requests_open,
        queueLength: status.queue_length
      };
    } catch (error) {
      logger.error('SRS health check failed', { error: error.message });
      return {
        healthy: false,
        message: `SRS error: ${error.message}`
      };
    }
  }

  /**
   * Get system uptime
   */
  getUptime() {
    const uptimeMs = Date.now() - this.startTime;
    const seconds = Math.floor(uptimeMs / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) {
      return `${days}d ${hours % 24}h ${minutes % 60}m`;
    } else if (hours > 0) {
      return `${hours}h ${minutes % 60}m`;
    } else if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`;
    } else {
      return `${seconds}s`;
    }
  }

  /**
   * Get detailed system statistics
   */
  async getSystemStats() {
    logger.service('SystemStatusService', 'getSystemStats');

    try {
      // Database stats
      const [userStats] = await db.execute(`
        SELECT 
          COUNT(*) as total_users,
          COUNT(CASE WHEN is_active = 1 THEN 1 END) as active_users,
          COUNT(CASE WHEN is_premium = 1 THEN 1 END) as premium_users,
          SUM(exp) as total_exp
        FROM tbl_users
      `);

      const [cardStats] = await db.execute(`
        SELECT 
          COUNT(*) as total_cards_issued
        FROM tbl_user_cards
      `);

      const [recentActivity] = await db.execute(`
        SELECT COUNT(*) as count
        FROM tbl_users
        WHERE last_activity >= DATE_SUB(NOW(), INTERVAL 7 DAY)
      `);

      // Memory usage
      const memUsage = process.memoryUsage();

      return {
        database: {
          totalUsers: userStats[0].total_users,
          activeUsers: userStats[0].active_users,
          premiumUsers: userStats[0].premium_users,
          totalExp: userStats[0].total_exp,
          cardsIssued: cardStats[0].total_cards_issued,
          activeLastWeek: recentActivity[0].count
        },
        system: {
          version: this.version,
          nodeVersion: process.version,
          platform: process.platform,
          uptime: this.getUptime(),
          memory: {
            heapUsed: `${Math.round(memUsage.heapUsed / 1024 / 1024)}MB`,
            heapTotal: `${Math.round(memUsage.heapTotal / 1024 / 1024)}MB`,
            rss: `${Math.round(memUsage.rss / 1024 / 1024)}MB`
          }
        },
        twitch: TwitchService.getStatus(),
        srs: SongRequestService.getStatus()
      };
    } catch (error) {
      logger.error('Failed to get system stats', { error: error.message });
      throw error;
    }
  }

  /**
   * Get API endpoint metrics (basic)
   */
  getMetrics() {
    // This is basic - you could enhance with actual request counting
    return {
      uptime: this.getUptime(),
      version: this.version,
      timestamp: new Date().toISOString()
    };
  }
}

module.exports = new SystemStatusService();