import { hashPassword } from '../auth.js';

const password = process.argv[2];

if (!password) {
  console.error('Usage: node server/scripts/hash-password.js "your master password"');
  process.exit(1);
}

console.log(await hashPassword(password));