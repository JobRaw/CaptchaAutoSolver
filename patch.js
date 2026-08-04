const fs = require('fs');
let code = fs.readFileSync('offscreen/offscreen.js', 'utf8');

code = code.replace(
  /层 \[外 \$\{v2BestPair\?\.o\}, 内 \$\{v2BestPair\?\.i\}\]/g,
  "层 [外 ${v2BestPair ? v2BestPair.o : 'N/A'}, 内 ${v2BestPair ? v2BestPair.i : 'N/A'}]"
);

code = code.replace(
  /if \(!success\) errorMsg = `V1 置信度过低 \(\$\{v1BestScore\.toFixed\(3\)\} <= 0\.05\)`/g,
  "if (!success) errorMsg = v1BestScore === -Infinity ? 'V1 运行失败' : `V1 置信度过低 (${v1BestScore.toFixed(3)} <= 0.05)`"
);

code = code.replace(
  /if \(!success\) errorMsg = `V2 置信度过低 \(\$\{v2BestScore\.toFixed\(3\)\} <= 0\.08\)` \+ \(v2ErrorMsg \? ` \| \$\{v2ErrorMsg\}` : ''\)/g,
  "if (!success) errorMsg = v2BestScore === -Infinity ? (v2ErrorMsg || 'V2 运行失败') : (`V2 置信度过低 (${v2BestScore.toFixed(3)} <= 0.08)` + (v2ErrorMsg ? ` | ${v2ErrorMsg}` : ''))"
);

fs.writeFileSync('offscreen/offscreen.js', code);
console.log("Patched.");
