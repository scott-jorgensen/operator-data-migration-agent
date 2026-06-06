import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import type { ArtifactStore } from '../../ports/artifact-store.port.js';

/**
 * Local-filesystem ArtifactStore. Keys are relative paths under `baseDir`;
 * traversal outside the base is rejected.
 */
export class LocalFsArtifactStore implements ArtifactStore {
  private readonly base: string;

  constructor(baseDir: string) {
    this.base = resolve(baseDir);
  }

  async put(key: string, bytes: Buffer): Promise<void> {
    const full = this.pathFor(key);
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, bytes);
  }

  async get(key: string): Promise<Buffer> {
    return readFile(this.pathFor(key));
  }

  private pathFor(key: string): string {
    const full = resolve(this.base, key);
    if (full !== this.base && !full.startsWith(this.base + sep)) {
      throw new Error(`invalid artifact key: ${key}`);
    }
    return full;
  }
}
