const logger = require('../utils/Logger');

/**
 * Middleware to automatically log all HTTP requests
 */
const requestLogger = (req, res, next) => {
  const startTime = Date.now();
  
  // Log incoming request (only in debug mode)
  logger.endpoint(req.method, req.path, req.body, req.query);

  // Capture the original res.json to log responses
  const originalJson = res.json;
  
  res.json = function(data) {
    const duration = Date.now() - startTime;
    
    // Log the response
    logger.http(req.method, req.path, res.statusCode, duration);
    
    // Log response body in debug mode
    if (logger.debugMode) {
      logger.debug('Response', { 
        statusCode: res.statusCode,
        body: data 
      });
    }
    
    // Call original json method
    return originalJson.call(this, data);
  };

  next();
};

module.exports = requestLogger;