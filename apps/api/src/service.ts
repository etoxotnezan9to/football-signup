// Бизнес-логика игр и записей. Зависит только от node:sqlite и @football/shared,
// поэтому полностью тестируется без HTTP-слоя.
import type { DatabaseSync } from 'node:sqlite';
import {
  FINISH_GRACE_MIN,
  MAX_ACTIVE_GAMES_PER_ORGANIZER,
  clampPaidSeats,
  computeRoster,
  parseGameInput,
  parseGameUpdate,
  rosterTotals,
  checkSeats,
} from '@football/shared';
import type {
  GameDetails,
  GameInput,
  GameSummary,
  RosterEntry,
  ServerEvent,
  User,
} from '@football/shared';
import { inTransaction } from './db.ts';
import { AppError } from './errors.ts';

interface UserRow {
  vk_id: number;
  first_name: string;
  last_name: string;
  photo_url: string | null;
}

interface GameRow {
  id: number;
  organizer_id: number;
  title: string;
  starts_at: string;
  venue: string;
  address: string;
  format: string;
  fee_rub: number;
  capacity: number;
  description: string;
  payment_info: string;
  organizer_contact: string;
  status: 'active' | 'cancelled';
}

interface SignupRow {
  id: number;
  game_id: number;
  user_id: number;
  seats: number;
  paid_seats: number;
  created_at: string;
  first_name: string;
  last_name: string;
  photo_url: string | null;
}

export interface VkProfile {
  vkId: number;
  firstName: string;
  lastName: string;
  photoUrl?: string | null;
}

export interface ServiceOptions {
  now?: () => Date;
  emit?: (event: ServerEvent) => void;
}

function toUser(r: { vk_id: number; first_name: string; last_name: string; photo_url: string | null }): User {
  return { vkId: r.vk_id, firstName: r.first_name, lastName: r.last_name, photoUrl: r.photo_url };
}

export function createService(db: DatabaseSync, options: ServiceOptions = {}) {
  const now = options.now ?? (() => new Date());
  const emit = options.emit ?? (() => {});

  function isFinished(startsAt: string): boolean {
    return now().getTime() > Date.parse(startsAt) + FINISH_GRACE_MIN * 60_000;
  }

  function getGameRow(gameId: number): GameRow {
    const row = db.prepare('SELECT * FROM games WHERE id = ?').get(gameId) as unknown as GameRow | undefined;
    if (!row) throw new AppError('NOT_FOUND', 'Игра не найдена');
    return row;
  }

  function getUser(vkId: number): User {
    const row = db.prepare('SELECT * FROM users WHERE vk_id = ?').get(vkId) as unknown as UserRow | undefined;
    if (!row) throw new AppError('NOT_FOUND', 'Пользователь не найден');
    return toUser(row);
  }

  function signupRows(gameId: number): SignupRow[] {
    return db
      .prepare(
        `SELECT s.id, s.game_id, s.user_id, s.seats, s.paid_seats, s.created_at,
                u.first_name, u.last_name, u.photo_url
           FROM signups s JOIN users u ON u.vk_id = s.user_id
          WHERE s.game_id = ?
          ORDER BY s.created_at, s.id`,
      )
      .all(gameId) as unknown as SignupRow[];
  }

  function buildRoster(game: GameRow): { entries: RosterEntry[]; taken: number; queued: number } {
    const rows = signupRows(game.id);
    const byId = new Map(rows.map((r) => [r.id, r]));
    const computed = computeRoster(
      game.capacity,
      rows.map((r) => ({ id: r.id, userId: r.user_id, seats: r.seats, createdAt: r.created_at })),
    );
    const entries: RosterEntry[] = computed.map((c) => {
      const r = byId.get(c.signupId)!;
      return {
        signupId: c.signupId,
        user: toUser({ vk_id: r.user_id, first_name: r.first_name, last_name: r.last_name, photo_url: r.photo_url }),
        seats: c.seats,
        mainSeats: c.mainSeats,
        queueSeats: c.queueSeats,
        paidSeats: r.paid_seats,
        createdAt: c.createdAt,
      };
    });
    return { entries, ...rosterTotals(computed) };
  }

  function summary(game: GameRow, viewerId?: number): GameSummary {
    const { entries, taken, queued } = buildRoster(game);
    const s: GameSummary = {
      id: game.id,
      title: game.title,
      startsAt: game.starts_at,
      venue: game.venue,
      feeRub: game.fee_rub,
      capacity: game.capacity,
      status: game.status,
      isFinished: isFinished(game.starts_at),
      taken,
      queued,
      organizer: getUser(game.organizer_id),
    };
    if (viewerId !== undefined) {
      s.mySeats = entries.find((e) => e.user.vkId === viewerId)?.seats ?? 0;
    }
    return s;
  }

  function details(game: GameRow, viewerId?: number): GameDetails {
    const { entries } = buildRoster(game);
    return {
      ...summary(game, viewerId),
      address: game.address,
      format: game.format,
      description: game.description,
      paymentInfo: game.payment_info,
      organizerContact: game.organizer_contact,
      roster: entries,
    };
  }

  /** События без данных конкретного получателя (mySeats не передаётся). */
  function emitGameChanged(gameId: number, kind: 'created' | 'updated' | 'roster'): void {
    const game = getGameRow(gameId);
    if (kind === 'created') {
      emit({ type: 'game.created', game: summary(game) });
      return;
    }
    emit({ type: 'game.updated', game: summary(game) });
    emit({ type: 'roster.updated', game: details(game) });
  }

  function requireOrganizer(game: GameRow, userId: number): void {
    if (game.organizer_id !== userId) throw new AppError('FORBIDDEN', 'Только организатор может это сделать');
  }

  function requireOpen(game: GameRow): void {
    if (game.status !== 'active' || isFinished(game.starts_at)) {
      throw new AppError('GAME_NOT_ACTIVE', 'Игра отменена или уже прошла');
    }
  }

  return {
    upsertUser(p: VkProfile): User {
      const ts = now().toISOString();
      db.prepare(
        `INSERT INTO users (vk_id, first_name, last_name, photo_url, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(vk_id) DO UPDATE SET
           first_name = excluded.first_name,
           last_name = excluded.last_name,
           photo_url = COALESCE(excluded.photo_url, users.photo_url),
           updated_at = excluded.updated_at`,
      ).run(p.vkId, p.firstName, p.lastName, p.photoUrl ?? null, ts, ts);
      return getUser(p.vkId);
    },

    createGame(organizerId: number, body: unknown): GameDetails {
      const parsed = parseGameInput(body);
      if (!parsed.ok) throw new AppError('VALIDATION_ERROR', 'Неверные данные игры', parsed.errors);
      const input: GameInput = parsed.value;
      if (Date.parse(input.startsAt) <= now().getTime()) {
        throw new AppError('STARTS_AT_IN_PAST', 'Время начала должно быть в будущем');
      }
      const id = inTransaction(db, () => {
        const active = db
          .prepare(
            `SELECT COUNT(*) AS n FROM games
              WHERE organizer_id = ? AND status = 'active' AND starts_at > ?`,
          )
          .get(organizerId, new Date(now().getTime() - FINISH_GRACE_MIN * 60_000).toISOString()) as unknown as {
          n: number;
        };
        if (active.n >= MAX_ACTIVE_GAMES_PER_ORGANIZER) {
          throw new AppError('ACTIVE_GAMES_LIMIT', 'Слишком много активных игр');
        }
        const ts = now().toISOString();
        const res = db
          .prepare(
            `INSERT INTO games (organizer_id, title, starts_at, venue, address, format, fee_rub, capacity,
                                description, payment_info, organizer_contact, status, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`,
          )
          .run(
            organizerId,
            input.title,
            input.startsAt,
            input.venue,
            input.address,
            input.format,
            input.feeRub,
            input.capacity,
            input.description,
            input.paymentInfo,
            input.organizerContact,
            ts,
            ts,
          );
        return Number(res.lastInsertRowid);
      });
      emitGameChanged(id, 'created');
      return details(getGameRow(id), organizerId);
    },

    listGames(viewerId: number, opts: { cursor?: string; limit?: number } = {}) {
      const limit = Math.min(Math.max(opts.limit ?? 20, 1), 50);
      const offset = opts.cursor && /^\d+$/.test(opts.cursor) ? Number(opts.cursor) : 0;
      const since = new Date(now().getTime() - FINISH_GRACE_MIN * 60_000).toISOString();
      const rows = db
        .prepare(
          `SELECT * FROM games WHERE status = 'active' AND starts_at > ?
            ORDER BY starts_at, id LIMIT ? OFFSET ?`,
        )
        .all(since, limit + 1, offset) as unknown as GameRow[];
      const page = rows.slice(0, limit);
      return {
        items: page.map((g) => summary(g, viewerId)),
        nextCursor: rows.length > limit ? String(offset + limit) : null,
      };
    },

    getGame(gameId: number, viewerId: number): GameDetails {
      return details(getGameRow(gameId), viewerId);
    },

    updateGame(gameId: number, userId: number, body: unknown): GameDetails {
      const parsed = parseGameUpdate(body);
      if (!parsed.ok) throw new AppError('VALIDATION_ERROR', 'Неверные данные игры', parsed.errors);
      const patch = parsed.value;
      inTransaction(db, () => {
        const game = getGameRow(gameId);
        requireOrganizer(game, userId);
        if (game.status !== 'active') throw new AppError('GAME_NOT_ACTIVE', 'Игра отменена');
        if (patch.startsAt !== undefined && Date.parse(patch.startsAt) <= now().getTime()) {
          throw new AppError('STARTS_AT_IN_PAST', 'Время начала должно быть в будущем');
        }
        const columns: Record<keyof GameInput, string> = {
          title: 'title',
          startsAt: 'starts_at',
          venue: 'venue',
          address: 'address',
          format: 'format',
          feeRub: 'fee_rub',
          capacity: 'capacity',
          description: 'description',
          paymentInfo: 'payment_info',
          organizerContact: 'organizer_contact',
        };
        const sets: string[] = [];
        const values: (string | number)[] = [];
        for (const key of Object.keys(patch) as (keyof GameInput)[]) {
          sets.push(`${columns[key]} = ?`);
          values.push(patch[key] as string | number);
        }
        sets.push('updated_at = ?');
        values.push(now().toISOString(), gameId);
        db.prepare(`UPDATE games SET ${sets.join(', ')} WHERE id = ?`).run(...values);
      });
      emitGameChanged(gameId, 'roster');
      return details(getGameRow(gameId), userId);
    },

    cancelGame(gameId: number, userId: number): GameDetails {
      inTransaction(db, () => {
        const game = getGameRow(gameId);
        requireOrganizer(game, userId);
        db.prepare("UPDATE games SET status = 'cancelled', updated_at = ? WHERE id = ?").run(
          now().toISOString(),
          gameId,
        );
      });
      emitGameChanged(gameId, 'roster');
      return details(getGameRow(gameId), userId);
    },

    /** Записаться или изменить число мест (идемпотентно): seats — итоговое число мест. */
    putSignup(gameId: number, userId: number, seatsInput: unknown): { signup: RosterEntry; game: GameDetails } {
      const check = checkSeats(seatsInput);
      if (!check.ok) {
        throw new AppError(
          check.code,
          check.code === 'SEATS_LIMIT_EXCEEDED' ? 'Превышен лимит мест на одного человека' : 'Неверное число мест',
        );
      }
      inTransaction(db, () => {
        const game = getGameRow(gameId);
        requireOpen(game);
        const ts = now().toISOString();
        const existing = db
          .prepare('SELECT id, paid_seats FROM signups WHERE game_id = ? AND user_id = ?')
          .get(gameId, userId) as unknown as { id: number; paid_seats: number } | undefined;
        if (existing) {
          db.prepare('UPDATE signups SET seats = ?, paid_seats = ?, updated_at = ? WHERE id = ?').run(
            check.seats,
            clampPaidSeats(existing.paid_seats, check.seats),
            ts,
            existing.id,
          );
        } else {
          db.prepare(
            'INSERT INTO signups (game_id, user_id, seats, paid_seats, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?)',
          ).run(gameId, userId, check.seats, ts, ts);
        }
      });
      emitGameChanged(gameId, 'roster');
      const game = details(getGameRow(gameId), userId);
      const signup = game.roster.find((e) => e.user.vkId === userId)!;
      return { signup, game };
    },

    deleteSignup(gameId: number, userId: number): GameDetails {
      inTransaction(db, () => {
        const game = getGameRow(gameId);
        requireOpen(game);
        const res = db.prepare('DELETE FROM signups WHERE game_id = ? AND user_id = ?').run(gameId, userId);
        if (Number(res.changes) === 0) throw new AppError('NOT_FOUND', 'Вы не записаны на эту игру');
      });
      emitGameChanged(gameId, 'roster');
      return details(getGameRow(gameId), userId);
    },

    setPaid(gameId: number, organizerId: number, signupId: number, paidSeats: unknown): GameDetails {
      if (typeof paidSeats !== 'number' || !Number.isInteger(paidSeats) || paidSeats < 0) {
        throw new AppError('VALIDATION_ERROR', 'Неверное число оплаченных мест');
      }
      inTransaction(db, () => {
        const game = getGameRow(gameId);
        requireOrganizer(game, organizerId);
        const s = db
          .prepare('SELECT id, seats FROM signups WHERE id = ? AND game_id = ?')
          .get(signupId, gameId) as unknown as { id: number; seats: number } | undefined;
        if (!s) throw new AppError('NOT_FOUND', 'Запись не найдена');
        if (paidSeats > s.seats) throw new AppError('VALIDATION_ERROR', 'Оплачено больше, чем мест в записи');
        db.prepare('UPDATE signups SET paid_seats = ?, updated_at = ? WHERE id = ?').run(
          paidSeats,
          now().toISOString(),
          signupId,
        );
      });
      emitGameChanged(gameId, 'roster');
      return details(getGameRow(gameId), organizerId);
    },

    removeSignup(gameId: number, organizerId: number, signupId: number): GameDetails {
      inTransaction(db, () => {
        const game = getGameRow(gameId);
        requireOrganizer(game, organizerId);
        const res = db.prepare('DELETE FROM signups WHERE id = ? AND game_id = ?').run(signupId, gameId);
        if (Number(res.changes) === 0) throw new AppError('NOT_FOUND', 'Запись не найдена');
      });
      emitGameChanged(gameId, 'roster');
      return details(getGameRow(gameId), organizerId);
    },

    myGames(userId: number): { organized: GameSummary[]; joined: GameSummary[] } {
      const since = new Date(now().getTime() - FINISH_GRACE_MIN * 60_000).toISOString();
      const organized = db
        .prepare(
          `SELECT * FROM games WHERE organizer_id = ? AND starts_at > ? ORDER BY starts_at, id`,
        )
        .all(userId, since) as unknown as GameRow[];
      const joined = db
        .prepare(
          `SELECT g.* FROM games g JOIN signups s ON s.game_id = g.id
            WHERE s.user_id = ? AND g.starts_at > ? ORDER BY g.starts_at, g.id`,
        )
        .all(userId, since) as unknown as GameRow[];
      return {
        organized: organized.map((g) => summary(g, userId)),
        joined: joined.map((g) => summary(g, userId)),
      };
    },

    getGameForText(gameId: number, viewerId: number): GameDetails {
      return details(getGameRow(gameId), viewerId);
    },
  };
}

export type Service = ReturnType<typeof createService>;
