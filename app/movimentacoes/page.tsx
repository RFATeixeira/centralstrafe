import type { Metadata } from "next";
import { Suspense } from "react";
import { FeaturePage } from "@/components/feature-page";

export const metadata: Metadata = {
  title: "Movimentacoes",
};

export default function MovimentacoesPage() {
  return (
    <Suspense fallback={null}>
      <FeaturePage
        category="movimentacoes"
        badge="Movimentacoes"
        title="Domine a movimentacao em alto nivel"
        intro="A movimentacao no CS2 separa jogadores comuns de jogadores de alto nivel. Aqui voce aprende a strafar com precisao, abrir angulos com seguranca e se posicionar com inteligencia para decidir rounds."
        points={[
          "Tecnicas de strafe e counter-strafe para duelo mais limpo",
          "Como abrir pixel sem entregar vantagem para o adversario",
          "Movimentacoes usadas por jogadores profissionais",
          "Posicionamento inteligente em situacoes de ataque e defesa",
        ]}
        showHero={false}
      />
    </Suspense>
  );
}
