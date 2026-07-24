/** プロジェクトフォルダ内の素材を配信APIのURLに変換する */
export function assetUrl(
  assetBase: string,
  projectName: string,
  file: string,
): string {
  return `${assetBase}/api/asset?project=${encodeURIComponent(projectName)}&file=${encodeURIComponent(file)}`;
}
