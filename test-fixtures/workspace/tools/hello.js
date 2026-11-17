// Writes its arguments to node.out in the current directory (checked by the tests).
const message = 'hello from node ' + process.argv.slice(2).join(' ');
console.log(message);
require('fs').writeFileSync('node.out', message + '\n');
