import { existsSync } from 'node:fs';
import { chromium } from 'playwright-core';

export function browserOptions() {
  const candidates = [process.env.CHROME_PATH,
    process.platform === 'win32' ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : null,
    process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : null,
    chromium.executablePath()].filter(Boolean);
  const executablePath = candidates.find(existsSync);
  if (!executablePath) throw new Error('Install a test browser with: npx playwright-core install chromium (or set CHROME_PATH).');
  return { executablePath, headless: true,
    args: ['--enable-webgl', '--ignore-gpu-blocklist', ...(process.env.CI ? ['--enable-unsafe-swiftshader'] : [])] };
}
