const str = "abc\n\ndef\n";
const tLines = str.split('\n').map(l => l.trim()).filter(l => l);
console.log(tLines);
