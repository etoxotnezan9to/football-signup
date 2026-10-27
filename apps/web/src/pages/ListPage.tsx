import { Icon28AddOutline } from '@vkontakte/icons';
import { useState } from 'react';
import { CustomSelect, FormItem, IconButton, PanelHeader, Tabs, TabsItem } from '@vkontakte/vkui';
import { Empty } from '../components/Empty.tsx';
import { GameCard } from '../components/GameCard.tsx';
import { MockBar } from '../components/MockBar.tsx';
import { NotificationsPrompt } from '../components/NotificationsPrompt.tsx';
import { RatingTab } from '../components/RatingTab.tsx';
import { useApp } from '../context.ts';
import { placeOptions, routeToHash } from '../format.ts';
import { useGames } from '../hooks.ts';
import { useSignupFlow } from '../signup.ts';

type MainTab = 'games' | 'rating';

/** Главный экран: вкладки «Сборы» (список игр) и «Рейтинг» игроков. */
export function ListPage() {
  const [tab, setTab] = useState<MainTab>(readMainTab);
  const changeTab = (value: MainTab) => {
    setTab(value);
    saveMainTab(value);
  };
  return (
    <>
      <PanelHeader>
        {/* вкладки прижаты влево: справа в шапке VK системные кнопки */}
        <Tabs layoutFillMode="shrinked">
          <TabsItem selected={tab === 'games'} onClick={() => changeTab('games')} aria-controls="tab-games">
            Сборы
          </TabsItem>
          <TabsItem selected={tab === 'rating'} onClick={() => changeTab('rating')} aria-controls="tab-rating">
            Рейтинг
          </TabsItem>
        </Tabs>
      </PanelHeader>
      {tab === 'rating' ? (
        <div id="tab-rating" role="tabpanel">
          <RatingTab />
        </div>
      ) : (
        <div id="tab-games" role="tabpanel">
          <GamesTab />
        </div>
      )}
    </>
  );
}

/** Список предстоящих игр: «+» прямо в карточке, обновление в реальном времени. */
function GamesTab() {
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
      <div className="actions">
        {/* правая часть шапки в VK занята системными кнопками, поэтому «+» в правом верхнем углу под шапкой */}
        <IconButton
          className="actions__add"
          label="Создать сбор"
          onClick={() => navigate(routeToHash({ name: 'create' }))}
        >
          <Icon28AddOutline />
        </IconButton>
      </div>
      <MockBar />
      <NotificationsPrompt />
      {places.length > 1 && (
        <FormItem htmlFor="placeFilter" top="Арена">
          <CustomSelect
            id="placeFilter"
            searchable
            placeholder="Все арены"
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

// Открытая вкладка главного экрана запоминается на время сессии: после возврата из игры она та же
const TAB_KEY = 'mainTab';

function readMainTab(): MainTab {
  try {
    return sessionStorage.getItem(TAB_KEY) === 'rating' ? 'rating' : 'games';
  } catch {
    return 'games';
  }
}

function saveMainTab(value: MainTab): void {
  try {
    sessionStorage.setItem(TAB_KEY, value);
  } catch {
    // ignore
  }
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
