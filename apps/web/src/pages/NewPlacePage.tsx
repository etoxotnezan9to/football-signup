import { Group, PanelHeader, PanelHeaderBack } from '@vkontakte/vkui';
import { PlaceForm } from '../components/PlaceForm.tsx';
import { useApp } from '../context.ts';
import { routeToHash } from '../format.ts';

/** Отдельная страница создания места. После сохранения место доступно в форме игры у всех. */
export function NewPlacePage() {
  const { navigate } = useApp();
  const back = () => navigate(routeToHash({ name: 'list' }));
  return (
    <>
      <PanelHeader before={<PanelHeaderBack onClick={back} />}>Новое место</PanelHeader>
      <Group>
        <PlaceForm onCreated={back} />
      </Group>
    </>
  );
}
