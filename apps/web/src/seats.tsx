import { Alert } from '@vkontakte/vkui';
import { MAX_SEATS_PER_USER } from '@football/shared';
import { seatsLabel } from './format.ts';

interface Options {
  /** Сколько мест у пользователя сейчас (0 — не записан) */
  current: number;
  onPick: (seats: number) => void;
  onLeave: () => void;
  onClose: () => void;
}

/** Выбор числа мест: «+N» при первой записи, «всего N» при изменении; отмена записи, если она есть. */
export function seatsPickerPopout({ current, onPick, onLeave, onClose }: Options) {
  const actions = [];
  for (let n = 1; n <= MAX_SEATS_PER_USER; n++) {
    actions.push({
      title: current > 0 ? `Всего ${seatsLabel(n)}${n === current ? ' (сейчас)' : ''}` : `+${n}`,
      mode: 'default' as const,
      action: () => onPick(n),
    });
  }
  if (current > 0) {
    // autoCloseDisabled: onLeave подменяет popout окном подтверждения, автозакрытие его бы сбросило
    actions.push({
      title: 'Отменить запись',
      mode: 'destructive' as const,
      action: onLeave,
      autoCloseDisabled: true,
    });
  }
  actions.push({ title: 'Закрыть', mode: 'cancel' as const });

  return (
    <Alert
      actions={actions}
      actionsLayout="vertical"
      onClose={onClose}
      title={current > 0 ? 'Изменить запись' : 'Сколько мест занять?'}
      description={`Не больше ${MAX_SEATS_PER_USER} мест на одного человека. Предоплата не возвращается при отмене записи.`}
    />
  );
}

export function confirmPopout(opts: {
  title: string;
  description?: string;
  confirmTitle: string;
  destructive?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Alert
      actions={[
        {
          title: opts.confirmTitle,
          mode: opts.destructive ? ('destructive' as const) : ('default' as const),
          action: opts.onConfirm,
        },
        { title: 'Отмена', mode: 'cancel' as const },
      ]}
      onClose={opts.onClose}
      title={opts.title}
      {...(opts.description ? { description: opts.description } : {})}
    />
  );
}

/** Меню организатора по строке состава: отметка оплаченных мест и удаление участника. */
export function entryMenuPopout(opts: {
  name: string;
  seats: number;
  paidSeats: number;
  onPaid: (paidSeats: number) => void;
  onRemove: () => void;
  onClose: () => void;
}) {
  const actions = [];
  for (let n = 0; n <= opts.seats; n++) {
    const base = n === 0 ? 'Не оплачено' : `Оплачено: ${n} из ${opts.seats}`;
    actions.push({
      title: n === opts.paidSeats ? `${base} ✓` : base,
      mode: 'default' as const,
      action: () => opts.onPaid(n),
    });
  }
  // autoCloseDisabled: onRemove подменяет popout окном подтверждения, автозакрытие его бы сбросило
  actions.push({
    title: 'Удалить из списка',
    mode: 'destructive' as const,
    action: opts.onRemove,
    autoCloseDisabled: true,
  });
  actions.push({ title: 'Закрыть', mode: 'cancel' as const });

  return (
    <Alert
      actions={actions}
      actionsLayout="vertical"
      onClose={opts.onClose}
      title={opts.name}
      description={`Записано мест: ${opts.seats}. Оплату отмечает организатор вручную.`}
    />
  );
}
