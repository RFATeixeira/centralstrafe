import type { Metadata } from "next";
import { FeaturePage } from "@/components/feature-page";

export const metadata: Metadata = {
  title: "Granadas",
};

export default function GranadasPage() {
  return (
    <FeaturePage
      category="granadas"
      badge="Pixel de granadas"
      title="Domine utilitaria para controlar ritmo de round"
      intro="Nesta pagina voce encontra o universo de granadas do CentralStrafe: lineups, referencias de posicionamento e logica taticas para entry, retake e controle de mapa. A ideia e transformar util em vantagem concreta de espaco e tempo para sua equipe."
      points={[
        "Lineups para entrada, retake e anti-rush nos mapas competitivos",
        "Execucao segura para jogar util sem se expor em timings ruins",
        "Organizacao de granadas por objetivo tatico e momento do round",
        "Passo a passo visual para repetir com consistencia no servidor",
      ]}
      showHero={false}
    />
  );
}
