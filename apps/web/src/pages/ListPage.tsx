import {
  Icon24ChevronLeftOutline,
  Icon24ChevronRightOutline,
  Icon28AddOutline,
  Icon28SlidersOutline,
} from '@vkontakte/icons';
import { useState } from 'react';
import type { GameSummary } from '@football/shared';
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
import {
  addDays,
  dayKey,
  dayLabel,
  groupByDay,
  initialWeekStart,
  parseDayKey,
  startOfWeek,
  weekDays,
  weekRangeLabel,
} from '../week.ts';

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

/** Сборы по дням недели: «+» прямо в карточке, обновление в реальном времени; фильтры — на отдельной странице. */
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
        <Empty>{active > 0 ? 'Нет сборов по выбранным фильтрам' : 'Пока нет предстоящих сборов. Создайте первый!'}</Empty>
      )}
      {data && data.length > 0 && (
        <WeekView
          games={data}
          showPast={filters.showPast}
          onOpen={(g) => navigate(routeToHash({ name: 'game', id: g.id }))}
          onPlus={(g) => openSignup(g.id, g.mySeats ?? 0)}
        />
      )}
    </>
  );
}

/**
 * Неделя Пн–Вс: у каждого дня его сборы или «Нет сборов». Стрелки листают недели;
 * назад от текущей — только с фильтром «прошедшие», вперёд — до недели последнего загруженного сбора.
 */
function WeekView({
  games,
  showPast,
  onOpen,
  onPlus,
}: {
  games: GameSummary[];
  showPast: boolean;
  onOpen: (g: GameSummary) => void;
  onPlus: (g: GameSummary) => void;
}) {
  // пока неделю не выбрали стрелками, она подстраивается под сборы (новый сбор может появиться в реальном времени)
  const [chosen, setChosen] = useState<string | null>(readWeek);
  const now = new Date();
  const current = startOfWeek(now);
  const weekStart = (chosen !== null ? parseDayKey(chosen) : null) ?? initialWeekStart(games, now);
  const lastGame = games.reduce((max, g) => Math.max(max, Date.parse(g.startsAt)), 0);
  const lastWeek = Math.max(current.getTime(), startOfWeek(new Date(lastGame)).getTime());
  const canPrev = showPast || weekStart.getTime() > current.getTime();
  const canNext = weekStart.getTime() < lastWeek;
  const go = (weeks: number) => {
    const key = dayKey(addDays(weekStart, weeks * 7));
    setChosen(key);
    saveWeek(key);
  };
  const byDay = groupByDay(games);
  const today = dayKey(now);

  return (
    <div className="week">
      <div className="week__nav">
        <IconButton label="Предыдущая неделя" disabled={!canPrev} onClick={() => go(-1)}>
          <Icon24ChevronLeftOutline />
        </IconButton>
        <div className="week__range" data-testid="week-range">
          {weekRangeLabel(weekStart, now)}
        </div>
        <IconButton label="Следующая неделя" disabled={!canNext} onClick={() => go(1)}>
          <Icon24ChevronRightOutline />
        </IconButton>
      </div>
      {weekDays(weekStart).map((day) => {
        const key = dayKey(day);
        const dayGames = byDay.get(key) ?? [];
        return (
          <section key={key} className={`week__day${key === today ? ' week__day--today' : ''}`}>
            <h3 className="week__day-title">{dayLabel(day, now)}</h3>
            {dayGames.length === 0 ? (
              <div className="week__empty">Нет сборов</div>
            ) : (
              dayGames.map((g) => (
                <GameCard key={g.id} game={g} timeOnly onOpen={() => onOpen(g)} onPlus={() => onPlus(g)} />
              ))
            )}
          </section>
        );
      })}
    </div>
  );
}

// Неделя, выбранная стрелками, запоминается на время сессии: после возврата из сбора она та же
const WEEK_KEY = 'mainWeek';

function readWeek(): string | null {
  try {
    return sessionStorage.getItem(WEEK_KEY);
  } catch {
    return null;
  }
}

function saveWeek(value: string): void {
  try {
    sessionStorage.setItem(WEEK_KEY, value);
  } catch {
    // ignore
  }
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
