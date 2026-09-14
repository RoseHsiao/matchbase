import { defineConfig, env } from "prisma/config";

/**
 * Prisma 7 CLI configuration.
 *
 * Prisma 7 no longer reads .env files on its own. Next.js loads them for the
 * application; this file loads them for the CLI using Node's built-in loader
 * (Node >= 20.12). Variables already present in the environment win, and the
 * first file listed wins over later ones.
 */
for (const file of [".env.local", ".env"]) {
  try {
    process.loadEnvFile(file);
  } catch {
    // File is optional (for example in CI, where variables are injected).
  }
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    // `prisma db seed` runs this. The seed is idempotent (upsert by id).
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    // Migrations and introspection use the direct (unpooled) Neon connection.
    // The pooled connection routes through PgBouncer in transaction mode, which
    // breaks Prisma Migrate. The application runtime uses the pooled
    // DATABASE_URL through the driver adapter instead.
    url: env("DATABASE_URL_UNPOOLED"),
  },
});
