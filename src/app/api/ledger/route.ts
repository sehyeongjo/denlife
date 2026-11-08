import { cookies } from "next/headers";
import {
  configuredPassword,
  sameOrigin,
  SESSION_COOKIE,
  verifySession,
} from "@/lib/auth";
import {
  InvalidLedgerUpdateError,
  LedgerConflictError,
  MAIN_LEDGER,
  readLedger,
  writeLedger,
} from "@/lib/database";
import { parseLedgerState } from "@/lib/ledger-sync";

export const runtime = "nodejs";
const headers = { "Cache-Control": "private, no-store" };
const unavailable = () =>
  Response.json(
    { error: "DB에 연결하지 못했어요. 연결을 확인하고 다시 시도해 주세요." },
    { status: 503, headers },
  );

async function authenticated() {
  return verifySession(
    (await cookies()).get(SESSION_COOKIE)?.value,
    configuredPassword(),
  );
}

export async function GET() {
  if (!(await authenticated()))
    return Response.json(
      { error: "다시 접속해 주세요." },
      { status: 401, headers },
    );
  try {
    return Response.json(await readLedger(MAIN_LEDGER), { headers });
  } catch {
    return unavailable();
  }
}

export async function PUT(request: Request) {
  if (!(await authenticated()))
    return Response.json(
      { error: "다시 접속해 주세요." },
      { status: 401, headers },
    );
  if (!sameOrigin(request))
    return Response.json(
      { error: "허용되지 않은 요청입니다." },
      { status: 403, headers },
    );
  let state;
  try {
    const reader = request.body?.getReader();
    if (!reader) throw new Error();
    const chunks: Uint8Array[] = [];
    let length = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > 4_000_000) {
        await reader.cancel();
        return Response.json(
          {
            error:
              "가계부 크기가 저장 한도를 초과했어요. 먼저 내역을 백업해 주세요.",
          },
          { status: 413, headers },
        );
      }
      chunks.push(value);
    }
    state = parseLedgerState(
      JSON.parse(Buffer.concat(chunks).toString("utf8")),
    );
  } catch {
    return Response.json(
      { error: "저장할 내역을 확인해 주세요." },
      { status: 400, headers },
    );
  }
  try {
    return Response.json(await writeLedger(MAIN_LEDGER, state), { headers });
  } catch (error) {
    if (error instanceof LedgerConflictError)
      return Response.json(
        {
          error:
            "다른 기기에서 내역이 변경됐어요. 최신 내역을 확인한 후 다시 저장해 주세요.",
        },
        { status: 409, headers },
      );
    if (error instanceof InvalidLedgerUpdateError)
      return Response.json({ error: error.message }, { status: 400, headers });
    return unavailable();
  }
}
