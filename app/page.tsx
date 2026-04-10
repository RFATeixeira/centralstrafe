"use client";

import Image from "next/image";
import { ReactNode, useEffect, useRef, useState } from "react";
import { isFirebaseConfigured } from "@/lib/firebase";

function Reveal({
  children,
  delay = 0,
  className = "",
}: {
  children: ReactNode;
  delay?: number;
  className?: string;
}) {
  const [visible, setVisible] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const node = ref.current;
    if (!node) {
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { threshold: 0.18 }
    );

    observer.observe(node);

    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      style={{ transitionDelay: `${delay}ms` }}
      className={`transition-all duration-700 ease-out will-change-transform ${
        visible
          ? "opacity-100 translate-y-0 scale-100 blur-0"
          : "opacity-0 translate-y-8 scale-[0.985] blur-[2px]"
      } ${className}`}
    >
      {children}
    </div>
  );
}

type Showcase = {
  id: "pixel" | "movement" | "taticas";
  badge: string;
  title: string;
  intro: string;
  bullets: string[];
  footer: string;
  comingSoon?: boolean;
};

export default function Home() {
  const showcases: Showcase[] = [
    {
      id: "pixel",
      badge: "Pixel de granadas",
      title: "Controle o round com util no lugar certo",
      intro:
        "Granada bem alinhada nao e detalhe: e vantagem de espaco, visao e tempo para sua equipe.",
      bullets: [
        "Lineups praticas para entry, retake e anti-rush",
        "Posicionamento para jogar util sem se expor cedo",
        "Padroes usados em mapas competitivos",
        "Execucao passo a passo para repetir com consistencia",
      ],
      footer: "Treine no server, leve para o competitivo e ganhe rounds com leitura.",
    },
    {
      id: "movement",
      badge: "Movimentacao",
      comingSoon: true,
      title: "Domine a movimentacao",
      intro:
        "A movimentacao no CS2 separa jogadores comuns de jogadores de alto nivel.",
      bullets: [
        "Tecnicas de strafe e counter-strafe",
        "Como abrir pixel sem se expor",
        "Movimentacoes usadas por jogadores profissionais",
        "Posicionamento inteligente em cada situacao",
      ],
      footer:
        "Cada conteudo vem com video e passo a passo visual para aplicacao pratica.",
    },
    {
      id: "taticas",
      badge: "Taticas",
      comingSoon: true,
      title: "Comunique melhor em todos os rounds",
      intro:
        "Uma call clara no momento certo coordena util, mira e movimentacao da equipe.",
      bullets: [
        "Padroes de call para ataque, defesa e retake",
        "Frases curtas para tomada de decisao rapida",
        "Como adaptar call em clutch e desvantagem numerica",
        "Leitura de mapa para chamar jogada com antecedencia",
      ],
      footer: "Comunicacao objetiva diminui erro e acelera a evolucao coletiva.",
    },
  ];

  return (
    <div className="mx-auto w-full max-w-400 px-3 pb-12 text-slate-100 sm:px-4 lg:px-6" id="inicio">
      <header className="relative min-h-[80vh] overflow-hidden rounded-3xl border border-slate-700/70 bg-slate-950/70 shadow-[0_28px_65px_rgba(0,0,0,.45)]">
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute -left-24 -top-24 h-72 w-72 rounded-full bg-orange-500/20 blur-3xl" />
          <div className="absolute -right-16 top-[10%] h-80 w-80 rounded-full bg-sky-500/10 blur-3xl" />
          <div className="absolute inset-0 bg-[linear-gradient(120deg,rgba(255,255,255,.03)_1px,transparent_1px)] bg-size-[22px_22px] opacity-30" />
        </div>

        <div className="relative flex h-full min-h-[80vh] flex-col p-5 md:p-8">
          <div className="my-auto w-full">
            <div className="grid items-center gap-6 md:grid-cols-[70%_30%] md:gap-8">
              <div className="flex min-h-80 flex-col justify-center">
                <h1 className="text-3xl font-bold uppercase leading-[0.98] tracking-tight text-white sm:text-4xl md:text-6xl">
                  Seu Hub de treino para CS2 competitivo
                </h1>

                <p className="mb-8 mt-4 max-w-3xl text-base text-slate-300 md:text-lg">
                  O CentralStrafe e uma plataforma para acelerar a evolucao de jogadores e times no
                  CS2 com estudo estruturado de util, movimentacao e comunicacao tatica. O objetivo
                  e transformar conhecimento de jogo em rotina pratica, com conteudo claro para
                  aplicar no servidor e levar para as partidas competitivas.
                </p>

                <div className="flex flex-wrap gap-3">
                  <a
                    href="/granadas"
                    className="rounded-lg border border-orange-300/45 bg-linear-to-r from-orange-400 to-orange-300 px-5 py-3 font-semibold text-slate-950 transition hover:scale-[1.01]"
                  >
                    Explorar guias
                  </a>
                </div>
              </div>

              <div className="flex min-h-80 flex-col items-center justify-center self-stretch">
                <Image
                  src="/logo-cs-white.png"
                  alt="CentralStrafe logo branco"
                  width={300}
                  height={27}
                  className="h-auto w-auto"
                  priority
                />
                <p className="mt-0 flex flex-col items-center leading-none text-slate-100">
                  <span className="text-3xl font-black uppercase tracking-[0.18em] md:text-5xl">
                    Central
                  </span>
                  <span className="text-3xl font-black uppercase tracking-[0.18em] text-orange-300 md:text-5xl">
                    Strafe
                  </span>
                </p>
              </div>
            </div>

            {!isFirebaseConfigured && (
              <p className="mt-4 text-sm text-orange-200/85">
                Configure variaveis NEXT_PUBLIC_FIREBASE_* para login e banco em producao.
              </p>
            )}
          </div>
        </div>
      </header>

      <main id="apresentacoes" className="mt-8 space-y-4">
        {showcases.map((section, sectionIndex) => {
          return (
            <Reveal key={section.id} delay={sectionIndex * 80}>
              <section
                id={section.id}
                className="rounded-2xl border border-slate-700/70 bg-slate-900/75 p-4 md:p-6"
              >
                <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
                  <div>
                    <p className="mb-2 inline-flex rounded-full border border-orange-300/35 px-3 py-1 text-xs uppercase tracking-[0.14em] text-orange-300">
                      {section.badge}
                    </p>
                    <h2 className="text-2xl font-semibold uppercase text-white md:text-3xl">
                      {section.title}
                    </h2>
                    <p className="mt-2 max-w-3xl text-slate-300">{section.intro}</p>
                  </div>

                  {section.comingSoon && (
                    <span className="inline-flex rounded-full border border-sky-300/40 bg-sky-400/20 px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-sky-200">
                      Em breve
                    </span>
                  )}
                </div>

                <div className="rounded-xl border border-slate-700 bg-slate-800/65 p-4 shadow-[0_10px_20px_rgba(0,0,0,.2)] md:p-5">
                  <ul className="space-y-2 text-sm text-slate-200 md:text-base">
                    {section.bullets.map((item) => (
                      <li key={item} className="flex items-start gap-2">
                        <span className="mt-1 h-1.5 w-1.5 rounded-full bg-orange-300" />
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>

                  <p className="mt-4 border-t border-slate-700 pt-4 text-sm text-slate-300 md:text-base">
                    {section.footer}
                  </p>
                </div>
              </section>
            </Reveal>
          );
        })}

      </main>
    </div>
  );
}
