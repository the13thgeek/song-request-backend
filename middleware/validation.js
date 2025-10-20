const { ResponseHandler } = require('../utils/ResponseHandler');

/**
 * Validation middleware factory
 * Creates middleware that validates request body/query parameters
 */
const validate = (schema) => {
  return (req, res, next) => {
    const data = { ...req.body, ...req.query, ...req.params };
    const errors = {};

    for (const [field, rules] of Object.entries(schema)) {
      const value = data[field];

      // Required check
      if (rules.required && (value === undefined || value === null || value === '')) {
        errors[field] = `${field} is required`;
        continue;
      }

      // Skip other validations if field is optional and empty
      if (!rules.required && !value) continue;

      // Type check
      if (rules.type) {
        const actualType = typeof value;
        if (actualType !== rules.type) {
          errors[field] = `${field} must be of type ${rules.type}`;
          continue;
        }
      }

      // String validations
      if (rules.type === 'string') {
        if (rules.minLength && value.length < rules.minLength) {
          errors[field] = `${field} must be at least ${rules.minLength} characters`;
        }
        if (rules.maxLength && value.length > rules.maxLength) {
          errors[field] = `${field} must be at most ${rules.maxLength} characters`;
        }
        if (rules.pattern && !rules.pattern.test(value)) {
          errors[field] = `${field} format is invalid`;
        }
      }

      // Number validations
      if (rules.type === 'number') {
        if (rules.min !== undefined && value < rules.min) {
          errors[field] = `${field} must be at least ${rules.min}`;
        }
        if (rules.max !== undefined && value > rules.max) {
          errors[field] = `${field} must be at most ${rules.max}`;
        }
      }

      // Enum check
      if (rules.enum && !rules.enum.includes(value)) {
        errors[field] = `${field} must be one of: ${rules.enum.join(', ')}`;
      }

      // Custom validation
      if (rules.custom) {
        const customError = rules.custom(value, data);
        if (customError) {
          errors[field] = customError;
        }
      }
    }

    if (Object.keys(errors).length > 0) {
      return ResponseHandler.validationError(res, errors);
    }

    next();
  };
};

/**
 * Common validation schemas
 */
const schemas = {
  twitchUser: {
    twitch_id: { required: true, type: 'string' },
    twitch_display_name: { required: true, type: 'string', minLength: 1, maxLength: 25 },
    twitch_avatar: { required: false, type: 'string' }
  },

  userId: {
    user_id: { required: true, type: 'number', min: 1 }
  },

  gameId: {
    game_id: { required: true, type: 'string', pattern: /^[a-z0-9-_]+$/i }
  },

  songRequest: {
    song_title: { required: true, type: 'string', minLength: 1 },
    user_name: { required: true, type: 'string', minLength: 1 }
  },

  ranking: {
    rank_type: { 
      required: true, 
      type: 'string',
      enum: ['exp', 'spender', 'redeems', 'checkins_last', 'checkins', 'achievements']
    },
    items_to_show: { required: false, type: 'number', min: 1, max: 100 }
  }
};

module.exports = { validate, schemas };