import { useCallback } from 'react';
import type { GameDetails } from '@football/shared';
import { api, type ApiError } from './api.ts';
import { useApp } from './context.ts';
import { signupResultText } from './format.ts';
import { confirmPopout, seatsPickerPopout } from './seats.tsx';

/**
 * Сценарий «+»: выбор числа мест → запрос → тост с результатом («2 места в составе, 1 в очереди»).
 * Возвращает функцию open(gameId, текущее число мест). onDone получает свежую игру из ответа.
 */
export function useSignupFlow(onDone: (game: GameDetails) => void) {
  const { setPopout, showToast } = useApp();

  return useCallback(
    (gameId: number, current: number) => {
      const close = () => setPopout(null);
      const fail = (e: ApiError) => showToast(e.message);

      setPopout(
        seatsPickerPopout({
          current,
          onClose: close,
          onPick: (seats) => {
            close();
            api
              .putSignup(gameId, seats)
              .then((r) => {
                showToast(signupResultText(r.signup));
                onDone(r.game);
              })
              .catch(fail);
          },
          onLeave: () =>
            setPopout(
              confirmPopout({
                title: 'Отменить запись?',
                description: 'Предоплата при отмене записи не возвращается.',
                confirmTitle: 'Отменить запись',
                destructive: true,
                onClose: close,
                onConfirm: () => {
                  close();
                  api
                    .deleteSignup(gameId)
                    .then((g) => {
                      showToast('Запись отменена');
                      onDone(g);
                    })
                    .catch(fail);
                },
              }),
            ),
        }),
      );
    },
    [setPopout, showToast, onDone],
  );
}
