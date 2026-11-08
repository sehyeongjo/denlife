import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "denlife · 가계부",
  description:
    "덴마크 크로네부터 원화까지. 등록 당시 환율로 기록하는 나만의 다중 통화 가계부.",
  appleWebApp: { capable: true, statusBarStyle: "default", title: "denlife" },
  icons: { icon: "/icon.svg", apple: "/icon.svg" },
};
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#ffffff",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
