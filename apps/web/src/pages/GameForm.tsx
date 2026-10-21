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
  DEFAULT_MEETINGS,
  DEFAULT_PLAYERS_PER_TEAM,
  DEFAULT_TEAMS,
  MAX_CAPACITY,
  MAX_MEETINGS,
  MAX_PLAYERS_PER_TEAM,
  MAX_TEAMS,
  MIN_MEETINGS,
  MIN_PLAYERS_PER_TEAM,
  MIN_TEAMS,
  gameCapacity,
  parseGameInput,
  type GameDetails,
  type GameInput,
  type Place,
} from '@football/shared';
import { api, ApiError } from '../api.ts';
import { CopyGatheringButton, CopyGatheringPicker } from '../components/CopyGatheringPicker.tsx';
import { Empty } from '../components/Empty.tsx';
import { PlaceForm } from '../components/PlaceForm.tsx';
import { useApp } from '../context.ts';
import { defaultStartsAt, fromLocalInput, nextWeekOf, routeToHash, toLocalInput } from '../format.ts';
import { useGame } from '../hooks.ts';

interface FormState {
  startsAt: string;
  /** id выбранного места строкой ('' — не выбрано) */
  placeId: string;
  teamsMax: string;
  playersPerTeam: string;
  meetings: string;
  feeRub: string;
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
  { key: 'teamsMax', label: 'Количество команд (макс)', type: 'number', hint: `От ${MIN_TEAMS} до ${MAX_TEAMS}` },
  {
    key: 'playersPerTeam',
    label: 'Игроков в команде',
    type: 'number',
    hint: `От ${MIN_PLAYERS_PER_TEAM} до ${MAX_PLAYERS_PER_TEAM}`,
  },
  {
    key: 'meetings',
    label: 'Количество встреч команд',
    type: 'number',
    hint: `Сколько раз каждая пара команд играет между собой, от ${MIN_MEETINGS} до ${MAX_MEETINGS}`,
  },
  { key: 'feeRub', label: 'Взнос, ₽', type: 'number' },
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
    teamsMax: String(g?.teamsMax ?? DEFAULT_TEAMS),
    playersPerTeam: String(g?.playersPerTeam ?? DEFAULT_PLAYERS_PER_TEAM),
    meetings: String(g?.meetings ?? DEFAULT_MEETINGS),
    feeRub: g ? String(g.feeRub) : '',
    description: g?.description ?? '',
    paymentInfo: g?.paymentInfo ?? '',
    organizerContact: g?.organizerContact ?? '',
  };
}

/**
 * Настройки сбора, который копируют: базовые поля, дата — через неделю после него. Состав, команды,
 * результаты и лучший игрок в форму не входят и не копируются.
 */
function copyForm(g: GameDetails): FormState {
  return { ...toForm(g), startsAt: nextWeekOf(g.startsAt, new Date()) };
}

/** Число из текстового поля; пустая строка и мусор дают NaN, чтобы валидатор показал ошибку, а не 0. */
function toNumber(s: string): number {
  return s.trim() === '' ? NaN : Number(s);
}

/** Подсказка под полем «Игроков в команде»: сколько мест в составе получится. */
function capacityHint(form: FormState): string | undefined {
  const teams = toNumber(form.teamsMax);
  const players = toNumber(form.playersPerTeam);
  if (!Number.isInteger(teams) || !Number.isInteger(players) || teams < 1 || players < 1) return undefined;
  const total = gameCapacity(teams, players);
  return total > MAX_CAPACITY
    ? `Мест в составе: ${total}, допустимо не больше ${MAX_CAPACITY}`
    : `Мест в составе: ${teams} × ${players} = ${total}`;
}

/** Форма создания (без `initial`) и редактирования игры. */
export function GameForm({ initial }: { initial?: GameDetails }) {
  const { navigate, showToast } = useApp();
  const [form, setForm] = useState<FormState>(() => toForm(initial));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [places, setPlaces] = useState<Place[] | null>(null);
  const [addingPlace, setAddingPlace] = useState(false);
  const [copying, setCopying] = useState(false);

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
      teamsMax: toNumber(form.teamsMax),
      playersPerTeam: toNumber(form.playersPerTeam),
      meetings: toNumber(form.meetings),
      feeRub: toNumber(form.feeRub),
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
        {initial ? (
          'Редактирование игры'
        ) : (
          <span className="copy-gathering__title">
            Новый сбор
            <CopyGatheringButton open={copying} onToggle={() => setCopying((v) => !v)} />
          </span>
        )}
      </PanelHeader>
      <Group>
        {!initial && copying && (
          <CopyGatheringPicker
            onPick={(g) => {
              setForm(copyForm(g));
              setErrors({});
            }}
            onClose={() => setCopying(false)}
          />
        )}
        {FIELDS.map((f) =>
          f.type === 'place' ? (
            <div key={f.key}>{renderPlace(f)}</div>
          ) : (
            <FormItem
              key={f.key}
              htmlFor={f.key}
              top={f.label}
              status={errors[f.key] ? 'error' : 'default'}
              bottom={errors[f.key] ?? (f.key === 'playersPerTeam' ? (capacityHint(form) ?? f.hint) : f.hint)}
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
