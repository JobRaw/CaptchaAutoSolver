const fs = require('fs');
const text = fs.readFileSync('/Users/joy/.gemini/antigravity/brain/11255e6e-f796-4c19-af74-5db8dfba06c6/.system_generated/steps/287/output.txt', 'utf8');
const jsonStr = text.replace('Script ran on page and returned:\n```json\n', '').replace('\n```', '');
const data = JSON.parse(JSON.parse(jsonStr)); // It's double JSON encoded string?
data.forEach(el => {
  if (el.className && typeof el.className === 'string' && (el.className.includes('slider') || el.className.includes('img') || el.className.includes('icon') || el.className.includes('btn') || el.tag === 'IMG')) {
    console.log(`<${el.tag} class="${el.className}" id="${el.id}" src="${el.src ? el.src.substring(0,20)+'...' : ''}">`);
  }
});
