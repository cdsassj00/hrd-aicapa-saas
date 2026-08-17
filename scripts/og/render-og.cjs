// OG 공유 썸네일(1200×630) 렌더링 스크립트.
// scripts/og/og-template.html 을 Chromium 으로 그려 public/og.png 로 저장한다.
// 한글은 Pretendard 를 CDN 에서 받아 쓰므로 네트워크가 필요하다.
//
// 실행: node scripts/og/render-og.cjs
// 브라우저 경로는 PW_CHROMIUM 환경변수로 덮어쓸 수 있다(기본: 컨테이너의 /opt/pw-browsers/chromium).
const { chromium } = require('playwright-core');
const path = require('path');

const EXEC = process.env.PW_CHROMIUM || '/opt/pw-browsers/chromium';

(async () => {
  const browser = await chromium.launch({
    executablePath: EXEC,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 2 });
  const file = 'file://' + path.resolve(__dirname, 'og-template.html');
  await page.goto(file, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready); // CDN 웹폰트 적용 대기
  await page.waitForTimeout(2500);
  const out = path.resolve(__dirname, '../../public/og.png');
  await page.screenshot({ path: out, clip: { x: 0, y: 0, width: 1200, height: 630 } });
  console.log('wrote', out);
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
