// Бизнес-логика игр и записей. Зависит только от node:sqlite и @football/shared,
// поэтому полностью тестируется без HTTP-слоя.
import type { DatabaseSync } from 'node:sqlite';
import {
  autoAssign,
  computeRating,
  isGoals,
  buildTeams,
  capacityError,
  gameCapacity,
  parseTeamName,
  seatKey,
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
  TEAM_NAME_MAX,
} from '@football/shared';
import type {
  GameDetails,
  GameInput,
  GameSummary,
  MainSeats,
  Place,
  RosterEntry,
  MatchResult,
  RatingGame,
  RatingRow,
  ServerEvent,
  TeamsView,
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
  starts_at: string;
  place_id: number;
  /** Название места (из JOIN с places) */
  venue: string;
  /** Адрес места (из JOIN с places) */
  address: string;
  teams_max: number;
  meetings: number;
  best_player_id: number | null;
  players_per_team: number;
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
  /** Тестовый режим: разрешены тестовые игроки (addTestPlayers) */
  testMode?: boolean;
}

/** Не больше стольких тестовых игроков за один запрос */
export const MAX_TEST_PLAYERS_PER_REQUEST = 50;

const TEST_FIRST_NAMES = [
  'Артём',
  'Николай',
  'Кирилл',
  'Александр',
  'Дмитрий',
  'Валерий',
  'Иннокентий',
  'Алексей',
  'Григорий',
  'Евгений',
  'Денис',
  'Филипп',
  'Константин',
  'Сергей',
  'Михаил',
  'Павел',
];

function toUser(r: { vk_id: number; first_name: string; last_name: string; photo_url: string | null }): User {
  return { vkId: r.vk_id, firstName: r.first_name, lastName: r.last_name, photoUrl: r.photo_url };
}

export function createService(db: DatabaseSync, options: ServiceOptions = {}) {
  const now = options.now ?? (() => new Date());
  const emit = options.emit ?? (() => {});
  // тестовые игроки (отрицательные vk_id) не существуют в VK: уведомления им не отправляются
  const rawNotify = options.notify;
  const notify: Notify | undefined = rawNotify
    ? (n) => {
        const userIds = n.userIds.filter((id) => id > 0);
        if (userIds.length > 0) rawNotify({ ...n, userIds });
      }
    : undefined;
  const testMode = options.testMode ?? false;
  const timeZone = options.timeZone ?? 'Europe/Moscow';

  function isFinished(startsAt: string): boolean {
    return now().getTime() > Date.parse(startsAt) + FINISH_GRACE_MIN * 60_000;
  }

  function getGameRow(gameId: number): GameRow {
    const row = db.prepare(`${GAME_SELECT} WHERE g.id = ?`).get(gameId) as unknown as GameRow | undefined;
    if (!row) throw new AppError('NOT_FOUND', 'Сбор не найден');
    return row;
  }

  /** Проверяет, что место существует (иначе ошибка поля placeId). */
  function requirePlace(placeId: number): void {
    if (!db.prepare('SELECT 1 FROM places WHERE id = ?').get(placeId)) {
      throw new AppError('VALIDATION_ERROR', 'Арена не найдена', { placeId: 'арена не найдена' });
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

  /** Команды игры по текущему составу; см. buildTeams в packages/shared. */
  function teamsOf(game: GameRow, entries: readonly RosterEntry[]): TeamsView {
    const names = db
      .prepare('SELECT team_no, name FROM game_teams WHERE game_id = ?')
      .all(game.id) as unknown as { team_no: number; name: string }[];
    const assignments = db
      .prepare('SELECT signup_id, seat_no, team_no, created_at FROM team_assignments WHERE game_id = ?')
      .all(game.id) as unknown as { signup_id: number; seat_no: number; team_no: number; created_at: string }[];
    return buildTeams({
      teamsMax: game.teams_max,
      playersPerTeam: game.players_per_team,
      names: new Map(names.map((n) => [n.team_no, n.name])),
      roster: entries,
      assignments: assignments.map((a) => ({
        signupId: a.signup_id,
        seat: a.seat_no,
        teamNo: a.team_no,
        createdAt: a.created_at,
      })),
    });
  }

  /**
   * Удаляет распределение мест, которые больше не попадают в команды: место ушло в очередь или из записи,
   * команд стало меньше, в команде стало меньше игроков. Иначе такое место вернулось бы в команду позже само.
   */
  function pruneAssignments(gameId: number): void {
    const game = getGameRow(gameId);
    const { teams } = teamsOf(game, buildRoster(game).entries);
    const kept = new Set(teams.flatMap((t) => t.members.map(seatKey)));
    const rows = db
      .prepare('SELECT signup_id, seat_no FROM team_assignments WHERE game_id = ?')
      .all(gameId) as unknown as { signup_id: number; seat_no: number }[];
    const del = db.prepare('DELETE FROM team_assignments WHERE signup_id = ? AND seat_no = ?');
    for (const r of rows) {
      if (!kept.has(seatKey({ signupId: r.signup_id, seat: r.seat_no }))) del.run(r.signup_id, r.seat_no);
    }
  }

  /** Счёт встреч, которые ещё есть в игре: команды не больше teamsMax, номер встречи не больше meetings. */
  function resultsOf(game: GameRow): MatchResult[] {
    const rows = db
      .prepare(
        `SELECT team_a, team_b, leg, goals_a, goals_b FROM match_results
          WHERE game_id = ? AND team_b <= ? AND leg <= ? ORDER BY team_a, team_b, leg`,
      )
      .all(game.id, game.teams_max, game.meetings) as unknown as {
      team_a: number;
      team_b: number;
      leg: number;
      goals_a: number;
      goals_b: number;
    }[];
    return rows.map((r) => ({
      teamA: r.team_a,
      teamB: r.team_b,
      leg: r.leg,
      goalsA: r.goals_a,
      goalsB: r.goals_b,
    }));
  }

  /** Записавшиеся (первое место записи), которые сейчас в командах: из них выбирается лучший игрок. */
  function teamPlayerIds(entries: readonly RosterEntry[], teams: TeamsView['teams']): Set<number> {
    const bySignup = new Map(entries.map((e) => [e.signupId, e.user.vkId]));
    const ids = new Set<number>();
    for (const t of teams) {
      for (const m of t.members) {
        const id = bySignup.get(m.signupId);
        if (m.seat === 1 && id !== undefined) ids.add(id);
      }
    }
    return ids;
  }

  function details(game: GameRow, viewerId?: number): GameDetails {
    const { entries } = buildRoster(game);
    const teams = teamsOf(game, entries);
    // выбранный лучший игрок мог выйти из команд (отменил запись, ушёл в очередь): тогда он не показывается
    const best =
      game.best_player_id !== null && teamPlayerIds(entries, teams.teams).has(game.best_player_id)
        ? game.best_player_id
        : null;
    return {
      ...summary(game, viewerId),
      address: game.address,
      teamsMax: game.teams_max,
      playersPerTeam: game.players_per_team,
      meetings: game.meetings,
      description: game.description,
      paymentInfo: game.payment_info,
      organizerContact: game.organizer_contact,
      roster: entries,
      ...teams,
      bestPlayerId: best,
      results: resultsOf(game),
    };
  }

  /** События без данных конкретного получателя (mySeats не передаётся). */
  /** Места состава игры («запись:место»): по ним видно, кто только что попал в состав. */
  function mainSeatKeys(gameId: number): Set<string> {
    const keys = new Set<string>();
    for (const e of buildRoster(getGameRow(gameId)).entries) {
      for (let seat = 1; seat <= e.mainSeats; seat++) keys.add(seatKey({ signupId: e.signupId, seat }));
    }
    return keys;
  }

  /**
   * Места, попавшие в состав после seatsBefore (новая запись, больше мест, переход из очереди, больше мест в игре),
   * сразу распределяются по командам (autoAssign: места одной записи вместе). Уже распределённые и убранные
   * организатором из команд места не трогаются.
   */
  function autoAssignNewSeats(gameId: number, seatsBefore: ReadonlySet<string>): void {
    const game = getGameRow(gameId);
    if (game.status !== 'active') return;
    const view = teamsOf(game, buildRoster(game).entries);
    const fresh = view.unassigned.filter((s) => !seatsBefore.has(seatKey(s)));
    if (fresh.length === 0) return;
    const ts = now().getTime();
    const upsert = db.prepare(
      `INSERT INTO team_assignments (signup_id, seat_no, game_id, team_no, created_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (signup_id, seat_no) DO UPDATE SET team_no = excluded.team_no, created_at = excluded.created_at`,
    );
    // по миллисекунде на место: порядок внутри команды совпадает с порядком распределения
    autoAssign({ ...view, unassigned: fresh }, game.players_per_team).forEach((a, i) =>
      upsert.run(a.signupId, a.seat, gameId, a.teamNo, new Date(ts + i).toISOString()),
    );
  }

  function emitGameChanged(
    gameId: number,
    kind: 'created' | 'updated' | 'roster',
    seatsBefore?: ReadonlySet<string>,
  ): void {
    const game = getGameRow(gameId);
    if (kind === 'created') {
      emit({ type: 'game.created', game: summary(game) });
      return;
    }
    pruneAssignments(gameId);
    if (seatsBefore) autoAssignNewSeats(gameId, seatsBefore);
    emit({ type: 'game.updated', game: summary(game) });
    emit({ type: 'roster.updated', game: details(game) });
  }

  function requireOrganizer(game: GameRow, userId: number): void {
    if (game.organizer_id !== userId) throw new AppError('FORBIDDEN', 'Только организатор может это сделать');
  }

  function requireOpen(game: GameRow): void {
    if (game.status !== 'active' || isFinished(game.starts_at)) {
      throw new AppError('GAME_NOT_ACTIVE', 'Сбор отменён или уже прошёл');
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
          `Вы в составе! ${whenText(game.starts_at)}, ${game.venue}. Мест у вас в составе: ${p.total}.`,
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
      if (!parsed.ok) throw new AppError('VALIDATION_ERROR', 'Неверные данные арены', parsed.errors);
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
      if (!parsed.ok) throw new AppError('VALIDATION_ERROR', 'Неверные данные сбора', parsed.errors);
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
          throw new AppError('ACTIVE_GAMES_LIMIT', 'Слишком много активных сборов');
        }
        const ts = now().toISOString();
        const res = db
          .prepare(
            `INSERT INTO games (organizer_id, starts_at, place_id, teams_max, players_per_team, meetings, fee_rub,
                                capacity, description, payment_info, organizer_contact, status, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`,
          )
          .run(
            organizerId,
            input.startsAt,
            input.placeId,
            input.teamsMax,
            input.playersPerTeam,
            input.meetings,
            input.feeRub,
            gameCapacity(input.teamsMax, input.playersPerTeam),
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

    /**
     * Список сборов для главной. Отменённые видны всем, кроме includeCancelled: false — тогда их нет вовсе.
     * Прошедшие — только с includePast. placeId — одна арена.
     * Порядок: предстоящие по возрастанию времени, затем прошедшие от новых к старым.
     */
    listGames(
      viewerId: number,
      opts: { cursor?: string; limit?: number; includePast?: boolean; includeCancelled?: boolean; placeId?: number } = {},
    ) {
      const limit = Math.min(Math.max(opts.limit ?? 20, 1), 50);
      const offset = opts.cursor && /^\d+$/.test(opts.cursor) ? Number(opts.cursor) : 0;
      const since = new Date(now().getTime() - FINISH_GRACE_MIN * 60_000).toISOString();
      const where: string[] = [];
      const params: (string | number)[] = [];
      if (!opts.includePast) {
        where.push('g.starts_at > ?');
        params.push(since);
      }
      if (opts.includeCancelled === false) where.push("g.status = 'active'");
      if (opts.placeId !== undefined) {
        where.push('g.place_id = ?');
        params.push(opts.placeId);
      }
      const rows = db
        .prepare(
          `${GAME_SELECT} ${where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''}
            ORDER BY g.starts_at <= ?, CASE WHEN g.starts_at > ? THEN g.starts_at END, g.starts_at DESC, g.id
            LIMIT ? OFFSET ?`,
        )
        .all(...params, since, since, limit + 1, offset) as unknown as GameRow[];
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
      if (!parsed.ok) throw new AppError('VALIDATION_ERROR', 'Неверные данные сбора', parsed.errors);
      const patch = parsed.value;
      const before = snapshot(gameId);
      const seatsBefore = mainSeatKeys(gameId);
      const old = inTransaction(db, () => {
        const game = getGameRow(gameId);
        requireOrganizer(game, userId);
        if (game.status !== 'active') throw new AppError('GAME_NOT_ACTIVE', 'Сбор отменён');
        if (patch.startsAt !== undefined && Date.parse(patch.startsAt) <= now().getTime()) {
          throw new AppError('STARTS_AT_IN_PAST', 'Время начала должно быть в будущем');
        }
        if (patch.placeId !== undefined) requirePlace(patch.placeId);
        // вместимость не задаётся напрямую: пересчитывается из итоговых команд и игроков в команде
        const teams = patch.teamsMax ?? game.teams_max;
        const players = patch.playersPerTeam ?? game.players_per_team;
        const tooBig = capacityError(teams, players);
        if (tooBig) throw new AppError('VALIDATION_ERROR', 'Неверные данные сбора', { playersPerTeam: tooBig });
        const columns: Record<keyof GameInput, string> = {
          startsAt: 'starts_at',
          placeId: 'place_id',
          teamsMax: 'teams_max',
          playersPerTeam: 'players_per_team',
          meetings: 'meetings',
          feeRub: 'fee_rub',
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
        if (patch.teamsMax !== undefined || patch.playersPerTeam !== undefined) {
          sets.push('capacity = ?');
          values.push(gameCapacity(teams, players));
        }
        sets.push('updated_at = ?');
        values.push(now().toISOString(), gameId);
        db.prepare(`UPDATE games SET ${sets.join(', ')} WHERE id = ?`).run(...values);
        return game; // состояние до правки
      });
      emitGameChanged(gameId, 'roster', seatsBefore);
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
              `Сбор ${whenText(old.starts_at)}, ${old.venue} изменён. Теперь: ${whenText(current.starts_at)}, ${current.venue}, ${current.address}.`,
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
          message: clipMessage(`Сбор ${whenText(g.starts_at)}, ${g.venue} отменён организатором.`),
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
      const seatsBefore = mainSeatKeys(gameId);
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
      emitGameChanged(gameId, 'roster', seatsBefore);
      notifyPromotions(gameId, before, userId);
      const game = details(getGameRow(gameId), userId);
      const signup = game.roster.find((e) => e.user.vkId === userId)!;
      return { signup, game };
    },

    deleteSignup(gameId: number, userId: number): GameDetails {
      const before = snapshot(gameId);
      const seatsBefore = mainSeatKeys(gameId);
      inTransaction(db, () => {
        const game = getGameRow(gameId);
        requireOpen(game);
        const res = db.prepare('DELETE FROM signups WHERE game_id = ? AND user_id = ?').run(gameId, userId);
        if (Number(res.changes) === 0) throw new AppError('NOT_FOUND', 'Вы не записаны на этот сбор');
      });
      emitGameChanged(gameId, 'roster', seatsBefore);
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

    /** Организатор переименовывает команду (номер с 1, не больше teamsMax). */
    setTeamName(gameId: number, organizerId: number, teamNo: number, body: unknown): GameDetails {
      const name = parseTeamName((body as { name?: unknown } | null)?.name);
      if (name === null) {
        throw new AppError('VALIDATION_ERROR', 'Неверное название команды', {
          name: `длина от 1 до ${TEAM_NAME_MAX}`,
        });
      }
      inTransaction(db, () => {
        const game = getGameRow(gameId);
        requireOrganizer(game, organizerId);
        if (game.status !== 'active') throw new AppError('GAME_NOT_ACTIVE', 'Сбор отменён');
        if (teamNo > game.teams_max) throw new AppError('NOT_FOUND', 'Команда не найдена');
        db.prepare(
          `INSERT INTO game_teams (game_id, team_no, name) VALUES (?, ?, ?)
             ON CONFLICT (game_id, team_no) DO UPDATE SET name = excluded.name`,
        ).run(gameId, teamNo, name);
      });
      emitGameChanged(gameId, 'roster');
      return details(getGameRow(gameId), organizerId);
    },

    /**
     * Организатор отправляет место состава в команду (teamNo) или убирает из команд (teamNo: null).
     * Место перемещается в конец выбранной команды; в полную команду нельзя (TEAM_FULL).
     */
    assignSeat(gameId: number, organizerId: number, body: unknown): GameDetails {
      const b = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>;
      const isPositiveInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 1;
      if (!isPositiveInt(b.signupId) || !isPositiveInt(b.seat) || !(b.teamNo === null || isPositiveInt(b.teamNo))) {
        throw new AppError('VALIDATION_ERROR', 'Неверные данные распределения');
      }
      const signupId = b.signupId;
      const seat = b.seat;
      const teamNo = b.teamNo as number | null;
      inTransaction(db, () => {
        const game = getGameRow(gameId);
        requireOrganizer(game, organizerId);
        if (game.status !== 'active') throw new AppError('GAME_NOT_ACTIVE', 'Сбор отменён');
        const { entries } = buildRoster(game);
        const entry = entries.find((e) => e.signupId === signupId);
        if (!entry) throw new AppError('NOT_FOUND', 'Запись не найдена');
        if (seat > entry.mainSeats) {
          throw new AppError('VALIDATION_ERROR', 'В команды распределяются только места из состава');
        }
        if (teamNo === null) {
          db.prepare('DELETE FROM team_assignments WHERE signup_id = ? AND seat_no = ?').run(signupId, seat);
          return;
        }
        if (teamNo > game.teams_max) throw new AppError('NOT_FOUND', 'Команда не найдена');
        const team = teamsOf(game, entries).teams[teamNo - 1]!;
        const key = seatKey({ signupId, seat });
        if (team.members.some((m) => seatKey(m) === key)) return;
        if (team.members.length >= game.players_per_team) {
          throw new AppError('TEAM_FULL', `В команде «${team.name}» уже ${game.players_per_team} игроков`);
        }
        db.prepare(
          `INSERT INTO team_assignments (signup_id, seat_no, game_id, team_no, created_at) VALUES (?, ?, ?, ?, ?)
             ON CONFLICT (signup_id, seat_no) DO UPDATE SET team_no = excluded.team_no, created_at = excluded.created_at`,
        ).run(signupId, seat, gameId, teamNo, now().toISOString());
      });
      emitGameChanged(gameId, 'roster');
      return details(getGameRow(gameId), organizerId);
    },

    /**
     * Организатор записывает счёт встречи leg (с 1 до meetings) команд teamA и teamB (порядок любой,
     * голы в том же порядке) или стирает его (body null). Можно и после окончания игры, но не в отменённой игре.
     */
    setMatchScore(
      gameId: number,
      organizerId: number,
      teamA: number,
      teamB: number,
      leg: number,
      body: unknown,
    ): GameDetails {
      let goals: [number, number] | null = null;
      if (body !== null) {
        const b = (typeof body === 'object' ? body : {}) as { goalsA?: unknown; goalsB?: unknown };
        if (!isGoals(b.goalsA) || !isGoals(b.goalsB)) {
          throw new AppError('VALIDATION_ERROR', 'Счёт — целые числа от 0 до 99');
        }
        goals = [b.goalsA, b.goalsB];
      }
      inTransaction(db, () => {
        const game = getGameRow(gameId);
        requireOrganizer(game, organizerId);
        if (game.status !== 'active') throw new AppError('GAME_NOT_ACTIVE', 'Сбор отменён');
        if (teamA === teamB || teamA > game.teams_max || teamB > game.teams_max || leg > game.meetings) {
          throw new AppError('NOT_FOUND', 'Такого матча нет');
        }
        const [a, b] = teamA < teamB ? [teamA, teamB] : [teamB, teamA];
        if (goals === null) {
          db.prepare('DELETE FROM match_results WHERE game_id = ? AND team_a = ? AND team_b = ? AND leg = ?').run(
            gameId,
            a,
            b,
            leg,
          );
          return;
        }
        const [ga, gb] = teamA < teamB ? goals : [goals[1], goals[0]];
        db.prepare(
          `INSERT INTO match_results (game_id, team_a, team_b, leg, goals_a, goals_b, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT (game_id, team_a, team_b, leg)
             DO UPDATE SET goals_a = excluded.goals_a, goals_b = excluded.goals_b, updated_at = excluded.updated_at`,
        ).run(gameId, a, b, leg, ga, gb, now().toISOString());
      });
      emitGameChanged(gameId, 'roster');
      return details(getGameRow(gameId), organizerId);
    },

    /**
     * Организатор выбирает лучшего игрока сбора (userId) из записавшихся, кто сейчас в командах,
     * или снимает выбор (userId: null). Можно и после окончания игры, но не в отменённой игре.
     */
    setBestPlayer(gameId: number, organizerId: number, body: unknown): GameDetails {
      const userId = (typeof body === 'object' && body !== null ? body : {}) as { userId?: unknown };
      const value = userId.userId;
      if (value !== null && !(typeof value === 'number' && Number.isInteger(value))) {
        throw new AppError('VALIDATION_ERROR', 'Неверный игрок');
      }
      inTransaction(db, () => {
        const game = getGameRow(gameId);
        requireOrganizer(game, organizerId);
        if (game.status !== 'active') throw new AppError('GAME_NOT_ACTIVE', 'Сбор отменён');
        if (value !== null) {
          const { entries } = buildRoster(game);
          if (!teamPlayerIds(entries, teamsOf(game, entries).teams).has(value)) {
            throw new AppError('VALIDATION_ERROR', 'Лучшего игрока можно выбрать только из игроков команд', {
              userId: 'игрок не в команде',
            });
          }
        }
        db.prepare('UPDATE games SET best_player_id = ?, updated_at = ? WHERE id = ?').run(
          value,
          now().toISOString(),
          gameId,
        );
      });
      emitGameChanged(gameId, 'roster');
      return details(getGameRow(gameId), organizerId);
    },

    removeSignup(gameId: number, organizerId: number, signupId: number): GameDetails {
      const before = snapshot(gameId);
      const seatsBefore = mainSeatKeys(gameId);
      inTransaction(db, () => {
        const game = getGameRow(gameId);
        requireOrganizer(game, organizerId);
        const res = db.prepare('DELETE FROM signups WHERE id = ? AND game_id = ?').run(signupId, gameId);
        if (Number(res.changes) === 0) throw new AppError('NOT_FOUND', 'Запись не найдена');
      });
      emitGameChanged(gameId, 'roster', seatsBefore);
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
              `Напоминание: сбор ${whenText(game.starts_at)}, ${game.venue}. Мест у вас в составе: ${seats}.`,
            ),
            fragment: gameFragment(game.id),
          });
        }
      }
      return sent;
    },

    /**
     * Рейтинг игроков по всем неотменённым сборам с сохранённым счётом (computeRating в packages/shared).
     * Учитываются записавшиеся люди (первое место записи), которые были в команде; их друзья — нет.
     */
    rating(): RatingRow[] {
      const gameIds = db
        .prepare(
          `SELECT DISTINCT m.game_id AS id FROM match_results m JOIN games g ON g.id = m.game_id
            WHERE g.status = 'active' ORDER BY m.game_id`,
        )
        .all() as unknown as { id: number }[];
      const users = new Map<number, User>();
      const games: RatingGame[] = gameIds.map(({ id }) => {
        const game = getGameRow(id);
        const { entries } = buildRoster(game);
        const bySignup = new Map(entries.map((e) => [e.signupId, e.user]));
        const { teams } = teamsOf(game, entries);
        const players: { userId: number; teamNo: number }[] = [];
        for (const t of teams) {
          for (const m of t.members) {
            const user = bySignup.get(m.signupId);
            if (m.seat !== 1 || !user) continue;
            users.set(user.vkId, user);
            players.push({ userId: user.vkId, teamNo: t.no });
          }
        }
        return {
          teamNos: teams.map((t) => t.no),
          players,
          results: resultsOf(game),
          bestPlayerId: game.best_player_id,
        };
      });
      return computeRating(games).map((s) => ({
        user: users.get(s.userId)!,
        matches: s.matches,
        gatherings: s.gatherings,
        bestPlayer: s.bestPlayer,
        points: s.points,
      }));
    },

    /**
     * Все сборы, которые создал пользователь, включая прошедшие и отменённые, новые сверху (не больше 50):
     * из них выбирают сбор, чтобы скопировать его настройки в новый.
     */
    myOrganized(userId: number): GameSummary[] {
      const rows = db
        .prepare(`${GAME_SELECT} WHERE g.organizer_id = ? ORDER BY g.starts_at DESC, g.id DESC LIMIT 50`)
        .all(userId) as unknown as GameRow[];
      return rows.map((g) => summary(g, userId));
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

    /**
     * Тестовый режим: организатор добавляет в свою игру `count` тестовых игроков по `seats` мест.
     * Тестовые игроки — пользователи с отрицательным vk_id и фамилией «(тест)»; в VK их нет.
     */
    addTestPlayers(
      gameId: number,
      organizerId: number,
      countInput: unknown,
      seatsInput: unknown = 1,
    ): GameDetails {
      if (!testMode) throw new AppError('FORBIDDEN', 'Тестовый режим выключен');
      const count = countInput;
      if (
        typeof count !== 'number' ||
        !Number.isInteger(count) ||
        count < 1 ||
        count > MAX_TEST_PLAYERS_PER_REQUEST
      ) {
        throw new AppError('VALIDATION_ERROR', `Число игроков от 1 до ${MAX_TEST_PLAYERS_PER_REQUEST}`);
      }
      const seats = checkSeats(seatsInput);
      if (!seats.ok) throw new AppError('VALIDATION_ERROR', 'Неверное число мест');
      const before = snapshot(gameId);
      const seatsBefore = mainSeatKeys(gameId);
      inTransaction(db, () => {
        const game = getGameRow(gameId);
        requireOrganizer(game, organizerId);
        requireOpen(game);
        const min = db.prepare('SELECT MIN(vk_id) AS m FROM users WHERE vk_id < 0').get() as unknown as {
          m: number | null;
        };
        let nextId = (min.m ?? 0) - 1;
        const insertUser = db.prepare(
          'INSERT INTO users (vk_id, first_name, last_name, photo_url, created_at, updated_at) VALUES (?, ?, ?, NULL, ?, ?)',
        );
        const insertSignup = db.prepare(
          'INSERT INTO signups (game_id, user_id, seats, paid_seats, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?)',
        );
        for (let i = 0; i < count; i++) {
          const n = -nextId;
          const name = `${TEST_FIRST_NAMES[(n - 1) % TEST_FIRST_NAMES.length]} ${n}`;
          const ts = now().toISOString();
          insertUser.run(nextId, name, '(тест)', ts, ts);
          insertSignup.run(gameId, nextId, seats.seats, ts, ts);
          nextId -= 1;
        }
      });
      emitGameChanged(gameId, 'roster', seatsBefore);
      notifyPromotions(gameId, before, organizerId);
      return details(getGameRow(gameId), organizerId);
    },

    /** Тестовый режим: убирает из игры всех тестовых игроков. */
    removeTestPlayers(gameId: number, organizerId: number): GameDetails {
      if (!testMode) throw new AppError('FORBIDDEN', 'Тестовый режим выключен');
      const before = snapshot(gameId);
      const seatsBefore = mainSeatKeys(gameId);
      inTransaction(db, () => {
        const game = getGameRow(gameId);
        requireOrganizer(game, organizerId);
        db.prepare('DELETE FROM signups WHERE game_id = ? AND user_id < 0').run(gameId);
      });
      emitGameChanged(gameId, 'roster', seatsBefore);
      notifyPromotions(gameId, before, organizerId);
      return details(getGameRow(gameId), organizerId);
    },

    getGameForText(gameId: number, viewerId: number): GameDetails {
      return details(getGameRow(gameId), viewerId);
    },
  };
}

export type Service = ReturnType<typeof createService>;
