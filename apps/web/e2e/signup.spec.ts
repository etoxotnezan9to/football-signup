import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';

// Тестовые пользователи режима моков (apps/web/src/session.ts)
const ORGANIZER = 1001; // Иван Петров
const MARIA = 1002; // Мария Сидорова
const ALEXEY = 1003; // Алексей Смирнов

const opened: BrowserContext[] = [];

/** Выбор места в комбобоксе формы игры; если места ещё нет, создаём его прямо из формы. */
async function choosePlace(page: Page, name: string, address: string): Promise<void> {
  await page.getByRole('button', { name: 'Добавить место', exact: true }).click();
  await page.getByLabel('Название места', { exact: true }).fill(name);
  await page.getByLabel('Адрес места', { exact: true }).fill(address);
  await page.getByRole('button', { name: 'Сохранить место', exact: true }).click();
  // новое место сразу выбрано в комбобоксе
  await expect(page.getByText(name, { exact: true })).toBeVisible();
}

/** Отдельный браузерный контекст = отдельный пользователь (mockUser хранится в localStorage). */
async function openAs(browser: Browser, userId: number, path = '/'): Promise<Page> {
  const ctx = await browser.newContext();
  opened.push(ctx);
  await ctx.addInitScript((id) => localStorage.setItem('mockUser', String(id)), userId);
  const page = await ctx.newPage();
  await page.goto(path);
  return page;
}

test.afterEach(async ({ browser: _browser }, info) => {
  // Для разбора сбоев в CI печатаем видимый текст страниц: скриншоты оттуда не достать
  if (info.status !== info.expectedStatus) {
    for (const ctx of opened) {
      for (const page of ctx.pages()) {
        console.log(`--- ${page.url()}\n${(await page.locator('body').innerText().catch(() => '')).slice(0, 1500)}`);
      }
    }
  }
  while (opened.length > 0) await opened.pop()?.close();
});

test('создание игры, запись нескольких мест, очередь и обновление у всех в реальном времени', async ({ browser }) => {
  // 1. Организатор создаёт игру на 4 места
  const org = await openAs(browser, ORGANIZER);
  await org.getByRole('button', { name: 'Создать игру', exact: true }).click();
  await choosePlace(org, 'Тест-арена', 'ул. Тестовая, 1');
  await org.getByLabel('Взнос, ₽', { exact: true }).fill('650');
  await org.getByLabel('Количество команд (макс)', { exact: true }).fill('2');
  await org.getByLabel('Игроков в команде', { exact: true }).fill('2');
  await org.getByRole('button', { name: 'Создать игру', exact: true }).last().click();
  await expect(org).toHaveURL(/#\/game\/\d+$/);
  const gamePath = `/${new URL(org.url()).hash}`;
  await expect(org.getByText('занято 0/4')).toBeVisible();

  // 2. Мария видит игру в списке и записывается на 3 места кнопкой «+»
  const maria = await openAs(browser, MARIA);
  await expect(maria.getByText(/Тест-арена/)).toBeVisible();
  await maria.getByRole('button', { name: '+', exact: true }).click();
  await maria.getByRole('button', { name: '+3', exact: true }).click();
  await expect(maria.getByText('Вы записаны: 3 места в составе')).toBeVisible();

  // 3. Организатор без перезагрузки видит Марию и заполненность
  await expect(org.getByText('Мария Сидорова')).toBeVisible();
  await expect(org.getByText('занято 3/4')).toBeVisible();

  // 4. Алексей открывает игру по ссылке и записывается на 2 места: одно в составе, одно в очереди
  const alexey = await openAs(browser, ALEXEY, gamePath);
  await alexey.getByRole('button', { name: '+ Записаться', exact: true }).click();
  await alexey.getByRole('button', { name: '+2', exact: true }).click();
  await expect(alexey.getByText('Вы записаны: 1 место в составе, 1 место в очереди')).toBeVisible();

  // 5. У организатора и в списке у Марии появилась очередь
  await expect(org.getByText('занято 4/4, в очереди 1')).toBeVisible();
  await expect(org.getByText('Очередь', { exact: true })).toBeVisible();
  await expect(maria.getByText('занято 4/4, в очереди 1')).toBeVisible();

  // 6. Мария отменяет запись: очередь продвигается, у организатора остаются 2 места Алексея без очереди
  await maria.getByText(/Тест-арена/).click();
  await maria.getByRole('button', { name: 'Изменить запись (3)', exact: true }).click();
  await maria.getByRole('button', { name: 'Отменить запись', exact: true }).click();
  await maria.getByRole('button', { name: 'Отменить запись', exact: true }).click();
  await expect(org.getByText('занято 2/4', { exact: true })).toBeVisible();
  await expect(org.getByText('Очередь', { exact: true })).toBeHidden();
});

test('лимит: нельзя записаться больше чем на 5 мест суммарно', async ({ browser }) => {
  const org = await openAs(browser, ORGANIZER);
  await org.getByRole('button', { name: 'Создать игру', exact: true }).click();
  await choosePlace(org, 'Арена', 'ул. Лимитная, 5');
  await org.getByLabel('Взнос, ₽', { exact: true }).fill('0');
  await org.getByLabel('Количество команд (макс)', { exact: true }).fill('4');
  await org.getByLabel('Игроков в команде', { exact: true }).fill('5');
  await org.getByRole('button', { name: 'Создать игру', exact: true }).last().click();
  await expect(org).toHaveURL(/#\/game\/\d+$/);
  await org.getByRole('button', { name: '+ Записаться', exact: true }).click();
  // в выборе числа мест нет варианта больше 5
  await expect(org.getByRole('button', { name: '+5', exact: true })).toBeVisible();
  await expect(org.getByRole('button', { name: '+6', exact: true })).toHaveCount(0);
});

test('форма создания показывает ошибки валидации и не создаёт игру', async ({ browser }) => {
  const org = await openAs(browser, ORGANIZER, '/#/create');
  await org.getByRole('button', { name: 'Создать игру', exact: true }).last().click();
  await expect(org.getByText('выберите место', { exact: true })).toBeVisible();
  // команды и игроки заполнены по умолчанию, отдельного поля вместимости нет
  await expect(org.getByLabel('Количество команд (макс)', { exact: true })).toHaveValue('4');
  await expect(org.getByLabel('Игроков в команде', { exact: true })).toHaveValue('6');
  await expect(org.getByText('Мест в составе: 4 × 6 = 24')).toBeVisible();
  await expect(org.getByLabel('Число мест в составе', { exact: true })).toHaveCount(0);
  await expect(org.getByLabel('Название', { exact: true })).toHaveCount(0);
  await expect(org).toHaveURL(/#\/create$/);
});

test('место: создаётся кнопкой + в форме игры и потом выбирается из списка', async ({ browser }) => {
  const org = await openAs(browser, ORGANIZER);
  // отдельной кнопки на главной больше нет
  await expect(org.getByRole('button', { name: 'Добавить место', exact: true })).toHaveCount(0);

  await org.getByRole('button', { name: 'Создать игру', exact: true }).click();
  await org.getByRole('button', { name: 'Добавить место', exact: true }).click();
  await org.getByRole('button', { name: 'Сохранить место', exact: true }).click();
  await expect(org.getByText('длина от 1 до 80').first()).toBeVisible();
  await org.getByLabel('Название места', { exact: true }).fill('Манеж E2E');
  await org.getByLabel('Адрес места', { exact: true }).fill('пр. Спортивный, 3');
  await org.getByRole('button', { name: 'Сохранить место', exact: true }).click();
  await expect(org.getByText('Манеж E2E', { exact: true })).toBeVisible();
  await org.getByLabel('Взнос, ₽', { exact: true }).fill('500');
  await org.getByLabel('Количество команд (макс)', { exact: true }).fill('2');
  await org.getByLabel('Игроков в команде', { exact: true }).fill('6');
  await org.getByRole('button', { name: 'Создать игру', exact: true }).last().click();
  await expect(org).toHaveURL(/#\/game\/\d+$/);
  await expect(org.getByText('Манеж E2E, пр. Спортивный, 3')).toBeVisible();
  // вместо названия у игры дата и место
  await org.goto('/#/');
  await expect(org.getByText(/· Манеж E2E$/).first()).toBeVisible();

  // второй раз место выбирается из списка
  await org.getByRole('button', { name: 'Создать игру', exact: true }).click();
  await org.getByLabel('Место', { exact: true }).click();
  await org.getByRole('option', { name: /Манеж E2E/ }).click();
  await org.getByLabel('Взнос, ₽', { exact: true }).fill('500');
  await org.getByLabel('Количество команд (макс)', { exact: true }).fill('2');
  await org.getByLabel('Игроков в команде', { exact: true }).fill('5');
  await org.getByRole('button', { name: 'Создать игру', exact: true }).last().click();
  await expect(org).toHaveURL(/#\/game\/\d+$/);
  await expect(org.getByText('Манеж E2E, пр. Спортивный, 3')).toBeVisible();
});

test('фильтр игр по месту на главной', async ({ browser }) => {
  // к этому моменту есть игры в «Тест-арене», «Арене» и «Манеже E2E» (предыдущие тесты)
  const page = await openAs(browser, MARIA);
  await expect(page.getByText(/· Тест-арена$/).first()).toBeVisible();
  await page.getByLabel('Место', { exact: true }).click();
  await page.getByRole('option', { name: 'Манеж E2E' }).click();
  await expect(page.getByText(/· Манеж E2E$/).first()).toBeVisible();
  await expect(page.getByText(/· Тест-арена$/)).toHaveCount(0);
  // выбор запоминается после перезагрузки
  await page.reload();
  await expect(page.getByText(/· Манеж E2E$/).first()).toBeVisible();
  await expect(page.getByText(/· Тест-арена$/)).toHaveCount(0);
});

test('тестовый режим: организатор добавляет много игроков и убирает их', async ({ browser }) => {
  const org = await openAs(browser, ORGANIZER, '/#/create');
  await choosePlace(org, 'Тест-поле', 'ул. Пробная, 2');
  await org.getByLabel('Взнос, ₽', { exact: true }).fill('0');
  await org.getByLabel('Количество команд (макс)', { exact: true }).fill('2');
  await org.getByLabel('Игроков в команде', { exact: true }).fill('5');
  await org.getByRole('button', { name: 'Создать игру', exact: true }).last().click();
  await expect(org).toHaveURL(/#\/game\/\d+$/);
  const gamePath = `/${new URL(org.url()).hash}`;

  await expect(org.getByText('🧪 Тестовый режим')).toBeVisible();
  await org.getByLabel('Тестовых игроков', { exact: true }).fill('14');
  await org.getByRole('button', { name: 'Добавить игроков', exact: true }).click();
  await expect(org.getByText('занято 10/10, в очереди 4')).toBeVisible();

  // другой пользователь видит тех же игроков, но не видит тестовую панель
  const maria = await openAs(browser, MARIA, gamePath);
  await expect(maria.getByText('занято 10/10, в очереди 4')).toBeVisible();
  await expect(maria.getByText('🧪 Тестовый режим')).toHaveCount(0);

  await org.getByRole('button', { name: 'Убрать тестовых', exact: true }).click();
  await expect(org.getByText('занято 0/10', { exact: true })).toBeVisible();
  await expect(maria.getByText('занято 0/10', { exact: true })).toBeVisible();
});

test('тестовый режим: в игру можно добавить 30 тестовых игроков', async ({ browser }) => {
  const org = await openAs(browser, ORGANIZER);
  await org.getByRole('button', { name: 'Создать игру', exact: true }).click();
  await choosePlace(org, 'Большая арена', 'ул. Длинная, 30');
  await org.getByLabel('Взнос, ₽', { exact: true }).fill('0');
  await org.getByLabel('Количество команд (макс)', { exact: true }).fill('2');
  await org.getByLabel('Игроков в команде', { exact: true }).fill('5');
  await org.getByRole('button', { name: 'Создать игру', exact: true }).last().click();
  await expect(org).toHaveURL(/#\/game\/\d+$/);
  const gamePath = `/${new URL(org.url()).hash}`;
  const maria = await openAs(browser, MARIA, gamePath);
  await expect(maria.getByText('занято 0/10')).toBeVisible();

  await expect(org.getByLabel('Число тестовых игроков')).toHaveValue('30');
  await org.getByRole('button', { name: 'тестовых игроков', exact: true }).click();
  await expect(org.getByText('Добавлено тестовых игроков: 30')).toBeVisible({ timeout: 30_000 });
  await expect(org.getByText('занято 10/10, в очереди 20')).toBeVisible();
  await expect(org.getByText('Тестовый игрок 30')).toBeVisible();
  // у другого пользователя состав обновился без перезагрузки
  await expect(maria.getByText('занято 10/10, в очереди 20')).toBeVisible();
});

test('формат игры: команды и игроки в команде задают число мест в составе', async ({ browser }) => {
  const org = await openAs(browser, ORGANIZER);
  await org.getByRole('button', { name: 'Создать игру', exact: true }).click();
  await expect(org.getByLabel('Формат', { exact: true })).toHaveCount(0);
  await choosePlace(org, 'Зал команд', 'ул. Командная, 3');
  await org.getByLabel('Взнос, ₽', { exact: true }).fill('0');
  // пустое поле обязательно
  await org.getByLabel('Количество команд (макс)', { exact: true }).fill('');
  await org.getByRole('button', { name: 'Создать игру', exact: true }).last().click();
  await expect(org.getByText('целое число от 2 до 10')).toBeVisible();
  // 10 × 7 = 70 больше допустимых 60 мест
  await org.getByLabel('Количество команд (макс)', { exact: true }).fill('10');
  await org.getByLabel('Игроков в команде', { exact: true }).fill('7');
  await expect(org.getByText('Мест в составе: 70, допустимо не больше 60')).toBeVisible();
  await org.getByLabel('Количество команд (макс)', { exact: true }).fill('3');
  await expect(org.getByText('Мест в составе: 3 × 7 = 21')).toBeVisible();
  await org.getByRole('button', { name: 'Создать игру', exact: true }).last().click();
  await expect(org).toHaveURL(/#\/game\/\d+$/);
  await expect(org.getByText('до 3 команд по 7 игроков')).toBeVisible();
  await expect(org.getByText('занято 0/21')).toBeVisible();

  // при редактировании вместимость пересчитывается
  await org.getByRole('button', { name: 'Редактировать', exact: true }).click();
  await expect(org.getByLabel('Количество команд (макс)', { exact: true })).toHaveValue('3');
  await org.getByLabel('Игроков в команде', { exact: true }).fill('5');
  await org.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(org).toHaveURL(/#\/game\/\d+$/);
  await expect(org.getByText('до 3 команд по 5 игроков')).toBeVisible();
  await expect(org.getByText('занято 0/15')).toBeVisible();
});

test('команды: новые игроки распределяются сами, запись держится вместе', async ({ browser }) => {
  const org = await openAs(browser, ORGANIZER);
  await org.getByRole('button', { name: 'Создать игру', exact: true }).click();
  await choosePlace(org, 'Зал автораспределения', 'ул. Командная, 7');
  await org.getByLabel('Взнос, ₽', { exact: true }).fill('0');
  await org.getByLabel('Количество команд (макс)', { exact: true }).fill('2');
  await org.getByLabel('Игроков в команде', { exact: true }).fill('3');
  await org.getByRole('button', { name: 'Создать игру', exact: true }).last().click();
  await expect(org).toHaveURL(/#\/game\/\d+$/);
  const gamePath = `/${new URL(org.url()).hash}`;
  await org.getByRole('tab', { name: 'Команды' }).click();
  await expect(org.getByRole('button', { name: 'Распределить автоматически' })).toHaveCount(0);

  for (const [user, seats] of [
    [ALEXEY, '+2'],
    [MARIA, '+3'],
  ] as const) {
    const page = await openAs(browser, user, gamePath);
    await page.getByRole('button', { name: '+ Записаться', exact: true }).click();
    await page.getByRole('button', { name: seats, exact: true }).click();
    await expect(page.getByText(/Вы записаны/)).toBeVisible();
  }

  // у организатора команды обновились без перезагрузки: каждая запись целиком в своей команде
  const blue = org.getByRole('region', { name: 'Команда Синие' });
  const pink = org.getByRole('region', { name: 'Команда Розовые' });
  await expect(blue.getByTestId('team-seat')).toHaveText(['Алексей Смирнов', 'Алексей Смирнов +1']);
  await expect(pink.getByTestId('team-seat')).toHaveText(['Мария Сидорова', 'Мария Сидорова +1', 'Мария Сидорова +2']);
  await expect(org.getByRole('region', { name: 'Не распределены' }).getByTestId('team-seat')).toHaveCount(0);
});

test('команды: организатор перераспределяет игроков и переименовывает команду, остальные видят', async ({
  browser,
}) => {
  const org = await openAs(browser, ORGANIZER);
  await org.getByRole('button', { name: 'Создать игру', exact: true }).click();
  await choosePlace(org, 'Зал распределения', 'ул. Командная, 5');
  await org.getByLabel('Взнос, ₽', { exact: true }).fill('0');
  await org.getByLabel('Количество команд (макс)', { exact: true }).fill('2');
  await org.getByLabel('Игроков в команде', { exact: true }).fill('2');
  await org.getByRole('button', { name: 'Создать игру', exact: true }).last().click();
  await expect(org).toHaveURL(/#\/game\/\d+$/);
  const gamePath = `/${new URL(org.url()).hash}`;

  // «+3» в команды по 2 целиком не помещается: двое в первой, третий во второй
  const maria = await openAs(browser, MARIA, gamePath);
  await maria.getByRole('button', { name: '+ Записаться', exact: true }).click();
  await maria.getByRole('button', { name: '+3', exact: true }).click();
  await expect(maria.getByText('Вы записаны: 3 места в составе')).toBeVisible();

  await org.getByRole('tab', { name: 'Команды' }).click();
  const blue = org.getByRole('region', { name: 'Команда Синие' });
  const pink = org.getByRole('region', { name: 'Команда Розовые' });
  const none = org.getByRole('region', { name: 'Не распределены' });
  await expect(org.getByTestId('team-dot')).toHaveCount(2);
  await expect(blue.getByTestId('team-seat')).toHaveText(['Мария Сидорова', 'Мария Сидорова +1']);
  await expect(pink.getByTestId('team-seat')).toHaveText(['Мария Сидорова +2']);

  // перетаскивание мышью: из команды в «не распределены»
  await pink.getByRole('button', { name: 'Мария Сидорова +2', exact: true }).dragTo(none);
  await expect(none.getByText('Мария Сидорова +2')).toBeVisible();
  // выбор команды нажатием (как на телефоне); в полную команду не предлагается
  await none.getByRole('button', { name: 'Мария Сидорова +2', exact: true }).click();
  await expect(org.getByRole('button', { name: 'В команду «Синие»', exact: true })).toHaveCount(0);
  await org.getByRole('button', { name: 'В команду «Розовые»', exact: true }).click();
  await expect(pink.getByText('1/2')).toBeVisible();
  await expect(none.getByText('Все игроки состава в командах')).toBeVisible();

  // переименование
  await pink.getByRole('button', { name: /Розовые/ }).click();
  await org.getByLabel('Название команды', { exact: true }).fill('Ветераны');
  await org.getByLabel('Название команды', { exact: true }).press('Enter');
  await expect(org.getByRole('region', { name: 'Команда Ветераны' })).toBeVisible();

  // участник видит команды без перезагрузки, но не может их менять
  await maria.getByRole('tab', { name: 'Команды' }).click();
  const veterans = maria.getByRole('region', { name: 'Команда Ветераны' });
  await expect(veterans.getByText('Мария Сидорова +2')).toBeVisible();
  await expect(maria.getByRole('button', { name: 'Мария Сидорова', exact: true })).toHaveCount(0);
  await expect(maria.getByText('Перетащите игрока в команду', { exact: false })).toHaveCount(0);
});

test('результаты: пары команд со счётом каждой встречи и турнирная таблица', async ({ browser }) => {
  const org = await openAs(browser, ORGANIZER);
  await org.getByRole('button', { name: 'Создать игру', exact: true }).click();
  await choosePlace(org, 'Стадион результатов', 'ул. Турнирная, 1');
  await org.getByLabel('Взнос, ₽', { exact: true }).fill('0');
  await org.getByLabel('Количество команд (макс)', { exact: true }).fill('3');
  await org.getByLabel('Игроков в команде', { exact: true }).fill('2');
  // встреч по умолчанию 2, организатор ставит 3
  await expect(org.getByLabel('Количество встреч команд', { exact: true })).toHaveValue('2');
  await org.getByLabel('Количество встреч команд', { exact: true }).fill('3');
  await org.getByRole('button', { name: 'Создать игру', exact: true }).last().click();
  await expect(org).toHaveURL(/#\/game\/\d+$/);
  const gamePath = `/${new URL(org.url()).hash}`;

  await org.getByRole('tab', { name: 'Результаты' }).click();
  // 3 команды: 3 пары по 3 встречи, без деления на туры
  await expect(org.getByText(/^Тур /)).toHaveCount(0);
  await expect(org.getByText('Каждая пара команд играет 3 раза')).toBeVisible();
  const pair = org.getByRole('region', { name: 'Синие — Розовые' });
  await expect(org.getByRole('region', { name: / — / })).toHaveCount(3);
  await expect(pair.getByRole('group', { name: /^Встреча / })).toHaveCount(3);

  const first = pair.getByRole('group', { name: 'Встреча 1' });
  await first.getByLabel('Голы Синие', { exact: true }).fill('2');
  await first.getByLabel('Голы Розовые', { exact: true }).fill('1');
  await first.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(first.getByRole('button', { name: 'Стереть', exact: true })).toBeVisible();
  const second = pair.getByRole('group', { name: 'Встреча 2' });
  await second.getByLabel('Голы Синие', { exact: true }).fill('1');
  await second.getByLabel('Голы Розовые', { exact: true }).fill('1');
  await second.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(second.getByRole('button', { name: 'Стереть', exact: true })).toBeVisible();

  // таблица: Синие — победа и ничья (4 очка), Розовые — ничья и поражение (1 очко)
  const table = org.getByRole('table', { name: 'Турнирная таблица' });
  const firstRow = table.getByRole('row').nth(1);
  await expect(firstRow).toContainText('Синие');
  await expect(firstRow.getByRole('cell').nth(1)).toHaveText('2');
  await expect(firstRow.getByRole('cell').last()).toHaveText('4');
  await expect(table.getByRole('row').nth(2)).toContainText('Розовые');

  // участник видит счёт встреч и таблицу, но не может их менять
  const maria = await openAs(browser, MARIA, gamePath);
  await maria.getByRole('tab', { name: 'Результаты' }).click();
  const seen = maria.getByRole('region', { name: 'Синие — Розовые' });
  await expect(seen.getByRole('group', { name: 'Встреча 1' }).getByText('2 : 1')).toBeVisible();
  await expect(seen.getByRole('group', { name: 'Встреча 2' }).getByText('1 : 1')).toBeVisible();
  await expect(seen.getByRole('textbox')).toHaveCount(0);

  // организатор стирает первую встречу: у участника обновляется без перезагрузки
  await first.getByRole('button', { name: 'Стереть', exact: true }).click();
  await expect(seen.getByRole('group', { name: 'Встреча 1' }).getByText('– : –')).toBeVisible();
});
