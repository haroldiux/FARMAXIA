import { Module } from "@nestjs/common";
import { TenantDatabase } from "./tenant-database.js";

@Module({
  providers: [
    {
      provide: TenantDatabase,
      useFactory: () =>
        new TenantDatabase(
          process.env.DATABASE_APP_URL ??
            process.env.DATABASE_APP_TEST_URL ??
            "postgresql://farmaxia_app:local-development-only@localhost:5433/farmaxia_test"
        )
    }
  ],
  exports: [TenantDatabase]
})
export class DatabaseModule {}
