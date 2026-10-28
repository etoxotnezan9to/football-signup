// Числовые id пользователей VK по коротким именам (vk.com/<имя>) через users.get с сервисным ключом.
// Нужны для списка создателей сборов: VK сообщает серверу только числовой vk_user_id.

export interface ResolveOptions {
  /** Сервисный ключ доступа приложения; передаётся только в теле запроса к VK */
  serviceKey: string;
  fetchImpl?: typeof fetch;
  endpoint?: string;
  apiVersion?: string;
  timeoutMs?: number;
}

interface VkUser {
  id?: number;
  screen_name?: string;
  deactivated?: string;
}

/**
 * Короткое имя (без @, в нижнем регистре) → id пользователя. Имена, которых нет среди пользователей
 * (например, сообщества или опечатки), в ответ не попадают.
 */
export async function resolveScreenNames(names: readonly string[], options: ResolveOptions): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const wanted = [...new Set(names.map(normalizeScreenName).filter((n) => n !== ''))];
  if (wanted.length === 0) return out;
  const fetchImpl = options.fetchImpl ?? fetch;
  const body = new URLSearchParams({
    user_ids: wanted.join(','),
    fields: 'screen_name',
    access_token: options.serviceKey,
    v: options.apiVersion ?? '5.199',
  });
  const res = await fetchImpl(options.endpoint ?? 'https://api.vk.com/method/users.get', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
    signal: AbortSignal.timeout(options.timeoutMs ?? 5_000),
  });
  const json = (await res.json()) as { response?: VkUser[]; error?: { error_code?: number; error_msg?: string } };
  if (json.error) throw new Error(`VK users.get: ${json.error.error_code ?? '?'} ${json.error.error_msg ?? ''}`.trim());
  for (const u of json.response ?? []) {
    const name = normalizeScreenName(u.screen_name ?? '');
    if (typeof u.id === 'number' && u.id > 0 && wanted.includes(name)) out.set(name, u.id);
  }
  return out;
}

/** «@LFProject», «vk.com/lfproject» → «lfproject». */
export function normalizeScreenName(value: string): string {
  return value
    .trim()
    .replace(/^https?:\/\//, '')
    .replace(/^(m\.)?vk\.(com|ru)\//, '')
    .replace(/^@/, '')
    .toLowerCase();
}
