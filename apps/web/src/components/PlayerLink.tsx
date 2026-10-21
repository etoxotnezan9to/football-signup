import type { ReactNode } from 'react';
import { fullName, profileUrl } from '../format.ts';

/**
 * Имя игрока ссылкой на его страницу ВКонтакте (в новой вкладке; приложение VK открывает профиль у себя).
 * У тестовых игроков страницы нет — тогда просто текст. Клик не всплывает к строке, у которой своё действие.
 */
export function PlayerLink({
  user,
  children,
}: {
  user: { vkId: number; firstName: string; lastName: string };
  children?: ReactNode;
}) {
  const url = profileUrl(user.vkId);
  const text = children ?? fullName(user);
  if (!url) return <span>{text}</span>;
  return (
    <a className="player-link" href={url} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}>
      {text}
    </a>
  );
}
