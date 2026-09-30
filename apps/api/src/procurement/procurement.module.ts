import { Module } from "@nestjs/common";
import { DatabaseModule } from "../database/database.module.js";
import { PayablesService } from "./payables.service.js";
import { ProcurementFinanceController } from "./procurement-finance.controller.js";
import { ProcurementController } from "./procurement.controller.js";
import { ProcurementService } from "./procurement.service.js";
import { ReorderService } from "./reorder.service.js";

@Module({
  imports: [DatabaseModule],
  controllers: [ProcurementController, ProcurementFinanceController],
  providers: [PayablesService, ProcurementService, ReorderService]
})
export class ProcurementModule {}
