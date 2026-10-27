import type { RatingRow, GameDetails, GameSummary, Place, RosterEntry, User } from '@football/shared';

export class ApiError extends Error {
  code: string;
  status: number;
  details: Record<string, string> | undefined;

  constructor(status: number, code: string, message: string, details?: Record<string, string>) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

let authHeader = '';
export function setAuthHeader(value: string): void {
  authHeader = value;
}

async function request<T>(method: string, path: string, body?: unknown, auth: string = authHeader): Promise<T> {
  const headers: Record<string, string> = { Authorization: auth };
  // Content-Type только при наличии тела: Fastify отвергает пустое тело с JSON-типом
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method,
      headers,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  } catch {
    throw new ApiError(0, 'NETWORK', 'Нет связи с сервером');
  }
  const text = await res.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
  }
  if (!res.ok) {
    const err = (
      data as { error?: { code?: string; message?: string; details?: Record<string, string> } } | null
    )?.error;
    throw new ApiError(res.status, err?.code ?? 'ERROR', err?.message ?? 'Ошибка запроса', err?.details);
  }
  return data as T;
}

export interface GamesPage {
  items: GameSummary[];
  nextCursor: string | null;
}

export const api = {
  putMe: (profile: { firstName: string; lastName: string; photoUrl: string | null }) =>
    request<User>('PUT', '/me', profile),
  getConfig: () => request<{ testMode: boolean }>('GET', '/config'),
  addTestPlayers: (id: number, count: number, seats: number) =>
    request<GameDetails>('POST', `/games/${id}/test-players`, { count, seats }),
  removeTestPlayers: (id: number) => request<GameDetails>('DELETE', `/games/${id}/test-players`),
  setTeamName: (id: number, teamNo: number, name: string) =>
    request<GameDetails>('PUT', `/games/${id}/teams/${teamNo}`, { name }),
  setMatchScore: (id: number, teamA: number, teamB: number, leg: number, goalsA: number, goalsB: number) =>
    request<GameDetails>('PUT', `/games/${id}/matches/${teamA}/${teamB}/${leg}`, { goalsA, goalsB }),
  clearMatchScore: (id: number, teamA: number, teamB: number, leg: number) =>
    request<GameDetails>('DELETE', `/games/${id}/matches/${teamA}/${teamB}/${leg}`),
  /** order — ключи matchKey всех встреч в новом порядке; null — порядок по умолчанию */
  setMatchOrder: (id: number, order: string[] | null) =>
    request<GameDetails>('PUT', `/games/${id}/match-order`, { order }),
  setBestPlayer: (id: number, userId: number | null) =>
    request<GameDetails>('PUT', `/games/${id}/best-player`, { userId }),
  assignSeat: (id: number, signupId: number, seat: number, teamNo: number | null) =>
    request<GameDetails>('PUT', `/games/${id}/team-assignment`, { signupId, seat, teamNo }),
  rating: () => request<{ items: RatingRow[] }>('GET', '/rating'),
  listPlaces: () => request<{ items: Place[] }>('GET', '/places'),
  createPlace: (body: { name: string; address: string }) => request<Place>('POST', '/places', body),
  /** query — параметры фильтров вида `&includePast=1` (filtersQuery) и периода `&from=…&to=…` */
  listGames: (query = '', limit = 50) => request<GamesPage>('GET', `/games?limit=${limit}${query}`),
  myGames: () => request<{ organized: GameSummary[]; joined: GameSummary[] }>('GET', '/me/games'),
  myOrganized: () => request<{ items: GameSummary[] }>('GET', '/me/organized'),
  getGame: (id: number) => request<GameDetails>('GET', `/games/${id}`),
  createGame: (body: unknown) => request<GameDetails>('POST', '/games', body),
  updateGame: (id: number, body: unknown) => request<GameDetails>('PATCH', `/games/${id}`, body),
  cancelGame: (id: number) => request<GameDetails>('POST', `/games/${id}/cancel`),
  putSignup: (id: number, seats: number) =>
    request<{ signup: RosterEntry; game: GameDetails }>('PUT', `/games/${id}/signup`, { seats }),
  /** Только тестовый режим: запись от имени другого тестового пользователя (заголовок `Mock …`). */
  putSignupAs: (auth: string, id: number, seats: number) =>
    request<{ signup: RosterEntry; game: GameDetails }>('PUT', `/games/${id}/signup`, { seats }, auth),
  deleteSignup: (id: number) => request<GameDetails>('DELETE', `/games/${id}/signup`),
  setPaid: (id: number, signupId: number, paidSeats: number) =>
    request<GameDetails>('PATCH', `/games/${id}/signups/${signupId}`, { paidSeats }),
  removeSignup: (id: number, signupId: number) =>
    request<GameDetails>('DELETE', `/games/${id}/signups/${signupId}`),
};
