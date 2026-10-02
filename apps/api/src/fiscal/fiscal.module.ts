import { Module } from "@nestjs/common";
import { DatabaseModule } from "../database/database.module.js";
import { FISCAL_PROVIDER } from "./fiscal-provider.js";
import { FiscalController } from "./fiscal.controller.js";
import { FiscalService } from "./fiscal.service.js";
import { StubFiscalProvider } from "./stub-fiscal-provider.js";

/** F13 scaffold module. Only the stub adapter is wired here; the real SIN adapter is blocked on D03. */
@Module({
  imports: [DatabaseModule],
  controllers: [FiscalController],
  providers: [FiscalService, { provide: FISCAL_PROVIDER, useClass: StubFiscalProvider }]
})
export class FiscalModule {}
