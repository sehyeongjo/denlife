"use client";

import { useState, type FormEvent } from "react";
import { Eye, EyeOff, LockKeyhole } from "lucide-react";

export default function LoginForm({ configured }: { configured: boolean }) {
  const [password, setPassword] = useState("");
  const [visible, setVisible] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    setError("");
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const result = await response.json();
      if (!response.ok) {
        setError(result.error || "접속하지 못했어요. 다시 시도해 주세요.");
        return;
      }
      window.location.replace("/");
    } catch {
      setError("연결을 확인한 후 다시 시도해 주세요.");
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="login-page">
      <header className="login-brand">denlife</header>
      <div className="login-content">
        <LockKeyhole size={30} strokeWidth={1.8} className="login-lock" />
        <h1>가계부에 접속하기</h1>
        <p>접속 비밀번호를 입력해 주세요.</p>
        <form onSubmit={submit}>
          <label className="form-field" htmlFor="password">
            비밀번호
            <div className="password-field">
              <input
                id="password"
                name="password"
                type={visible ? "text" : "password"}
                autoComplete="current-password"
                enterKeyHint="go"
                placeholder="비밀번호 입력"
                maxLength={1024}
                value={password}
                onChange={(event) => {
                  setPassword(event.target.value);
                  setError("");
                }}
                disabled={!configured || pending}
                required
              />
              <button
                type="button"
                className="icon-button"
                onClick={() => setVisible(!visible)}
                aria-label={visible ? "비밀번호 숨기기" : "비밀번호 표시"}
              >
                {visible ? <EyeOff size={21} /> : <Eye size={21} />}
              </button>
            </div>
          </label>
          {(!configured || error) && (
            <p className="form-error" role="alert">
              {configured
                ? error
                : "서버의 APP_PASSWORD 환경변수를 설정해 주세요."}
            </p>
          )}
          <button
            className="button button-primary full-width"
            disabled={!configured || !password || pending}
          >
            {pending ? "확인 중…" : "접속하기"}
          </button>
        </form>
      </div>
    </main>
  );
}
