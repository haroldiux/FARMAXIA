import "dotenv/config";
import "reflect-metadata";
import fastifyCookie from "@fastify/cookie";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, NestFastifyApplication } from "@nestjs/platform-fastify";
import { AppModule } from "./app.module.js";

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    // 4 MB: un comprobante de pago de 2 MB viaja en base64 (~2,7 MB).
    new FastifyAdapter({ bodyLimit: 4 * 1024 * 1024 })
  );
  app.enableCors({
    origin: process.env.CORS_ORIGIN ?? "http://localhost:3000",
    credentials: true,
    // Fastify solo permite GET, HEAD y POST por defecto: sin esto el navegador bloquea las ediciones.
    methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"]
  });
  await app.register(fastifyCookie);
  const port = Number(process.env.PORT ?? 3001);
  await app.listen({ host: "0.0.0.0", port });
}

void bootstrap();
