/**
 * Seed: creates the default admin if it does not exist. Nothing else.
 *
 * NON-DESTRUCTIVE. This script never deletes or modifies products, categories
 * or any other record. It used to delete every Product and Category before
 * creating the admin; that step seeded nothing and has been removed so the
 * script is safe to run against a database that already holds a catalogue.
 * To delete the catalogue deliberately, use `npm run db:clear-products-categories`
 * (local databases only, with explicit confirmation).
 */
import connectDB from './connection';
import Admin from '../models/Admin';
import bcrypt from 'bcryptjs';

async function seed() {
  try {
    console.log('🔄 Connecting to MongoDB...');
    await connectDB();
    console.log('✅ Connected! Starting seed...');

    // Create default admin only (admin@edinc.com / Admin1234)
    const defaultEmail = 'admin@edinc.com';
    const existingAdmin = await Admin.findOne({ email: defaultEmail });
    if (!existingAdmin) {
      const hashedPassword = await bcrypt.hash('Admin1234', 10);
      await Admin.create({
        email: defaultEmail,
        password_hash: hashedPassword,
        name: 'Admin',
        role: 'admin',
      });
      console.log('✅ Default admin created (email: admin@edinc.com, password: Admin1234)');
    } else {
      console.log('✅ Admin already exists');
    }

    console.log('✅ Seed complete. Existing products and categories were not touched.');
    process.exit(0);
  } catch (error: any) {
    console.error('❌ Seeding failed:', error);
    if (error.message?.includes('MongoServerError') || error.message?.includes('connection')) {
      console.error('\n💡 TIP: Make sure MongoDB is running and MONGODB_URI in .env is correct!');
    }
    process.exit(1);
  }
}

seed();
