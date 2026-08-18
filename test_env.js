const fs = require('fs');
const dotenv = require('dotenv');
const p = require('path').join(__dirname, 'src-backend', '.env');
console.log('exists:', fs.existsSync(p));
if (fs.existsSync(p)) {
    const raw = fs.readFileSync(p);
    console.log('keys:', Object.keys(dotenv.parse(raw)));
}
