import { existsSync } from "node:fs";
import { initializeDatabase } from "../src/lib/database.ts";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");

try {
  await initializeDatabase();
  console.log(
    "Neon 연결 및 denlife 테이블 준비 완료. 기존 데이터는 유지됩니다.",
  );
} catch {
  console.error(
    "Neon 초기화에 실패했습니다. DATABASE_URL과 DB 접근 권한을 확인해 주세요.",
  );
  process.exitCode = 1;
}
