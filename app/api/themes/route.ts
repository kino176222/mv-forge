import { NextRequest, NextResponse } from "next/server";
import {
  loadUserThemes,
  saveUserTheme,
  deleteUserTheme,
} from "@/lib/server/themes-server";

export const dynamic = "force-dynamic";

/** 自作テーマの一覧 */
export async function GET() {
  return NextResponse.json({ themes: loadUserThemes() });
}

/** 組んだ手札セットをテーマとして登録（同一idは上書き） */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { theme?: unknown };
    if (!body.theme) {
      return NextResponse.json({ error: "theme required" }, { status: 400 });
    }
    return NextResponse.json({ themes: saveUserTheme(body.theme) });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 400 });
  }
}

/** 自作テーマを削除（?id=） */
export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  return NextResponse.json({ themes: deleteUserTheme(id) });
}
