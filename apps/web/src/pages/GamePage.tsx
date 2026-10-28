import { useState, type ReactNode } from 'react';
import { Icon16CopyOutline, Icon28CopyOutline, Icon28ShareOutline } from '@vkontakte/icons';
import {
  Avatar,
  Button,
  Div,
  Group,
  Header,
  IconButton,
  PanelHeader,
  PanelHeaderBack,
  SimpleCell,
  Tabs,
  TabsItem,
} from '@vkontakte/vkui';
import { formatRosterText, numberLabel, queueOrder, type GameDetails, type RosterEntry } from '@football/shared';
import { api, type ApiError } from '../api.ts';
import { Empty } from '../components/Empty.tsx';
import { MockFill } from '../components/MockFill.tsx';
import { PlayerLink } from '../components/PlayerLink.tsx';
import { ResultsTab } from '../components/ResultsTab.tsx';
import { TeamsTab } from '../components/TeamsTab.tsx';
import { useApp } from '../context.ts';
import {
  fillLabel,
  formatWhen,
  fullName,
  gameLabel,
  gameLink,
  meetingsLabel,
  openProfile,
  profileUrl,
  routeToHash,
  seatsLabel,
  splitPhones,
  teamsLabel,
} from '../format.ts';
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

/** Текст, в котором номера телефона копируются нажатием (чтобы вставить в перевод по СБП). */
function CopyablePhones({ text }: { text: string }) {
  const { showToast } = useApp();
  return (
    <>
      {splitPhones(text).map((part, i) =>
        part.phone ? (
          <button
            key={i}
            type="button"
            className="phone-copy"
            aria-label={`Скопировать номер ${part.text}`}
            onClick={() => {
              const phone = part.phone!;
              void copyText(phone).then((ok) => showToast(ok ? 'Номер скопирован' : 'Не удалось скопировать номер'));
            }}
          >
            {part.text}
            <Icon16CopyOutline className="phone-copy__icon" aria-hidden="true" />
          </button>
        ) : (
          <span key={i}>{part.text}</span>
        ),
      )}
    </>
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
  const [tab, setTab] = useState<'roster' | 'teams' | 'results'>('roster');
  const back = () => navigate(routeToHash({ name: 'list' }));

  const header = (
    <PanelHeader before={<PanelHeaderBack onClick={back} />}>{game ? gameLabel(game) : 'Сбор'}</PanelHeader>
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
        <Empty error={error ?? 'Сбор не найден'} onRetry={reload} />
      </>
    );
  }

  const isOrganizer = game.organizer.vkId === session.user.id;
  const active = game.status === 'active' && !game.isFinished;
  const mySeats = game.roster.find((r) => r.user.vkId === session.user.id)?.seats ?? 0;
  const mainRows = numbered(game.roster, (e) => e.mainSeats);
  const queueRows = numbered(queueOrder(game.roster), (e) => e.queueSeats);
  const fail = (e: ApiError) => showToast(e.message);
  const close = () => setPopout(null);

  const share = async () => {
    const r = await shareLink(gameLink(VK_APP_ID, game.id));
    if (r === 'copied') showToast('Ссылка на сбор скопирована');
    if (r === 'failed') showToast('Не удалось поделиться ссылкой');
  };

  const copyList = async () => {
    const text = formatRosterText(
      {
        whenLabel: formatWhen(game.startsAt),
        venue: game.venue,
        address: game.address,
        feeRub: game.feeRub,
        ...(game.status === 'cancelled'
          ? { statusLabel: 'Сбор отменён' }
          : game.isFinished
            ? { statusLabel: 'Сбор прошёл' }
            : {}),
        formatLabel: `${teamsLabel(game.teamsMax, game.playersPerTeam)}, ${meetingsLabel(game.meetings)}`,
        organizerName: fullName(game.organizer),
        organizerContact: game.organizerContact,
        paymentInfo: game.paymentInfo,
        description: game.description,
        fillLabel: fillLabel(game.taken, game.capacity, game.queued),
      },
      game.roster.map((r) => ({
        name: fullName(r.user),
        seats: r.seats,
        mainSeats: r.mainSeats,
        queueSeats: r.queueSeats,
        queuePosition: r.queuePosition,
        paidSeats: r.paidSeats,
      })),
    );
    showToast((await copyText(text)) ? 'Список скопирован' : 'Не удалось скопировать список');
  };

  const cancelGame = () =>
    setPopout(
      confirmPopout({
        title: 'Отменить сбор?',
        description: 'Сбор останется в списке со статусом «отменён», записаться на него будет нельзя.',
        confirmTitle: 'Отменить сбор',
        destructive: true,
        onClose: close,
        onConfirm: () => {
          close();
          api
            .cancelGame(game.id)
            .then((g: GameDetails) => {
              setData(g);
              showToast('Сбор отменён');
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
        ...(profileUrl(e.user.vkId) ? { onProfile: () => openProfile(e.user.vkId) } : {}),
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
    const url = profileUrl(e.user.vkId);
    // организатор по нажатию открывает меню (там же «Страница ВКонтакте»), остальные — сразу страницу участника
    const action = isOrganizer
      ? { onClick: () => openEntryMenu(e) }
      : url
        ? { Component: 'a' as const, href: url, target: '_blank', rel: 'noopener noreferrer' }
        : {};
    return (
      <SimpleCell
        key={`${e.signupId}-${showPaid ? 'm' : 'q'}`}
        before={<Avatar size={36} src={e.user.photoUrl ?? undefined} />}
        subtitle={`${row.label}${count > 1 ? ` ${seatsLabel(count)}` : ''}${showPaid ? paidText(e) : ''}`}
        {...action}
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
              Сбор отменён
            </Row>
          )}
          {game.isFinished && game.status === 'active' && (
            <Row icon="⚠" label="Статус">
              Сбор прошёл
            </Row>
          )}
          <Row icon="📅" label="Когда">
            {formatWhen(game.startsAt)}
          </Row>
          <Row icon="📍" label="Где">
            {game.venue}, {game.address}
          </Row>
          <Row icon="⚽" label="Формат">
            {teamsLabel(game.teamsMax, game.playersPerTeam)}
          </Row>
          <Row icon="💰" label="Взнос">
            {game.feeRub} ₽
          </Row>
          <Row icon="🕺" label="Организатор">
            <PlayerLink user={game.organizer} />
            {game.organizerContact ? `, ${game.organizerContact}` : ''}
          </Row>
          {game.paymentInfo && (
            <Row icon="❗" label="Предоплата">
              <CopyablePhones text={game.paymentInfo} />
            </Row>
          )}
          {game.description && (
            <Row icon="📝" label="Описание">
              <span className="multiline-text" data-testid="game-description">
                {game.description}
              </span>
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
          <IconButton className="actions__add" label="Поделиться" onClick={() => void share()}>
            <Icon28ShareOutline />
          </IconButton>
          {isOrganizer && (
            <IconButton className="actions__icon" label="Скопировать список" onClick={() => void copyList()}>
              <Icon28CopyOutline />
            </IconButton>
          )}
        </div>
        {isOrganizer && active && (
          <div className="actions">
            <Button
              size="m"
              mode="outline"
              onClick={() => navigate(routeToHash({ name: 'edit', id: game.id }))}
            >
              Редактировать сбор
            </Button>
            <Button size="m" mode="outline" appearance="negative" onClick={cancelGame}>
              Отменить сбор
            </Button>
          </div>
        )}
        {active && <MockFill game={game} onUpdate={setData} />}
      </Group>
      {isOrganizer && active && <TestPlayersPanel gameId={game.id} onChanged={setData} />}
      <Group
        header={
          <Tabs>
            <TabsItem selected={tab === 'roster'} onClick={() => setTab('roster')} aria-controls="tab-roster">
              Состав {game.taken}/{game.capacity}
            </TabsItem>
            <TabsItem selected={tab === 'teams'} onClick={() => setTab('teams')} aria-controls="tab-teams">
              Команды
            </TabsItem>
            <TabsItem selected={tab === 'results'} onClick={() => setTab('results')} aria-controls="tab-results">
              Результаты
            </TabsItem>
          </Tabs>
        }
      >
        {tab === 'teams' ? (
          <div id="tab-teams" role="tabpanel">
            <TeamsTab game={game} editable={isOrganizer && game.status === 'active'} onUpdate={setData} />
          </div>
        ) : tab === 'results' ? (
          <div id="tab-results" role="tabpanel">
            <ResultsTab game={game} editable={isOrganizer && game.status === 'active'} onUpdate={setData} />
          </div>
        ) : (
          <div id="tab-roster" role="tabpanel">
            {mainRows.length === 0 ? (
              <Empty>Пока никто не записался</Empty>
            ) : (
              mainRows.map((r) => cell(r, r.count, true))
            )}
          </div>
        )}
      </Group>
      {tab === 'roster' && queueRows.length > 0 && (
        <Group header={<Header indicator={String(game.queued)}>Очередь</Header>}>
          {queueRows.map((r) => cell(r, r.count, false))}
        </Group>
      )}
    </>
  );
}
