import { Editor } from "@/components/editor/Editor";

export default async function EditorPage({
  params,
}: {
  params: Promise<{ project: string }>;
}) {
  const { project } = await params;
  return <Editor projectName={decodeURIComponent(project)} />;
}
