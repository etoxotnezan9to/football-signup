import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import websocket from '@fastify/websocket';
import { LAUNCH_PARAMS_MAX_AGE_SEC, WS_HEARTBEAT_SEC } from '@football/shared';
import { AppError } from './errors.ts';
import type { Config } from './config.ts';
import type { Hub } from './hub.ts';
import type { RateLimiter } from './rate-limit.ts';
import type { Service } from './service.ts';
import { verifyLaunchParams } from './vk-auth.ts';

export interface AppDeps {
  config: Config;
  service: Service;
  hub: Hub;
  limiter: RateLimiter;
  version: string;
  logger?: boolean;
}

declare module 'fastify' {
  interface FastifyRequest {
    vkId: number;
  }
}

function parseId(value: unknown): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) throw new AppError('NOT_FOUND', 'Не найдено');
  return n;
}

/** Проверяет заголовок Authorization и возвращает vkId; для WebSocket используется тот же алгоритм. */
export function authenticateLaunchParams(
  config: Config,
  launchParams: string,
  service: Service,
  nowMs: number = Date.now(),
): number | null {
  // Только вне production (config.authDevBypass): строка вида `mock:<id>:<имя>:<фамилия>` (имя и фамилия URL-кодированы)
  if (config.authDevBypass && launchParams.startsWith('mock:')) {
    const [, idRaw, first = 'Тест', last = ''] = launchParams.split(':');
    const id = Number(idRaw);
    if (!Number.isInteger(id) || id <= 0) return null;
    try {
      service.upsertUser({
        vkId: id,
        firstName: decodeURIComponent(first),
        lastName: decodeURIComponent(last),
      });
    } catch {
      return null;
    }
    return id;
  }
  const res = verifyLaunchParams(launchParams, config.vkAppSecret, {
    appId: config.vkAppId,
    nowSec: Math.floor(nowMs / 1000),
    maxAgeSec: LAUNCH_PARAMS_MAX_AGE_SEC,
  });
  if (!res.ok) return null;
  service.ensureUser(res.vkId);
  return res.vkId;
}

function authenticateHeader(config: Config, service: Service, header: string | undefined): number {
  if (header?.startsWith('VK ')) {
    const id = authenticateLaunchParams(config, header.slice(3), service);
    if (id !== null) return id;
  } else if (config.authDevBypass && header?.startsWith('Mock ')) {
    const [idRaw, first = 'Тест', last = 'Пользователь'] = header.slice(5).split(':');
    const id = Number(idRaw);
    if (Number.isInteger(id) && id > 0) {
      try {
        service.upsertUser({
          vkId: id,
          firstName: decodeURIComponent(first),
          lastName: decodeURIComponent(last),
        });
      } catch {
        throw new AppError('UNAUTHORIZED', 'Некорректный Mock-заголовок');
      }
      return id;
    }
  }
  throw new AppError('UNAUTHORIZED', 'Требуется авторизация VK');
}

export function buildApp(deps: AppDeps): FastifyInstance {
  const { config, service, hub, limiter } = deps;
  const app = Fastify({ logger: deps.logger ?? false, bodyLimit: 64 * 1024 });

  app.setErrorHandler((err: unknown, _req, reply) => {
    if (err instanceof AppError) {
      return reply.status(err.status).send({
        error: { code: err.code, message: err.message, ...(err.details ? { details: err.details } : {}) },
      });
    }
    const status = (err as { statusCode?: number }).statusCode;
    if (typeof status === 'number' && status >= 400 && status < 500) {
      return reply.status(400).send({ error: { code: 'VALIDATION_ERROR', message: 'Некорректный запрос' } });
    }
    app.log.error(err);
    return reply.status(500).send({ error: { code: 'INTERNAL', message: 'Внутренняя ошибка' } });
  });

  app.setNotFoundHandler((_req, reply) =>
    reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Не найдено' } }),
  );

  void app.register(websocket);

  void app.register(
    async (api) => {
      api.get('/health', async () => ({
        status: 'ok',
        version: deps.version,
        time: new Date().toISOString(),
      }));

      api.register(async (secured) => {
        secured.decorateRequest('vkId', 0);
        secured.addHook('preHandler', async (req: FastifyRequest, _reply: FastifyReply) => {
          req.vkId = authenticateHeader(config, service, req.headers.authorization);
          if (req.method !== 'GET' && !limiter.take(String(req.vkId))) {
            throw new AppError('RATE_LIMITED', 'Слишком много запросов, попробуйте позже');
          }
        });

        secured.get('/me', async (req) => service.ensureUser(req.vkId));
        secured.put('/me', async (req) => service.updateProfile(req.vkId, req.body));
        secured.get('/me/games', async (req) => service.myGames(req.vkId));
        secured.get('/me/organized', async (req) => ({ items: service.myOrganized(req.vkId) }));

        secured.get('/config', async () => ({ testMode: config.testMode }));

        secured.post('/games/:gameId/test-players', async (req) => {
          const body = (typeof req.body === 'object' && req.body !== null ? req.body : {}) as {
            count?: unknown;
            seats?: unknown;
          };
          return service.addTestPlayers(
            parseId((req.params as { gameId: string }).gameId),
            req.vkId,
            body.count,
            body.seats ?? 1,
          );
        });
        secured.delete('/games/:gameId/test-players', async (req) =>
          service.removeTestPlayers(parseId((req.params as { gameId: string }).gameId), req.vkId),
        );

        secured.get('/rating', async () => ({ items: service.rating() }));

        secured.get('/places', async () => ({ items: service.listPlaces() }));
        secured.post('/places', async (req, reply) => {
          const { place, created } = service.createPlace(req.vkId, req.body);
          return reply.status(created ? 201 : 200).send(place);
        });

        secured.get('/games', async (req) => {
          const q = req.query as {
            cursor?: string;
            limit?: string;
            includePast?: string;
            includeCancelled?: string;
            placeId?: string;
            from?: string;
            to?: string;
          };
          const range = parseRange(q.from, q.to);
          const limit = q.limit !== undefined ? Number(q.limit) : undefined;
          const placeId = q.placeId !== undefined ? Number(q.placeId) : undefined;
          return service.listGames(req.vkId, {
            ...(q.cursor !== undefined ? { cursor: q.cursor } : {}),
            ...(limit !== undefined && Number.isInteger(limit) ? { limit } : {}),
            includePast: q.includePast === '1',
            includeCancelled: q.includeCancelled !== '0',
            ...(placeId !== undefined && Number.isInteger(placeId) && placeId > 0 ? { placeId } : {}),
            ...range,
          });
        });
        secured.post('/games', async (req, reply) => {
          const game = service.createGame(req.vkId, req.body);
          return reply.status(201).send(game);
        });

        secured.get('/games/:gameId', async (req) =>
          service.getGame(parseId((req.params as { gameId: string }).gameId), req.vkId),
        );
        secured.patch('/games/:gameId', async (req) =>
          service.updateGame(parseId((req.params as { gameId: string }).gameId), req.vkId, req.body),
        );
        secured.post('/games/:gameId/cancel', async (req) =>
          service.cancelGame(parseId((req.params as { gameId: string }).gameId), req.vkId),
        );

        secured.put('/games/:gameId/signup', async (req) => {
          const body = (typeof req.body === 'object' && req.body !== null ? req.body : {}) as {
            seats?: unknown;
          };
          return service.putSignup(parseId((req.params as { gameId: string }).gameId), req.vkId, body.seats);
        });
        secured.delete('/games/:gameId/signup', async (req) =>
          service.deleteSignup(parseId((req.params as { gameId: string }).gameId), req.vkId),
        );

        secured.patch('/games/:gameId/signups/:signupId', async (req) => {
          const p = req.params as { gameId: string; signupId: string };
          const body = (typeof req.body === 'object' && req.body !== null ? req.body : {}) as {
            paidSeats?: unknown;
          };
          return service.setPaid(parseId(p.gameId), req.vkId, parseId(p.signupId), body.paidSeats);
        });
        secured.put('/games/:gameId/teams/:teamNo', async (req) => {
          const p = req.params as { gameId: string; teamNo: string };
          return service.setTeamName(parseId(p.gameId), req.vkId, parseId(p.teamNo), req.body);
        });
        secured.put('/games/:gameId/matches/:teamA/:teamB/:leg', async (req) => {
          const p = req.params as { gameId: string; teamA: string; teamB: string; leg: string };
          return service.setMatchScore(
            parseId(p.gameId),
            req.vkId,
            parseId(p.teamA),
            parseId(p.teamB),
            parseId(p.leg),
            req.body ?? {},
          );
        });
        secured.delete('/games/:gameId/matches/:teamA/:teamB/:leg', async (req) => {
          const p = req.params as { gameId: string; teamA: string; teamB: string; leg: string };
          return service.setMatchScore(
            parseId(p.gameId),
            req.vkId,
            parseId(p.teamA),
            parseId(p.teamB),
            parseId(p.leg),
            null,
          );
        });
        secured.put('/games/:gameId/match-order', async (req) =>
          service.setMatchOrder(parseId((req.params as { gameId: string }).gameId), req.vkId, req.body),
        );
        secured.put('/games/:gameId/best-player', async (req) =>
          service.setBestPlayer(parseId((req.params as { gameId: string }).gameId), req.vkId, req.body),
        );
        secured.put('/games/:gameId/team-assignment', async (req) =>
          service.assignSeat(parseId((req.params as { gameId: string }).gameId), req.vkId, req.body),
        );

        secured.delete('/games/:gameId/signups/:signupId', async (req) => {
          const p = req.params as { gameId: string; signupId: string };
          return service.removeSignup(parseId(p.gameId), req.vkId, parseId(p.signupId));
        });
      });
    },
    { prefix: '/api' },
  );

  // WebSocket регистрируется после плагина websocket
  void app.register(async (ws) => {
    ws.get('/ws', { websocket: true }, (socket) => {
      const conn = hub.connect({
        send: (data) => socket.send(data),
        close: (code) => socket.close(code),
      });
      let alive = true;
      socket.on('pong', () => {
        alive = true;
      });
      const heartbeat = setInterval(() => {
        if (!alive) {
          socket.terminate();
          return;
        }
        alive = false;
        socket.ping();
      }, WS_HEARTBEAT_SEC * 1000);
      socket.on('message', (raw: Buffer | ArrayBuffer | Buffer[]) => conn.onMessage(raw.toString()));
      socket.on('close', () => {
        clearInterval(heartbeat);
        conn.onClose();
      });
    });
  });

  return app;
}

/** Период from/to для GET /games: даты ISO-8601, приводятся к UTC; неверная дата или from ≥ to — ошибка. */
function parseRange(from?: string, to?: string): { from?: string; to?: string } {
  const out: { from?: string; to?: string } = {};
  const errors: Record<string, string> = {};
  for (const [key, value] of [['from', from], ['to', to]] as const) {
    if (value === undefined) continue;
    const t = Date.parse(value);
    if (typeof value !== 'string' || Number.isNaN(t)) errors[key] = 'дата в формате ISO-8601';
    else out[key] = new Date(t).toISOString();
  }
  if (out.from !== undefined && out.to !== undefined && out.from >= out.to) errors.to = 'должно быть позже from';
  if (Object.keys(errors).length > 0) throw new AppError('VALIDATION_ERROR', 'Неверный период', errors);
  return out;
}
