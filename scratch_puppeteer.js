const puppeteer = require('puppeteer-core');
const fs = require('fs');
(async () => {
    // Find Chrome executable path for Mac
    const executablePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
    const browser = await puppeteer.launch({ executablePath, headless: true });
    const page = await browser.newPage();
    await page.setViewport({ width: 375, height: 667, isMobile: true });
    await page.goto('https://m.jf.10086.cn/#/pages/user/login/loginSms', { waitUntil: 'networkidle2' });
    
    // Type phone
    const inputs = await page.$$('input');
    if (inputs.length > 0) {
        await inputs[0].type('13800138000', { delay: 50 });
    }
    
    // Click button
    const btn = await page.$('.getCode');
    if (btn) await btn.click();
    
    // Wait for captcha
    await new Promise(r => setTimeout(r, 2000));
    
    // Extract captcha DOM and styles
    const data = await page.evaluate(() => {
        const captchas = document.querySelectorAll('.yidun, [class*="captcha"], [id*="captcha"]');
        if (captchas.length === 0) return 'No captcha found';
        
        let res = '';
        for (let c of captchas) {
            res += c.outerHTML + '\n';
        }
        
        // Let's also find elements that have background-image
        const allElements = document.querySelectorAll('*');
        let bgElements = [];
        for (let el of allElements) {
            const bg = window.getComputedStyle(el).backgroundImage;
            if (bg && bg !== 'none' && el.offsetWidth > 30) {
                const rect = el.getBoundingClientRect();
                bgElements.push({
                    className: el.className,
                    tag: el.tagName,
                    bg: bg,
                    width: rect.width,
                    height: rect.height,
                    borderRadius: window.getComputedStyle(el).borderRadius,
                    bgSize: window.getComputedStyle(el).backgroundSize,
                    bgPos: window.getComputedStyle(el).backgroundPosition
                });
            }
        }
        return JSON.stringify({ captchas: res, bgElements: bgElements }, null, 2);
    });
    
    fs.writeFileSync('/Users/joy/project/CaptchaAutoSolver/cmcc_captcha.json', data);
    console.log('Saved to cmcc_captcha.json');
    await browser.close();
})();
