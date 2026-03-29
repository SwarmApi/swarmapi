const fs = require('fs');
const content = fs.readFileSync('D:/code/claws/swarm-queen/queen.js', 'utf8');
const lines = content.split('\n');

let openBrackets = 0;
let openParens = 0;
let openBraces = 0;
let inString = false;
let stringChar = '';

for (let i = 243; i < 444; i++) {
  const line = lines[i];
  for (let j = 0; j < line.length; j++) {
    const c = line[j];
    if (inString) {
      if (c === '\\') {
        j++;
        continue;
      }
      if (c === stringChar) {
        inString = false;
      }
    } else {
      if (c === '"' || c === "'" || c === '`') {
        inString = true;
        stringChar = c;
      } else if (c === '[') {
        openBrackets++;
      } else if (c === ']') {
        openBrackets--;
      } else if (c === '(') {
        openParens++;
      } else if (c === ')') {
        openParens--;
      } else if (c === '{') {
        openBraces++;
      } else if (c === '}') {
        openBraces--;
      }
    }
  }
}

console.log('Brackets:', openBrackets, 'Parens:', openParens, 'Braces:', openBraces, 'In string:', inString);
