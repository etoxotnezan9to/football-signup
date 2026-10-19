import { useState } from 'react';
import { Button, FormItem, Input } from '@vkontakte/vkui';
import { parsePlaceInput, type Place } from '@football/shared';
import { api, ApiError } from '../api.ts';
import { useApp } from '../context.ts';

/** Форма создания места: название и адрес. Используется отдельной страницей и внутри формы игры. */
export function PlaceForm({
  onCreated,
  onCancel,
}: {
  onCreated: (place: Place) => void;
  onCancel?: () => void;
}) {
  const { showToast } = useApp();
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const parsed = parsePlaceInput({ name, address });
    if (!parsed.ok) {
      setErrors(parsed.errors);
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      const place = await api.createPlace(parsed.value);
      showToast('Место сохранено');
      setName('');
      setAddress('');
      onCreated(place);
    } catch (e) {
      if (e instanceof ApiError) {
        if (e.details) setErrors(e.details);
        showToast(e.message);
      } else {
        showToast('Не удалось сохранить место');
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <FormItem
        htmlFor="placeName"
        top="Название места"
        status={errors.name ? 'error' : 'default'}
        bottom={errors.name ?? 'Например: Ф.Ц. «Орловский»'}
      >
        <Input id="placeName" value={name} onChange={(e) => setName(e.target.value)} />
      </FormItem>
      <FormItem
        htmlFor="placeAddress"
        top="Адрес места"
        status={errors.address ? 'error' : 'default'}
        bottom={errors.address ?? 'Например: Суздальское шоссе 62'}
      >
        <Input id="placeAddress" value={address} onChange={(e) => setAddress(e.target.value)} />
      </FormItem>
      <FormItem>
        <div className="actions" style={{ padding: 0 }}>
          <Button size="m" loading={busy} onClick={() => void submit()}>
            Сохранить место
          </Button>
          {onCancel && (
            <Button size="m" mode="secondary" onClick={onCancel}>
              Отмена
            </Button>
          )}
        </div>
      </FormItem>
    </>
  );
}
