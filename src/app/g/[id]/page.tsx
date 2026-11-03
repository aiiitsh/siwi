import GameView from "@/components/GameView";

export default async function GamePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <GameView id={id} />;
}
