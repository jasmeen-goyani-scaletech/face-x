import { migrateUp, runSeed } from './migrate';

/** `pnpm db:migrate` and `pnpm db:seed`. Reads DATABASE_URL from the environment (see package.json scripts). */
async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  const command = process.argv[2];
  if (command === 'migrate') {
    const applied = await migrateUp(url);
    console.log(applied.length ? `Applied: ${applied.join(', ')}` : 'Database is up to date');
  } else if (command === 'seed') {
    if (process.env.NODE_ENV === 'production') throw new Error('Refusing to seed in production');
    await runSeed(url);
    console.log('Seed loaded');
  } else {
    throw new Error('Usage: cli.ts migrate | seed');
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
