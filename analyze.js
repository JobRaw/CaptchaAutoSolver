const fs = require('fs');
const lines = fs.readFileSync('metrics.jsonl', 'utf8').split('\n').filter(Boolean);
const data = lines.map(JSON.parse);

let v1ChosenFail = 0;
let v1ChosenSuccess = 0;
let v2ChosenFail = 0;
let v2ChosenSuccess = 0;

console.log("Analyzing...");
for (const d of data) {
    if (d.chosenAlgo === 'V1') {
        if (d.outcome === 'SUCCESS') v1ChosenSuccess++;
        if (d.outcome === 'FAIL') {
           v1ChosenFail++;
           console.log(`V1 Fail: v1Angle=${d.v1Angle}, v1Score=${d.v1Score.toFixed(3)}, v2Angle=${d.v2Angle}, v2Score=${d.v2Score.toFixed(3)}`);
        }
    } else if (d.chosenAlgo === 'V2') {
        if (d.outcome === 'SUCCESS') v2ChosenSuccess++;
        if (d.outcome === 'FAIL') {
           v2ChosenFail++;
           console.log(`V2 Fail: v1Angle=${d.v1Angle}, v1Score=${d.v1Score.toFixed(3)}, v2Angle=${d.v2Angle}, v2Score=${d.v2Score.toFixed(3)}`);
        }
    }
}
console.log(`\nV1: Success=${v1ChosenSuccess}, Fail=${v1ChosenFail}`);
console.log(`V2: Success=${v2ChosenSuccess}, Fail=${v2ChosenFail}`);
