import type { MigrationSession } from '@prisma/client';
import { prisma } from '../infra/db/prisma.js';

export interface CreateSessionInput {
  name: string;
  operatorRef: string;
  createdBy?: string;
  notes?: string;
}

export class SessionService {
  create(input: CreateSessionInput): Promise<MigrationSession> {
    return prisma.migrationSession.create({ data: input });
  }

  get(id: string): Promise<MigrationSession | null> {
    return prisma.migrationSession.findUnique({ where: { id } });
  }

  list(): Promise<MigrationSession[]> {
    return prisma.migrationSession.findMany({ orderBy: { createdAt: 'desc' } });
  }
}
