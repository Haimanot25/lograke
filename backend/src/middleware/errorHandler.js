// AppError class — keep for operational error handling
class AppError extends Error {
  constructor(message, statusCode = 500) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = true;
  }
}

function errorHandler(err, req, res, next) {
  if (err.isOperational) {
    return res.status(err.statusCode).json({
      error: err.message
    });
  }

  // Client errors surfaced by express/body-parser (e.g. 413 payload too large)
  const status = err.statusCode || err.status;
  if (typeof status === 'number' && status >= 400 && status < 500) {
    const message = status === 413 ? 'Payload too large' : status === 404 ? 'Not found' : 'Bad request';
    return res.status(status).json({ error: message });
  }

  console.error('Unhandled error:', err);
  return res.status(500).json({
    error: 'Internal server error'
  });
}

function notFoundHandler(req, res) {
  res.status(404).json({ error: 'Not found' });
}

module.exports = { errorHandler, notFoundHandler };
