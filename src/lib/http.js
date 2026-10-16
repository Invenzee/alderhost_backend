class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function http(status, message) {
  return new HttpError(status, message);
}

function asyncRoute(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

module.exports = { HttpError, http, asyncRoute };
