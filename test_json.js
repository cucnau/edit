import fs from 'fs';
const file = JSON.parse(fs.readFileSync('./firebase-applet-config.json'));
console.log(file);
