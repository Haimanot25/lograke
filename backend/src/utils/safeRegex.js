const safeRegex = require('safe-regex2');

function compileSafe(pattern) {
  const regex = new RegExp(pattern);
  if (!safeRegex(regex)) {
    const err = new Error('Regex rejected: pattern is too complex (possible ReDoS)');
    err.isOperational = true;
    err.statusCode = 400;
    throw err;
  }
  return regex;
}

module.exports = { compileSafe };
