import { Module } from "@nestjs/common";
import { DatabaseModule } from "../database/database.module.js";
import { ControlledController } from "./controlled.controller.js";
import { ControlledService } from "./controlled.service.js";

@Module({
  imports: [DatabaseModule],
  controllers: [ControlledController],
  providers: [ControlledService]
})
export class ControlledModule {}
