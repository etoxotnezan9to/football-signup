// Распределение игроков состава по командам (чистые функции, используются сервером).
import { MAX_TEAMS } from './constants.ts';

/** Цвет команды из набора: постоянный ключ (хранится в сборе), название команды этого цвета и цвет кружка. */
export interface TeamColor {
  key: string;
  name: string;
  color: string;
}

/**
 * Набор цветов команд. Первые MAX_TEAMS — цвета по умолчанию по номеру команды; организатор может выбрать
 * любой цвет набора, которого нет у других команд сбора.
 */
export const TEAM_COLORS: readonly TeamColor[] = [
  { key: 'blue', name: 'Синие', color: '#2f6fed' },
  { key: 'pink', name: 'Розовые', color: '#f06bb3' },
  { key: 'lime', name: 'Салатовые', color: '#9bdb4d' },
  { key: 'orange', name: 'Оранжевые', color: '#f7941d' },
  { key: 'yellow', name: 'Жёлтые', color: '#f5d02f' },
  { key: 'purple', name: 'Фиолетовые', color: '#9b51e0' },
  { key: 'red', name: 'Красные', color: '#e53935' },
  { key: 'lightblue', name: 'Голубые', color: '#56ccf2' },
  { key: 'white', name: 'Белые', color: '#ffffff' },
  { key: 'gray', name: 'Серые', color: '#9e9e9e' },
  { key: 'black', name: 'Чёрные', color: '#212121' },
];

/** Название и цвет команды по умолчанию по её номеру (1..MAX_TEAMS). */
export const TEAM_PRESETS: readonly TeamColor[] = TEAM_COLORS.slice(0, MAX_TEAMS);

if (TEAM_PRESETS.length < MAX_TEAMS) throw new Error('TEAM_COLORS короче MAX_TEAMS');

const COLOR_BY_KEY = new Map(TEAM_COLORS.map((c) => [c.key, c]));

export function teamColor(key: string): TeamColor | undefined {
  return COLOR_BY_KEY.get(key);
}

/**
 * Цвета команд 1..teamsMax (ключи по порядку номеров). Выбранные организатором (explicit) остаются как есть
 * (повтор цвета у команды с большим номером не учитывается); остальные получают цвет по умолчанию для своего номера,
 * а если он уже занят — первый свободный цвет набора.
 */
export function resolveTeamColors(teamsMax: number, explicit: ReadonlyMap<number, string>): string[] {
  const out: (string | undefined)[] = [];
  const used = new Set<string>();
  for (let no = 1; no <= teamsMax; no++) {
    const key = explicit.get(no);
    if (key !== undefined && COLOR_BY_KEY.has(key) && !used.has(key)) {
      out[no - 1] = key;
      used.add(key);
    }
  }
  for (let no = 1; no <= teamsMax; no++) {
    if (out[no - 1] !== undefined) continue;
    const preset = TEAM_PRESETS[no - 1]?.key;
    const key =
      preset !== undefined && !used.has(preset) ? preset : TEAM_COLORS.find((c) => !used.has(c.key))!.key;
    out[no - 1] = key;
    used.add(key);
  }
  return out as string[];
}

/** Ключ цвета из набора или null. */
export function parseTeamColor(value: unknown): string | null {
  return typeof value === 'string' && COLOR_BY_KEY.has(value) ? value : null;
}

/**
 * Цвета команд при создании сбора (например, скопированные из другого сбора): ключи по номерам команд с 1,
 * без повторов, не больше MAX_TEAMS. undefined — не заданы; null — неверные.
 */
export function parseTeamColors(value: unknown): string[] | null | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > MAX_TEAMS) return null;
  const keys = value.map(parseTeamColor);
  if (keys.some((k) => k === null) || new Set(keys).size !== keys.length) return null;
  return keys as string[];
}

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
  /** Ключ цвета из TEAM_COLORS */
  colorKey: string;
  /** Цвет кружка (#rrggbb) */
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
  /** Названия, заданные организатором, по номеру команды; без названия — название цвета */
  names: ReadonlyMap<number, string>;
  /** Цвета, заданные организатором (ключи TEAM_COLORS), по номеру команды; см. resolveTeamColors */
  colors?: ReadonlyMap<number, string>;
  /** Состав в порядке очереди: сколько мест записи в составе */
  roster: readonly { signupId: number; mainSeats: number }[];
  assignments: readonly TeamAssignment[];
}): TeamsView {
  const mainSeats = new Map(input.roster.map((r) => [r.signupId, r.mainSeats]));
  const teams: Team[] = [];
  const colors = resolveTeamColors(input.teamsMax, input.colors ?? new Map());
  for (let no = 1; no <= input.teamsMax; no++) {
    const color = teamColor(colors[no - 1]!)!;
    teams.push({ no, name: input.names.get(no) ?? color.name, colorKey: color.key, color: color.color, members: [] });
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
 * Команды заполняются по очереди, а не поровну: место получает самая заполненная команда, где ещё есть место.
 * Места одной записи (человек и его друзья) по возможности попадают в одну команду целиком: туда, где уже есть
 * кто-то из этой записи, иначе в самую заполненную команду, где группа помещается целиком. Если целиком
 * не помещается никуда, группа делится так, чтобы кусков было меньше: начиная с самой свободной команды.
 * Крупные группы раскладываются первыми, равные по размеру — в порядке состава.
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

  /** Команда, где свободно не меньше need: самая заполненная (fullest) или самая свободная; при равенстве — с меньшим номером. */
  const pick = (need: number, prefer: 'fullest' | 'emptiest'): number | undefined => {
    let best: number | undefined;
    for (const t of view.teams) {
      const f = free.get(t.no)!;
      if (f < need || f === 0) continue;
      const b = best === undefined ? undefined : free.get(best)!;
      if (b === undefined || (prefer === 'fullest' ? f < b : f > b)) best = t.no;
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
    const target = home ?? pick(group.length, 'fullest');
    if (target === undefined) deferred.push(group);
    else put(group, target);
  }
  for (const group of deferred) {
    let rest = group;
    while (rest.length > 0) {
      const target = pick(1, 'emptiest');
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
