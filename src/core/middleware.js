'use strict';

const theme = require('../ui/theme.js');

class MiddlewarePipeline {
  constructor() {
    this.middlewares = [];
  }

  use(middleware) {
    if (typeof middleware !== 'function') {
      throw new Error('Middleware must be a function');
    }
    this.middlewares.push(middleware);
    return this;
  }

  remove(middleware) {
    const index = this.middlewares.indexOf(middleware);
    if (index !== -1) {
      this.middlewares.splice(index, 1);
    }
    return this;
  }

  async execute(context) {
    let index = 0;
    const next = async () => {
      if (index < this.middlewares.length) {
        const middleware = this.middlewares[index++];
        await middleware(context, next);
      }
    };

    await next();
    return context;
  }

  clear() {
    this.middlewares = [];
    return this;
  }

  list() {
    return [...this.middlewares];
  }
}

const loggingMiddleware = async (context, next) => {
  const start = Date.now();
  console.log(`[${new Date().toISOString()}] Request started`);

  await next();

  const duration = Date.now() - start;
  console.log(`[${new Date().toISOString()}] Request completed in ${duration}ms`);
};

const errorMiddleware = async (context, next) => {
  try {
    await next();
  } catch (error) {
    theme.printError(error.message);
    context.error = error;
  }
};

const validationMiddleware = async (context, next) => {
  if (!context.input || context.input.trim() === '') {
    throw new Error('Input cannot be empty');
  }
  await next();
};

const rateLimitMiddleware = (maxRequests = 100, windowMs = 60000) => {
  const requests = new Map();

  return async (context, next) => {
    const now = Date.now();
    const windowStart = now - windowMs;
    const clientRequests = (requests.get(context.clientId) || []).filter(
      (t) => t > windowStart
    );

    if (clientRequests.length >= maxRequests) {
      throw new Error('Rate limit exceeded');
    }

    clientRequests.push(now);
    requests.set(context.clientId, clientRequests);

    await next();
  };
};

module.exports = {
  MiddlewarePipeline,
  loggingMiddleware,
  errorMiddleware,
  validationMiddleware,
  rateLimitMiddleware,
};
