import { useState } from 'react';
import { Button, Cell, List } from '@vkontakte/vkui';
import { MAX_GOALS, matchKey, moveItem, standings, type GameDetails, type Team } from '@football/shared';
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

function TeamName({ team }: { team: Team }) {
  return (
    <span className="match__team">
      <span className="team-dot" style={{ backgroundColor: team.color }} aria-hidden="true" />
      <span className="match__team-name">{team.name}</span>
    </span>
  );
}

/**
 * Вкладка «Результаты»: все встречи одним списком в порядке проведения (по умолчанию — без долгих серий игр
 * и ожиданий у команд, организатор меняет порядок перетаскиванием), счёт каждой встречи (вводит организатор)
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
  // новый порядок показывается сразу, пока сервер его сохраняет
  const [pendingOrder, setPendingOrder] = useState<string[] | null>(null);
  const teams = new Map(game.teams.map((t) => [t.no, t]));
  const saved = new Map(game.results.map((r) => [matchKey(r.teamA, r.teamB, r.leg), r]));
  const byKey = new Map(game.matches.map((m) => [matchKey(m.teamA, m.teamB, m.leg), m]));
  const order = pendingOrder ?? [...byKey.keys()];
  const matches = order.map((k) => byKey.get(k)).filter((m) => m !== undefined);
  const table = standings(
    game.teams.map((t) => t.no),
    game.results,
  );

  if (game.matches.length === 0) return <Empty>Для матчей нужно хотя бы две команды</Empty>;

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

  const saveOrder = (next: string[] | null) => {
    setPendingOrder(next);
    api
      .setMatchOrder(game.id, next)
      .then(onUpdate)
      .catch((e: ApiError) => showToast(e.message))
      .finally(() => setPendingOrder(null));
  };

  const onDragFinish = ({ from, to }: { from: number; to: number }) => {
    if (from === to) return;
    saveOrder(moveItem(order, from, to));
  };

  return (
    <div className="results">
      <div className="results__hint">
        Каждая пара команд играет {game.meetings} {plural(game.meetings, ['раз', 'раза', 'раз'])}. Матчи идут по
        порядку списка{editable ? '; чтобы изменить порядок, перетащите матч за значок слева' : ''}.
      </div>
      {editable && game.matchOrderCustom && (
        <div>
          <Button size="s" mode="link" disabled={pendingOrder !== null} onClick={() => saveOrder(null)}>
            Вернуть порядок по умолчанию
          </Button>
        </div>
      )}
      <List className="matches" aria-label="Матчи по порядку">
        {matches.map((m, index) => {
          const { teamA, teamB, leg } = m;
          const a = teams.get(teamA);
          const b = teams.get(teamB);
          if (!a || !b) return null;
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
          const label = `Матч ${index + 1}: ${a.name} — ${b.name}`;
          const row = (
            <div className="match" role="group" aria-label={label} data-testid="match">
              <div className="match__head">
                <span className="match__no">
                  Матч {index + 1}
                  {game.meetings > 1 && ` · встреча ${leg}`}
                </span>
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
              {[
                { team: a, side: 'a' as const, goals: result?.goalsA },
                { team: b, side: 'b' as const, goals: result?.goalsB },
              ].map(({ team, side, goals }) => (
                <div key={side} className="match__side">
                  <TeamName team={team} />
                  {editable ? (
                    <input
                      className="match__goals"
                      inputMode="numeric"
                      aria-label={`Голы ${team.name}`}
                      value={value[side]}
                      onChange={(e) => setValue(side, e.target.value)}
                    />
                  ) : (
                    <span className="match__score--text" data-testid="match-goals">
                      {goals ?? '–'}
                    </span>
                  )}
                </div>
              ))}
            </div>
          );
          return editable ? (
            <Cell
              key={key}
              className="matches__cell"
              draggable
              draggerLabel={`Перетащить: ${label}`}
              draggerTestId="match-dragger"
              hasHover={false}
              hasActive={false}
              onDragFinish={onDragFinish}
            >
              {row}
            </Cell>
          ) : (
            <div key={key} className="matches__item">
              {row}
            </div>
          );
        })}
      </List>

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
