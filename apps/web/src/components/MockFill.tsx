import { useState } from 'react';
import { Button } from '@vkontakte/vkui';
import type { GameDetails } from '@football/shared';
import { api, type ApiError } from '../api.ts';
import { useApp } from '../context.ts';
import { MOCK_FILL_DEFAULT, MOCK_FILL_MAX, mockAuthHeader, nextMockPlayers } from '../mock-players.ts';

/** Только тестовый режим: заполняет игру тестовыми игроками по одному месту, чтобы проверить большой состав и очередь. */
export function MockFill({ game, onUpdate }: { game: GameDetails; onUpdate: (g: GameDetails) => void }) {
  const { session, showToast } = useApp();
  const [count, setCount] = useState(MOCK_FILL_DEFAULT);
  const [done, setDone] = useState<number | null>(null);
  if (!session.mock) return null;

  const busy = done !== null;
  const run = async () => {
    // по одному запросу подряд: так порядок в очереди совпадает с номерами игроков
    const players = nextMockPlayers(
      game.roster.map((r) => r.user.vkId),
      count,
    );
    setDone(0);
    let added = 0;
    try {
      for (const p of players) {
        const res = await api.putSignupAs(mockAuthHeader(p), game.id, 1);
        onUpdate(res.game);
        added += 1;
        setDone(added);
      }
      showToast(`Добавлено тестовых игроков: ${added}`);
    } catch (e) {
      showToast(`Добавлено ${added}, затем ошибка: ${(e as ApiError).message}`);
    } finally {
      setDone(null);
    }
  };

  return (
    <div className="mock-bar">
      Тестовый режим: добавить
      <input
        type="number"
        aria-label="Число тестовых игроков"
        min={1}
        max={MOCK_FILL_MAX}
        value={count}
        disabled={busy}
        onChange={(e) => setCount(Math.min(MOCK_FILL_MAX, Math.max(1, Math.trunc(Number(e.target.value)) || 1)))}
        style={{ width: 56 }}
      />
      <Button size="s" mode="outline" loading={busy} disabled={busy} onClick={() => void run()}>
        {busy ? `${done}/${count}` : 'тестовых игроков'}
      </Button>
    </div>
  );
}
