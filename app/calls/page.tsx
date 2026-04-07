import { FeaturePage } from "@/components/feature-page";

export default function CallsPage() {
  return (
    <FeaturePage
      category="calls"
      badge="Calls"
      title="Comunicacao tatica para rounds mais organizados"
      intro="Uma call objetiva no momento certo melhora execucao, sincroniza util e acelera decisao do time. Nesta area, o foco e padronizar comunicacao para ataque, defesa e retake em cenario competitivo."
      points={[
        "Padroes de call para entradas, rotações e retomadas",
        "Comandos curtos para leitura rapida de situacao",
        "Ajustes de call em clutch e desvantagem numerica",
        "Estrutura de comunicacao para times em evolucao",
      ]}
      showHero={false}
    />
  );
}
