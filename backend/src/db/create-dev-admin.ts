/* Task 02 one-shot: create a development-only admin using the existing
 * Admin model + bcryptjs hashing pipeline. Password is taken from
 * DEV_ADMIN_PASSWORD (never hardcoded). Delete this file after use. */
import '../load-env';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import connectDB from './connection';
import Admin from '../models/Admin';

async function main() {
  const email = process.env.DEV_ADMIN_EMAIL || 'dev-admin@local.test';
  const password = process.env.DEV_ADMIN_PASSWORD;
  if (!password) {
    console.error('DEV_ADMIN_PASSWORD is required');
    process.exit(2);
  }
  await connectDB();
  const dbName = mongoose.connection.name;
  if (dbName !== 'express_distributors_dev') {
    console.error(`Refusing to seed admin: connected DB is "${dbName}", expected "express_distributors_dev"`);
    process.exit(3);
  }
  const existing = await Admin.findOne({ email });
  if (existing) {
    console.log(JSON.stringify({ status: 'exists', email, db: dbName }));
    await mongoose.disconnect();
    return;
  }
  const password_hash = await bcrypt.hash(password, 12);
  const created = await Admin.create({ email, password_hash, name: 'Dev Admin', role: 'admin' });
  console.log(JSON.stringify({ status: 'created', email: created.email, db: dbName }));
  await mongoose.disconnect();
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('create-dev-admin failed:', err);
    process.exit(1);
  });
