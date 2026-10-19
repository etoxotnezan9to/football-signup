import { MOCK_USERS, setMockUser } from '../session.ts';
import { useApp } from '../context.ts';
import { fullName } from '../format.ts';

/** Переключатель тестового пользователя (только вне VK): позволяет проверить очередь без второго аккаунта. */
export function MockBar() {
  const { session } = useApp();
  if (!session.mock) return null;
  return (
    <div className="mock-bar">
      Тестовый режим, вы:
      <select
        value={session.user.id}
        onChange={(e) => {
          setMockUser(Number(e.target.value));
          window.location.reload();
        }}
      >
        {MOCK_USERS.map((u) => (
          <option key={u.id} value={u.id}>
            {fullName(u)}
          </option>
        ))}
      </select>
    </div>
  );
}
