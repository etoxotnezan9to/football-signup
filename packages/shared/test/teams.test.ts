import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  MAX_TEAMS,
  TEAM_PRESETS,
  autoAssign,
  buildTeams,
  parseTeamName,
  type TeamAssignment,
} from '../src/index.ts';

const at = (n: number) => `2026-10-21T10:00:${String(n).padStart(2, '0')}.000Z`;
const a = (signupId: number, seat: number, teamNo: number, t: number): TeamAssignment => ({
  signupId,
  seat,
  teamNo,
  createdAt: at(t),
});

describe('buildTeams', () => {
  const roster = [
    { signupId: 1, mainSeats: 3 }, // запись «+3»: три места, каждое распределяется отдельно
    { signupId: 2, mainSeats: 1 },
    { signupId: 3, mainSeats: 0 }, // целиком в очереди
  ];

  it('по умолчанию команды названы по цветам, все места состава не распределены', () => {
    const r = buildTeams({ teamsMax: 4, playersPerTeam: 6, names: new Map(), roster, assignments: [] });
    assert.deepEqual(
      r.teams.map((t) => t.name),
      ['Синие', 'Розовые', 'Салатовые', 'Оранжевые'],
    );
    assert.deepEqual(
      r.teams.map((t) => t.no),
      [1, 2, 3, 4],
    );
    assert.ok(r.teams.every((t) => /^#[0-9a-f]{6}$/.test(t.color)));
    assert.deepEqual(r.unassigned, [
      { signupId: 1, seat: 1 },
      { signupId: 1, seat: 2 },
      { signupId: 1, seat: 3 },
      { signupId: 2, seat: 1 },
    ]);
  });

  it('учитывает переименование и распределение, порядок в команде — по времени', () => {
    const r = buildTeams({
      teamsMax: 2,
      playersPerTeam: 3,
      names: new Map([[2, 'Ветераны']]),
      roster,
      assignments: [a(2, 1, 1, 5), a(1, 2, 1, 1), a(1, 3, 2, 2)],
    });
    assert.equal(r.teams[1]!.name, 'Ветераны');
    assert.deepEqual(r.teams[0]!.members, [
      { signupId: 1, seat: 2 },
      { signupId: 2, seat: 1 },
    ]);
    assert.deepEqual(r.teams[1]!.members, [{ signupId: 1, seat: 3 }]);
    assert.deepEqual(r.unassigned, [{ signupId: 1, seat: 1 }]);
  });

  it('отбрасывает места из очереди, лишние команды и игроков сверх playersPerTeam', () => {
    const r = buildTeams({
      teamsMax: 2,
      playersPerTeam: 1,
      names: new Map(),
      roster,
      assignments: [
        a(3, 1, 1, 1), // место в очереди
        a(1, 1, 3, 2), // команды 3 больше нет
        a(1, 2, 1, 3),
        a(2, 1, 1, 4), // команда 1 уже полна
      ],
    });
    assert.deepEqual(r.teams[0]!.members, [{ signupId: 1, seat: 2 }]);
    assert.deepEqual(r.teams[1]!.members, []);
    assert.deepEqual(r.unassigned, [
      { signupId: 1, seat: 1 },
      { signupId: 1, seat: 3 },
      { signupId: 2, seat: 1 },
    ]);
  });

  it('названий и цветов хватает на MAX_TEAMS команд', () => {
    assert.ok(TEAM_PRESETS.length >= MAX_TEAMS);
    assert.equal(new Set(TEAM_PRESETS.map((p) => p.color)).size, TEAM_PRESETS.length);
  });
});

describe('parseTeamName', () => {
  it('обрезает пробелы и ограничивает длину', () => {
    assert.equal(parseTeamName('  Красные  '), 'Красные');
    assert.equal(parseTeamName('   '), null);
    assert.equal(parseTeamName('x'.repeat(31)), null);
    assert.equal(parseTeamName(5), null);
  });
});

describe('autoAssign', () => {
  const view = (playersPerTeam: number, teamsMax: number, roster: [number, number][], assignments: TeamAssignment[] = []) =>
    buildTeams({
      teamsMax,
      playersPerTeam,
      names: new Map(),
      roster: roster.map(([signupId, mainSeats]) => ({ signupId, mainSeats })),
      assignments,
    });
  /** Команда каждого места: «запись:место» → номер команды */
  const placement = (r: ReturnType<typeof autoAssign>) => new Map(r.map((x) => [`${x.signupId}:${x.seat}`, x.teamNo]));
  const sizes = (r: ReturnType<typeof autoAssign>, teams: number) =>
    Array.from({ length: teams }, (_, i) => r.filter((x) => x.teamNo === i + 1).length);

  it('заполняет команды по очереди, держа игроков одной записи вместе', () => {
    // 4 команды по 6: записи +3, +1, +2, +1, +3, +2, +1, +1 = 14 игроков
    const v = view(6, 4, [
      [1, 3],
      [2, 1],
      [3, 2],
      [4, 1],
      [5, 3],
      [6, 2],
      [7, 1],
      [8, 1],
    ]);
    const r = autoAssign(v, 6);
    assert.equal(r.length, 14);
    const p = placement(r);
    for (const [id, seats] of [
      [1, 3],
      [3, 2],
      [5, 3],
      [6, 2],
    ]) {
      const teams = new Set(Array.from({ length: seats! }, (_, i) => p.get(`${id}:${i + 1}`)));
      assert.equal(teams.size, 1, `запись ${id} в одной команде`);
    }
    // сначала до конца заполняется первая команда, потом вторая, остальные пока пустые
    assert.deepEqual(sizes(r, 4), [6, 6, 2, 0]);
  });

  it('досаживает к своим, если часть записи уже в команде, и не трогает ручную расстановку', () => {
    const at0 = '2026-10-21T10:00:00.000Z';
    const v = view(
      3,
      2,
      [
        [1, 3],
        [2, 1],
      ],
      [
        { signupId: 1, seat: 1, teamNo: 2, createdAt: at0 },
        { signupId: 2, seat: 1, teamNo: 2, createdAt: at0 },
      ],
    );
    const r = autoAssign(v, 3);
    // в команде 2 осталось одно место: группа из двух мест туда целиком не входит → в команду 1
    assert.deepEqual(r, [
      { signupId: 1, seat: 2, teamNo: 1 },
      { signupId: 1, seat: 3, teamNo: 1 },
    ]);
    const v2 = view(4, 2, [[1, 3]], [{ signupId: 1, seat: 1, teamNo: 2, createdAt: at0 }]);
    assert.deepEqual(
      autoAssign(v2, 4).map((x) => x.teamNo),
      [2, 2],
      'остальные места записи идут к своим',
    );
  });

  it('одиночный игрок идёт в самую заполненную команду, а группа — туда, где поместится целиком', () => {
    const at0 = '2026-10-21T10:00:00.000Z';
    const seat = (signupId: number, teamNo: number) => ({ signupId, seat: 1, teamNo, createdAt: at0 });
    // команда 1: 4 из 6, команда 2: 1 из 6
    const base: [number, number][] = [
      [1, 1],
      [2, 1],
      [3, 1],
      [4, 1],
      [5, 1],
    ];
    const fixed = [seat(1, 1), seat(2, 1), seat(3, 1), seat(4, 1), seat(5, 2)];
    const single = view(6, 2, [...base, [6, 1]], fixed);
    assert.deepEqual(
      autoAssign(single, 6).map((x) => x.teamNo),
      [1],
    );
    const trio = view(6, 2, [...base, [6, 3]], fixed);
    assert.deepEqual(
      autoAssign(trio, 6).map((x) => x.teamNo),
      [2, 2, 2],
      'в первой команде 2 места: тройка идёт целиком во вторую',
    );
    const pair = view(6, 2, [...base, [6, 2]], fixed);
    assert.deepEqual(
      autoAssign(pair, 6).map((x) => x.teamNo),
      [1, 1],
      'пара помещается в самую заполненную',
    );
  });

  it('делит группу, только если целиком она не помещается никуда, и останавливается, когда мест нет', () => {
    const v = view(2, 2, [
      [1, 3],
      [2, 2],
    ]);
    const r = autoAssign(v, 2);
    assert.equal(r.length, 4, 'в командах всего 4 места из 5');
    const p = placement(r);
    assert.equal(p.get('2:1'), p.get('2:2'), 'пара не делится');
  });
});
