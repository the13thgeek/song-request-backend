/**
 * Standardized API response handler
 * Ensures consistent response format across all endpoints
 */
class ResponseHandler {
  static success(res, data = null, message = 'Success', statusCode = 200) {
    return res.status(statusCode).json({
      success: true,
      message,
      data,
      timestamp: new Date().toISOString()
    });
  }

  static error(res, message = 'An error occurred', statusCode = 500, errors = null) {
    return res.status(statusCode).json({
      success: false,
      message,
      errors,
      timestamp: new Date().toISOString()
    });
  }

  static validationError(res, errors) {
    return this.error(res, 'Validation failed', 400, errors);
  }

  static notFound(res, resource = 'Resource') {
    return this.error(res, `${resource} not found`, 404);
  }

  static unauthorized(res, message = 'Unauthorized access') {
    return this.error(res, message, 403);
  }

  static serverError(res, error) {
    console.error('Server error:', error);
    return this.error(res, 'Internal server error', 500);
  }
}

/**
 * Async error wrapper for route handlers
 * Catches errors and passes them to error handler
 */
const asyncHandler = (fn) => {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch((error) => {
      ResponseHandler.serverError(res, error);
    });
  };
};

module.exports = { ResponseHandler, asyncHandler };