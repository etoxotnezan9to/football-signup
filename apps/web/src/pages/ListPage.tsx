import { Icon28AddOutline } from '@vkontakte/icons';
import { useState } from 'react';
import { CustomSelect, FormItem, IconButton, PanelHeader } from '@vkontakte/vkui';
import { Empty } from '../components/Empty.tsx';
import { GameCard } from '../components/GameCard.tsx';
import { MockBar } from '../components/MockBar.tsx';
import { NotificationsPrompt } from '../components/NotificationsPrompt.tsx';
import { useApp } from '../context.ts';
import { placeOptions, routeToHash } from '../format.ts';
import { useGames } from '../hooks.ts';
import { useSignupFlow } from '../signup.ts';

/** Список предстоящих игр: «+» прямо в карточке, обновление в реальном времени. */
export function ListPage() {
  const { navigate } = useApp();
  const { data, error, loading, reload } = useGames();
  const openSignup = useSignupFlow(() => reload());
  const [placeFilter, setPlaceFilter] = useState<number | null>(readPlaceFilter);

  const places = placeOptions(data ?? []);
  // если в выбранном месте игр не осталось, фильтр не применяется
  const activeFilter = placeFilter !== null && places.some((p) => p.id === placeFilter) ? placeFilter : null;
  const games = activeFilter === null ? data : data?.filter((g) => g.placeId === activeFilter);

  const changeFilter = (value: number | null) => {
    setPlaceFilter(value);
    savePlaceFilter(value);
  };

  return (
    <>
      <PanelHeader>Запись на футбол</PanelHeader>
      <div className="actions">
        {/* правая часть шапки в VK занята системными кнопками, поэтому «+» в правом верхнем углу под шапкой */}
        <IconButton
          className="actions__add"
          label="Создать игру"
          onClick={() => navigate(routeToHash({ name: 'create' }))}
        >
          <Icon28AddOutline />
        </IconButton>
      </div>
      <MockBar />
      <NotificationsPrompt />
      {places.length > 1 && (
        <FormItem htmlFor="placeFilter" top="Место">
          <CustomSelect
            id="placeFilter"
            searchable
            placeholder="Все места"
            allowClearButton
            options={places.map((p) => ({ value: String(p.id), label: p.name }))}
            value={activeFilter === null ? null : String(activeFilter)}
            onChange={(_e, value) => changeFilter(value === null || value === '' ? null : Number(value))}
          />
        </FormItem>
      )}
      {loading && <Empty loading />}
      {!loading && error && !data && <Empty error={error} onRetry={reload} />}
      {data && data.length === 0 && <Empty>Пока нет предстоящих игр. Создайте первую!</Empty>}
      {games?.map((g) => (
        <GameCard
          key={g.id}
          game={g}
          onOpen={() => navigate(routeToHash({ name: 'game', id: g.id }))}
          onPlus={() => openSignup(g.id, g.mySeats ?? 0)}
        />
      ))}
    </>
  );
}

// Выбранное место запоминается в браузере пользователя; при недоступном хранилище фильтр просто не сохраняется
const FILTER_KEY = 'placeFilter';

function readPlaceFilter(): number | null {
  try {
    const v = Number(localStorage.getItem(FILTER_KEY));
    return Number.isInteger(v) && v > 0 ? v : null;
  } catch {
    return null;
  }
}

function savePlaceFilter(value: number | null): void {
  try {
    if (value === null) localStorage.removeItem(FILTER_KEY);
    else localStorage.setItem(FILTER_KEY, String(value));
  } catch {
    // ignore
  }
}
