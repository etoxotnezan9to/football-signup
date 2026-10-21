import type { ReactNode } from 'react';
import {
  Avatar,
  Button,
  Div,
  Group,
  Header,
  PanelHeader,
  PanelHeaderBack,
  SimpleCell,
} from '@vkontakte/vkui';
import { formatRosterText, numberLabel, type GameDetails, type RosterEntry } from '@football/shared';
import { api, type ApiError } from '../api.ts';
import { Empty } from '../components/Empty.tsx';
import { MockFill } from '../components/MockFill.tsx';
import { useApp } from '../context.ts';
import { fillLabel, formatWhen, fullName, gameLabel, gameLink, routeToHash, seatsLabel, teamsLabel } from '../format.ts';
import { useGame } from '../hooks.ts';
import { TestPlayersPanel } from '../components/TestPlayersPanel.tsx';
import { confirmPopout, entryMenuPopout } from '../seats.tsx';
import { VK_APP_ID } from '../session.ts';
import { copyText, shareLink } from '../share.ts';
import { useSignupFlow } from '../signup.ts';

/** Строка сведений об игре. Иконки те же, что в тексте «Скопировать список» и в сообщении организатора. */
function Row({ icon, label, children }: { icon: string; label: string; children: ReactNode }) {
  return (
    <div className="info-row">
      <div className="info-row__label">
        <span className="info-row__icon" aria-hidden="true">
          {icon}
        </span>
        {label}
      </div>
      <div>{children}</div>
    </div>
  );
}

interface Numbered {
  entry: RosterEntry;
  count: number;
  label: string;
}

/** Строки состава с нумерацией мест, как в привычном списке: «1-6)», «7,8,9)». */
function numbered(roster: RosterEntry[], pick: (e: RosterEntry) => number): Numbered[] {
  const rows: Numbered[] = [];
  let n = 1;
  for (const entry of roster) {
    const count = pick(entry);
    if (count <= 0) continue;
    rows.push({ entry, count, label: numberLabel(n, count) });
    n += count;
  }
  return rows;
}

function paidText(e: RosterEntry): string {
  if (e.paidSeats <= 0) return '';
  return e.paidSeats >= e.seats ? ' · ✅ оплачено' : ` · ✅ оплачено ${e.paidSeats} из ${e.seats}`;
}

export function GamePage({ id }: { id: number }) {
  if (id <= 0) return null;
  return <GameView id={id} />;
}

function GameView({ id }: { id: number }) {
  const { session, navigate, showToast, setPopout } = useApp();
  const { data: game, error, loading, reload, setData } = useGame(id);
  const openSignup = useSignupFlow(setData);
  const back = () => navigate(routeToHash({ name: 'list' }));

  const header = (
    <PanelHeader before={<PanelHeaderBack onClick={back} />}>{game ? gameLabel(game) : 'Игра'}</PanelHeader>
  );

  if (loading) {
    return (
      <>
        {header}
        <Empty loading />
      </>
    );
  }
  if (!game) {
    return (
      <>
        {header}
        <Empty error={error ?? 'Игра не найдена'} onRetry={reload} />
      </>
    );
  }

  const isOrganizer = game.organizer.vkId === session.user.id;
  const active = game.status === 'active' && !game.isFinished;
  const mySeats = game.roster.find((r) => r.user.vkId === session.user.id)?.seats ?? 0;
  const mainRows = numbered(game.roster, (e) => e.mainSeats);
  const queueRows = numbered(game.roster, (e) => e.queueSeats);
  const fail = (e: ApiError) => showToast(e.message);
  const close = () => setPopout(null);

  const share = async () => {
    const r = await shareLink(gameLink(VK_APP_ID, game.id));
    if (r === 'copied') showToast('Ссылка на игру скопирована');
    if (r === 'failed') showToast('Не удалось поделиться ссылкой');
  };

  const copyList = async () => {
    const text = formatRosterText(
      {
        whenLabel: formatWhen(game.startsAt),
        venue: game.venue,
        address: game.address,
        feeRub: game.feeRub,
      },
      game.roster.map((r) => ({
        name: fullName(r.user),
        seats: r.seats,
        mainSeats: r.mainSeats,
        queueSeats: r.queueSeats,
        paidSeats: r.paidSeats,
      })),
    );
    showToast((await copyText(text)) ? 'Список скопирован' : 'Не удалось скопировать список');
  };

  const cancelGame = () =>
    setPopout(
      confirmPopout({
        title: 'Отменить игру?',
        description: 'Игра останется в списке со статусом «отменена», записаться на неё будет нельзя.',
        confirmTitle: 'Отменить игру',
        destructive: true,
        onClose: close,
        onConfirm: () => {
          close();
          api
            .cancelGame(game.id)
            .then((g: GameDetails) => {
              setData(g);
              showToast('Игра отменена');
            })
            .catch(fail);
        },
      }),
    );

  const openEntryMenu = (e: RosterEntry) =>
    setPopout(
      entryMenuPopout({
        name: fullName(e.user),
        seats: e.seats,
        paidSeats: e.paidSeats,
        onClose: close,
        onPaid: (n) => {
          close();
          api.setPaid(game.id, e.signupId, n).then(setData).catch(fail);
        },
        onRemove: () =>
          setPopout(
            confirmPopout({
              title: `Удалить ${fullName(e.user)}?`,
              description: 'Участник и его места будут убраны, очередь сдвинется автоматически.',
              confirmTitle: 'Удалить',
              destructive: true,
              onClose: close,
              onConfirm: () => {
                close();
                api.removeSignup(game.id, e.signupId).then(setData).catch(fail);
              },
            }),
          ),
      }),
    );

  const cell = (row: Numbered, count: number, showPaid: boolean) => {
    const e = row.entry;
    const mine = e.user.vkId === session.user.id;
    return (
      <SimpleCell
        key={`${e.signupId}-${showPaid ? 'm' : 'q'}`}
        before={<Avatar size={36} src={e.user.photoUrl ?? undefined} />}
        subtitle={`${row.label}${count > 1 ? ` ${seatsLabel(count)}` : ''}${showPaid ? paidText(e) : ''}`}
        {...(isOrganizer ? { onClick: () => openEntryMenu(e) } : {})}
      >
        {fullName(e.user)}
        {mine ? ' (вы)' : ''}
      </SimpleCell>
    );
  };

  return (
    <>
      {header}
      <Group>
        <Div>
          {game.status === 'cancelled' && (
            <Row icon="⚠" label="Статус">
              Игра отменена
            </Row>
          )}
          {game.isFinished && game.status === 'active' && (
            <Row icon="⚠" label="Статус">
              Игра прошла
            </Row>
          )}
          <Row icon="📅" label="Когда">
            {formatWhen(game.startsAt)}
          </Row>
          <Row icon="📍" label="Где">
            {game.venue}, {game.address}
          </Row>
          {teamsLabel(game.teamsMax, game.playersPerTeam) && (
            <Row icon="⚽" label="Формат">
              {teamsLabel(game.teamsMax, game.playersPerTeam)}
            </Row>
          )}
          <Row icon="💰" label="Взнос">
            {game.feeRub} ₽
          </Row>
          <Row icon="🕺" label="Организатор">
            {fullName(game.organizer)}
            {game.organizerContact ? `, ${game.organizerContact}` : ''}
          </Row>
          {game.paymentInfo && (
            <Row icon="❗" label="Предоплата">
              {game.paymentInfo}
            </Row>
          )}
          {game.description && (
            <Row icon="📝" label="Описание">
              {game.description}
            </Row>
          )}
          <Row icon="👥" label="Места">
            {fillLabel(game.taken, game.capacity, game.queued)}
          </Row>
        </Div>
        <div className="actions">
          {active && (
            <Button size="l" onClick={() => openSignup(game.id, mySeats)}>
              {mySeats > 0 ? `Изменить запись (${mySeats})` : '+ Записаться'}
            </Button>
          )}
          <Button size="l" mode="secondary" onClick={() => void share()}>
            Поделиться
          </Button>
          {isOrganizer && (
            <Button size="l" mode="secondary" onClick={() => void copyList()}>
              Скопировать список
            </Button>
          )}
        </div>
        {isOrganizer && active && (
          <div className="actions">
            <Button
              size="m"
              mode="outline"
              onClick={() => navigate(routeToHash({ name: 'edit', id: game.id }))}
            >
              Редактировать
            </Button>
            <Button size="m" mode="outline" appearance="negative" onClick={cancelGame}>
              Отменить игру
            </Button>
          </div>
        )}
        {active && <MockFill game={game} onUpdate={setData} />}
      </Group>
      {isOrganizer && active && <TestPlayersPanel gameId={game.id} onChanged={setData} />}
      <Group header={<Header indicator={`${game.taken}/${game.capacity}`}>Состав</Header>}>
        {mainRows.length === 0 ? (
          <Empty>Пока никто не записался</Empty>
        ) : (
          mainRows.map((r) => cell(r, r.count, true))
        )}
      </Group>
      {queueRows.length > 0 && (
        <Group header={<Header indicator={String(game.queued)}>Очередь</Header>}>
          {queueRows.map((r) => cell(r, r.count, false))}
        </Group>
      )}
    </>
  );
}
