import { PrismaClient } from '@prisma/client';
import { env } from '../../config/env.js';

/**
 * Single PrismaClient for the migration service DB. This is the ONLY database
 * this service connects to — it never touches operator-platform tables.
 */
export const prisma = new PrismaClient({
  log: env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
});

export async function disconnectPrisma(): Promise<void> {
  await prisma.$disconnect();
}
