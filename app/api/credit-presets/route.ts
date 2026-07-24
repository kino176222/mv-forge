import { NextRequest, NextResponse } from "next/server";
import {
  loadUserCreditPresets,
  saveUserCreditPreset,
  deleteUserCreditPreset,
} from "@/lib/server/credit-presets-server";

export const dynamic = "force-dynamic";

/** 自作クレジットプリセットの一覧 */
export async function GET() {
  return NextResponse.json({ presets: loadUserCreditPresets() });
}

/** 現在のクレジット設定から作ったプリセットを登録（同一idは上書き） */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { preset?: unknown };
    if (!body.preset) {
      return NextResponse.json({ error: "preset required" }, { status: 400 });
    }
    return NextResponse.json({ presets: saveUserCreditPreset(body.preset) });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 400 });
  }
}

/** 自作プリセットを削除（?id=） */
export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  return NextResponse.json({ presets: deleteUserCreditPreset(id) });
}
