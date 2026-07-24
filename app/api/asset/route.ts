import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { projectFile } from "@/lib/server/projects-server";

export const dynamic = "force-dynamic";

const MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".m4a": "audio/mp4",
  ".aac": "audio/aac",
  ".ogg": "audio/ogg",
  ".flac": "audio/flac",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
  ".lrc": "text/plain; charset=utf-8",
  ".json": "application/json",
};

/**
 * プロジェクトフォルダ内の素材を配信する。
 * PlayerとRemotionレンダラーの両方がここを読む（プレビュー＝書き出しの同一性）。
 * 音声のシークのため Range リクエストに対応。
 */
export async function GET(req: NextRequest) {
  const project = req.nextUrl.searchParams.get("project");
  const file = req.nextUrl.searchParams.get("file");
  if (!project || !file) {
    return NextResponse.json({ error: "project & file required" }, { status: 400 });
  }
  let abs: string;
  try {
    abs = projectFile(project, file);
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 400 });
  }
  if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const stat = fs.statSync(abs);
  const contentType = MIME[path.extname(abs).toLowerCase()] ?? "application/octet-stream";
  const range = req.headers.get("range");

  if (range) {
    const m = range.match(/bytes=(\d*)-(\d*)/);
    const start = m?.[1] ? Number(m[1]) : 0;
    const end = m?.[2] ? Math.min(Number(m[2]), stat.size - 1) : stat.size - 1;
    const stream = fs.createReadStream(abs, { start, end });
    return new NextResponse(stream as unknown as ReadableStream, {
      status: 206,
      headers: {
        "Content-Type": contentType,
        "Content-Range": `bytes ${start}-${end}/${stat.size}`,
        "Accept-Ranges": "bytes",
        "Content-Length": String(end - start + 1),
        "Cache-Control": "no-cache",
        // Remotionレンダラー（別オリジンのバンドル）からのfetchを許可
        "Access-Control-Allow-Origin": "*",
      },
    });
  }

  const stream = fs.createReadStream(abs);
  return new NextResponse(stream as unknown as ReadableStream, {
    headers: {
      "Content-Type": contentType,
      "Content-Length": String(stat.size),
      "Accept-Ranges": "bytes",
      "Cache-Control": "no-cache",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
