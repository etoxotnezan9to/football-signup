import { useEffect, useState } from 'react';
import { Avatar } from '@vkontakte/vkui';
import { percent, type RatingRow } from '@football/shared';
import { api, ApiError } from '../api.ts';
import { Empty } from './Empty.tsx';
import { fullName } from '../format.ts';

/** Вкладка «Рейтинг» на главном экране: игроки по сборам с сохранённым счётом. Загружается при открытии. */
export function RatingTab() {
  const [rows, setRows] = useState<RatingRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let alive = true;
    setError(null);
    api
      .rating()
      .then((r) => alive && setRows(r.items))
      .catch((e: unknown) => alive && setError(e instanceof ApiError ? e.message : 'Не удалось загрузить рейтинг'));
    return () => {
      alive = false;
    };
  }, [attempt]);

  if (error && !rows) return <Empty error={error} onRetry={() => setAttempt((n) => n + 1)} />;
  if (!rows) return <Empty loading />;
  if (rows.length === 0) {
    return <Empty>Рейтинг появится, когда в сборах будет сохранён счёт матчей</Empty>;
  }

  /** «3 (60%)»: количество и доля от сыгранного */
  const share = (n: number, total: number) => `${n} (${percent(n, total)}%)`;

  return (
    <div className="rating">
      <div className="results__table-wrap">
        <table className="standings rating__table" aria-label="Рейтинг игроков">
          <thead>
            <tr>
              <th scope="col">#</th>
              <th scope="col" className="standings__team">
                Игрок
              </th>
              <th scope="col" title="Сыграно матчей">
                Матчи
              </th>
              <th scope="col" title="Победы в матчах">
                В
              </th>
              <th scope="col" title="Ничьи в матчах">
                Н
              </th>
              <th scope="col" title="Поражения в матчах">
                П
              </th>
              <th scope="col" title="Участие в сборах">
                Сборы
              </th>
              <th scope="col" title="Победы в сборах: первое место команды">
                Победы в сборах
              </th>
              <th scope="col" title="Сколько раз был лучшим игроком сбора">
                Лучший игрок
              </th>
              <th scope="col" title="Персональные очки: 2 лучшему игроку сбора, иначе 1 за победу команды">
                Очки
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.user.vkId}>
                <td>{i + 1}</td>
                <th scope="row" className="standings__team">
                  <span className="rating__player">
                    <Avatar size={24} src={r.user.photoUrl ?? undefined} />
                    {fullName(r.user)}
                  </span>
                </th>
                <td>{r.matches.played}</td>
                <td>{share(r.matches.won, r.matches.played)}</td>
                <td>{share(r.matches.drawn, r.matches.played)}</td>
                <td>{share(r.matches.lost, r.matches.played)}</td>
                <td>{r.gatherings.played}</td>
                <td>{share(r.gatherings.won, r.gatherings.played)}</td>
                <td>{r.bestPlayer}</td>
                <td className="standings__points">{r.points}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="results__hint">
        Каждая встреча команд — отдельный матч. Победа в сборе — первое место команды в турнирной таблице сбора, за
        неё 1 очко; лучший игрок сбора получает 2 очка вместо этого (очки не складываются). Учитываются только
        записавшиеся, без их друзей «+1».
      </div>
    </div>
  );
}
