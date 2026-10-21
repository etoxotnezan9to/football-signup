import { useState } from 'react';
import { Button, CustomSelect, FormItem } from '@vkontakte/vkui';
import type { GameDetails, GameSummary } from '@football/shared';
import { api, ApiError } from '../api.ts';
import { useApp } from '../context.ts';
import { gameLabel } from '../format.ts';

/**
 * «Копировать сбор» в форме нового сбора: кнопка открывает список моих сборов (включая прошедшие),
 * выбранный сбор загружается целиком и передаётся в onPick; форма берёт из него только настройки.
 */
export function CopyGatheringPicker({ onPick }: { onPick: (game: GameDetails) => void }) {
  const { showToast } = useApp();
  const [games, setGames] = useState<GameSummary[] | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const show = () => {
    setOpen(true);
    if (games) return;
    api
      .myOrganized()
      .then((r) => setGames(r.items))
      .catch((e: unknown) => {
        setGames([]);
        showToast(e instanceof ApiError ? e.message : 'Не удалось загрузить сборы');
      });
  };

  const pick = (value: string | null) => {
    if (value === null || value === '') return;
    setBusy(true);
    api
      .getGame(Number(value))
      .then((g) => {
        onPick(g);
        setOpen(false);
        showToast(`Настройки скопированы из сбора ${gameLabel(g)}`);
      })
      .catch((e: unknown) => showToast(e instanceof ApiError ? e.message : 'Не удалось загрузить сбор'))
      .finally(() => setBusy(false));
  };

  if (!open) {
    return (
      <FormItem>
        <Button size="m" mode="secondary" stretched onClick={show}>
          Копировать сбор
        </Button>
      </FormItem>
    );
  }

  return (
    <FormItem
      htmlFor="copyGathering"
      top="Копировать сбор"
      bottom="Копируются место, команды, игроки, встречи, взнос, реквизиты, контакт и описание; время начала — без даты. Состав, команды и результаты не копируются"
    >
      <CustomSelect
        id="copyGathering"
        searchable
        placeholder={games === null ? 'Загрузка…' : 'Выберите сбор'}
        emptyText="У вас пока нет сборов"
        fetching={games === null}
        disabled={busy}
        options={(games ?? []).map((g) => ({
          value: String(g.id),
          label: gameLabel(g),
          ...(g.status === 'cancelled' ? { description: 'отменён' } : {}),
        }))}
        value={null}
        onChange={(_e, value) => pick(value === null ? null : String(value))}
      />
    </FormItem>
  );
}
