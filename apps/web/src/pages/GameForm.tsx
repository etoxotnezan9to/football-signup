import { useEffect, useState } from 'react';
import {
  Button,
  CustomSelect,
  FormItem,
  Group,
  IconButton,
  Input,
  PanelHeader,
  PanelHeaderBack,
  Textarea,
} from '@vkontakte/vkui';
import { Icon28AddOutline } from '@vkontakte/icons';
import {
  MAX_PLAYERS_PER_TEAM,
  MAX_TEAMS,
  MIN_PLAYERS_PER_TEAM,
  MIN_TEAMS,
  parseGameInput,
  type GameDetails,
  type GameInput,
  type Place,
} from '@football/shared';
import { api, ApiError } from '../api.ts';
import { Empty } from '../components/Empty.tsx';
import { PlaceForm } from '../components/PlaceForm.tsx';
import { useApp } from '../context.ts';
import { defaultStartsAt, fromLocalInput, routeToHash, toLocalInput } from '../format.ts';
import { useGame } from '../hooks.ts';

interface FormState {
  startsAt: string;
  /** id выбранного места строкой ('' — не выбрано) */
  placeId: string;
  teamsMax: string;
  playersPerTeam: string;
  feeRub: string;
  capacity: string;
  description: string;
  paymentInfo: string;
  organizerContact: string;
}

interface Field {
  key: keyof FormState;
  label: string;
  type?: 'text' | 'datetime-local' | 'number' | 'place';
  multiline?: boolean;
  hint?: string;
}

const FIELDS: Field[] = [
  { key: 'startsAt', label: 'Дата и время начала', type: 'datetime-local' },
  { key: 'placeId', label: 'Место', type: 'place', hint: 'Выберите из списка или добавьте новое кнопкой +' },
  { key: 'teamsMax', label: 'Количество команд (макс)', type: 'number', hint: `От ${MIN_TEAMS} до ${MAX_TEAMS}, можно не указывать` },
  {
    key: 'playersPerTeam',
    label: 'Игроков в команде',
    type: 'number',
    hint: `От ${MIN_PLAYERS_PER_TEAM} до ${MAX_PLAYERS_PER_TEAM}, можно не указывать`,
  },
  { key: 'feeRub', label: 'Взнос, ₽', type: 'number' },
  { key: 'capacity', label: 'Число мест в составе', type: 'number', hint: 'От 2 до 60' },
  {
    key: 'paymentInfo',
    label: 'Реквизиты для предоплаты',
    hint: 'Телефон и банк. Оплату вы отмечаете вручную',
  },
  { key: 'organizerContact', label: 'Контакт для чека', hint: 'Ссылка VK или телефон' },
  { key: 'description', label: 'Описание', multiline: true },
];

function toForm(g?: GameDetails): FormState {
  return {
    startsAt: g ? toLocalInput(g.startsAt) : defaultStartsAt(new Date()),
    placeId: g ? String(g.placeId) : '',
    teamsMax: g?.teamsMax != null ? String(g.teamsMax) : '',
    playersPerTeam: g?.playersPerTeam != null ? String(g.playersPerTeam) : '',
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

/** Необязательное число: пустое поле означает «не указано» (null). */
function toOptionalNumber(s: string): number | null {
  return s.trim() === '' ? null : Number(s);
}

/** Форма создания (без `initial`) и редактирования игры. */
export function GameForm({ initial }: { initial?: GameDetails }) {
  const { navigate, showToast } = useApp();
  const [form, setForm] = useState<FormState>(() => toForm(initial));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [places, setPlaces] = useState<Place[] | null>(null);
  const [addingPlace, setAddingPlace] = useState(false);

  useEffect(() => {
    let alive = true;
    api
      .listPlaces()
      .then((r) => alive && setPlaces(r.items))
      .catch(() => alive && setPlaces([]));
    return () => {
      alive = false;
    };
  }, []);

  const onPlaceCreated = (place: Place) => {
    setPlaces((prev) => {
      const rest = (prev ?? []).filter((p) => p.id !== place.id);
      return [...rest, place].sort(
        (a, b) => a.name.localeCompare(b.name, 'ru') || a.address.localeCompare(b.address, 'ru'),
      );
    });
    setForm((f) => ({ ...f, placeId: String(place.id) }));
    setErrors((e) => {
      const { placeId: _drop, ...rest } = e;
      return rest;
    });
    setAddingPlace(false);
  };

  const renderPlace = (f: Field) => (
    <>
      <FormItem
        key={f.key}
        htmlFor={f.key}
        top={f.label}
        status={errors[f.key] ? 'error' : 'default'}
        bottom={errors[f.key] ?? f.hint}
      >
        <div className="place-picker">
          <CustomSelect
            className="place-picker__select"
            id={f.key}
            searchable
            placeholder={places === null ? 'Загрузка…' : 'Выберите место'}
            emptyText="Мест пока нет, добавьте новое"
            fetching={places === null}
            options={(places ?? []).map((p) => ({
              value: String(p.id),
              label: p.name,
              description: p.address,
            }))}
            value={form.placeId === '' ? null : form.placeId}
            onChange={(_e, value) => setForm({ ...form, placeId: value === null ? '' : String(value) })}
          />
          <IconButton
            className="place-picker__add"
            label="Добавить место"
            aria-expanded={addingPlace}
            onClick={() => setAddingPlace((v) => !v)}
          >
            <Icon28AddOutline />
          </IconButton>
        </div>
      </FormItem>
      {addingPlace && <PlaceForm onCreated={onPlaceCreated} onCancel={() => setAddingPlace(false)} />}
    </>
  );

  const back = () => navigate(routeToHash(initial ? { name: 'game', id: initial.id } : { name: 'list' }));

  const submit = async () => {
    const parsed = parseGameInput({
      startsAt: fromLocalInput(form.startsAt),
      placeId: toNumber(form.placeId),
      teamsMax: toOptionalNumber(form.teamsMax),
      playersPerTeam: toOptionalNumber(form.playersPerTeam),
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
      const patch: Record<string, string | number | null> = {};
      for (const key of Object.keys(parsed.value) as (keyof GameInput)[]) {
        const next = parsed.value[key];
        const before = initial[key];
        const same =
          key === 'startsAt' ? Date.parse(String(before)) === Date.parse(String(next)) : before === next;
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
        {FIELDS.map((f) =>
          f.type === 'place' ? (
            <div key={f.key}>{renderPlace(f)}</div>
          ) : (
            <FormItem
              key={f.key}
              htmlFor={f.key}
              top={f.label}
              status={errors[f.key] ? 'error' : 'default'}
              bottom={errors[f.key] ?? f.hint}
            >
              {f.multiline ? (
                <Textarea
                  id={f.key}
                  value={form[f.key]}
                  onChange={(e) => setForm({ ...form, [f.key]: e.target.value })}
                />
              ) : (
                <Input
                  id={f.key}
                  type={f.type ?? 'text'}
                  value={form[f.key]}
                  onChange={(e) => setForm({ ...form, [f.key]: e.target.value })}
                />
              )}
            </FormItem>
          ),
        )}
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
