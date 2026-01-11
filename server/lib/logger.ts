import pino from 'pino';

export const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport: {
    target: 'pino-pretty',
    options: {
      colorize: true,
      ignore: 'pid,hostname',
      translateTime: 'SYS:standard',
    },
  },
  redact: {
    paths: [
      'req.headers.authorization',
      'password',
      'token',
      'key',
      'secret',
      'accessToken',
      'refreshToken',
      'stripeConnectId',
      'stripeUserId'
    ],
    remove: true,
  },
});
