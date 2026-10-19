import { Button, PanelHeader } from '@vkontakte/vkui';
import { Empty } from '../components/Empty.tsx';
import { GameCard } from '../components/GameCard.tsx';
import { MockBar } from '../components/MockBar.tsx';
import { NotificationsPrompt } from '../components/NotificationsPrompt.tsx';
import { useApp } from '../context.ts';
import { routeToHash } from '../format.ts';
import { useGames } from '../hooks.ts';
import { useSignupFlow } from '../signup.ts';

/** Список предстоящих игр: «+» прямо в карточке, обновление в реальном времени. */
export function ListPage() {
  const { navigate } = useApp();
  const { data, error, loading, reload } = useGames();
  const openSignup = useSignupFlow(() => reload());

  return (
    <>
      <PanelHeader>Запись на футбол</PanelHeader>
      <div className="actions">
        <Button size="m" onClick={() => navigate(routeToHash({ name: 'create' }))}>
          Создать игру
        </Button>
        <Button size="m" mode="secondary" onClick={() => navigate(routeToHash({ name: 'my' }))}>
          Мои игры
        </Button>
      </div>
      <MockBar />
      <NotificationsPrompt />
      {loading && <Empty loading />}
      {!loading && error && !data && <Empty error={error} onRetry={reload} />}
      {data && data.length === 0 && <Empty>Пока нет предстоящих игр. Создайте первую!</Empty>}
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
