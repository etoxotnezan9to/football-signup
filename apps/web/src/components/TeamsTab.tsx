import { useState, type DragEvent, type KeyboardEvent } from 'react';
import { Alert, Avatar, Input } from '@vkontakte/vkui';
import { TEAM_NAME_MAX, type GameDetails, type Team, type TeamSeat } from '@football/shared';
import { api, type ApiError } from '../api.ts';
import { Empty } from './Empty.tsx';
import { useApp } from '../context.ts';
import { seatName } from '../format.ts';

/** Куда бросили место: номер команды или null — «не распределены». */
type Target = number | null;

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
  const [dragging, setDragging] = useState<TeamSeat | null>(null);
  const [over, setOver] = useState<Target | undefined>(undefined);
  const [renaming, setRenaming] = useState<{ no: number; value: string } | null>(null);
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

  /** Свойства зоны, куда можно бросить место. */
  const dropZone = (target: Target, accepts: boolean) =>
    editable
      ? {
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
    return (
      <div
        key={`${s.signupId}:${s.seat}`}
        className={`team-seat${editable ? ' team-seat--editable' : ''}`}
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
        <Avatar size={28} src={entry.user.photoUrl ?? undefined} />
        <span>{name}</span>
      </div>
    );
  };

  if (game.roster.every((r) => r.mainSeats === 0)) {
    return <Empty>Команды появятся, когда в составе будут игроки</Empty>;
  }

  return (
    <div className="teams">
      {editable && (
        <div className="teams__hint">Перетащите игрока в команду или нажмите на него, чтобы выбрать команду</div>
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
            <span
              className="team-dot"
              style={{ backgroundColor: t.color }}
              aria-hidden="true"
              data-testid="team-dot"
            />
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
