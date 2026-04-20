/// <reference types="vite/client" />
import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

export const env = createEnv({
  server: {
    DATABASE_URL: z.url(),
    NODE_ENV: z.enum(["development", "test", "production"]),
  },
  clientPrefix: "VITE_",
  client: {
    VITE_PUBLIC_API_URL: z.url(),
  },
  runtimeEnv: {
    DATABASE_URL: process.env.DATABASE_URL,
    NODE_ENV: process.env.NODE_ENV,
    VITE_PUBLIC_API_URL: import.meta.env.VITE_PUBLIC_API_URL,
  },
});
