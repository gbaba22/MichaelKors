/**
 * End-to-end check of the built app against a running server on :3100.
 *  1. a business user completes and submits an assessment
 *  2. the thank-you screen shows no scores
 *  3. the admin sees that respondent's row and the computed scores
 *  4. a second submission moves the chart with no reload (real-time)
 */
import { chromium } from 'playwright';

const BASE = process.env.BASE ?? 'http://localhost:3100';
const OUT = process.env.OUT ?? '/tmp/shots';
const PASSWORD = 'letmein';

const log = (...a) => console.log('·', ...a);
const fail = (m) => {
  console.error('FAIL:', m);
  process.exitCode = 1;
};

/** Fills one opportunity's questions by clicking the option with `score`. */
async function answerCurrentOpportunity(page, score) {
  const groups = page.locator('.question');
  const count = await groups.count();
  for (let i = 0; i < count; i++) {
    await groups.nth(i).locator('.scale-option', { hasText: new RegExp(`^${score}`) }).first().click();
  }
  return count;
}

async function takeAssessment(browser, { name, email, team, score }) {
  const context = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
  const page = await context.newPage();
  await page.goto(BASE, { waitUntil: 'networkidle' });

  await page.fill('input[autocomplete="name"]', name);
  await page.fill('input[autocomplete="email"]', email);
  await page.selectOption('select', { label: team });
  await page.click('button:has-text("Start assessment")');
  await page.waitForSelector('.question');

  const total = Number((await page.locator('.pager-dot').count()) || 0);
  log(`${name}: ${total} opportunities to score`);

  let questions = 0;
  for (let i = 0; i < total; i++) {
    questions = await answerCurrentOpportunity(page, score);
    if (i === 0) await page.screenshot({ path: `${OUT}/1-assess-scoring.png` });
    if (i < total - 1) await page.click('button:has-text("Next opportunity")');
  }
  await page.waitForSelector('button:has-text("Submit assessment")');
  await page.click('button:has-text("Submit assessment")');
  await page.waitForSelector('text=Thank you');

  // The respondent must never see a score, a chart or a ranking.
  const body = (await page.locator('body').innerText()).toLowerCase();
  for (const forbidden of ['impact', 'feasibility', 'overall', 'score of', 'ranking']) {
    if (body.includes(forbidden)) fail(`thank-you page leaks "${forbidden}"`);
  }
  if (await page.locator('svg.chart-surface').count()) fail('thank-you page renders a chart');
  await page.screenshot({ path: `${OUT}/2-assess-done.png` });

  log(`${name}: submitted ${total} opportunities x ${questions} questions`);
  await context.close();
  return { total, questions };
}

const browser = await chromium.launch();

// --- 1 & 2: business-user flow ------------------------------------------------
const first = await takeAssessment(browser, {
  name: 'Ada Lovelace',
  email: 'ada@example.com',
  team: 'Supply Chain',
  score: 75,
});
if (first.questions !== 10) fail(`expected 10 questions, saw ${first.questions}`);

// --- 3: admin sees it ---------------------------------------------------------
const admin = await browser.newContext({ viewport: { width: 1500, height: 1100 } });
const adminPage = await admin.newPage();
await adminPage.goto(`${BASE}/admin`, { waitUntil: 'networkidle' });
await adminPage.screenshot({ path: `${OUT}/3-admin-login.png` });
await adminPage.fill('input[type="password"]', PASSWORD);
await adminPage.click('button:has-text("Sign in")');
await adminPage.waitForSelector('svg.chart-surface', { timeout: 15000 });
await adminPage.waitForTimeout(600);
await adminPage.screenshot({ path: `${OUT}/4-admin-analytics.png`, fullPage: true });

const marksBefore = await adminPage.locator('svg.chart-surface circle[stroke="var(--surface)"]').count();
log(`admin chart shows ${marksBefore} marks`);
if (marksBefore !== first.total) fail(`expected ${first.total} marks, saw ${marksBefore}`);

// Hover a mark and confirm the tooltip.
await adminPage.locator('svg.chart-surface circle[fill="var(--series-impact)"]').first().hover({ force: true });
await adminPage.waitForTimeout(300);
if (!(await adminPage.locator('.chart-tooltip').count())) fail('no tooltip on hover');
await adminPage.screenshot({ path: `${OUT}/5-admin-chart-hover.png` });

// Responses tab: the individual answers must be there.
await adminPage.click('button:has-text("Responses")');
await adminPage.waitForSelector('table');
const responsesText = await adminPage.locator('body').innerText();
if (!responsesText.includes('ada@example.com')) fail('admin does not show the respondent');
await adminPage.screenshot({ path: `${OUT}/6-admin-responses.png`, fullPage: true });

// Factors & Weights tab.
await adminPage.click('button:has-text("Factors & Weights")');
await adminPage.waitForSelector('text=Impact factors');
await adminPage.screenshot({ path: `${OUT}/7-admin-factors.png`, fullPage: true });

// Opportunities tab.
await adminPage.click('button:has-text("AI Opportunities")');
await adminPage.waitForSelector('table');
await adminPage.screenshot({ path: `${OUT}/8-admin-opportunities.png`, fullPage: true });

// --- 4: real-time ------------------------------------------------------------
await adminPage.click('button:has-text("Analytics")');
await adminPage.waitForSelector('svg.chart-surface');
const beforeText = await adminPage.locator('.stat-row').innerText();
log('stats before second respondent:', beforeText.replace(/\n/g, ' | '));

// Submit as a different team member WITHOUT touching the admin page.
await takeAssessment(browser, {
  name: 'Grace Hopper',
  email: 'grace@example.com',
  team: 'Digital Commerce',
  score: 30,
});

// The admin page should pick this up from the SSE stream alone.
await adminPage.waitForFunction(
  () => document.querySelectorAll('svg.chart-surface circle[stroke="var(--surface)"]').length > 4,
  null,
  { timeout: 10000 },
);
const marksAfter = await adminPage.locator('svg.chart-surface circle[stroke="var(--surface)"]').count();
const afterText = await adminPage.locator('.stat-row').innerText();
log('stats after  second respondent:', afterText.replace(/\n/g, ' | '));
log(`chart marks: ${marksBefore} -> ${marksAfter} without a reload`);
if (marksAfter <= marksBefore) fail('chart did not update in real time');
if (!afterText.includes('2')) fail('respondent count did not update');
await adminPage.screenshot({ path: `${OUT}/9-admin-realtime.png`, fullPage: true });

// Dark mode rendering.
const dark = await browser.newContext({ colorScheme: 'dark', viewport: { width: 1500, height: 1100 } });
const darkPage = await dark.newPage();
await darkPage.goto(`${BASE}/admin`, { waitUntil: 'networkidle' });
await darkPage.fill('input[type="password"]', PASSWORD);
await darkPage.click('button:has-text("Sign in")');
await darkPage.waitForSelector('svg.chart-surface');
await darkPage.waitForTimeout(600);
await darkPage.screenshot({ path: `${OUT}/10-admin-dark.png`, fullPage: true });

// Phone-width assessment screen.
const phone = await browser.newContext({ viewport: { width: 390, height: 844 } });
const phonePage = await phone.newPage();
await phonePage.goto(BASE, { waitUntil: 'networkidle' });
await phonePage.fill('input[autocomplete="name"]', 'Alan Turing');
await phonePage.fill('input[autocomplete="email"]', 'alan@example.com');
await phonePage.selectOption('select', { label: 'Finance' });
await phonePage.click('button:has-text("Start assessment")');
await phonePage.waitForSelector('.question');
await phonePage.screenshot({ path: `${OUT}/11-assess-phone.png` });
const overflow = await phonePage.evaluate(
  () => document.documentElement.scrollWidth > window.innerWidth + 1,
);
if (overflow) fail('assessment page scrolls horizontally at 390px');

await browser.close();
console.log(process.exitCode ? '\nE2E FAILED' : '\nE2E PASSED');
