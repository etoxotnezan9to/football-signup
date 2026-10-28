import { useRef, useState, type DragEvent, type KeyboardEvent, type PointerEvent } from 'react';
import { Icon24Reorder, Icon24ReorderIos } from '@vkontakte/icons';
import { Alert, Avatar, Input, usePlatform } from '@vkontakte/vkui';
import { TEAM_COLORS, TEAM_NAME_MAX, type GameDetails, type Team, type TeamSeat } from '@football/shared';
import { api, type ApiError } from '../api.ts';
import { Empty } from './Empty.tsx';
import { useApp } from '../context.ts';
import { openProfile, profileUrl, seatName } from '../format.ts';
import { PlayerLink } from './PlayerLink.tsx';

/** Куда бросили место: номер команды или null — «не распределены». */
type Target = number | null;

/** Перетаскивание пальцем за значок ☰: какое место, откуда и где сейчас палец. */
interface TouchDrag {
  seat: TeamSeat;
  from: Target;
  name: string;
  photoUrl: string | null;
  x: number;
  y: number;
}

/** Зона под точкой экрана: data-drop у секции команды («none» или номер) и можно ли туда бросить. */
function dropTargetAt(x: number, y: number): { target: Target; accepts: boolean } | undefined {
  const el = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-drop]');
  if (!el) return undefined;
  const raw = el.dataset.drop!;
  return { target: raw === 'none' ? null : Number(raw), accepts: el.dataset.accepts === 'true' };
}

/** У края экрана во время перетаскивания страница прокручивается сама, чтобы дотянуться до дальней команды. */
const EDGE = 70;

/**
 * Вкладка «Команды». Новые игроки состава распределяются сервером автоматически; организатор перетаскивает
 * игроков между командами (мышью), а на телефоне, где перетаскивания нет, нажимает на игрока и выбирает команду.
 * Остальные только смотрят.
 */
export function TeamsTab({
  game,
  editable,
  onUpdate,
}: {
  game: GameDetails;
  editable: boolean;
  onUpdate: (g: GameDetails) => void;
}) {
  const { showToast, setPopout } = useApp();
  const platform = usePlatform();
  const [dragging, setDragging] = useState<TeamSeat | null>(null);
  const [touchDrag, setTouchDrag] = useState<TouchDrag | null>(null);
  const touchRef = useRef<TouchDrag | null>(null);
  const [over, setOver] = useState<Target | undefined>(undefined);
  const [renaming, setRenaming] = useState<{ no: number; value: string } | null>(null);
  // команда, у которой открыт выбор цвета
  const [picking, setPicking] = useState<number | null>(null);
  const bySignup = new Map(game.roster.map((r) => [r.signupId, r]));
  const isFull = (t: Team) => t.members.length >= game.playersPerTeam;
  const fail = (e: ApiError) => showToast(e.message);

  const move = (s: TeamSeat, teamNo: Target) =>
    api.assignSeat(game.id, s.signupId, s.seat, teamNo).then(onUpdate).catch(fail);

  const saveName = () => {
    if (!renaming) return;
    const team = game.teams.find((t) => t.no === renaming.no);
    setRenaming(null);
    const name = renaming.value.trim();
    if (!team || name === team.name) return;
    api.setTeamName(game.id, team.no, name).then(onUpdate).catch(fail);
  };

  const chooseColor = (team: Team, key: string) => {
    setPicking(null);
    if (key === team.colorKey) return;
    api.setTeamColor(game.id, team.no, key).then(onUpdate).catch(fail);
  };

  /** Свободные цвета для команды: её текущий и те, которых нет у других команд сбора. */
  const colorChoices = (team: Team) => {
    const taken = new Set(game.teams.filter((t) => t.no !== team.no).map((t) => t.colorKey));
    return TEAM_COLORS.filter((c) => !taken.has(c.key));
  };

  const openMenu = (s: TeamSeat, current: Target) => {
    const entry = bySignup.get(s.signupId);
    if (!entry) return;
    const close = () => setPopout(null);
    const actions = game.teams
      .filter((t) => t.no !== current && !isFull(t))
      .map((t) => ({ title: `В команду «${t.name}»`, mode: 'default' as const, action: () => void move(s, t.no) }));
    if (current !== null) {
      actions.push({ title: 'Убрать из команды', mode: 'default' as const, action: () => void move(s, null) });
    }
    // страница есть только у самого записавшегося, не у его друзей «+1»
    if (s.seat === 1 && profileUrl(entry.user.vkId)) {
      actions.push({ title: 'Страница ВКонтакте', mode: 'default' as const, action: () => void openProfile(entry.user.vkId) });
    }
    setPopout(
      <Alert
        actions={[...actions, { title: 'Закрыть', mode: 'cancel' as const, action: close }]}
        actionsLayout="vertical"
        onClose={close}
        title={seatName(entry.user, s.seat)}
        {...(actions.length === 0 ? { description: 'Все команды заполнены' } : {})}
      />,
    );
  };

  // перетаскивание пальцем (Pointer Events): мышью работает обычное перетаскивание HTML5 по всей строке
  const updateTouch = (next: TouchDrag | null) => {
    touchRef.current = next;
    setTouchDrag(next);
  };

  const onHandleDown = (e: PointerEvent<HTMLElement>, s: TeamSeat, current: Target) => {
    if (e.pointerType === 'mouse') return;
    const entry = bySignup.get(s.signupId);
    if (!entry) return;
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    updateTouch({
      seat: s,
      from: current,
      name: seatName(entry.user, s.seat),
      photoUrl: entry.user.photoUrl,
      x: e.clientX,
      y: e.clientY,
    });
  };

  const onHandleMove = (e: PointerEvent<HTMLElement>) => {
    const drag = touchRef.current;
    if (!drag) return;
    e.preventDefault();
    updateTouch({ ...drag, x: e.clientX, y: e.clientY });
    if (e.clientY < EDGE) window.scrollBy(0, -12);
    else if (e.clientY > window.innerHeight - EDGE) window.scrollBy(0, 12);
    const zone = dropTargetAt(e.clientX, e.clientY);
    setOver(zone && zone.accepts && zone.target !== drag.from ? zone.target : undefined);
  };

  const onHandleUp = (e: PointerEvent<HTMLElement>) => {
    const drag = touchRef.current;
    if (!drag) return;
    updateTouch(null);
    setOver(undefined);
    const zone = dropTargetAt(e.clientX, e.clientY);
    if (zone && zone.accepts && zone.target !== drag.from) void move(drag.seat, zone.target);
  };

  const onHandleCancel = () => {
    updateTouch(null);
    setOver(undefined);
  };

  /** Свойства зоны, куда можно бросить место. */
  const dropZone = (target: Target, accepts: boolean) =>
    editable
      ? {
          'data-drop': target === null ? 'none' : String(target),
          'data-accepts': String(accepts),
          onDragOver: (e: DragEvent) => {
            if (!dragging || !accepts) return;
            e.preventDefault();
            setOver(target);
          },
          onDragLeave: () => setOver((o) => (o === target ? undefined : o)),
          onDrop: (e: DragEvent) => {
            e.preventDefault();
            setOver(undefined);
            if (dragging && accepts) void move(dragging, target);
            setDragging(null);
          },
        }
      : {};

  const seatRow = (s: TeamSeat, current: Target) => {
    const entry = bySignup.get(s.signupId);
    if (!entry) return null;
    const name = seatName(entry.user, s.seat);
    const isDragged = touchDrag !== null && touchDrag.seat.signupId === s.signupId && touchDrag.seat.seat === s.seat;
    // значок для перетаскивания пальцем: как у матчей — на iOS справа, на остальных платформах слева
    const handle = editable ? (
      <span
        className="team-seat__handle"
        role="button"
        aria-label={`Перетащить: ${name}`}
        data-testid="seat-dragger"
        onPointerDown={(e) => onHandleDown(e, s, current)}
        onPointerMove={onHandleMove}
        onPointerUp={onHandleUp}
        onPointerCancel={onHandleCancel}
        onClick={(e) => e.stopPropagation()}
      >
        {platform === 'ios' ? <Icon24ReorderIos /> : <Icon24Reorder />}
      </span>
    ) : null;
    return (
      <div
        key={`${s.signupId}:${s.seat}`}
        className={`team-seat${editable ? ' team-seat--editable' : ''}${isDragged ? ' team-seat--dragged' : ''}`}
        data-testid="team-seat"
        {...(editable
          ? {
              draggable: true,
              role: 'button',
              tabIndex: 0,
              'aria-label': name,
              onDragStart: (e: DragEvent) => {
                e.dataTransfer.setData('text/plain', name);
                e.dataTransfer.effectAllowed = 'move';
                setDragging(s);
              },
              onDragEnd: () => {
                setDragging(null);
                setOver(undefined);
              },
              onClick: () => openMenu(s, current),
              onKeyDown: (e: KeyboardEvent) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  openMenu(s, current);
                }
              },
            }
          : {})}
      >
        {platform !== 'ios' && handle}
        <Avatar size={28} src={entry.user.photoUrl ?? undefined} />
        {/* у организатора нажатие открывает меню с «Страница ВКонтакте»; у остальных имя — ссылка */}
        {!editable && s.seat === 1 ? (
          <PlayerLink user={entry.user}>{name}</PlayerLink>
        ) : (
          <span className="team-seat__name">{name}</span>
        )}
        {platform === 'ios' && handle}
      </div>
    );
  };

  if (game.roster.every((r) => r.mainSeats === 0)) {
    return <Empty>Команды появятся, когда в составе будут игроки</Empty>;
  }

  return (
    <div className="teams">
      {editable && (
        <div className="teams__hint">
          Перетащите игрока в команду (на телефоне — за значок ☰) или нажмите на него, чтобы выбрать команду
        </div>
      )}
      {touchDrag && (
        <div className="team-seat team-seat--ghost" style={{ left: touchDrag.x, top: touchDrag.y }} aria-hidden="true">
          <Avatar size={28} src={touchDrag.photoUrl ?? undefined} />
          <span>{touchDrag.name}</span>
        </div>
      )}
      <section
        className={`team-box team-box--none${over === null ? ' team-box--over' : ''}`}
        aria-label="Не распределены"
        {...dropZone(null, true)}
      >
        <div className="team-box__header">
          <span className="team-box__name">Не распределены</span>
          <span className="team-box__count">{game.unassigned.length}</span>
        </div>
        {game.unassigned.length === 0 ? (
          <div className="team-box__empty">Все игроки состава в командах</div>
        ) : (
          game.unassigned.map((s) => seatRow(s, null))
        )}
      </section>
      {game.teams.map((t) => (
        <section
          key={t.no}
          className={`team-box${over === t.no ? ' team-box--over' : ''}`}
          aria-label={`Команда ${t.name}`}
          {...dropZone(t.no, !isFull(t))}
        >
          <div className="team-box__header">
            {editable ? (
              <button
                type="button"
                className="team-dot team-dot--button"
                style={{ backgroundColor: t.color }}
                aria-label={`Цвет команды ${t.name}`}
                aria-expanded={picking === t.no}
                data-testid="team-dot"
                onClick={() => setPicking((p) => (p === t.no ? null : t.no))}
              />
            ) : (
              <span
                className="team-dot"
                style={{ backgroundColor: t.color }}
                aria-hidden="true"
                data-testid="team-dot"
              />
            )}
            {renaming?.no === t.no ? (
              <Input
                className="team-box__input"
                aria-label="Название команды"
                autoFocus
                maxLength={TEAM_NAME_MAX}
                value={renaming.value}
                onChange={(e) => setRenaming({ no: t.no, value: e.target.value })}
                onBlur={saveName}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') saveName();
                  if (e.key === 'Escape') setRenaming(null);
                }}
              />
            ) : editable ? (
              <button
                type="button"
                className="team-box__name team-box__name--button"
                title="Переименовать команду"
                onClick={() => setRenaming({ no: t.no, value: t.name })}
              >
                {t.name} ✎
              </button>
            ) : (
              <span className="team-box__name">{t.name}</span>
            )}
            <span className="team-box__count">
              {t.members.length}/{game.playersPerTeam}
            </span>
          </div>
          {editable && picking === t.no && (
            <div className="team-colors" role="group" aria-label={`Выбор цвета команды ${t.name}`}>
              {colorChoices(t).map((c) => (
                <button
                  key={c.key}
                  type="button"
                  className={`team-dot team-dot--choice${c.key === t.colorKey ? ' team-dot--current' : ''}`}
                  style={{ backgroundColor: c.color }}
                  aria-label={c.name}
                  aria-pressed={c.key === t.colorKey}
                  title={c.name}
                  onClick={() => chooseColor(t, c.key)}
                />
              ))}
            </div>
          )}
          {t.members.length === 0 ? (
            <div className="team-box__empty">{editable ? 'Перетащите сюда игроков' : 'Пока никого'}</div>
          ) : (
            t.members.map((s) => seatRow(s, t.no))
          )}
        </section>
      ))}
    </div>
  );
}
