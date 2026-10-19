// Бизнес-логика игр и записей. Зависит только от node:sqlite и @football/shared,
// поэтому полностью тестируется без HTTP-слоя.
import type { DatabaseSync } from 'node:sqlite';
import {
  FINISH_GRACE_MIN,
  MAX_ACTIVE_GAMES_PER_ORGANIZER,
  REMINDER_LEAD_MIN,
  REMINDER_MIN_LEAD_MIN,
  clampPaidSeats,
  clipMessage,
  computeRoster,
  groupUsersBy,
  promotionsBetween,
  parseGameInput,
  parseGameUpdate,
  parsePlaceInput,
  rosterTotals,
  checkSeats,
} from '@football/shared';
import type {
  GameDetails,
  GameInput,
  GameSummary,
  MainSeats,
  Place,
  RosterEntry,
  ServerEvent,
  User,
} from '@football/shared';
import { inTransaction } from './db.ts';
import { AppError } from './errors.ts';
import type { Notify } from './notifier.ts';

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
  place_id: number;
  /** Название места (из JOIN с places) */
  venue: string;
  /** Адрес места (из JOIN с places) */
  address: string;
  format: string;
  fee_rub: number;
  capacity: number;
  description: string;
  payment_info: string;
  organizer_contact: string;
  status: 'active' | 'cancelled';
}

interface PlaceRow {
  id: number;
  name: string;
  address: string;
}

/** Игра вместе с названием и адресом её места. Колонки игр в условиях пишите с префиксом `g.`. */
const GAME_SELECT = `SELECT g.*, p.name AS venue, p.address AS address
  FROM games g JOIN places p ON p.id = g.place_id`;

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
  /** Личные уведомления (VK). Не задан — уведомления отключены. */
  notify?: Notify;
  /** Часовой пояс, в котором время игры показывается в уведомлениях */
  timeZone?: string;
}

function toUser(r: { vk_id: number; first_name: string; last_name: string; photo_url: string | null }): User {
  return { vkId: r.vk_id, firstName: r.first_name, lastName: r.last_name, photoUrl: r.photo_url };
}

export function createService(db: DatabaseSync, options: ServiceOptions = {}) {
  const now = options.now ?? (() => new Date());
  const emit = options.emit ?? (() => {});
  const notify = options.notify;
  const timeZone = options.timeZone ?? 'Europe/Moscow';

  function isFinished(startsAt: string): boolean {
    return now().getTime() > Date.parse(startsAt) + FINISH_GRACE_MIN * 60_000;
  }

  function getGameRow(gameId: number): GameRow {
    const row = db.prepare(`${GAME_SELECT} WHERE g.id = ?`).get(gameId) as unknown as GameRow | undefined;
    if (!row) throw new AppError('NOT_FOUND', 'Игра не найдена');
    return row;
  }

  /** Проверяет, что место существует (иначе ошибка поля placeId). */
  function requirePlace(placeId: number): void {
    if (!db.prepare('SELECT 1 FROM places WHERE id = ?').get(placeId)) {
      throw new AppError('VALIDATION_ERROR', 'Место не найдено', { placeId: 'место не найдено' });
    }
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
        user: toUser({
          vk_id: r.user_id,
          first_name: r.first_name,
          last_name: r.last_name,
          photo_url: r.photo_url,
        }),
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
      placeId: game.place_id,
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

  // ---- Уведомления ----------------------------------------------------------

  function whenText(iso: string): string {
    return new Intl.DateTimeFormat('ru-RU', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
      timeZone,
    }).format(new Date(iso));
  }

  /** Места в составе по пользователям. Снимок нужен только при включённых уведомлениях. */
  function mainSeatsOf(gameId: number): MainSeats {
    const out: MainSeats = {};
    for (const e of buildRoster(getGameRow(gameId)).entries) {
      if (e.mainSeats > 0) out[e.user.vkId] = e.mainSeats;
    }
    return out;
  }

  const snapshot = (gameId: number): MainSeats => (notify ? mainSeatsOf(gameId) : {});

  function signupUserIds(gameId: number): number[] {
    const rows = db.prepare('SELECT user_id FROM signups WHERE game_id = ?').all(gameId) as unknown as {
      user_id: number;
    }[];
    return rows.map((r) => r.user_id);
  }

  const gameFragment = (gameId: number): string => `/game/${gameId}`;

  /** Уведомляет тех, кто из очереди попал в состав после действия `actorId`. Возвращает их id. */
  function notifyPromotions(gameId: number, before: MainSeats, actorId: number): Set<number> {
    const notified = new Set<number>();
    if (!notify) return notified;
    const game = getGameRow(gameId);
    if (game.status !== 'active') return notified;
    for (const p of promotionsBetween(before, mainSeatsOf(gameId), actorId)) {
      notified.add(p.userId);
      notify({
        userIds: [p.userId],
        message: clipMessage(
          `Вы в составе! «${game.title}», ${whenText(game.starts_at)}. Мест у вас в составе: ${p.total}.`,
        ),
        fragment: gameFragment(gameId),
      });
    }
    return notified;
  }

  function upsertUser(p: VkProfile): User {
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
  }

  return {
    upsertUser,

    listPlaces(): Place[] {
      const rows = db
        .prepare('SELECT id, name, address FROM places ORDER BY name, address, id')
        .all() as unknown as PlaceRow[];
      return rows.map((r) => ({ id: r.id, name: r.name, address: r.address }));
    },

    /** Создаёт место. Если такое же (название и адрес) уже есть, возвращает существующее. */
    createPlace(userId: number, body: unknown): { place: Place; created: boolean } {
      const parsed = parsePlaceInput(body);
      if (!parsed.ok) throw new AppError('VALIDATION_ERROR', 'Неверные данные места', parsed.errors);
      const { name, address } = parsed.value;
      return inTransaction(db, () => {
        const existing = db
          .prepare('SELECT id, name, address FROM places WHERE name = ? AND address = ?')
          .get(name, address) as unknown as PlaceRow | undefined;
        if (existing) return { place: { ...existing }, created: false };
        const res = db
          .prepare('INSERT INTO places (name, address, created_by, created_at) VALUES (?, ?, ?, ?)')
          .run(name, address, userId, now().toISOString());
        return { place: { id: Number(res.lastInsertRowid), name, address }, created: true };
      });
    },

    /** Гарантирует, что пользователь существует (имя-заглушка, если профиль ещё не передан). */
    ensureUser(vkId: number): User {
      const ts = now().toISOString();
      db.prepare(
        `INSERT OR IGNORE INTO users (vk_id, first_name, last_name, photo_url, created_at, updated_at)
         VALUES (?, ?, '', NULL, ?, ?)`,
      ).run(vkId, `Игрок ${vkId}`, ts, ts);
      return getUser(vkId);
    },

    /**
     * Профиль присылает клиент (VKWebAppGetUserInfo). Идентификатор подтверждён подписью,
     * а отображаемое имя пользователь может задать только для себя.
     */
    updateProfile(vkId: number, body: unknown): User {
      const b = typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};
      const errors: Record<string, string> = {};
      const name = (key: 'firstName' | 'lastName', min: number): string => {
        const v = b[key];
        if (typeof v !== 'string' || v.trim().length < min || v.trim().length > 64) {
          errors[key] = `длина от ${min} до 64`;
          return '';
        }
        return v.trim();
      };
      const firstName = name('firstName', 1);
      const lastName = b.lastName === undefined ? '' : name('lastName', 0);
      let photoUrl: string | null = null;
      if (b.photoUrl !== undefined && b.photoUrl !== null) {
        if (typeof b.photoUrl !== 'string' || b.photoUrl.length > 500 || !/^https:\/\//.test(b.photoUrl)) {
          errors.photoUrl = 'ожидается https-ссылка';
        } else {
          photoUrl = b.photoUrl;
        }
      }
      if (Object.keys(errors).length > 0) throw new AppError('VALIDATION_ERROR', 'Неверный профиль', errors);
      return upsertUser({ vkId, firstName, lastName, photoUrl });
    },

    createGame(organizerId: number, body: unknown): GameDetails {
      const parsed = parseGameInput(body);
      if (!parsed.ok) throw new AppError('VALIDATION_ERROR', 'Неверные данные игры', parsed.errors);
      const input: GameInput = parsed.value;
      if (Date.parse(input.startsAt) <= now().getTime()) {
        throw new AppError('STARTS_AT_IN_PAST', 'Время начала должно быть в будущем');
      }
      const id = inTransaction(db, () => {
        requirePlace(input.placeId);
        const active = db
          .prepare(
            `SELECT COUNT(*) AS n FROM games
              WHERE organizer_id = ? AND status = 'active' AND starts_at > ?`,
          )
          .get(
            organizerId,
            new Date(now().getTime() - FINISH_GRACE_MIN * 60_000).toISOString(),
          ) as unknown as {
          n: number;
        };
        if (active.n >= MAX_ACTIVE_GAMES_PER_ORGANIZER) {
          throw new AppError('ACTIVE_GAMES_LIMIT', 'Слишком много активных игр');
        }
        const ts = now().toISOString();
        const res = db
          .prepare(
            `INSERT INTO games (organizer_id, title, starts_at, place_id, format, fee_rub, capacity,
                                description, payment_info, organizer_contact, status, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`,
          )
          .run(
            organizerId,
            input.title,
            input.startsAt,
            input.placeId,
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
          `${GAME_SELECT} WHERE g.status = 'active' AND g.starts_at > ?
            ORDER BY g.starts_at, g.id LIMIT ? OFFSET ?`,
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
      const before = snapshot(gameId);
      const old = inTransaction(db, () => {
        const game = getGameRow(gameId);
        requireOrganizer(game, userId);
        if (game.status !== 'active') throw new AppError('GAME_NOT_ACTIVE', 'Игра отменена');
        if (patch.startsAt !== undefined && Date.parse(patch.startsAt) <= now().getTime()) {
          throw new AppError('STARTS_AT_IN_PAST', 'Время начала должно быть в будущем');
        }
        if (patch.placeId !== undefined) requirePlace(patch.placeId);
        const columns: Record<keyof GameInput, string> = {
          title: 'title',
          startsAt: 'starts_at',
          placeId: 'place_id',
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
        return game; // состояние до правки
      });
      emitGameChanged(gameId, 'roster');
      if (notify) {
        const promoted = notifyPromotions(gameId, before, userId);
        const current = getGameRow(gameId);
        const moved =
          Date.parse(old.starts_at) !== Date.parse(current.starts_at) ||
          old.venue !== current.venue ||
          old.address !== current.address;
        const recipients = signupUserIds(gameId).filter((id) => id !== userId && !promoted.has(id));
        if (moved && recipients.length > 0) {
          notify({
            userIds: recipients,
            message: clipMessage(
              `Игра «${current.title}» изменена: ${whenText(current.starts_at)}, ${current.venue}, ${current.address}.`,
            ),
            fragment: gameFragment(gameId),
          });
        }
      }
      return details(getGameRow(gameId), userId);
    },

    cancelGame(gameId: number, userId: number): GameDetails {
      const { cancelled, recipients } = inTransaction(db, () => {
        const game = getGameRow(gameId);
        requireOrganizer(game, userId);
        db.prepare("UPDATE games SET status = 'cancelled', updated_at = ? WHERE id = ?").run(
          now().toISOString(),
          gameId,
        );
        // повторная отмена уже отменённой игры никого не беспокоит
        return game.status === 'active'
          ? { cancelled: game, recipients: signupUserIds(gameId).filter((id) => id !== userId) }
          : { cancelled: null, recipients: [] as number[] };
      });
      emitGameChanged(gameId, 'roster');
      if (notify && cancelled && recipients.length > 0) {
        const g = cancelled;
        notify({
          userIds: recipients,
          message: clipMessage(`Игра «${g.title}» (${whenText(g.starts_at)}) отменена организатором.`),
          fragment: gameFragment(gameId),
        });
      }
      return details(getGameRow(gameId), userId);
    },

    /** Записаться или изменить число мест (идемпотентно): seats — итоговое число мест. */
    putSignup(
      gameId: number,
      userId: number,
      seatsInput: unknown,
    ): { signup: RosterEntry; game: GameDetails } {
      const check = checkSeats(seatsInput);
      if (!check.ok) {
        throw new AppError(
          check.code,
          check.code === 'SEATS_LIMIT_EXCEEDED'
            ? 'Превышен лимит мест на одного человека'
            : 'Неверное число мест',
        );
      }
      const before = snapshot(gameId);
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
      notifyPromotions(gameId, before, userId);
      const game = details(getGameRow(gameId), userId);
      const signup = game.roster.find((e) => e.user.vkId === userId)!;
      return { signup, game };
    },

    deleteSignup(gameId: number, userId: number): GameDetails {
      const before = snapshot(gameId);
      inTransaction(db, () => {
        const game = getGameRow(gameId);
        requireOpen(game);
        const res = db.prepare('DELETE FROM signups WHERE game_id = ? AND user_id = ?').run(gameId, userId);
        if (Number(res.changes) === 0) throw new AppError('NOT_FOUND', 'Вы не записаны на эту игру');
      });
      emitGameChanged(gameId, 'roster');
      notifyPromotions(gameId, before, userId);
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
      const before = snapshot(gameId);
      inTransaction(db, () => {
        const game = getGameRow(gameId);
        requireOrganizer(game, organizerId);
        const res = db.prepare('DELETE FROM signups WHERE id = ? AND game_id = ?').run(signupId, gameId);
        if (Number(res.changes) === 0) throw new AppError('NOT_FOUND', 'Запись не найдена');
      });
      emitGameChanged(gameId, 'roster');
      notifyPromotions(gameId, before, organizerId);
      return details(getGameRow(gameId), organizerId);
    },

    /**
     * Напоминание о предстоящей игре: один раз, за сутки до начала, тем, кто в составе.
     * Не отправляется, если игра создана менее чем за сутки (люди только что записались)
     * или до начала осталось меньше часа. Вызывается планировщиком раз в минуту.
     * Возвращает число игр, по которым отправлено напоминание.
     */
    sendDueReminders(): number {
      if (!notify) return 0;
      const nowMs = now().getTime();
      const candidates = db
        .prepare(
          `${GAME_SELECT} WHERE g.status = 'active' AND g.reminder_sent_at IS NULL AND g.starts_at > ?`,
        )
        .all(new Date(nowMs).toISOString()) as unknown as (GameRow & { created_at: string })[];
      let sent = 0;
      for (const game of candidates) {
        const startMs = Date.parse(game.starts_at);
        const leftMin = (startMs - nowMs) / 60_000;
        if (leftMin > REMINDER_LEAD_MIN || leftMin <= REMINDER_MIN_LEAD_MIN) continue;
        if (Date.parse(game.created_at) > startMs - REMINDER_LEAD_MIN * 60_000) continue;
        const claimed = inTransaction(db, () => {
          const res = db
            .prepare('UPDATE games SET reminder_sent_at = ? WHERE id = ? AND reminder_sent_at IS NULL')
            .run(new Date(nowMs).toISOString(), game.id);
          return Number(res.changes) === 1;
        });
        if (!claimed) continue;
        sent += 1;
        // сообщение у каждого своё по числу мест, поэтому группируем получателей по этому числу
        for (const [seats, userIds] of groupUsersBy(mainSeatsOf(game.id))) {
          notify({
            userIds,
            message: clipMessage(
              `Напоминание: «${game.title}», ${whenText(game.starts_at)}, ${game.venue}. Мест у вас в составе: ${seats}.`,
            ),
            fragment: gameFragment(game.id),
          });
        }
      }
      return sent;
    },

    myGames(userId: number): { organized: GameSummary[]; joined: GameSummary[] } {
      const since = new Date(now().getTime() - FINISH_GRACE_MIN * 60_000).toISOString();
      const organized = db
        .prepare(`${GAME_SELECT} WHERE g.organizer_id = ? AND g.starts_at > ? ORDER BY g.starts_at, g.id`)
        .all(userId, since) as unknown as GameRow[];
      const joined = db
        .prepare(
          `${GAME_SELECT} JOIN signups s ON s.game_id = g.id
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
