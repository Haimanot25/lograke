const { validationResult, body, param, query } = require('express-validator');

function validateSchema(schema, source) {
  return (req, res, next) => {
    const data = req[source];
    const errors = [];
    for (const [field, rules] of Object.entries(schema)) {
      const value = data[field];
      if (rules.required && (value === undefined || value === null || value === '')) {
        errors.push(`${field} is required`);
        continue;
      }
      if (value === undefined || value === null) continue;
      if (rules.type === 'string' && typeof value !== 'string') {
        errors.push(`${field} must be of type ${rules.type}`);
        continue;
      }
      if (rules.type === 'number') {
        if (typeof value === 'string' && source === 'body') {
          errors.push(`${field} must be of type number`);
          continue;
        }
        const num = Number(value);
        if (isNaN(num)) {
          errors.push(`${field} must be a number`);
          continue;
        }
        if (source === 'query') req[source][field] = num;
      }
      if (rules.type === 'boolean' && typeof value !== 'boolean') {
        errors.push(`${field} must be of type boolean`);
        continue;
      }
      if (rules.minLength !== undefined && typeof value === 'string' && value.length < rules.minLength) {
        errors.push(`${field} must be at least ${rules.minLength} characters`);
      }
      if (rules.maxLength !== undefined && typeof value === 'string' && value.length > rules.maxLength) {
        errors.push(`${field} must be at most ${rules.maxLength} characters`);
      }
      if (rules.min !== undefined) {
        const num = Number(value);
        if (!isNaN(num) && num < rules.min) {
          errors.push(`${field} must be at least ${rules.min}`);
        }
      }
      if (rules.max !== undefined) {
        const num = Number(value);
        if (!isNaN(num) && num > rules.max) {
          errors.push(`${field} must be at most ${rules.max}`);
        }
      }
      if (rules.enum && !rules.enum.includes(value)) {
        errors.push(`${field} must be one of: ${rules.enum.join(', ')}`);
      }
      if (rules.pattern && typeof value === 'string' && !rules.pattern.test(value)) {
        errors.push(`${field} does not match required pattern`);
      }
    }
    if (errors.length > 0) {
      return res.status(400).json({ error: 'Validation failed', details: errors });
    }
    next();
  };
}

function validateBody(schema) {
  return validateSchema(schema, 'body');
}

function validateQuery(schema) {
  return validateSchema(schema, 'query');
}

function validate(req, res, next) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      error: 'Validation failed',
      details: errors.array().map(e => `${e.path}: ${e.msg}`),
    });
  }
  next();
}

module.exports = { validate, validateBody, validateQuery, body, param, query };