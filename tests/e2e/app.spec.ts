import { expect, test } from '@playwright/test';

test('catalog search and event details show current inventory', async ({ page }) => {
  await page.goto('/wydarzenia');
  await expect(page.getByRole('heading', { name: /odkryj wydarzenia/i })).toBeVisible();
  await expect(page.getByText('Noc Świateł — koncert na Stadionie')).toBeVisible();
  await page.getByLabel('Szukaj wydarzeń').fill('design');
  await expect(page.getByText('Design Systems Meetup')).toBeVisible();
  await expect(page.getByText('Noc Świateł — koncert na Stadionie')).toHaveCount(0);
});

test('registration creates a normal user account', async ({ page }) => {
  const email = `e2e-${Date.now()}@ticketmaestro.local`;
  await page.goto('/rejestracja');
  await page.getByLabel('Imię').fill('Testowy Użytkownik');
  await page.getByLabel('Adres e-mail').fill(email);
  await page.getByLabel('Hasło').fill('TicketMaestro123!');
  await page.getByRole('button', { name: /utwórz konto/i }).last().click();
  await expect(page).toHaveURL(/moje-rezerwacje/);
  await expect(page.getByRole('button', { name: 'Wyloguj' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Panel organizatora' })).toHaveCount(0);
});

test('a user can create a reservation, complete simulated checkout, and print ticket details', async ({ page }) => {
  await page.goto('/login');
  await page.getByRole('button', { name: /użyj konta demo/i }).click();
  await page.getByRole('button', { name: /zaloguj się/i }).last().click();
  await expect(page).toHaveURL(/moje-rezerwacje/);
  await page.getByRole('link', { name: /znajdź wydarzenie/i }).click();
  await page.getByRole('link', { name: /jazz nad wartą/i }).click();
  await expect(page.getByRole('button', { name: 'Wyloguj' })).toBeVisible();
  await page.getByRole('button', { name: /zarezerwuj bilety/i }).click();
  await expect(page).toHaveURL(/rezerwacja\//);
  await page.getByRole('button', { name: /potwierdź zakup testowy/i }).click();
  await expect(page).toHaveURL(/potwierdzenie\//);
  await expect(page.getByText(/TM-[A-Z0-9]{12}/)).toBeVisible();
  await expect(page.getByRole('button', { name: /drukuj \/ zapisz pdf/i })).toBeVisible();
});

test('admin dashboard uses the authenticated admin role', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Adres e-mail').fill('admin@ticketmaestro.local');
  await page.getByLabel('Hasło').fill('TicketMaestro123!');
  await page.getByRole('button', { name: /zaloguj się/i }).last().click();
  await expect(page).toHaveURL(/moje-rezerwacje/);
  await page.goto('/admin');
  await expect(page.getByRole('heading', { name: /przegląd platformy/i })).toBeVisible();
  await expect(page.getByText('DANE NA ŻYWO')).toBeVisible();
});
