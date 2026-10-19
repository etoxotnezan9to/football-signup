import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';

// Тестовые пользователи режима моков (apps/web/src/session.ts)
const ORGANIZER = 1001; // Иван Петров
const MARIA = 1002; // Мария Сидорова
const ALEXEY = 1003; // Алексей Смирнов

const opened: BrowserContext[] = [];

/** Выбор места в комбобоксе формы игры; если места ещё нет, создаём его прямо из формы. */
async function choosePlace(page: Page, name: string, address: string): Promise<void> {
  await page.getByRole('button', { name: '+ Новое место', exact: true }).click();
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
  await org.getByLabel('Число мест в составе', { exact: true }).fill('4');
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
  await org.getByLabel('Число мест в составе', { exact: true }).fill('20');
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
  await expect(org.getByText('целое число от 2 до 60')).toBeVisible();
  await expect(org.getByLabel('Название', { exact: true })).toHaveCount(0);
  await expect(org).toHaveURL(/#\/create$/);
});

test('место: создаётся на отдельной странице и выбирается в форме игры из списка', async ({ browser }) => {
  const org = await openAs(browser, ORGANIZER);
  await org.getByRole('button', { name: 'Добавить место', exact: true }).click();
  await expect(org).toHaveURL(/#\/places\/new$/);
  await org.getByRole('button', { name: 'Сохранить место', exact: true }).click();
  await expect(org.getByText('длина от 1 до 80').first()).toBeVisible();
  await org.getByLabel('Название места', { exact: true }).fill('Манеж E2E');
  await org.getByLabel('Адрес места', { exact: true }).fill('пр. Спортивный, 3');
  await org.getByRole('button', { name: 'Сохранить место', exact: true }).click();
  await expect(org).toHaveURL(/#\/$/);

  await org.getByRole('button', { name: 'Создать игру', exact: true }).click();
  await org.getByLabel('Место', { exact: true }).click();
  await org.getByRole('option', { name: /Манеж E2E/ }).click();
  await org.getByLabel('Взнос, ₽', { exact: true }).fill('500');
  await org.getByLabel('Число мест в составе', { exact: true }).fill('12');
  await org.getByRole('button', { name: 'Создать игру', exact: true }).last().click();
  await expect(org).toHaveURL(/#\/game\/\d+$/);
  await expect(org.getByText('Манеж E2E, пр. Спортивный, 3')).toBeVisible();
  // вместо названия у игры дата и место
  await org.goto('/#/');
  await expect(org.getByText(/· Манеж E2E$/).first()).toBeVisible();
});
