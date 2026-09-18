import { Module } from "@nestjs/common";
import { DatabaseModule } from "../database/database.module.js";
import { ProcurementController } from "./procurement.controller.js";
import { ProcurementService } from "./procurement.service.js";

@Module({
  imports: [DatabaseModule],
  controllers: [ProcurementController],
  providers: [ProcurementService]
})
export class ProcurementModule {}
