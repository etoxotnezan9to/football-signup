// Проверка подписи параметров запуска VK Mini Apps (docs/spec.md, раздел 9).
import { createHmac, timingSafeEqual } from 'node:crypto';

export type VerifyResult = { ok: true; vkId: number } | { ok: false; reason: string };

export interface VerifyOptions {
  appId: number;
  /** Текущее время, секунды Unix */
  nowSec: number;
  maxAgeSec: number;
}

function base64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Строка для подписи: только vk_*, по имени ключа, значения URL-кодируются. */
export function buildSignedString(params: URLSearchParams): string {
  const keys = [...new Set([...params.keys()])].filter((k) => k.startsWith('vk_')).sort();
  return keys.map((k) => `${k}=${encodeURIComponent(params.get(k) ?? '')}`).join('&');
}

export function signLaunchParams(params: URLSearchParams, secret: string): string {
  return base64url(createHmac('sha256', secret).update(buildSignedString(params)).digest());
}

export function verifyLaunchParams(raw: string, secret: string, opts: VerifyOptions): VerifyResult {
  if (!raw || raw.length > 4096) return { ok: false, reason: 'пустые или слишком длинные параметры' };
  const params = new URLSearchParams(raw.startsWith('?') ? raw.slice(1) : raw);
  const sign = params.get('sign');
  if (!sign) return { ok: false, reason: 'нет sign' };

  const expected = Buffer.from(signLaunchParams(params, secret));
  const actual = Buffer.from(sign);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    return { ok: false, reason: 'неверная подпись' };
  }

  if (params.get('vk_app_id') !== String(opts.appId)) return { ok: false, reason: 'чужое приложение' };

  const ts = Number(params.get('vk_ts'));
  if (!Number.isInteger(ts) || ts <= 0) return { ok: false, reason: 'нет vk_ts' };
  if (opts.nowSec - ts > opts.maxAgeSec) return { ok: false, reason: 'параметры устарели' };

  const vkId = Number(params.get('vk_user_id'));
  if (!Number.isInteger(vkId) || vkId <= 0) return { ok: false, reason: 'нет vk_user_id' };

  return { ok: true, vkId };
}
