import { useState } from 'react';
import { Button } from '@vkontakte/vkui';
import { MAX_GOALS, matchKey, roundRobin, standings, type GameDetails, type Team } from '@football/shared';
import { api, type ApiError } from '../api.ts';
import { Empty } from './Empty.tsx';
import { useApp } from '../context.ts';

/** Введённый, но ещё не сохранённый счёт матча (строки полей ввода). */
interface Draft {
  a: string;
  b: string;
}

function parseGoals(s: string): number | null {
  if (!/^\d{1,2}$/.test(s.trim())) return null;
  const n = Number(s);
  return n <= MAX_GOALS ? n : null;
}

function TeamName({ team, align = 'left' }: { team: Team; align?: 'left' | 'right' }) {
  return (
    <span className={`match__team match__team--${align}`}>
      {align === 'left' && <span className="team-dot" style={{ backgroundColor: team.color }} aria-hidden="true" />}
      <span className="match__team-name">{team.name}</span>
      {align === 'right' && <span className="team-dot" style={{ backgroundColor: team.color }} aria-hidden="true" />}
    </span>
  );
}

/** Вкладка «Результаты»: матчи каждая команда с каждой по турам, счёт (вводит организатор) и турнирная таблица. */
export function ResultsTab({
  game,
  editable,
  onUpdate,
}: {
  game: GameDetails;
  editable: boolean;
  onUpdate: (g: GameDetails) => void;
}) {
  const { showToast } = useApp();
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const teams = new Map(game.teams.map((t) => [t.no, t]));
  const saved = new Map(game.results.map((r) => [matchKey(r.teamA, r.teamB), r]));
  const matches = roundRobin(game.teams.length);
  const rounds = [...new Set(matches.map((m) => m.round))];
  const table = standings(
    game.teams.map((t) => t.no),
    game.results,
  );

  if (matches.length === 0) return <Empty>Для матчей нужно хотя бы две команды</Empty>;

  const dropDraft = (key: string) =>
    setDrafts((d) => {
      const { [key]: _drop, ...rest } = d;
      return rest;
    });

  const run = (key: string, request: Promise<GameDetails>) => {
    setBusy(key);
    request
      .then((g) => {
        onUpdate(g);
        dropDraft(key);
      })
      .catch((e: ApiError) => showToast(e.message))
      .finally(() => setBusy(null));
  };

  return (
    <div className="results">
      {rounds.map((round) => (
        <section key={round} className="results__round" aria-label={`Тур ${round}`}>
          <div className="results__round-title">Тур {round}</div>
          {matches
            .filter((m) => m.round === round)
            .map((m) => {
              const a = teams.get(m.teamA)!;
              const b = teams.get(m.teamB)!;
              const key = matchKey(m.teamA, m.teamB);
              const result = saved.get(key);
              const draft = drafts[key];
              const value: Draft = draft ?? {
                a: result ? String(result.goalsA) : '',
                b: result ? String(result.goalsB) : '',
              };
              const ga = parseGoals(value.a);
              const gb = parseGoals(value.b);
              const dirty = draft !== undefined && (ga !== result?.goalsA || gb !== result?.goalsB);
              const title = `${a.name} — ${b.name}`;
              const setValue = (side: 'a' | 'b', v: string) =>
                setDrafts((d) => ({ ...d, [key]: { ...value, [side]: v } }));
              return (
                <div key={key} className="match" role="group" aria-label={`Матч ${title}`}>
                  <TeamName team={a} />
                  {editable ? (
                    <span className="match__score">
                      <input
                        className="match__goals"
                        inputMode="numeric"
                        aria-label={`Голы ${a.name}`}
                        value={value.a}
                        onChange={(e) => setValue('a', e.target.value)}
                      />
                      <span aria-hidden="true">:</span>
                      <input
                        className="match__goals"
                        inputMode="numeric"
                        aria-label={`Голы ${b.name}`}
                        value={value.b}
                        onChange={(e) => setValue('b', e.target.value)}
                      />
                    </span>
                  ) : (
                    <span className="match__score match__score--text">
                      {result ? `${result.goalsA} : ${result.goalsB}` : '– : –'}
                    </span>
                  )}
                  <TeamName team={b} align="right" />
                  {editable && (dirty || result) && (
                    <span className="match__actions">
                      {dirty ? (
                        <Button
                          size="s"
                          loading={busy === key}
                          disabled={ga === null || gb === null}
                          onClick={() =>
                            ga !== null && gb !== null && run(key, api.setMatchScore(game.id, m.teamA, m.teamB, ga, gb))
                          }
                        >
                          Сохранить
                        </Button>
                      ) : (
                        <Button
                          size="s"
                          mode="tertiary"
                          appearance="negative"
                          loading={busy === key}
                          onClick={() => run(key, api.clearMatchScore(game.id, m.teamA, m.teamB))}
                        >
                          Стереть
                        </Button>
                      )}
                    </span>
                  )}
                </div>
              );
            })}
          {game.teams.length % 2 === 1 && (
            <div className="results__rest">
              Отдыхает:{' '}
              {game.teams
                .filter((t) => !matches.some((m) => m.round === round && (m.teamA === t.no || m.teamB === t.no)))
                .map((t) => t.name)
                .join(', ')}
            </div>
          )}
        </section>
      ))}

      <div className="results__table-wrap">
        <table className="standings" aria-label="Турнирная таблица">
          <caption>Турнирная таблица</caption>
          <thead>
            <tr>
              <th scope="col">#</th>
              <th scope="col" className="standings__team">
                Команда
              </th>
              <th scope="col" title="Игры">
                И
              </th>
              <th scope="col" title="Победы">
                В
              </th>
              <th scope="col" title="Ничьи">
                Н
              </th>
              <th scope="col" title="Поражения">
                П
              </th>
              <th scope="col" title="Забито – пропущено">
                Мячи
              </th>
              <th scope="col" title="Разница мячей">
                ±
              </th>
              <th scope="col" title="Очки">
                О
              </th>
            </tr>
          </thead>
          <tbody>
            {table.map((row, i) => {
              const t = teams.get(row.teamNo)!;
              return (
                <tr key={row.teamNo}>
                  <td>{i + 1}</td>
                  <th scope="row" className="standings__team">
                    <span className="team-dot" style={{ backgroundColor: t.color }} aria-hidden="true" /> {t.name}
                  </th>
                  <td>{row.played}</td>
                  <td>{row.won}</td>
                  <td>{row.drawn}</td>
                  <td>{row.lost}</td>
                  <td>
                    {row.goalsFor}–{row.goalsAgainst}
                  </td>
                  <td>{row.goalDiff > 0 ? `+${row.goalDiff}` : row.goalDiff}</td>
                  <td className="standings__points">{row.points}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
