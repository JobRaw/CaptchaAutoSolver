const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();
  
  // Set viewport
  await page.setViewport({ width: 375, height: 667, isMobile: true });
  
  console.log('Navigating...');
  await page.goto('https://m.jf.10086.cn/#/pages/user/login/loginSms', { waitUntil: 'networkidle2' });
  
  // Wait a bit
  await page.waitForTimeout(2000);
  
  // Enter phone number
  console.log('Typing phone number...');
  const inputs = await page.$$('input');
  if (inputs.length > 0) {
      await inputs[0].type('13800138000', { delay: 100 });
  }
  
  // Click get SMS code
  console.log('Clicking get SMS...');
  const buttons = await page.$$('.get-code-btn, .getCode, button');
  for (let btn of buttons) {
      const text = await page.evaluate(el => el.innerText, btn);
      if (text && text.includes('获取验证码')) {
          await btn.click();
          break;
      }
  }
  
  // Wait for captcha
  console.log('Waiting for captcha...');
  await page.waitForTimeout(3000);
  
  // Find anything that looks like captcha
  const captchaHTML = await page.evaluate(() => {
      const captchas = document.querySelectorAll('.yidun, .captcha, [class*="captcha"], [class*="yidun"], [id*="captcha"]');
      let res = '';
      captchas.forEach(c => {
          res += c.outerHTML + '\n\n';
      });
      return res;
  });
  
  console.log('Captcha HTML length:', captchaHTML.length);
  if (captchaHTML.length > 0) {
      console.log('--- HTML START ---');
      console.log(captchaHTML.substring(0, 1500));
      console.log('--- HTML END ---');
  } else {
      console.log('No captcha found. Dumping body:');
      console.log(await page.evaluate(() => document.body.innerHTML.substring(0, 1000)));
  }
  
  await browser.close();
})();
