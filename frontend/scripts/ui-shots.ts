// 冒烟快照：对一个已在运行的 BooruX 服务按 页面 × 视口 × 配色 截图，并收集控制台报错。
// 用法：bun run shots [服务地址]   （默认 http://127.0.0.1:48300；也可设置环境变量 SHOTS_URL）
// 可选环境变量：SHOTS_REDUCED=1 以 prefers-reduced-motion: reduce 截图。
// 输出：<仓库>/logs/ui-shots/yyyy-MM-dd HH-mm-ss/*.png 与同名 .log（控制台报错与页面异常）。
// 注意：首页数据实时来自 Danbooru，每次内容都不同；对话页只截空状态。这是冒烟快照，不做像素比对。
import { chromium } from 'playwright';
import type { BrowserContext, Page } from 'playwright';
import { appendFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const base = (process.argv[2] || process.env.SHOTS_URL || 'http://127.0.0.1:48300').replace(/\/$/, '');
const reduced = process.env.SHOTS_REDUCED === '1';
const pad = (n: number) => String(n).padStart(2, '0');
const now = new Date();
const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
const outDir = resolve(import.meta.dir, '..', '..', 'logs', 'ui-shots', stamp);
mkdirSync(outDir, { recursive: true });
const logFile = join(outDir, `${stamp}.log`);
const log = (line: string) => { console.log(line); appendFileSync(logFile, `${line}\n`, 'utf8'); };

const VIEWPORTS = { mobile: { width: 375, height: 812 }, desktop: { width: 1280, height: 800 } } as const;
const SCHEMES = ['light', 'dark'] as const;
const SETTINGS_GROUPS = ['settings-appearance', 'settings-content', 'settings-providers', 'settings-data', 'settings-about'];

let errors = 0;
const watch = (page: Page, label: string) => {
  page.on('console', message => {
    if (message.type() !== 'error') return;
    // 第三方图片 CDN 加载失败（离线、被拦截）不算应用错误；同源资源失败仍然记录。
    const url = message.location().url || '';
    if (url && !url.startsWith(base) && /Failed to load resource/.test(message.text())) return;
    errors++;
    log(`[console.error] ${label}: ${message.text()} (${url})`);
  });
  page.on('pageerror', error => { errors++; log(`[pageerror] ${label}: ${error.message}`); });
};

async function settle(page: Page) {
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => !document.querySelector('.skeleton-card, .setting-loading, .chat-loading'), null, { timeout: 15000 }).catch(() => log('  (等待加载态消失超时，按当前画面截图)'));
  await page.waitForTimeout(500);
}

async function shot(page: Page, name: string) {
  await page.screenshot({ path: join(outDir, `${name}.png`), fullPage: false });
  log(`  截图 ${name}.png`);
}

async function runMatrix(context: BrowserContext, viewport: string, scheme: string) {
  const prefix = `${viewport}-${scheme}`;
  const page = await context.newPage();
  watch(page, prefix);

  await page.goto(`${base}/`);
  await settle(page);
  await shot(page, `${prefix}-01-home`);

  // 详情页 id 从首页第一张卡片动态获取。
  const groupId = await page.locator('[data-post-group]').first().getAttribute('data-post-group').catch(() => null);
  if (groupId) {
    await page.goto(`${base}/posts/${encodeURIComponent(groupId)}`);
    await settle(page);
    await shot(page, `${prefix}-02-detail`);
    await page.goto(`${base}/`);
    await settle(page);
    const image = page.locator('.media-original').first();
    if (await image.count()) {
      await image.scrollIntoViewIfNeeded();
      await image.click();
      await page.locator('.media-viewer[open]').waitFor({ timeout: 5000 }).catch(() => log('  (看图器未能打开)'));
      await page.waitForTimeout(700);
      await shot(page, `${prefix}-03-viewer`);
    } else log('  (首页没有可点开的图片，跳过看图器)');
  } else log('  (首页没有帖子卡片，跳过详情与看图器)');

  await page.goto(`${base}/chat`);
  await settle(page);
  await shot(page, `${prefix}-04-chat-empty`);

  for (const [index, group] of SETTINGS_GROUPS.entries()) {
    await page.goto(`${base}/settings?tab=${group}`);
    await settle(page);
    await shot(page, `${prefix}-05-settings-${index + 1}-${group.replace('settings-', '')}`);
  }
  await page.close();
}

const browser = await chromium.launch();
try {
  log(`目标 ${base}，输出 ${outDir}${reduced ? '（reduced-motion）' : ''}`);
  for (const [viewport, size] of Object.entries(VIEWPORTS)) {
    for (const scheme of SCHEMES) {
      log(`== ${viewport} ${size.width}x${size.height} / ${scheme}`);
      const context = await browser.newContext({ viewport: size, colorScheme: scheme, reducedMotion: reduced ? 'reduce' : 'no-preference', deviceScaleFactor: viewport === 'mobile' ? 2 : 1, hasTouch: viewport === 'mobile', isMobile: viewport === 'mobile' });
      await runMatrix(context, viewport, scheme);
      await context.close();
    }
  }
} finally {
  await browser.close();
}
log(errors ? `完成：共记录 ${errors} 条控制台/页面错误，见 ${logFile}` : '完成：未发现控制台或页面错误');
process.exit(errors ? 1 : 0);
