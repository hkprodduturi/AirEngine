/**
 * Doctor Command
 *
 * Runs diagnostic checks to verify the development environment is ready.
 */

import { execSync } from 'child_process';
import { readFileSync, existsSync } from 'fs';
import { createServer } from 'net';

export interface DoctorCheck {
  name: string;
  status: 'pass' | 'fail' | 'warn';
  message: string;
}

export async function runDoctorChecks(airFile?: string): Promise<DoctorCheck[]> {
  const checks: DoctorCheck[] = [];

  // Node version >= 18
  const nodeVersion = process.version;
  const major = parseInt(nodeVersion.slice(1), 10);
  checks.push({
    name: 'Node.js',
    status: major >= 18 ? 'pass' : 'fail',
    message: major >= 18
      ? `${nodeVersion} (>= 18 required)`
      : `${nodeVersion} — upgrade to Node.js 18+`,
  });

  // npm available
  try {
    const npmVersion = execSync('npm --version', { encoding: 'utf-8' }).trim();
    checks.push({ name: 'npm', status: 'pass', message: `v${npmVersion}` });
  } catch {
    checks.push({ name: 'npm', status: 'fail', message: 'npm not found in PATH' });
  }

  // Port 3000 free
  const port3000 = await isPortFree(3000);
  checks.push({
    name: 'Port 3000',
    status: port3000 ? 'pass' : 'warn',
    message: port3000 ? 'available' : 'in use (client dev server may conflict)',
  });

  // Port 3001 free
  const port3001 = await isPortFree(3001);
  checks.push({
    name: 'Port 3001',
    status: port3001 ? 'pass' : 'warn',
    message: port3001 ? 'available' : 'in use (API server may conflict)',
  });

  // .air file parses
  if (airFile && existsSync(airFile)) {
    try {
      const source = readFileSync(airFile, 'utf-8');
      // Dynamic import to avoid circular dep at module level
      const { parse } = await import('../parser/index.js');
      parse(source);
      checks.push({ name: '.air parse', status: 'pass', message: `${airFile} parses successfully` });
    } catch (err) {
      checks.push({
        name: '.air parse',
        status: 'fail',
        message: `${airFile}: ${err instanceof Error ? err.message : String(err)}`,
      });
    }

    // Check if Prisma CLI available (if @db)
    const source = readFileSync(airFile, 'utf-8');
    if (source.includes('@db')) {
      try {
        execSync('npx prisma --version', { encoding: 'utf-8', stdio: 'pipe' });
        checks.push({ name: 'Prisma CLI', status: 'pass', message: 'available' });
      } catch {
        checks.push({ name: 'Prisma CLI', status: 'warn', message: 'not found (needed for @db)' });
      }
    }
  }

  return checks;
}

function isPortFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => {
      server.close(() => resolve(true));
    });
    server.listen(port, '127.0.0.1');
  });
}
