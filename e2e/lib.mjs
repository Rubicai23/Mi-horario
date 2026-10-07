import { createRequire } from 'node:module';
const require = createRequire('/home/claude/.npm-global/lib/node_modules/');
export const { chromium } = require('playwright');
export const FIXED = new Date('2026-10-07T12:00:00+02:00');
export async function open({ lang, dark } = {}) {
  const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined });
  const context = await browser.newContext({ viewport: { width: 390, height: 800 }, timezoneId: 'Europe/Madrid', locale: lang || 'es-ES', colorScheme: dark ? 'dark' : 'light', serviceWorkers: 'block' });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.clock.install({ time: FIXED });
  return { browser, context, page, errors };
}
