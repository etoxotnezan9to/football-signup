import bridge from '@vkontakte/vk-bridge';
import { insideVk } from './session.ts';

export async function copyText(text: string): Promise<boolean> {
  try {
    if (insideVk()) {
      await bridge.send('VKWebAppCopyText', { text });
      return true;
    }
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** Делится ссылкой: в VK открывается стандартный диалог, вне VK ссылка копируется. */
export async function shareLink(link: string): Promise<'shared' | 'copied' | 'failed'> {
  if (insideVk()) {
    try {
      await bridge.send('VKWebAppShare', { link });
      return 'shared';
    } catch {
      return 'failed';
    }
  }
  return (await copyText(link)) ? 'copied' : 'failed';
}
