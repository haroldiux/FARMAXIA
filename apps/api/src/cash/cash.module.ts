import { Module } from "@nestjs/common";
import { DatabaseModule } from "../database/database.module.js";
import { CashController } from "./cash.controller.js";
import { CashService } from "./cash.service.js";

@Module({
  imports: [DatabaseModule],
  controllers: [CashController],
  providers: [CashService]
})
export class CashModule {}
