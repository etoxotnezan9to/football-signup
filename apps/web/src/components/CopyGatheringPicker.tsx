import { useEffect, useState } from 'react';
import { CustomSelect, FormItem, IconButton, Tooltip } from '@vkontakte/vkui';
import { Icon24CopyOutline } from '@vkontakte/icons';
import type { GameDetails, GameSummary } from '@football/shared';
import { api, ApiError } from '../api.ts';
import { useApp } from '../context.ts';
import { gameLabel } from '../format.ts';

export const COPY_TOOLTIP = 'Копировать инфу из существующего сбора';

/** Иконка «Копировать сбор» рядом с заголовком «Новый сбор»: открывает и закрывает список сборов. */
export function CopyGatheringButton({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  return (
    <Tooltip description={COPY_TOOLTIP} placement="bottom">
      <IconButton label="Копировать сбор" aria-expanded={open} onClick={onToggle} className="copy-gathering__button">
        <Icon24CopyOutline />
      </IconButton>
    </Tooltip>
  );
}

/**
 * Список моих сборов (включая прошедшие) для копирования: выбранный сбор загружается целиком
 * и передаётся в onPick; форма берёт из него только настройки.
 */
export function CopyGatheringPicker({
  onPick,
  onClose,
  excludeId,
}: {
  onPick: (game: GameDetails) => void;
  onClose: () => void;
  /** Редактируемый сбор: копировать его в самого себя незачем */
  excludeId?: number;
}) {
  const { showToast } = useApp();
  const [games, setGames] = useState<GameSummary[] | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    api
      .myOrganized()
      .then((r) => alive && setGames(r.items))
      .catch((e: unknown) => {
        if (!alive) return;
        setGames([]);
        showToast(e instanceof ApiError ? e.message : 'Не удалось загрузить сборы');
      });
    return () => {
      alive = false;
    };
  }, [showToast]);

  const pick = (value: string | null) => {
    if (value === null || value === '') return;
    setBusy(true);
    api
      .getGame(Number(value))
      .then((g) => {
        onPick(g);
        onClose();
        showToast(`Настройки скопированы из сбора ${gameLabel(g)}`);
      })
      .catch((e: unknown) => showToast(e instanceof ApiError ? e.message : 'Не удалось загрузить сбор'))
      .finally(() => setBusy(false));
  };

  return (
    <FormItem
      htmlFor="copyGathering"
      top="Копировать сбор"
      bottom={
        excludeId === undefined
          ? 'Копируются арена, команды, игроки, встречи, взнос, реквизиты, контакт и описание; дата — через неделю после выбранного сбора. Состав, команды и результаты не копируются'
          : 'Копируются арена, команды, игроки, встречи, взнос, реквизиты, контакт и описание; дата сбора не меняется. Состав, команды и результаты не копируются'
      }
    >
      <CustomSelect
        id="copyGathering"
        searchable
        placeholder={games === null ? 'Загрузка…' : 'Выберите сбор'}
        emptyText="У вас пока нет сборов"
        fetching={games === null}
        disabled={busy}
        options={(games ?? [])
          .filter((g) => g.id !== excludeId)
          .map((g) => ({
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
