import { Module } from "@nestjs/common";
import { DatabaseModule } from "../database/database.module.js";
import { StaffCommissionsService } from "./staff-commissions.service.js";
import { StaffProductivityService } from "./staff-productivity.service.js";
import { StaffShiftsService } from "./staff-shifts.service.js";
import { StaffController } from "./staff.controller.js";

@Module({
  imports: [DatabaseModule],
  controllers: [StaffController],
  providers: [StaffShiftsService, StaffCommissionsService, StaffProductivityService]
})
export class StaffModule {}
