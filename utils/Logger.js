const chalk = require('chalk');  // Optional: for colored output (npm install chalk)

class Logger {
  constructor() {
    // Read from environment variables
    this.debugMode = process.env.DEBUG_MODE === 'true';
    this.logLevel = process.env.LOG_LEVEL || 'info';
    this.timezone = process.env.LOG_TIMEZONE || 'America/New_York';
    this.logFormat = process.env.LOG_FORMAT || 'local'; // 'local' or 'utc'
    
    // Log levels hierarchy
    this.levels = {
      error: 0,
      warn: 1,
      info: 2,
      debug: 3
    };

    this.currentLevel = this.levels[this.logLevel] || this.levels.info;
  }

  /**
   * Get UTC timestamp (for data/storage/correlation)
   */
  getTimestampUTC() {
    return new Date().toISOString();
  }

  /**
   * Get formatted timestamp for display
   * Uses configured timezone (default: EST)
   */
  getTimestampDisplay() {
    const now = new Date();
    
    // Use UTC if configured
    if (this.logFormat === 'utc') {
      return now.toISOString();
    }
    
    // Otherwise use configured timezone (EST/EDT by default)
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: this.timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    });

    const parts = formatter.formatToParts(now);
    const get = (type) => parts.find(p => p.type === type)?.value;

    // Get timezone abbreviation (EST/EDT)
    const tzName = now.toLocaleString('en-US', {
      timeZone: this.timezone,
      timeZoneName: 'short'
    }).split(' ').pop();

    // Format: 2025-10-18 10:30:45 EST
    return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}:${get('second')} ${tzName}`;
  }

  /**
   * Format log message with metadata
   */
  formatMessage(level, message, meta = {}) {
    const displayTime = this.getTimestampDisplay();
    const utcTime = this.getTimestampUTC();
    
    // Add UTC timestamp to metadata for storage/correlation
    const enhancedMeta = {
      ...meta,
      _utc: utcTime  // Hidden UTC timestamp for tools
    };
    
    // Only show user-provided metadata in console (not _utc)
    const visibleMeta = Object.keys(meta).length > 0 
      ? `\n  ${JSON.stringify(meta, null, 2)}` 
      : '';
    
    return {
      formatted: `[${displayTime}] [${level.toUpperCase()}] ${message}${visibleMeta}`,
      metadata: enhancedMeta
    };
  }

  /**
   * Check if level should be logged
   */
  shouldLog(level) {
    return this.levels[level] <= this.currentLevel;
  }

  /**
   * ERROR: Critical errors that need attention
   */
  error(message, meta = {}) {
    if (!this.shouldLog('error')) return;

    const { formatted } = this.formatMessage('error', message, meta);
    
    // Use chalk for colors if available
    if (typeof chalk !== 'undefined') {
      console.error(chalk.red(formatted));
    } else {
      console.error(formatted);
    }
  }

  /**
   * WARN: Warning messages
   */
  warn(message, meta = {}) {
    if (!this.shouldLog('warn')) return;

    const { formatted } = this.formatMessage('warn', message, meta);
    
    if (typeof chalk !== 'undefined') {
      console.warn(chalk.yellow(formatted));
    } else {
      console.warn(formatted);
    }
  }

  /**
   * INFO: General information (default level)
   */
  info(message, meta = {}) {
    if (!this.shouldLog('info')) return;

    const { formatted } = this.formatMessage('info', message, meta);
    
    if (typeof chalk !== 'undefined') {
      console.log(chalk.blue(formatted));
    } else {
      console.log(formatted);
    }
  }

  /**
   * DEBUG: Detailed debugging information (only in debug mode)
   */
  debug(message, meta = {}) {
    if (!this.debugMode || !this.shouldLog('debug')) return;

    const { formatted } = this.formatMessage('debug', message, meta);
    
    if (typeof chalk !== 'undefined') {
      console.log(chalk.gray(formatted));
    } else {
      console.log(formatted);
    }
  }

  /**
   * Log endpoint entry with request details
   */
  endpoint(method, path, body = {}, query = {}) {
    if (!this.debugMode) return;

    this.debug(`→ ${method} ${path}`, {
      body: Object.keys(body).length > 0 ? body : undefined,
      query: Object.keys(query).length > 0 ? query : undefined
    });
  }

  /**
   * Log function entry with parameters
   */
  functionEntry(functionName, params = {}) {
    if (!this.debugMode) return;

    this.debug(`⚡ ${functionName}()`, params);
  }

  /**
   * Log function exit with result
   */
  functionExit(functionName, result = null) {
    if (!this.debugMode) return;

    const meta = result !== null ? { result } : {};
    this.debug(`✓ ${functionName}() completed`, meta);
  }

  /**
   * Log database query (useful for debugging)
   */
  query(query, params = []) {
    if (!this.debugMode) return;

    this.debug('DB Query', {
      sql: query,
      params: params
    });
  }

  /**
   * Log service method call
   */
  service(serviceName, methodName, params = {}) {
    if (!this.debugMode) return;

    this.debug(`🔧 ${serviceName}.${methodName}()`, params);
  }

  /**
   * SUCCESS: Success messages (custom level)
   */
  success(message, meta = {}) {
    if (!this.shouldLog('info')) return;

    const { formatted } = this.formatMessage('success', message, meta);
    
    if (typeof chalk !== 'undefined') {
      console.log(chalk.green(formatted));
    } else {
      console.log(formatted);
    }
  }

  /**
   * HTTP: Log HTTP requests/responses
   */
  http(method, path, statusCode, duration = null) {
    if (!this.shouldLog('info')) return;

    const meta = duration ? { duration: `${duration}ms` } : {};
    const message = `${method} ${path} → ${statusCode}`;
    
    const { formatted } = this.formatMessage('http', message, meta);
    
    // Color based on status code
    if (typeof chalk !== 'undefined') {
      if (statusCode >= 500) {
        console.log(chalk.red(formatted));
      } else if (statusCode >= 400) {
        console.log(chalk.yellow(formatted));
      } else if (statusCode >= 300) {
        console.log(chalk.cyan(formatted));
      } else {
        console.log(chalk.green(formatted));
      }
    } else {
      console.log(formatted);
    }
  }

  /**
   * Toggle debug mode at runtime
   */
  setDebugMode(enabled) {
    this.debugMode = enabled;
    this.info(`Debug mode ${enabled ? 'enabled' : 'disabled'}`);
  }

  /**
   * Set log level at runtime
   */
  setLogLevel(level) {
    if (this.levels[level] === undefined) {
      this.warn(`Invalid log level: ${level}`);
      return;
    }
    
    this.logLevel = level;
    this.currentLevel = this.levels[level];
    this.info(`Log level set to: ${level}`);
  }

  /**
   * Set timezone at runtime
   */
  setTimezone(timezone) {
    try {
      // Test if timezone is valid
      new Intl.DateTimeFormat('en-US', { timeZone: timezone });
      this.timezone = timezone;
      this.info(`Timezone set to: ${timezone}`);
    } catch (error) {
      this.warn(`Invalid timezone: ${timezone}`);
    }
  }

  /**
   * Set log format (local or utc)
   */
  setLogFormat(format) {
    if (format !== 'local' && format !== 'utc') {
      this.warn(`Invalid log format: ${format}. Use 'local' or 'utc'`);
      return;
    }
    
    this.logFormat = format;
    this.info(`Log format set to: ${format}`);
  }
}

// Export singleton instance
module.exports = new Logger();