import { z } from "zod";

// 会话 id 同时用作远程请求的资源键和目录名：单个路径段、1–200 字符。
export const sessionId = z
  .string()
  .min(1)
  .max(200)
  .regex(/^[A-Za-z0-9_.-]+$/);
