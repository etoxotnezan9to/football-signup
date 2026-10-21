// Распределение игроков состава по командам (чистые функции, используются сервером).
import { MAX_TEAMS } from './constants.ts';

/** Название и цвет команды по умолчанию по её номеру (1..MAX_TEAMS). Цвет не меняется, название — может. */
export const TEAM_PRESETS: readonly { name: string; color: string }[] = [
  { name: 'Синие', color: '#2f6fed' },
  { name: 'Розовые', color: '#f06bb3' },
  { name: 'Салатовые', color: '#9bdb4d' },
  { name: 'Оранжевые', color: '#f7941d' },
  { name: 'Жёлтые', color: '#f5d02f' },
  { name: 'Фиолетовые', color: '#9b51e0' },
  { name: 'Красные', color: '#e53935' },
  { name: 'Голубые', color: '#56ccf2' },
  { name: 'Белые', color: '#ffffff' },
  { name: 'Серые', color: '#9e9e9e' },
];

if (TEAM_PRESETS.length < MAX_TEAMS) throw new Error('TEAM_PRESETS короче MAX_TEAMS');

export const TEAM_NAME_MAX = 30;

/** Одно место записи: запись «+3» даёт места 1, 2 и 3, каждое можно отправить в свою команду. */
export interface TeamSeat {
  signupId: number;
  seat: number;
}

export interface TeamAssignment extends TeamSeat {
  /** Номер команды, с 1 */
  teamNo: number;
  createdAt: string;
}

export interface Team {
  /** Номер команды, с 1 */
  no: number;
  name: string;
  color: string;
  /** Игроки команды в порядке распределения */
  members: TeamSeat[];
}

export interface TeamsView {
  teams: Team[];
  /** Места состава, ещё не распределённые по командам, в порядке состава */
  unassigned: TeamSeat[];
}

export function seatKey(s: TeamSeat): string {
  return `${s.signupId}:${s.seat}`;
}

/**
 * Команды игры. Учитываются только места в составе (не в очереди) и команды с номером до teamsMax;
 * в команде остаются первые playersPerTeam по времени распределения, остальные считаются нераспределёнными.
 */
export function buildTeams(input: {
  teamsMax: number;
  playersPerTeam: number;
  /** Названия, заданные организатором, по номеру команды */
  names: ReadonlyMap<number, string>;
  /** Состав в порядке очереди: сколько мест записи в составе */
  roster: readonly { signupId: number; mainSeats: number }[];
  assignments: readonly TeamAssignment[];
}): TeamsView {
  const mainSeats = new Map(input.roster.map((r) => [r.signupId, r.mainSeats]));
  const teams: Team[] = [];
  for (let no = 1; no <= input.teamsMax; no++) {
    const preset = TEAM_PRESETS[no - 1]!;
    teams.push({ no, name: input.names.get(no) ?? preset.name, color: preset.color, members: [] });
  }
  const placed = new Set<string>();
  const ordered = [...input.assignments].sort(
    (a, b) => a.createdAt.localeCompare(b.createdAt) || a.signupId - b.signupId || a.seat - b.seat,
  );
  for (const a of ordered) {
    const team = teams[a.teamNo - 1];
    if (!team || a.seat < 1 || a.seat > (mainSeats.get(a.signupId) ?? 0)) continue;
    if (team.members.length >= input.playersPerTeam || placed.has(seatKey(a))) continue;
    team.members.push({ signupId: a.signupId, seat: a.seat });
    placed.add(seatKey(a));
  }
  const unassigned: TeamSeat[] = [];
  for (const r of input.roster) {
    for (let seat = 1; seat <= r.mainSeats; seat++) {
      if (!placed.has(seatKey({ signupId: r.signupId, seat }))) unassigned.push({ signupId: r.signupId, seat });
    }
  }
  return { teams, unassigned };
}

/**
 * Автоматическое распределение нераспределённых мест (уже распределённые не трогаются).
 * Места одной записи (человек и его друзья) по возможности попадают в одну команду: туда, где уже есть кто-то
 * из этой записи, иначе в самую свободную команду, куда группа помещается целиком. Если целиком не помещается
 * никуда, группа делится между самыми свободными командами. Крупные группы раскладываются первыми,
 * равные по размеру — в порядке состава. Команды заполняются равномерно.
 * Возвращает новые назначения в порядке, в котором их надо сохранить.
 */
export function autoAssign(view: TeamsView, playersPerTeam: number): (TeamSeat & { teamNo: number })[] {
  const free = new Map(view.teams.map((t) => [t.no, playersPerTeam - t.members.length]));
  const homeOf = new Map<number, number[]>(); // запись → команды, где уже есть её места
  for (const t of view.teams) {
    for (const m of t.members) homeOf.set(m.signupId, [...(homeOf.get(m.signupId) ?? []), t.no]);
  }
  const groups: TeamSeat[][] = [];
  for (const s of view.unassigned) {
    const last = groups.at(-1);
    if (last && last[0]!.signupId === s.signupId) last.push(s);
    else groups.push([s]);
  }
  // стабильная сортировка: при равном размере сохраняется порядок состава
  groups.sort((a, b) => b.length - a.length);

  const mostFree = (minFree: number): number | undefined => {
    let best: number | undefined;
    for (const t of view.teams) {
      const f = free.get(t.no)!;
      if (f >= minFree && f > 0 && (best === undefined || f > free.get(best)!)) best = t.no;
    }
    return best;
  };

  const out: (TeamSeat & { teamNo: number })[] = [];
  const put = (seats: TeamSeat[], teamNo: number) => {
    for (const s of seats) out.push({ ...s, teamNo });
    free.set(teamNo, free.get(teamNo)! - seats.length);
  };
  // сначала группы, которые помещаются целиком; остальные делятся в конце, чтобы не разрывать другие группы
  const deferred: TeamSeat[][] = [];
  for (const group of groups) {
    const home = (homeOf.get(group[0]!.signupId) ?? []).find((no) => free.get(no)! >= group.length);
    const target = home ?? mostFree(group.length);
    if (target === undefined) deferred.push(group);
    else put(group, target);
  }
  for (const group of deferred) {
    let rest = group;
    while (rest.length > 0) {
      const target = mostFree(1);
      if (target === undefined) return out; // мест в командах больше нет
      const take = Math.min(rest.length, free.get(target)!);
      put(rest.slice(0, take), target);
      rest = rest.slice(take);
    }
  }
  return out;
}

/** Название команды: 1..TEAM_NAME_MAX символов после обрезки пробелов; null — неверное. */
export function parseTeamName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const s = value.trim();
  return s.length >= 1 && s.length <= TEAM_NAME_MAX ? s : null;
}
