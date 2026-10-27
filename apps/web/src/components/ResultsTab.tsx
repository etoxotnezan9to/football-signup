import { useEffect, useRef, useState } from 'react';
import { Button, Cell, List } from '@vkontakte/vkui';
import { MAX_GOALS, defaultMatchOrder, matchKey, moveItem, standings, type GameDetails, type Team } from '@football/shared';
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

/** Название команды; у первой команды кружок цвета справа (ближе к счёту), у второй — слева. */
function TeamName({ team, side }: { team: Team; side: 'a' | 'b' }) {
  const dot = <span className="team-dot" style={{ backgroundColor: team.color }} aria-hidden="true" />;
  return (
    <span className={`match__team match__team--${side}`} title={team.name}>
      {side === 'b' && dot}
      <span className="match__team-name">{team.name}</span>
      {side === 'a' && dot}
    </span>
  );
}

/** Пауза после ввода, после которой счёт сохраняется сам */
const SAVE_DELAY_MS = 600;

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
  // последние значения для отложенного сохранения: таймер срабатывает после нескольких перерисовок
  const draftsRef = useRef(drafts);
  draftsRef.current = drafts;
  const gameRef = useRef(game);
  gameRef.current = game;
  const onUpdateRef = useRef(onUpdate);
  onUpdateRef.current = onUpdate;
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  // новый порядок показывается сразу, пока сервер его сохраняет
  const [pendingOrder, setPendingOrder] = useState<string[] | null>(null);
  const teams = new Map(game.teams.map((t) => [t.no, t]));
  const saved = new Map(game.results.map((r) => [matchKey(r.teamA, r.teamB, r.leg), r]));
  // сервер старой версии (например, пока идёт выкладка) не присылает matches: тогда порядок по умолчанию
  const gameMatches =
    (game.matches as GameDetails['matches'] | undefined) ?? defaultMatchOrder(game.teams.length, game.meetings);
  const byKey = new Map(gameMatches.map((m) => [matchKey(m.teamA, m.teamB, m.leg), m]));
  const order = pendingOrder ?? [...byKey.keys()];
  const matches = order.map((k) => byKey.get(k)).filter((m) => m !== undefined);
  // при уходе со вкладки введённый счёт не теряется: отложенные сохранения выполняются сразу
  const flushRef = useRef<() => void>(() => undefined);
  useEffect(() => () => flushRef.current(), []);

  const table = standings(
    game.teams.map((t) => t.no),
    game.results,
  );

  if (gameMatches.length === 0) return <Empty>Для матчей нужно хотя бы две команды</Empty>;

  const dropDraft = (key: string) =>
    setDrafts((d) => {
      const { [key]: _drop, ...rest } = d;
      return rest;
    });

  /**
   * Сохраняет введённый счёт встречи: оба поля — числа 0..99 → записать, оба пустые → стереть,
   * иначе (заполнено одно поле или неверное значение) ждём дальнейшего ввода.
   */
  const save = (key: string, slot: { teamA: number; teamB: number; leg: number }) => {
    const timer = timers.current.get(key);
    if (timer !== undefined) clearTimeout(timer);
    timers.current.delete(key);
    const draft = draftsRef.current[key];
    if (!draft) return;
    const current = gameRef.current.results.find((r) => matchKey(r.teamA, r.teamB, r.leg) === key);
    const ga = parseGoals(draft.a);
    const gb = parseGoals(draft.b);
    const empty = draft.a.trim() === '' && draft.b.trim() === '';
    let request: Promise<GameDetails> | null = null;
    if (empty) {
      if (current) request = api.clearMatchScore(gameRef.current.id, slot.teamA, slot.teamB, slot.leg);
      else dropDraft(key);
    } else if (ga !== null && gb !== null) {
      if (current?.goalsA === ga && current.goalsB === gb) dropDraft(key);
      else request = api.setMatchScore(gameRef.current.id, slot.teamA, slot.teamB, slot.leg, ga, gb);
    }
    request
      ?.then((g) => {
        onUpdateRef.current(g);
        // пока шёл запрос, могли ввести что-то ещё: тогда черновик остаётся до следующего сохранения
        if (draftsRef.current[key] === draft) dropDraft(key);
      })
      .catch((e: ApiError) => showToast(e.message));
  };

  const schedule = (key: string, slot: { teamA: number; teamB: number; leg: number }) => {
    const timer = timers.current.get(key);
    if (timer !== undefined) clearTimeout(timer);
    timers.current.set(
      key,
      setTimeout(() => save(key, slot), SAVE_DELAY_MS),
    );
  };

  flushRef.current = () => {
    for (const key of [...timers.current.keys()]) {
      const m = byKey.get(key);
      if (m) save(key, m);
    }
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
          const slot = { teamA, teamB, leg };
          const setValue = (side: 'a' | 'b', v: string) => {
            const next = { ...value, [side]: v };
            draftsRef.current = { ...draftsRef.current, [key]: next };
            setDrafts(draftsRef.current);
            schedule(key, slot);
          };
          const label = `Матч ${index + 1}: ${a.name} — ${b.name}`;
          const goalsInput = (side: 'a' | 'b', team: Team) => {
            const invalid = value[side].trim() !== '' && parseGoals(value[side]) === null;
            return (
              <input
                className={`match__goals${invalid ? ' match__goals--invalid' : ''}`}
                inputMode="numeric"
                maxLength={2}
                aria-label={`Голы ${team.name}`}
                aria-invalid={invalid}
                value={value[side]}
                onChange={(e) => setValue(side, e.target.value)}
                onBlur={() => timers.current.has(key) && save(key, slot)}
              />
            );
          };
          const row = (
            <div className="match" role="group" aria-label={label} data-testid="match">
              <span className="match__no" title={game.meetings > 1 ? `Встреча ${leg}` : undefined}>
                {index + 1}
              </span>
              <TeamName team={a} side="a" />
              {editable ? (
                <span className="match__score">
                  {goalsInput('a', a)}
                  <span aria-hidden="true">:</span>
                  {goalsInput('b', b)}
                </span>
              ) : (
                <span className="match__score">
                  <span className="match__score--text" data-testid="match-goals">
                    {result?.goalsA ?? '–'}
                  </span>
                  <span aria-hidden="true">:</span>
                  <span className="match__score--text" data-testid="match-goals">
                    {result?.goalsB ?? '–'}
                  </span>
                </span>
              )}
              <TeamName team={b} side="b" />
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
