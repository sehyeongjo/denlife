# denlife

모바일용 다중 통화 가계부입니다. Next.js App Router + React + TypeScript를 사용하며, DB 없이 이 브라우저에 내역을 저장합니다. 회원가입 없이 공통 비밀번호로 접속합니다.

## 실행

Node.js 22 이상에서 실행하세요. 현재 로컬 `.env.local`에는 `APP_PASSWORD=test`가 설정되어 있습니다.

새로 내려받은 경우 환경변수 파일을 먼저 만드세요.

```bash
cp .env.example .env.local
npm install
npm run dev
```

http://localhost:3000 에서 비밀번호 `test`로 접속하세요. 휴대폰은 같은 Wi-Fi에서 `http://<컴퓨터의 로컬 IP>:3000`으로 확인할 수 있습니다. 휴대폰과 컴퓨터의 저장 내역은 각각 독립적입니다.

```bash
npm test
npm run typecheck
npm run build
npm start
```

## 화면과 기능

- 모바일을 기준으로 한 단일 열 화면과 하단 메뉴: 홈 / 내역 / 설정
- 본문·입력칸 16–18px, 주요 금액 30–42px, 주요 버튼 48–58px
- 홈: 선택한 달의 지출, 수입, 남은 금액, 최근 내역
- 내역 추가·수정·삭제, 월 선택, 검색, 수입·지출 필터
- 기본 DKK, KRW / USD / JPY / EUR 및 추가 ISO 통화
- 합계 표시 통화 변경, 설정에서 전체 기간의 통화별 잔액 확인
- 거래별 등록 환율 보관, 수동 환율 입력, 저장된 환율 확인
- JSON 백업, 비밀번호 접속, 가계부 잠그기

기존 `denlife.ledger.v1` 데이터와 환율 스냅샷은 유지합니다. 샘플 데이터를 자동으로 표시하지 않습니다.

## 비밀번호 설정

서버 전용 환경변수는 하나입니다.

```dotenv
APP_PASSWORD=test
```

원하는 값으로 변경한 뒤 로컬 서버를 재시작하거나 Vercel에서 다시 배포하세요. `NEXT_PUBLIC_` 접두사를 붙이지 않습니다. `.env.local`은 Git에 포함되지 않습니다.

- 비밀번호 검증은 `/api/auth/login`에서만 수행합니다.
- 성공 시 7일 유효한 HMAC 서명 세션 쿠키를 발급합니다. 쿠키는 HttpOnly / SameSite=Lax이고, 프로덕션에서는 Secure를 사용합니다.
- 가계부 페이지와 `/api/rates`는 서버에서 세션을 확인합니다.
- 환경변수가 없으면 접속을 차단합니다. 프로덕션용 기본 비밀번호는 없습니다.
- 비밀번호를 바꾸면 기존 세션도 무효화됩니다.
- 같은 서버 인스턴스에서 1분에 5회까지 접속을 시도할 수 있습니다. 이 제한은 서버 재시작·서버리스 인스턴스 간 공유되지 않으므로, 공개 배포의 전체 요청 제한이 필요하면 Vercel WAF 등을 설정하세요.
- 잠그기는 세션 쿠키만 지우며 가계부 내역은 유지합니다.

이 기능은 사이트 접속 잠금입니다. localStorage 내역 자체를 암호화하지는 않습니다.

## 환율과 금액

`GET /api/rates`는 [Frankfurter v2](https://frankfurter.dev)의 DKK 기준 전체 환율을 조회합니다. 별도 API 키는 필요 없습니다. 등록 직전에 최신 일별 고시값을 다시 조회하고, 통화별 고시일·조회 시각·환율표 전체를 해당 거래에 보관합니다. 과거 날짜의 거래를 입력해도 **거래 날짜가 아닌 등록 시점 기준**입니다.

금액은 통화의 최소 단위 정수로 저장합니다. DKK / USD / EUR는 소수점 2자리, KRW / JPY는 정수 단위이며 `Intl.NumberFormat`의 통화별 정밀도를 따릅니다. 각 거래를 저장된 환율로 환산하고 최소 단위로 반올림한 뒤 합산합니다. 수정 시에도 최초 등록 환율을 유지합니다.

통화 추가 시 과거 스냅샷에 환율이 있으면 바로 환산할 수 있습니다. 자동 조회에 실패하면 재시도하거나 환율을 직접 입력하세요. 필요한 환율이 없는 거래는 환산 합계에서 제외하고 제외 건수를 표시합니다. 원래 거래 금액은 그대로 확인할 수 있습니다.

설정의 현재 참고 환율은 기존 거래의 계산에 사용하지 않습니다. 거래 내용과 금액은 외부 환율 API에 보내지 않습니다.

## 데이터 저장

- 저장 키: `denlife.ledger.v1`
- 로그인 비밀번호가 같아도 기기·브라우저 사이의 내역은 동기화되지 않습니다.
- 브라우저 데이터 삭제나 비공개 창 종료 시 내역이 사라질 수 있으니 설정의 **내역 백업**으로 JSON을 보관하세요.
- 저장 실패 시 기존 내역을 유지하며 오류를 표시합니다. 손상된 저장 데이터도 덮어쓰지 않고 원본 백업을 제공합니다.

## Vercel

Git `origin`: `https://github.com/sehyeongjo/denlife.git`

1. 코드를 GitHub에 커밋하고 push합니다.
2. Vercel에서 해당 저장소를 가져옵니다.
3. Framework Preset은 **Next.js**, Build Command는 `npm run build`입니다.
4. **Environment Variables**에 `APP_PASSWORD`를 원하는 비밀번호로 설정합니다. Preview에도 사용하려면 해당 환경을 함께 선택하세요.
5. 배포합니다. 환경변수 변경 후에는 다시 배포해야 합니다.

별도 `vercel.json`이나 DB 설정은 필요하지 않습니다.

## 이후 Neon 연결

- `src/lib/ledger.ts`: 거래 타입, 금액·환율 계산, 저장 데이터 검증
- `src/components/ledger-app.tsx`: 화면과 localStorage 읽기·저장
- `src/lib/auth.ts`: 비밀번호·서명 세션·접속 시도 제한
- `src/app/api/auth/`: 접속 및 잠그기
- `src/app/api/rates/route.ts`: 인증 후 환율 조회

Neon 연결 시 localStorage 읽기·저장을 인증된 서버 API로 교체하고, 거래의 `amountMinor`, `currency`, `date`, `createdAt`, **`fx` 전체(JSONB)**를 저장하면 됩니다. DB URL은 서버 전용 `DATABASE_URL`로 설정하세요. 백업 JSON을 마이그레이션 입력으로 사용할 수 있습니다. 현재 Neon SDK나 DB 연결 코드는 없습니다.
