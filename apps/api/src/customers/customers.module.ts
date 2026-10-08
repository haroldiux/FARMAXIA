import { Module } from "@nestjs/common";
import { DatabaseModule } from "../database/database.module.js";
import { AgreementStatementsController } from "./agreement-statements.controller.js";
import { AgreementStatementsService } from "./agreement-statements.service.js";
import { AgreementsController } from "./agreements.controller.js";
import { AgreementsService } from "./agreements.service.js";
import { CustomersController } from "./customers.controller.js";
import { CustomersService } from "./customers.service.js";
import { LoyaltyController } from "./loyalty.controller.js";
import { LoyaltyService } from "./loyalty.service.js";

@Module({
  imports: [DatabaseModule],
  controllers: [CustomersController, LoyaltyController, AgreementsController, AgreementStatementsController],
  providers: [CustomersService, LoyaltyService, AgreementsService, AgreementStatementsService]
})
export class CustomersModule {}
