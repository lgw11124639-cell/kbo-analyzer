import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = { title: "KBO Analyzer", description: "KBO 자동 분석 대시보드" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="ko"><body>{children}</body></html>;
}
