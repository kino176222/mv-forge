import { NextResponse } from "next/server";
import { detectAiProviders } from "@/lib/server/llm";

export const dynamic = "force-dynamic";

/** インストール済みAI CLI（claude / codex / gemini）の検出結果を返す */
export async function GET() {
  return NextResponse.json(await detectAiProviders());
}
