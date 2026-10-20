import { useEffect, useState } from 'react';
import { Button, FormItem, Group, Header, Input, Select } from '@vkontakte/vkui';
import { MAX_SEATS_PER_USER, type GameDetails } from '@football/shared';
import { api, ApiError } from '../api.ts';
import { useApp } from '../context.ts';

const MAX_PER_REQUEST = 50;

// Включён ли тестовый режим на сервере: спрашиваем один раз за запуск приложения
let testModePromise: Promise<boolean> | null = null;
function loadTestMode(): Promise<boolean> {
  testModePromise ??= api
    .getConfig()
    .then((c) => c.testMode)
    .catch(() => {
      testModePromise = null;
      return false;
    });
  return testModePromise;
}

/** Тестовый режим: организатор добавляет в игру сразу много тестовых игроков и может их убрать. */
export function TestPlayersPanel({ gameId, onChanged }: { gameId: number; onChanged: (g: GameDetails) => void }) {
  const { showToast } = useApp();
  const [enabled, setEnabled] = useState(false);
  const [count, setCount] = useState('10');
  const [seats, setSeats] = useState('1');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    void loadTestMode().then((v) => alive && setEnabled(v));
    return () => {
      alive = false;
    };
  }, []);

  if (!enabled) return null;

  const run = async (action: () => Promise<GameDetails>, done: string) => {
    setBusy(true);
    try {
      onChanged(await action());
      showToast(done);
    } catch (e) {
      showToast(e instanceof ApiError ? e.message : 'Не удалось выполнить действие');
    } finally {
      setBusy(false);
    }
  };

  const n = Number(count);
  const validCount = Number.isInteger(n) && n >= 1 && n <= MAX_PER_REQUEST;

  return (
    <Group header={<Header>🧪 Тестовый режим</Header>}>
      <div className="test-panel">
        <FormItem
          htmlFor="testCount"
          top="Тестовых игроков"
          status={validCount ? 'default' : 'error'}
          bottom={`От 1 до ${MAX_PER_REQUEST} за раз`}
        >
          <Input id="testCount" type="number" value={count} onChange={(e) => setCount(e.target.value)} />
        </FormItem>
        <FormItem htmlFor="testSeats" top="Мест у каждого">
          <Select
            id="testSeats"
            value={seats}
            onChange={(e) => setSeats(e.target.value)}
            options={Array.from({ length: MAX_SEATS_PER_USER }, (_, i) => ({
              value: String(i + 1),
              label: String(i + 1),
            }))}
          />
        </FormItem>
      </div>
      <div className="actions">
        <Button
          size="m"
          loading={busy}
          disabled={!validCount}
          onClick={() =>
            void run(() => api.addTestPlayers(gameId, n, Number(seats)), `Добавлено тестовых игроков: ${n}`)
          }
        >
          Добавить игроков
        </Button>
        <Button
          size="m"
          mode="secondary"
          appearance="negative"
          disabled={busy}
          onClick={() => void run(() => api.removeTestPlayers(gameId), 'Тестовые игроки убраны')}
        >
          Убрать тестовых
        </Button>
      </div>
    </Group>
  );
}
