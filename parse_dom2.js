const fs = require('fs');
const text = fs.readFileSync('/Users/joy/.gemini/antigravity/brain/11255e6e-f796-4c19-af74-5db8dfba06c6/.system_generated/steps/287/output.txt', 'utf8');
const jsonStr = text.replace('Script ran on page and returned:\n```json\n', '').replace('\n```', '');
const data = JSON.parse(JSON.parse(jsonStr));
data.forEach(el => {
  if (el.tag === 'IMG' || el.className === 'slider-move-btn' || el.className === 'slider-move-track' || el.className === 'bg-img-div' || el.className === 'slider-img-div') {
    console.log(`<${el.tag} class="${el.className}" id="${el.id}" src="${el.src ? el.src.substring(0,20)+'...' : ''}">`);
  }
});
