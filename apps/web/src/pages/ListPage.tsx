import { Icon28AddOutline, Icon28SlidersOutline } from '@vkontakte/icons';
import { useState } from 'react';
import { IconButton, PanelHeader, Tabs, TabsItem } from '@vkontakte/vkui';
import { Empty } from '../components/Empty.tsx';
import { GameCard } from '../components/GameCard.tsx';
import { MockBar } from '../components/MockBar.tsx';
import { NotificationsPrompt } from '../components/NotificationsPrompt.tsx';
import { RatingTab } from '../components/RatingTab.tsx';
import { useApp } from '../context.ts';
import { activeFiltersCount, useListFilters } from '../filters.ts';
import { routeToHash } from '../format.ts';
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

/** Список сборов: «+» прямо в карточке, обновление в реальном времени; фильтры — на отдельной странице. */
function GamesTab() {
  const { navigate } = useApp();
  const { data, error, loading, reload } = useGames();
  const openSignup = useSignupFlow(() => reload());
  const filters = useListFilters();
  const active = activeFiltersCount(filters);

  return (
    <>
      <div className="actions">
        {/* правая часть шапки в VK занята системными кнопками, поэтому кнопки в правом верхнем углу под шапкой */}
        <IconButton
          className="actions__add list-filter"
          label={active > 0 ? `Фильтры (включено: ${active})` : 'Фильтры'}
          onClick={() => navigate(routeToHash({ name: 'filters' }))}
        >
          <Icon28SlidersOutline />
          {active > 0 && (
            <span className="list-filter__badge" aria-hidden="true">
              {active}
            </span>
          )}
        </IconButton>
        <IconButton className="actions__icon" label="Создать сбор" onClick={() => navigate(routeToHash({ name: 'create' }))}>
          <Icon28AddOutline />
        </IconButton>
      </div>
      <MockBar />
      <NotificationsPrompt />
      {loading && <Empty loading />}
      {!loading && error && !data && <Empty error={error} onRetry={reload} />}
      {data && data.length === 0 && (
        <Empty>{active > 0 ? 'Нет сборов по выбранным фильтрам' : 'Пока нет предстоящих игр. Создайте первую!'}</Empty>
      )}
      {data?.map((g) => (
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
