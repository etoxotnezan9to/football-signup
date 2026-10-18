import { Button, Div, Spinner, Text } from '@vkontakte/vkui';

/** Состояния «загрузка / ошибка / пусто» одним компонентом, чтобы экраны не дублировали разметку. */
export function Empty({
  loading,
  error,
  onRetry,
  children,
}: {
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  children?: string;
}) {
  if (loading) return <Spinner size="large" style={{ margin: '24px 0' }} />;
  return (
    <Div>
      <Text style={{ textAlign: 'center', color: 'var(--vkui--color_text_secondary)' }}>
        {error ?? children}
      </Text>
      {error && onRetry && (
        <div style={{ textAlign: 'center', marginTop: 12 }}>
          <Button size="m" mode="secondary" onClick={onRetry}>
            Повторить
          </Button>
        </div>
      )}
    </Div>
  );
}
