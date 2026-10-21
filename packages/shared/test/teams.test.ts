import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { MAX_TEAMS, TEAM_PRESETS, buildTeams, parseTeamName, type TeamAssignment } from '../src/index.ts';

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
