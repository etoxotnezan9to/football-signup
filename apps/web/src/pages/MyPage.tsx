import { Group, Header, PanelHeader, PanelHeaderBack } from '@vkontakte/vkui';
import type { GameSummary } from '@football/shared';
import { Empty } from '../components/Empty.tsx';
import { GameCard } from '../components/GameCard.tsx';
import { useApp } from '../context.ts';
import { routeToHash } from '../format.ts';
import { useMyGames } from '../hooks.ts';

/** «Мои игры»: те, что я организую, и те, куда я записан. */
export function MyPage() {
  const { navigate } = useApp();
  const { data, error, loading, reload } = useMyGames();

  const list = (games: GameSummary[], emptyText: string) =>
    games.length === 0 ? (
      <Empty>{emptyText}</Empty>
    ) : (
      games.map((g) => (
        <GameCard key={g.id} game={g} onOpen={() => navigate(routeToHash({ name: 'game', id: g.id }))} />
      ))
    );

  return (
    <>
      <PanelHeader before={<PanelHeaderBack onClick={() => navigate(routeToHash({ name: 'list' }))} />}>
        Мои сборы
      </PanelHeader>
      {loading && <Empty loading />}
      {!loading && error && !data && <Empty error={error} onRetry={reload} />}
      {data && (
        <>
          <Group header={<Header>Организую</Header>}>
            {list(data.organized, 'Вы пока не создавали сборов')}
          </Group>
          <Group header={<Header>Записан</Header>}>{list(data.joined, 'Вы пока никуда не записаны')}</Group>
        </>
      )}
    </>
  );
}
