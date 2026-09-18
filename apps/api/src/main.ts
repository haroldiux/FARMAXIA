import "dotenv/config";
import "reflect-metadata";
import fastifyCookie from "@fastify/cookie";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, NestFastifyApplication } from "@nestjs/platform-fastify";
import { AppModule } from "./app.module.js";

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter()
  );
  app.enableCors({
    origin: process.env.CORS_ORIGIN ?? "http://localhost:3000",
    credentials: true
  });
  await app.register(fastifyCookie);
  const port = Number(process.env.PORT ?? 3001);
  await app.listen({ host: "0.0.0.0", port });
}

void bootstrap();
