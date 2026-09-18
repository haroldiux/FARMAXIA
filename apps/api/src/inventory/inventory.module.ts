import { Module } from "@nestjs/common";
import { DatabaseModule } from "../database/database.module.js";
import { InventoryController } from "./inventory.controller.js";
import { InventoryService } from "./inventory.service.js";

@Module({
  imports: [DatabaseModule],
  controllers: [InventoryController],
  providers: [InventoryService]
})
export class InventoryModule {}
