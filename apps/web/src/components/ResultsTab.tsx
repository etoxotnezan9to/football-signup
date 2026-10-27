import { useState } from 'react';
import { Button } from '@vkontakte/vkui';
import { MAX_GOALS, matchKey, matchPairs, standings, type GameDetails, type Team } from '@football/shared';
import { api, type ApiError } from '../api.ts';
import { BestPlayerPicker } from './BestPlayerPicker.tsx';
import { Empty } from './Empty.tsx';
import { useApp } from '../context.ts';
import { plural } from '../format.ts';

/** Введённый, но ещё не сохранённый счёт встречи (строки полей ввода). */
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

/**
 * Вкладка «Результаты»: каждая пара команд с meetings встречами, счёт каждой встречи (вводит организатор)
 * и турнирная таблица, где каждая встреча — отдельный матч.
 */
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
  const saved = new Map(game.results.map((r) => [matchKey(r.teamA, r.teamB, r.leg), r]));
  const pairs = matchPairs(game.teams.length);
  const legs = Array.from({ length: game.meetings }, (_, i) => i + 1);
  const table = standings(
    game.teams.map((t) => t.no),
    game.results,
  );

  if (pairs.length === 0) return <Empty>Для матчей нужно хотя бы две команды</Empty>;

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
      <div className="results__hint">
        Каждая пара команд играет {game.meetings} {plural(game.meetings, ['раз', 'раза', 'раз'])}
      </div>
      {pairs.map(({ teamA, teamB }) => {
        const a = teams.get(teamA)!;
        const b = teams.get(teamB)!;
        return (
          <section key={`${teamA}-${teamB}`} className="pair" aria-label={`${a.name} — ${b.name}`}>
            <div className="pair__header">
              <TeamName team={a} />
              <span className="pair__vs" aria-hidden="true">
                —
              </span>
              <TeamName team={b} align="right" />
            </div>
            {legs.map((leg) => {
              const key = matchKey(teamA, teamB, leg);
              const result = saved.get(key);
              const draft = drafts[key];
              const value: Draft = draft ?? {
                a: result ? String(result.goalsA) : '',
                b: result ? String(result.goalsB) : '',
              };
              const ga = parseGoals(value.a);
              const gb = parseGoals(value.b);
              const dirty = draft !== undefined && (ga !== result?.goalsA || gb !== result?.goalsB);
              const setValue = (side: 'a' | 'b', v: string) =>
                setDrafts((d) => ({ ...d, [key]: { ...value, [side]: v } }));
              return (
                <div key={leg} className="leg" role="group" aria-label={`Встреча ${leg}`}>
                  <span className="leg__title">Встреча {leg}</span>
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
                  <span className="leg__actions">
                    {editable && dirty && (
                      <Button
                        size="s"
                        loading={busy === key}
                        disabled={ga === null || gb === null}
                        onClick={() =>
                          ga !== null && gb !== null && run(key, api.setMatchScore(game.id, teamA, teamB, leg, ga, gb))
                        }
                      >
                        Сохранить
                      </Button>
                    )}
                    {editable && !dirty && result && (
                      <Button
                        size="s"
                        mode="tertiary"
                        appearance="negative"
                        loading={busy === key}
                        onClick={() => run(key, api.clearMatchScore(game.id, teamA, teamB, leg))}
                      >
                        Стереть
                      </Button>
                    )}
                  </span>
                </div>
              );
            })}
          </section>
        );
      })}

      <BestPlayerPicker game={game} editable={editable} onUpdate={onUpdate} />

      <div className="results__table-wrap">
        <table className="standings" aria-label="Турнирная таблица">
          <caption>Турнирная таблица</caption>
          <thead>
            <tr>
              <th scope="col">#</th>
              <th scope="col" className="standings__team">
                Команда
              </th>
              <th scope="col" title="Сыграно матчей">
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
