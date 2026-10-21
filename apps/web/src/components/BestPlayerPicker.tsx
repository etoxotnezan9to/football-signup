import { useState } from 'react';
import { Avatar, CustomSelect, CustomSelectOption, FormItem } from '@vkontakte/vkui';
import { POINTS_BEST_PLAYER, type GameDetails } from '@football/shared';
import { api, type ApiError } from '../api.ts';
import { useApp } from '../context.ts';
import { fullName } from '../format.ts';

/**
 * Лучший игрок сбора. Организатор выбирает его выпадающим списком, где игроки сгруппированы по командам
 * (заголовок группы — команда с её цветом); остальные видят выбор. Выбрать можно только записавшегося,
 * кто в команде: друзья «+1» не имеют своего аккаунта и в рейтинг не попадают.
 */
export function BestPlayerPicker({
  game,
  editable,
  onUpdate,
}: {
  game: GameDetails;
  editable: boolean;
  onUpdate: (g: GameDetails) => void;
}) {
  const { showToast } = useApp();
  const [busy, setBusy] = useState(false);
  const bySignup = new Map(game.roster.map((r) => [r.signupId, r.user]));
  const groups = game.teams
    .map((t) => ({
      team: t,
      players: t.members
        .filter((m) => m.seat === 1)
        .map((m) => bySignup.get(m.signupId))
        .filter((u) => u !== undefined),
    }))
    .filter((g) => g.players.length > 0);
  const best = groups.flatMap((g) => g.players.map((u) => ({ user: u, team: g.team }))).find(
    (p) => p.user.vkId === game.bestPlayerId,
  );
  const hint = `Лучший игрок получает ${POINTS_BEST_PLAYER} очка в рейтинг вместо очка за победу команды`;

  if (!editable) {
    return (
      <div className="best-player">
        <span className="best-player__label">Лучший игрок:</span>{' '}
        {best ? (
          <>
            <span className="team-dot" style={{ backgroundColor: best.team.color }} aria-hidden="true" />{' '}
            <strong>{fullName(best.user)}</strong> ({best.team.name})
          </>
        ) : (
          'не выбран'
        )}
      </div>
    );
  }

  const options = groups.flatMap(({ team, players }) => [
    // заголовок группы: недоступная для выбора строка с названием и цветом команды
    {
      value: `team-${team.no}`,
      label: team.name,
      disabled: true,
      before: <span className="team-dot best-player__dot" style={{ backgroundColor: team.color }} aria-hidden="true" />,
      group: true,
    },
    ...players.map((u) => ({
      value: String(u.vkId),
      label: fullName(u),
      description: team.name,
      before: <Avatar size={24} src={u.photoUrl ?? undefined} />,
    })),
  ]);

  const choose = (value: string | null) => {
    setBusy(true);
    api
      .setBestPlayer(game.id, value === null || value === '' ? null : Number(value))
      .then(onUpdate)
      .catch((e: ApiError) => showToast(e.message))
      .finally(() => setBusy(false));
  };

  return (
    <FormItem htmlFor="bestPlayer" top="Лучший игрок" bottom={groups.length === 0 ? 'В командах пока нет игроков' : hint}>
      <CustomSelect
        id="bestPlayer"
        searchable
        allowClearButton
        placeholder="Выберите игрока"
        emptyText="Никого не найдено"
        disabled={busy || groups.length === 0}
        options={options}
        value={best ? String(best.user.vkId) : null}
        onChange={(_e, value) => choose(value === null ? null : String(value))}
        renderOption={({ option, ...rest }) => (
          <CustomSelectOption
            {...rest}
            className={'group' in option ? 'best-player__group' : undefined}
          />
        )}
      />
    </FormItem>
  );
}
