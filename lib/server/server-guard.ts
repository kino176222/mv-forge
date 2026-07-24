/**
 * server専用モジュールのクライアント混入ガード。
 * `*-server.ts` 命名規約（Node組込みAPIを使う層。lib/server/ 配下に集約）の唯一の守りが
 * 「人間とAIの記憶」になっていたため、ビルド/実行時にも効く番犬を足す。
 * lib/server/ の全ファイルが先頭でimportする。
 *
 * 公式の `server-only` パッケージを使わない理由: あちらは react-server 条件が無い実行環境で
 * 即throwするため、tsxで直接 `-server.ts` をimportするこのリポジトリのテスト方式
 * （scripts/*.test.ts・pnpm test）が全滅する。ブラウザ判定なら両立できる。
 */
if (typeof window !== "undefined") {
  throw new Error(
    "server専用モジュールがクライアントバンドルに混入しました（*-server.ts はクライアントコンポーネントからimport禁止。必要なら import type か API 経由で）",
  );
}

export {};
