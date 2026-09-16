import { Controller, Get } from "@nestjs/common";
import { Public } from "../auth/auth.decorators.js";

@Controller("health")
export class HealthController {
  @Public()
  @Get()
  getHealth(): { status: "ok"; service: "farmaxia-api" } {
    return {
      status: "ok",
      service: "farmaxia-api"
    };
  }
}
