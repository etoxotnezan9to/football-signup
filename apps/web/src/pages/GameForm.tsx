import { useState } from 'react';
import { Button, FormItem, Group, Input, PanelHeader, PanelHeaderBack, Textarea } from '@vkontakte/vkui';
import { parseGameInput, type GameDetails, type GameInput } from '@football/shared';
import { api, ApiError } from '../api.ts';
import { Empty } from '../components/Empty.tsx';
import { useApp } from '../context.ts';
import { defaultStartsAt, fromLocalInput, routeToHash, toLocalInput } from '../format.ts';
import { useGame } from '../hooks.ts';

interface FormState {
  title: string;
  startsAt: string;
  venue: string;
  address: string;
  format: string;
  feeRub: string;
  capacity: string;
  description: string;
  paymentInfo: string;
  organizerContact: string;
}

interface Field {
  key: keyof FormState;
  label: string;
  type?: 'text' | 'datetime-local' | 'number';
  multiline?: boolean;
  hint?: string;
}

const FIELDS: Field[] = [
  { key: 'title', label: 'Название', hint: 'Например: Футбольный сбор' },
  { key: 'startsAt', label: 'Дата и время начала', type: 'datetime-local' },
  { key: 'venue', label: 'Площадка', hint: 'Например: Ф.Ц. «Орловский»' },
  { key: 'address', label: 'Адрес' },
  { key: 'format', label: 'Формат', hint: 'Например: 6х6, 3 команды, 6 игр по 9 минут' },
  { key: 'feeRub', label: 'Взнос, ₽', type: 'number' },
  { key: 'capacity', label: 'Число мест в составе', type: 'number', hint: 'От 2 до 60' },
  { key: 'paymentInfo', label: 'Реквизиты для предоплаты', hint: 'Телефон и банк. Оплату вы отмечаете вручную' },
  { key: 'organizerContact', label: 'Контакт для чека', hint: 'Ссылка VK или телефон' },
  { key: 'description', label: 'Описание', multiline: true },
];

function toForm(g?: GameDetails): FormState {
  return {
    title: g?.title ?? '',
    startsAt: g ? toLocalInput(g.startsAt) : defaultStartsAt(new Date()),
    venue: g?.venue ?? '',
    address: g?.address ?? '',
    format: g?.format ?? '',
    feeRub: g ? String(g.feeRub) : '',
    capacity: g ? String(g.capacity) : '',
    description: g?.description ?? '',
    paymentInfo: g?.paymentInfo ?? '',
    organizerContact: g?.organizerContact ?? '',
  };
}

/** Число из текстового поля; пустая строка и мусор дают NaN, чтобы валидатор показал ошибку, а не 0. */
function toNumber(s: string): number {
  return s.trim() === '' ? NaN : Number(s);
}

/** Форма создания (без `initial`) и редактирования игры. */
export function GameForm({ initial }: { initial?: GameDetails }) {
  const { navigate, showToast } = useApp();
  const [form, setForm] = useState<FormState>(() => toForm(initial));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const back = () =>
    navigate(routeToHash(initial ? { name: 'game', id: initial.id } : { name: 'list' }));

  const submit = async () => {
    const parsed = parseGameInput({
      title: form.title,
      startsAt: fromLocalInput(form.startsAt),
      venue: form.venue,
      address: form.address,
      format: form.format,
      feeRub: toNumber(form.feeRub),
      capacity: toNumber(form.capacity),
      description: form.description,
      paymentInfo: form.paymentInfo,
      organizerContact: form.organizerContact,
    });
    if (!parsed.ok) {
      setErrors(parsed.errors);
      showToast('Проверьте поля формы');
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      if (!initial) {
        const created = await api.createGame(parsed.value);
        showToast('Игра создана');
        navigate(routeToHash({ name: 'game', id: created.id }));
        return;
      }
      // при редактировании отправляем только изменённые поля (неизменённое прошедшее время не должно давать ошибку)
      const patch: Record<string, string | number> = {};
      for (const key of Object.keys(parsed.value) as (keyof GameInput)[]) {
        const next = parsed.value[key];
        const before = initial[key];
        const same = key === 'startsAt' ? Date.parse(String(before)) === Date.parse(String(next)) : before === next;
        if (!same) patch[key] = next;
      }
      if (Object.keys(patch).length === 0) {
        showToast('Изменений нет');
      } else {
        await api.updateGame(initial.id, patch);
        showToast('Изменения сохранены');
      }
      navigate(routeToHash({ name: 'game', id: initial.id }));
    } catch (e) {
      if (e instanceof ApiError) {
        if (e.details) setErrors(e.details);
        showToast(e.message);
      } else {
        showToast('Не удалось сохранить игру');
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PanelHeader before={<PanelHeaderBack onClick={back} />}>
        {initial ? 'Редактирование игры' : 'Новая игра'}
      </PanelHeader>
      <Group>
        {FIELDS.map((f) => (
          <FormItem
            key={f.key}
            htmlFor={f.key}
            top={f.label}
            status={errors[f.key] ? 'error' : 'default'}
            bottom={errors[f.key] ?? f.hint}
          >
            {f.multiline ? (
              <Textarea id={f.key} value={form[f.key]} onChange={(e) => setForm({ ...form, [f.key]: e.target.value })} />
            ) : (
              <Input
                id={f.key}
                type={f.type ?? 'text'}
                value={form[f.key]}
                onChange={(e) => setForm({ ...form, [f.key]: e.target.value })}
              />
            )}
          </FormItem>
        ))}
        <FormItem>
          <Button size="l" stretched loading={busy} onClick={() => void submit()}>
            {initial ? 'Сохранить' : 'Создать игру'}
          </Button>
        </FormItem>
      </Group>
    </>
  );
}

export function EditGamePage({ id }: { id: number }) {
  if (id <= 0) return null;
  return <EditGameView id={id} />;
}

function EditGameView({ id }: { id: number }) {
  const { session, navigate } = useApp();
  const { data: game, error, loading, reload } = useGame(id);
  const back = () => navigate(routeToHash({ name: 'game', id }));

  if (loading) return <Empty loading />;
  if (!game) return <Empty error={error ?? 'Игра не найдена'} onRetry={reload} />;
  if (game.organizer.vkId !== session.user.id || game.status !== 'active') {
    return (
      <>
        <PanelHeader before={<PanelHeaderBack onClick={back} />}>Редактирование игры</PanelHeader>
        <Empty>Редактировать может только организатор, и только активную игру</Empty>
      </>
    );
  }
  // key: форма инициализируется один раз; обновления состава по сокету не должны затирать ввод
  return <GameForm key={game.id} initial={game} />;
}
