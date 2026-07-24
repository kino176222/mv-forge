import { NextRequest, NextResponse } from "next/server";
import {
  loadUserPacks,
  saveUserPack,
  deleteUserPack,
} from "@/lib/server/style-packs-server";

export const dynamic = "force-dynamic";

/** 自作スタイルパックの一覧 */
export async function GET() {
  return NextResponse.json({ packs: loadUserPacks() });
}

/** 現在の設定から作ったパックを登録（同一idは上書き） */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { pack?: unknown };
    if (!body.pack) {
      return NextResponse.json({ error: "pack required" }, { status: 400 });
    }
    return NextResponse.json({ packs: saveUserPack(body.pack) });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 400 });
  }
}

/** 自作パックを削除（?id=） */
export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  return NextResponse.json({ packs: deleteUserPack(id) });
}
