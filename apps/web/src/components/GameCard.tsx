import { Button } from '@vkontakte/vkui';
import type { GameSummary } from '@football/shared';
import { fillLabel, gameLabel } from '../format.ts';

interface Props {
  game: GameSummary;
  onOpen: (g: GameSummary) => void;
  onPlus?: (g: GameSummary) => void;
}

export function GameCard({ game, onOpen, onPlus }: Props) {
  const cancelled = game.status === 'cancelled';
  const my = game.mySeats ?? 0;
  return (
    <div className={`card${cancelled ? ' card--cancelled' : ''}`}>
      <div className="card__body" onClick={() => onOpen(game)}>
        <div className="card__title">{gameLabel(game)}</div>
        <div className="card__meta">
          {fillLabel(game.taken, game.capacity, game.queued)} · {game.feeRub} ₽
        </div>
        {cancelled && <div className="card__meta">Сбор отменён</div>}
      </div>
      {onPlus && !cancelled && !game.isFinished && (
        <div className="card__side">
          <Button size="m" mode={my > 0 ? 'secondary' : 'primary'} onClick={() => onPlus(game)}>
            {my > 0 ? `Вы: ${my}` : '+'}
          </Button>
        </div>
      )}
    </div>
  );
}
