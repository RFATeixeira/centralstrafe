"use client";

import Image from "next/image";
import Link from "next/link";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { useEffect, useState } from "react";
import { db, isFirebaseConfigured } from "@/lib/firebase";

type MapCard = {
  key: string;
  label: string;
  screenshot: string;
  logoSrc?: string;
  logoAlt?: string;
  logoText?: string;
};

const mapCards: MapCard[] = [
  {
    key: "ancient",
    label: "Ancient",
    screenshot: "/assets/maps/screenshots/de_ancient.png",
    logoSrc: "/assets/icons/maps/svg/map_icon_de_ancient.svg",
    logoAlt: "Logo do mapa Ancient",
  },
  {
    key: "anubis",
    label: "Anubis",
    screenshot: "/assets/maps/screenshots/de_anubis.png",
    logoSrc: "/assets/icons/maps/svg/map_icon_de_anubis.svg",
    logoAlt: "Logo do mapa Anubis",
  },
  {
    key: "cache",
    label: "Cache",
    screenshot: "/assets/maps/screenshots/de_cache.png",
    logoSrc: "/assets/icons/maps/svg/map_icon_de_cache.svg",
    logoAlt: "Logo do mapa Cache",
  },
  {
    key: "dust2",
    label: "Dust II",
    screenshot: "/assets/maps/screenshots/de_dust2.png",
    logoSrc: "/assets/icons/maps/svg/map_icon_de_dust2.svg",
    logoAlt: "Logo do mapa Dust II",
  },
  {
    key: "inferno",
    label: "Inferno",
    screenshot: "/assets/maps/screenshots/de_inferno.png",
    logoSrc: "/assets/icons/maps/svg/map_icon_de_inferno.svg",
    logoAlt: "Logo do mapa Inferno",
  },
  {
    key: "mirage",
    label: "Mirage",
    screenshot: "/assets/maps/screenshots/de_mirage.png",
    logoSrc: "/assets/icons/maps/svg/map_icon_de_mirage.svg",
    logoAlt: "Logo do mapa Mirage",
  },
  {
    key: "nuke",
    label: "Nuke",
    screenshot: "/assets/maps/screenshots/de_nuke.png",
    logoSrc: "/assets/icons/maps/svg/map_icon_de_nuke.svg",
    logoAlt: "Logo do mapa Nuke",
  },
  {
    key: "overpass",
    label: "Overpass",
    screenshot: "/assets/maps/screenshots/de_overpass.png",
    logoSrc: "/assets/icons/maps/svg/map_icon_de_overpass.svg",
    logoAlt: "Logo do mapa Overpass",
  },
  {
    key: "train",
    label: "Train",
    screenshot: "/assets/maps/screenshots/de_train.png",
    logoSrc: "/assets/icons/maps/svg/map_icon_de_train.svg",
    logoAlt: "Logo do mapa Train",
  },
  {
    key: "vertigo",
    label: "Vertigo",
    screenshot: "/assets/maps/screenshots/de_vertigo.png",
    logoSrc: "/assets/icons/maps/svg/map_icon_de_vertigo.svg",
    logoAlt: "Logo do mapa Vertigo",
  },
];

const mapAliases: Record<string, string[]> = {
  ancient: ["ancient"],
  anubis: ["anubis"],
  cache: ["cache"],
  dust2: ["dustii", "dust2", "dust-2", "dust-ii"],
  dustii: ["dustii", "dust2", "dust-2", "dust-ii"],
  inferno: ["inferno"],
  mirage: ["mirage"],
  nuke: ["nuke"],
  overpass: ["overpass"],
  train: ["train"],
  vertigo: ["vertigo"],
};

function slugify(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function normalizeMapKey(value?: string) {
  if (!value?.trim()) {
    return "";
  }

  const slug = slugify(value);
  const compactSlug = slug.replace(/-/g, "");

  if (
    slug === "dust-2" ||
    slug === "dust-ii" ||
    slug === "dustii" ||
    slug === "dust2" ||
    compactSlug === "dustii"
  ) {
    return "dust2";
  }

  return mapAliases[slug]?.[0] ?? mapAliases[compactSlug]?.[0] ?? slug;
}

export default function Home() {
  const [mapCounts, setMapCounts] = useState<Record<string, number>>({});
  const [loadingCounts, setLoadingCounts] = useState(Boolean(db));

  useEffect(() => {
    if (!db) {
      return;
    }

    const featuresQuery = query(collection(db, "features"), where("category", "==", "granadas"));

    const unsubscribe = onSnapshot(featuresQuery, (snapshot) => {
      const nextCounts = mapCards.reduce<Record<string, number>>((accumulator, card) => {
        accumulator[card.key] = 0;
        return accumulator;
      }, {});

      snapshot.docs.forEach((doc) => {
        const feature = doc.data() as { map?: string };
        const key = normalizeMapKey(feature.map);

        if (!key) {
          return;
        }

        nextCounts[key] = (nextCounts[key] ?? 0) + 1;
      });

      setMapCounts(nextCounts);
      setLoadingCounts(false);
    });

    return () => unsubscribe();
  }, []);

  return (
    <div className="mx-auto w-full max-w-400 px-3 pb-12 text-slate-100 sm:px-4 lg:px-6">
      <section className="relative overflow-hidden rounded-3xl border border-slate-700/70 bg-slate-950/70 shadow-[0_28px_65px_rgba(0,0,0,.45)]">
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute -left-24 -top-24 h-72 w-72 rounded-full bg-orange-500/20 blur-3xl" />
          <div className="absolute -right-16 top-[10%] h-80 w-80 rounded-full bg-sky-500/10 blur-3xl" />
          <div className="absolute inset-0 bg-[linear-gradient(120deg,rgba(255,255,255,.03)_1px,transparent_1px)] bg-size-[22px_22px] opacity-30" />
        </div>

        <div className="relative flex flex-col p-5 md:p-4">
          <div className="my-auto grid gap-6 md:grid-cols-[1.2fr_.8fr] md:gap-8">
            <div className="flex flex-col justify-center">
              <p className="mb-3 w-fit inline-flex rounded-full border border-orange-300/35 px-3 py-1 text-xs uppercase tracking-[0.14em] text-orange-300">
                Mapas disponíveis
              </p>
              <h1 className="text-3xl font-bold uppercase leading-[0.98] tracking-tight text-white sm:text-4xl md:text-3xl">
                CS to CS - Seu hub visual para treinar util por mapa
              </h1>
              <div className="flex flex-wrap gap-3 mt-4">
                <Link
                  href="/granadas"
                  className="rounded-lg border border-orange-300/45 bg-linear-to-r from-orange-400 to-orange-300 px-3 py-2 font-semibold text-slate-950 transition hover:scale-[1.01]"
                >
                  Explorar granadas
                </Link>
                <Link
                  href="/sobre"
                  className="rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 font-semibold text-slate-100 transition hover:border-slate-400"
                >
                  Sobre o projeto
                </Link>
              </div>

              {!isFirebaseConfigured && (
                <p className="mt-4 text-sm text-orange-200/85">
                  Configure as variáveis NEXT_PUBLIC_FIREBASE_* para carregar a contagem em tempo real.
                </p>
              )}
            </div>

            <div className="flex items-center justify-start md:justify-end">
              <div className="rounded-2xl border border-slate-700 bg-slate-900/70 p-4 shadow-[0_10px_20px_rgba(0,0,0,.2)]">
                <p className="text-xs uppercase tracking-[0.18em] text-slate-400">Catálogo</p>
                <p className="mt-2 text-2xl font-black uppercase tracking-[0.14em] text-white">
                  {mapCards.length} mapas
                </p>
                
              </div>
            </div>
          </div>
        </div>
      </section>

      <main className="mt-8">
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="mb-2 inline-flex rounded-full border border-orange-300/35 px-3 py-1 text-xs uppercase tracking-[0.14em] text-orange-300">
              Catálogo de mapas
            </p>
            <h2 className="text-2xl font-semibold uppercase text-white md:text-3xl">
              Cards com screenshot, logo e contagem
            </h2>
          </div>

          <p className="text-sm text-slate-400">
            {loadingCounts ? "Atualizando contagem..." : "Contagem carregada do banco de granadas."}
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          {mapCards.map((card) => {
            const grenadeCount = mapCounts[card.key] ?? 0;

            return (
              <Link
                key={card.key}
                href={`/granadas?map=${encodeURIComponent(card.label)}`}
                aria-label={`Ver guias de ${card.label}`}
                className="group overflow-hidden rounded-[1.75rem] border border-slate-700/80 bg-slate-900/80 shadow-[0_24px_55px_rgba(0,0,0,.32)] transition hover:-translate-y-1 hover:border-orange-300/50"
              >
                <div className="relative aspect-16/10 overflow-hidden">
                  <Image
                    src={card.screenshot}
                    alt={`Foto do mapa ${card.label}`}
                    fill
                    className="object-cover transition duration-500 group-hover:scale-105"
                    sizes="(min-width: 1280px) 33vw, (min-width: 640px) 50vw, 100vw"
                    priority={card.key === "ancient"}
                  />
                  <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(5,8,13,.08)_0%,rgba(5,8,13,.26)_45%,rgba(5,8,13,.78)_100%)]" />

                  <div className="absolute inset-0 flex items-center justify-center">
                    {card.logoSrc ? (
                      <div className="relative h-[68%] w-[88%]">
                        <Image
                          src={card.logoSrc}
                          alt={card.logoAlt ?? `Logo do mapa ${card.label}`}
                          fill
                          sizes="(min-width: 1280px) 18vw, (min-width: 1024px) 24vw, 42vw"
                          className="object-contain drop-shadow-[0_14px_26px_rgba(0,0,0,.55)] scale-[1.22]"
                        />
                      </div>
                    ) : (
                      <div className="rounded-2xl border border-white/10 bg-slate-950/45 px-5 py-3 text-xl font-black uppercase tracking-[0.22em] text-slate-100 shadow-[0_18px_35px_rgba(0,0,0,.35)] backdrop-blur-sm">
                        {card.logoText}
                      </div>
                    )}
                  </div>
                </div>

                <div className="border-t border-slate-700 bg-slate-900/75 p-4 transition group-hover:border-orange-300/45">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h3 className="text-lg font-semibold uppercase text-white">{card.label}</h3>
                      
                    </div>

                    <div className="rounded-full border border-orange-300/35 bg-orange-400/10 px-3 py-1 text-sm font-semibold text-orange-200">
                      {loadingCounts ? "..." : grenadeCount}
                    </div>
                  </div>

                  
                </div>
              </Link>
            );
          })}
        </div>
      </main>
    </div>
  );
}
