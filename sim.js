const fs = require('fs');
const lines = fs.readFileSync('metrics.jsonl', 'utf8').split('\n').filter(Boolean);
const data = lines.map(JSON.parse);

let newSuccess = 0;
let newFail = 0;

for (const d of data) {
    if (d.outcome === 'FAIL') {
        let chosenNew = 0;
        let v1_v2_diff = Math.min(Math.abs(d.v1Angle - d.v2Angle), 360 - Math.abs(d.v1Angle - d.v2Angle));
        
        let newAngle = 0;
        if (d.v1Score > 0.055) {
            if (v1_v2_diff < 30 && d.v2Score > 0.7) {
                newAngle = d.v2Angle; // Trust V2 for precision
            } else {
                newAngle = d.v1Angle; // Trust V1 for robustness
            }
        } else if (d.v2Score > 0.8) {
            newAngle = d.v2Angle;
        }

        console.log(`[SIM] Old Chosen: ${d.chosenAlgo}(${d.chosenAlgo==='V1'?d.v1Angle:d.v2Angle}), New Chosen: ${newAngle === d.v1Angle ? 'V1' : 'V2'}(${newAngle}). Diff=${v1_v2_diff}`);
    }
}
