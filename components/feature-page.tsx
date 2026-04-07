"use client";

import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from "firebase/firestore";
import { FormEvent, WheelEvent, useEffect, useMemo, useState } from "react";
import { db } from "@/lib/firebase";
import { isCommentModerator, isFeatureManager } from "@/lib/roles";
import { useAuthSession } from "@/components/auth-provider";

export type FeatureCategory = "granadas" | "movimentacoes" | "calls";

type FeatureItem = {
  id: string;
  category: FeatureCategory;
  title: string;
  grenadeType?: string;
  map?: string;
  location?: string;
  position?: string;
  teleportCommand?: string;
  description: string;
  coverImageText?: string;
  imageTexts?: string[];
  imageText?: string;
  imageUrl?: string;
  youtubeUrl: string;
  createdBy: string;
  createdByName?: string;
  createdAt?: unknown;
  updatedAt?: unknown;
};

type FeatureComment = {
  id: string;
  featureId: string;
  uid: string;
  userName: string;
  text: string;
  createdAt?: unknown;
  updatedAt?: unknown;
};

type FeaturePageProps = {
  category: FeatureCategory;
  badge: string;
  title: string;
  intro: string;
  points: string[];
  showHero?: boolean;
};

type CategoryCopy = {
  singular: string;
  singularTitle: string;
  plural: string;
};

const categoryCopy: Record<FeatureCategory, CategoryCopy> = {
  granadas: {
    singular: "granada",
    singularTitle: "Granada",
    plural: "granadas",
  },
  movimentacoes: {
    singular: "movimentacao",
    singularTitle: "Movimentacao",
    plural: "movimentacoes",
  },
  calls: {
    singular: "call",
    singularTitle: "Call",
    plural: "calls",
  },
};

type FeatureFormState = {
  title: string;
  grenadeType: string;
  map: string;
  location: string;
  position: string;
  teleportCommand: string;
  description: string;
  coverImageText: string;
  imageTexts: string[];
  youtubeUrl: string;
};

const emptyFeatureForm = (): FeatureFormState => ({
  title: "",
  grenadeType: "Smoke",
  map: "",
  location: "",
  position: "Respawn",
  teleportCommand: "",
  description: "",
  coverImageText: "",
  imageTexts: [],
  youtubeUrl: "",
});

function normalizePosition(value: string | undefined) {
  const trimmed = (value ?? "").trim();
  return trimmed === "Spawn" ? "Respawn" : trimmed;
}

function getYouTubeEmbedUrl(url: string) {
  try {
    const parsedUrl = new URL(url);

    if (parsedUrl.hostname.includes("youtu.be")) {
      const videoId = parsedUrl.pathname.replace("/", "");
      return videoId ? `https://www.youtube.com/embed/${videoId}` : "";
    }

    if (parsedUrl.hostname.includes("youtube.com")) {
      const videoId = parsedUrl.searchParams.get("v");
      return videoId ? `https://www.youtube.com/embed/${videoId}` : "";
    }
  } catch {
    return "";
  }

  return "";
}

function getYouTubeVideoId(url: string) {
  try {
    const parsedUrl = new URL(url);

    if (parsedUrl.hostname.includes("youtu.be")) {
      return parsedUrl.pathname.replace("/", "").trim();
    }

    if (parsedUrl.hostname.includes("youtube.com")) {
      const fromQuery = parsedUrl.searchParams.get("v")?.trim() ?? "";
      if (fromQuery) {
        return fromQuery;
      }

      const embedMatch = parsedUrl.pathname.match(/\/embed\/([^/?]+)/);
      if (embedMatch?.[1]) {
        return embedMatch[1].trim();
      }
    }
  } catch {
    return "";
  }

  return "";
}

function getYouTubeThumbnailUrl(url: string) {
  const videoId = getYouTubeVideoId(url);
  return videoId ? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg` : "";
}

function getYouTubeHoverPreviewUrl(url: string) {
  const videoId = getYouTubeVideoId(url);
  if (!videoId) {
    return "";
  }

  const params = new URLSearchParams({
    autoplay: "1",
    mute: "1",
    controls: "0",
    rel: "0",
    modestbranding: "1",
    loop: "1",
    playlist: videoId,
    playsinline: "1",
    enablejsapi: "1",
  });

  return `https://www.youtube.com/embed/${videoId}?${params.toString()}`;
}

function sendYouTubePlaybackCommands(targetWindow: Window | null, speed = 1.5) {
  if (!targetWindow) {
    return;
  }

  const commands = [
    { event: "command", func: "mute", args: [] },
    { event: "command", func: "playVideo", args: [] },
    { event: "command", func: "setPlaybackRate", args: [speed] },
  ];

  for (const command of commands) {
    targetWindow.postMessage(JSON.stringify(command), "*");
  }
}

function getCommentTimeLabel(value: unknown) {
  if (!value || typeof value !== "object") {
    return "";
  }

  const seconds = (value as { seconds?: number }).seconds;
  if (!seconds) {
    return "";
  }

  return new Date(seconds * 1000).toLocaleDateString("pt-BR");
}

function getFeatureTitleSizeClass(title: string) {
  const length = title.trim().length;

  if (length >= 70) {
    return "text-sm md:text-base";
  }

  if (length >= 48) {
    return "text-base md:text-lg";
  }

  return "text-xl md:text-2xl";
}

const grenadeIconByKey: Record<string, string> = {
  smoke: "/assets/icons/grenades/smoke.png",
  flash: "/assets/icons/grenades/flashbang.png",
  flashbang: "/assets/icons/grenades/flashbang.png",
  decoy: "/assets/icons/grenades/decoy.png",
  molotov: "/assets/icons/grenades/molotov.png",
  molly: "/assets/icons/grenades/molotov.png",
  incendiary: "/assets/icons/grenades/molotov.png",
  he: "/assets/icons/grenades/he.png",
  grenade: "/assets/icons/grenades/he.png",
  hegrenade: "/assets/icons/grenades/he.png",
  frag: "/assets/icons/grenades/he.png",
};

const mapIconByKey: Record<string, string> = {
  ancient: "/assets/icons/maps/ancient.png",
  anubis: "/assets/icons/maps/anubis.png",
  cobblestone: "/assets/icons/maps/cobblestone.png",
  cbble: "/assets/icons/maps/cobblestone.png",
  dustii: "/assets/icons/maps/dustii.png",
  dust2: "/assets/icons/maps/dustii.png",
  "dust-2": "/assets/icons/maps/dustii.png",
  "dust-ii": "/assets/icons/maps/dustii.png",
  inferno: "/assets/icons/maps/inferno.png",
  mirage: "/assets/icons/maps/mirage.png",
  nuke: "/assets/icons/maps/nuke.png",
  overpass: "/assets/icons/maps/overpass.png",
  train: "/assets/icons/maps/train.png",
  vertigo: "/assets/icons/maps/vertigo.png",
};

const grenadeTypeAliases: Record<string, string[]> = {
  smoke: ["smoke"],
  flash: ["flash", "flashbang"],
  flashbang: ["flashbang", "flash"],
  decoy: ["decoy"],
  molotov: ["molotov", "molly", "incendiary"],
  he: ["he", "hegrenade", "frag"],
  grenade: ["he", "hegrenade", "frag"],
};

const mapNameAliases: Record<string, string[]> = {
  dust2: ["dustii", "dust2", "dust-2", "dust-ii"],
  "dust-2": ["dustii", "dust2", "dust-2", "dust-ii"],
  "dust-ii": ["dustii", "dust2", "dust-2", "dust-ii"],
  dustii: ["dustii", "dust2", "dust-2", "dust-ii"],
  nuke: ["nuke"],
  mirage: ["mirage"],
  inferno: ["inferno"],
  vertigo: ["vertigo"],
  ancient: ["ancient"],
  anubis: ["anubis"],
  overpass: ["overpass"],
  train: ["train"],
  cobblestone: ["cobblestone", "cbble"],
  cbble: ["cobblestone", "cbble"],
};

function slugifyIconName(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function uniqueValues(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)));
}

function getGrenadeTypeIconCandidates(grenadeType?: string) {
  if (!grenadeType?.trim()) {
    return [];
  }

  const key = slugifyIconName(grenadeType);
  const aliases = grenadeTypeAliases[key] ?? [key];
  const candidates = aliases
    .map((alias) => grenadeIconByKey[slugifyIconName(alias)])
    .filter((iconPath): iconPath is string => Boolean(iconPath));

  return uniqueValues(candidates);
}

function getMapIconCandidates(mapName?: string) {
  if (!mapName?.trim()) {
    return [];
  }

  const slug = slugifyIconName(mapName);
  const compactSlug = slug.replace(/-/g, "");
  const aliases = mapNameAliases[slug] ?? [slug, compactSlug];
  const candidates = aliases
    .map((alias) => mapIconByKey[slugifyIconName(alias)])
    .filter((iconPath): iconPath is string => Boolean(iconPath));

  return uniqueValues(candidates);
}

type IconWithFallbackProps = {
  candidates: string[];
  alt: string;
  className: string;
};

function IconWithFallback({ candidates, alt, className }: IconWithFallbackProps) {
  const uniqueCandidates = uniqueValues(candidates);
  const [activeCandidateIndex, setActiveCandidateIndex] = useState(0);

  if (!uniqueCandidates.length || activeCandidateIndex >= uniqueCandidates.length) {
    return null;
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={uniqueCandidates[activeCandidateIndex]}
      alt={alt}
      className={className}
      onError={() => setActiveCandidateIndex((current) => current + 1)}
    />
  );
}

async function readFileAsDataUrl(file: File) {
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
    reader.onerror = () => reject(new Error("Falha ao ler imagem."));
    reader.readAsDataURL(file);
  });
}

async function compressImageToDataUrl(file: File) {
  const sourceDataUrl = await readFileAsDataUrl(file);
  const image = new Image();

  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error("Falha ao processar imagem."));
    image.src = sourceDataUrl;
  });

  const maxDimension = 1280;
  const scale = Math.min(1, maxDimension / Math.max(image.width, image.height));
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext("2d");
  if (!context) {
    return sourceDataUrl;
  }

  context.drawImage(image, 0, 0, width, height);

  let quality = 0.82;
  let output = canvas.toDataURL("image/jpeg", quality);

  while (output.length > 700_000 && quality > 0.4) {
    quality -= 0.08;
    output = canvas.toDataURL("image/jpeg", quality);
  }

  return output;
}

export function FeaturePage({ category, badge, title, intro, points, showHero = true }: FeaturePageProps) {
  const { user, profile, role } = useAuthSession();
  const copy = categoryCopy[category];
  const [features, setFeatures] = useState<FeatureItem[]>([]);
  const [comments, setComments] = useState<FeatureComment[]>([]);
  const [featureModalOpen, setFeatureModalOpen] = useState(false);
  const [editingFeature, setEditingFeature] = useState<FeatureItem | null>(null);
  const [featureForm, setFeatureForm] = useState<FeatureFormState>(emptyFeatureForm);
  const [filterGrenadeType, setFilterGrenadeType] = useState("");
  const [filterMap, setFilterMap] = useState("");
  const [filterLocation, setFilterLocation] = useState("");
  const [filterPosition, setFilterPosition] = useState("");
  const [expandedFeatureId, setExpandedFeatureId] = useState<string | null>(null);
  const [activeExpandedImageIndex, setActiveExpandedImageIndex] = useState(0);
  const [commentDrafts, setCommentDrafts] = useState<Record<string, string>>({});
  const [editingComment, setEditingComment] = useState<FeatureComment | null>(null);
  const [editingCommentText, setEditingCommentText] = useState("");
  const [feedback, setFeedback] = useState("");
  const [saving, setSaving] = useState(false);
  const [processingImage, setProcessingImage] = useState(false);
  const [imageViewer, setImageViewer] = useState<{ src: string; alt: string } | null>(null);
  const [imageZoom, setImageZoom] = useState(1);
  const [copiedCommandKey, setCopiedCommandKey] = useState("");
  const [coverProcessingImage, setCoverProcessingImage] = useState(false);
  const [hoveredFeatureId, setHoveredFeatureId] = useState<string | null>(null);
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);

  const canAddFeature = isFeatureManager(role);
  const canModerateComments = isCommentModerator(role);

  useEffect(() => {
    if (!db) {
      setFeedback("Configure o Firebase para visualizar conteudo em tempo real.");
      return;
    }

    const featuresQuery = query(
      collection(db, "features"),
      where("category", "==", category)
    );

    const unsubscribe = onSnapshot(featuresQuery, (snapshot) => {
      const items = snapshot.docs.map((item) => ({
        id: item.id,
        ...(item.data() as Omit<FeatureItem, "id">),
      }));

      setFeatures(items.sort((first, second) => first.title.localeCompare(second.title)));
    });

    return () => unsubscribe();
  }, [category]);

  useEffect(() => {
    if (!db) {
      return;
    }

    const unsubscribe = onSnapshot(collection(db, "comments"), (snapshot) => {
      const items = snapshot.docs.map((item) => ({
        id: item.id,
        ...(item.data() as Omit<FeatureComment, "id">),
      }));

      setComments(items);
    });

    return () => unsubscribe();
  }, []);

  const featureComments = useMemo(
    () =>
      features.reduce<Record<string, FeatureComment[]>>((accumulator, feature) => {
        accumulator[feature.id] = comments
          .filter((comment) => comment.featureId === feature.id)
          .sort((first, second) => {
            const firstSeconds = (first.createdAt as { seconds?: number } | undefined)?.seconds ?? 0;
            const secondSeconds = (second.createdAt as { seconds?: number } | undefined)?.seconds ?? 0;
            return secondSeconds - firstSeconds;
          });
        return accumulator;
      }, {}),
    [comments, features]
  );

  const filterOptions = useMemo(
    () => ({
      grenadeTypes: Array.from(
        new Set(features.map((item) => (item.grenadeType ?? "").trim()).filter(Boolean))
      ).sort((first, second) => first.localeCompare(second)),
      maps: Array.from(
        new Set(features.map((item) => (item.map ?? "").trim()).filter(Boolean))
      ).sort((first, second) => first.localeCompare(second)),
      locations: Array.from(
        new Set(features.map((item) => (item.location ?? "").trim()).filter(Boolean))
      ).sort((first, second) => first.localeCompare(second)),
      positions: Array.from(
        new Set(features.map((item) => normalizePosition(item.position)).filter(Boolean))
      ).sort((first, second) => first.localeCompare(second)),
    }),
    [features]
  );

  const filteredFeatures = useMemo(
    () =>
      features.filter((feature) => {
        const featureGrenadeType = (feature.grenadeType ?? "").trim();
        const featureMap = (feature.map ?? "").trim();
        const featureLocation = (feature.location ?? "").trim();
        const featurePosition = normalizePosition(feature.position);

        if (filterGrenadeType && featureGrenadeType !== filterGrenadeType) {
          return false;
        }

        if (filterMap && featureMap !== filterMap) {
          return false;
        }

        if (filterLocation && featureLocation !== filterLocation) {
          return false;
        }

        if (filterPosition && featurePosition !== filterPosition) {
          return false;
        }

        return true;
      }),
    [features, filterGrenadeType, filterLocation, filterMap, filterPosition]
  );

  const openExpandedFeature = (featureId: string) => {
    const nextExpandedFeatureId = expandedFeatureId === featureId ? null : featureId;
    setExpandedFeatureId(nextExpandedFeatureId);
    setActiveExpandedImageIndex(0);
  };

  const handleImageUpload = async (files: FileList | null) => {
    if (!files || files.length === 0) {
      return;
    }

    setProcessingImage(true);
    setFeedback("Processando imagem...");

    try {
      const incomingFiles = Array.from(files);
      const currentCount = featureForm.imageTexts.length;
      const remainingSlots = Math.max(0, 5 - currentCount);

      if (remainingSlots === 0) {
        setFeedback("Limite de 5 imagens por conteudo.");
        return;
      }

      const filesToProcess = incomingFiles.slice(0, remainingSlots);
      const compressedList = await Promise.all(filesToProcess.map((file) => compressImageToDataUrl(file)));
      const validImages = compressedList.filter((imageData) => imageData.length <= 950_000);

      setFeatureForm((current) => ({
        ...current,
        imageTexts: [...current.imageTexts, ...validImages].slice(0, 5),
      }));

      if (validImages.length === 0) {
        setFeedback("As imagens selecionadas estao muito grandes. Use arquivos menores.");
      } else if (compressedList.length !== validImages.length) {
        setFeedback("Algumas imagens foram ignoradas por tamanho. As restantes estao prontas para salvar.");
      } else {
        setFeedback("Imagem pronta para salvar.");
      }
    } catch {
      setFeedback("Nao foi possivel processar a imagem.");
    } finally {
      setProcessingImage(false);
    }
  };

  const handleCoverImageUpload = async (file: File | null) => {
    if (!file) {
      setFeatureForm((current) => ({ ...current, coverImageText: "" }));
      return;
    }

    setCoverProcessingImage(true);
    setFeedback("Processando imagem de capa...");

    try {
      const imageData = await compressImageToDataUrl(file);
      setFeatureForm((current) => ({
        ...current,
        coverImageText: imageData,
      }));

      if (imageData.length > 950_000) {
        setFeedback("Imagem de capa muito grande para salvar. Tente uma menor.");
      } else {
        setFeedback("Imagem de capa pronta para salvar.");
      }
    } catch {
      setFeedback("Nao foi possivel processar a imagem de capa.");
    } finally {
      setCoverProcessingImage(false);
    }
  };

  const openNewFeatureModal = () => {
    setEditingFeature(null);
    setFeatureForm(emptyFeatureForm());
    setFeedback("");
    setFeatureModalOpen(true);
  };

  const openEditFeatureModal = (feature: FeatureItem) => {
    setEditingFeature(feature);
    setFeatureForm({
      title: feature.title ?? "",
      grenadeType: feature.grenadeType ?? "Smoke",
      map: feature.map ?? "",
      location: feature.location ?? "",
      position: normalizePosition(feature.position) || "Respawn",
      teleportCommand: feature.teleportCommand ?? "",
      description: feature.description ?? "",
      coverImageText: feature.coverImageText ?? feature.imageTexts?.[0] ?? feature.imageText ?? feature.imageUrl ?? "",
      imageTexts: feature.imageTexts?.filter(Boolean) ?? [feature.imageText ?? feature.imageUrl ?? ""].filter(Boolean),
      youtubeUrl: feature.youtubeUrl ?? "",
    });
    setFeedback("");
    setFeatureModalOpen(true);
  };

  const closeFeatureModal = () => {
    setFeatureModalOpen(false);
    setEditingFeature(null);
    setFeatureForm(emptyFeatureForm());
  };

  const submitFeature = async (event: FormEvent) => {
    event.preventDefault();

    if (!db || !user || !canAddFeature) {
      setFeedback(`Voce nao tem permissao para adicionar ${copy.plural}.`);
      return;
    }

    const isGranadas = category === "granadas";

    if (
      !featureForm.title.trim() ||
      !featureForm.map.trim() ||
      (isGranadas && !featureForm.grenadeType.trim())
    ) {
      setFeedback(
        isGranadas ? "Preencha nome, tipo e mapa." : "Preencha nome e mapa."
      );
      return;
    }

    setSaving(true);

    try {
      const payload = {
        category,
        title: featureForm.title.trim(),
        grenadeType: featureForm.grenadeType.trim(),
        map: featureForm.map.trim(),
        location: featureForm.location.trim(),
        position: featureForm.position.trim(),
        teleportCommand: featureForm.teleportCommand.trim(),
        description: featureForm.description.trim(),
        coverImageText: featureForm.coverImageText.trim(),
        imageTexts: featureForm.imageTexts,
        imageText: featureForm.imageTexts[0] ?? "",
        youtubeUrl: featureForm.youtubeUrl.trim(),
        updatedAt: serverTimestamp(),
      };

      if (editingFeature) {
        await updateDoc(doc(db, "features", editingFeature.id), payload);
        closeFeatureModal();
        setFeedback(`${copy.singularTitle} atualizada com sucesso.`);
      } else {
        await addDoc(collection(db, "features"), {
          ...payload,
          createdBy: user.uid,
          createdByName: profile?.displayName ?? user.displayName ?? user.email ?? "jogador",
          createdAt: serverTimestamp(),
        });
        closeFeatureModal();
        setFeedback(`${copy.singularTitle} adicionada com sucesso.`);
      }
    } catch (error) {
      const code = (error as { code?: string } | null)?.code ?? "";
      const message = (error as { message?: string } | null)?.message ?? "";
      if (code.includes("permission-denied")) {
        setFeedback(`Sem permissao no Firestore para salvar ${copy.singular}. Verifique seu papel (admin/owner) e as regras publicadas.`);
      } else if (message) {
        setFeedback(`Erro ao salvar ${copy.singular}: ${message}`);
      } else {
        setFeedback(`Nao foi possivel salvar ${copy.singular}.`);
      }
    } finally {
      setSaving(false);
    }
  };

  const deleteFeature = async (featureId: string) => {
    if (!db || !canAddFeature) {
      return;
    }

    setSaving(true);

    try {
      await deleteDoc(doc(db, "features", featureId));
      setFeedback(`${copy.singularTitle} excluida com sucesso.`);
    } catch (error) {
      const code = (error as { code?: string } | null)?.code ?? "";
      if (code.includes("permission-denied")) {
        setFeedback(`Sem permissao para excluir ${copy.singular}.`);
      } else {
        setFeedback(`Nao foi possivel excluir ${copy.singular}.`);
      }
    } finally {
      setSaving(false);
    }
  };

  const copyToClipboard = async (value: string, key: string) => {
    if (!value.trim()) {
      return;
    }

    try {
      await navigator.clipboard.writeText(value);
      setCopiedCommandKey(key);
      window.setTimeout(() => {
        setCopiedCommandKey((current) => (current === key ? "" : current));
      }, 1500);
    } catch {
      setFeedback("Nao foi possivel copiar o comando.");
    }
  };

  const openImageViewer = (src: string, alt: string) => {
    setImageViewer({ src, alt });
    setImageZoom(1);
  };

  const closeImageViewer = () => {
    setImageViewer(null);
    setImageZoom(1);
  };

  const applyZoom = (nextZoom: number) => {
    setImageZoom(Math.min(4, Math.max(0.6, nextZoom)));
  };

  const onImageWheel = (event: WheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    const delta = event.deltaY < 0 ? 0.15 : -0.15;
    applyZoom(imageZoom + delta);
  };

  const submitComment = async (event: FormEvent, featureId: string) => {
    event.preventDefault();

    if (!db || !user) {
      setFeedback("Faca login para comentar.");
      return;
    }

    const text = (commentDrafts[featureId] ?? "").trim();
    if (!text) {
      return;
    }

    setSaving(true);

    try {
      await addDoc(collection(db, "comments"), {
        featureId,
        uid: user.uid,
        userName: profile?.displayName ?? user.displayName ?? user.email ?? "jogador",
        text,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      setCommentDrafts((current) => ({ ...current, [featureId]: "" }));
      setFeedback("Comentario publicado.");
    } catch {
      setFeedback("Nao foi possivel publicar comentario.");
    } finally {
      setSaving(false);
    }
  };

  const saveCommentEdit = async () => {
    if (!db || !editingComment) {
      return;
    }

    if (!editingCommentText.trim()) {
      setFeedback("O comentario nao pode ficar vazio.");
      return;
    }

    setSaving(true);

    try {
      await updateDoc(doc(db, "comments", editingComment.id), {
        text: editingCommentText.trim(),
        updatedAt: serverTimestamp(),
      });
      setEditingComment(null);
      setEditingCommentText("");
      setFeedback("Comentario atualizado.");
    } catch {
      setFeedback("Nao foi possivel atualizar o comentario.");
    } finally {
      setSaving(false);
    }
  };

  const deleteComment = async (commentId: string) => {
    if (!db) {
      return;
    }

    setSaving(true);

    try {
      await deleteDoc(doc(db, "comments", commentId));
      setFeedback("Comentario removido.");
    } catch {
      setFeedback("Nao foi possivel remover o comentario.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <main className="mx-auto w-full max-w-400 px-3 pb-12 text-slate-100 sm:px-4 lg:px-6">
      {showHero && (
        <section className="rounded-3xl border border-slate-700/70 bg-slate-950/70 p-6 shadow-[0_28px_65px_rgba(0,0,0,.45)] md:p-10">
          <p className="mb-3 inline-flex rounded-full border border-orange-300/35 px-3 py-1 text-xs uppercase tracking-[0.14em] text-orange-300">
            {badge}
          </p>
          <h1 className="text-3xl font-bold uppercase tracking-tight text-white md:text-5xl">
            {title}
          </h1>
          <p className="mt-4 max-w-4xl text-slate-300 md:text-lg">{intro}</p>

          <div className="mt-6 rounded-2xl border border-slate-700 bg-slate-800/65 p-5">
            <ul className="space-y-2 text-sm text-slate-200 md:text-base">
              {points.map((item) => (
                <li key={item} className="flex items-start gap-2">
                  <span className="mt-1 h-1.5 w-1.5 rounded-full bg-orange-300" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}

      {feedback && (
        <p className="mt-4 rounded-xl border border-slate-700 bg-slate-900/75 px-4 py-3 text-sm text-slate-300">
          {feedback}
        </p>
      )}

      <div className="mt-4 flex flex-wrap items-center justify-end gap-3">
        {canAddFeature && (
          <button
            type="button"
            onClick={openNewFeatureModal}
            className="rounded-lg border border-orange-300/45 bg-linear-to-r from-orange-400 to-orange-300 px-4 py-2.5 text-sm font-semibold text-slate-950 transition hover:scale-[1.01]"
          >
            {`Adicionar ${copy.singular}`}
          </button>
        )}
      </div>

      <section className="mt-4 space-y-4">
        <div className="rounded-2xl border border-slate-700 bg-slate-900/75 p-4 shadow-[0_10px_20px_rgba(0,0,0,.2)] md:p-5">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-semibold uppercase tracking-[0.08em] text-slate-200">
              Filtros
            </p>

            <button
              type="button"
              onClick={() => setMobileFiltersOpen((current) => !current)}
              className="inline-flex items-center gap-2 rounded-lg border border-slate-500 bg-slate-800 px-3 py-2 text-xs font-semibold text-slate-100 transition hover:border-slate-300 md:hidden"
              aria-expanded={mobileFiltersOpen}
              aria-controls="feature-filters-mobile"
            >
              {mobileFiltersOpen ? "Fechar" : "Abrir"}
            </button>
          </div>

          <div className="mt-3 hidden gap-3 md:grid md:grid-cols-4">
            <label className="space-y-2 text-sm text-slate-300">
              <span>Tipo</span>
              <select
                className="w-full rounded-lg border border-slate-600 bg-slate-950 px-3 py-2 text-slate-100 outline-none"
                value={filterGrenadeType}
                onChange={(event) => setFilterGrenadeType(event.target.value)}
              >
                <option value="">Todos</option>
                {filterOptions.grenadeTypes.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </label>

            <label className="space-y-2 text-sm text-slate-300">
              <span>Mapa</span>
              <select
                className="w-full rounded-lg border border-slate-600 bg-slate-950 px-3 py-2 text-slate-100 outline-none"
                value={filterMap}
                onChange={(event) => setFilterMap(event.target.value)}
              >
                <option value="">Todos</option>
                {filterOptions.maps.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </label>

            <label className="space-y-2 text-sm text-slate-300">
              <span>Local</span>
              <select
                className="w-full rounded-lg border border-slate-600 bg-slate-950 px-3 py-2 text-slate-100 outline-none"
                value={filterLocation}
                onChange={(event) => setFilterLocation(event.target.value)}
              >
                <option value="">Todos</option>
                {filterOptions.locations.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </label>

            <label className="space-y-2 text-sm text-slate-300">
              <span>Posicao</span>
              <select
                className="w-full rounded-lg border border-slate-600 bg-slate-950 px-3 py-2 text-slate-100 outline-none"
                value={filterPosition}
                onChange={(event) => setFilterPosition(event.target.value)}
              >
                <option value="">Todos</option>
                {filterOptions.positions.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div
            id="feature-filters-mobile"
            className={`${mobileFiltersOpen ? "mt-3 grid" : "hidden"} grid-cols-1 gap-3 md:hidden`}
          >
              <label className="space-y-2 text-sm text-slate-300">
                <span>Tipo</span>
                <select
                  className="w-full rounded-lg border border-slate-600 bg-slate-950 px-3 py-2 text-slate-100 outline-none"
                  value={filterGrenadeType}
                  onChange={(event) => setFilterGrenadeType(event.target.value)}
                >
                  <option value="">Todos</option>
                  {filterOptions.grenadeTypes.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </label>

            <label className="space-y-2 text-sm text-slate-300">
              <span>Mapa</span>
              <select
                className="w-full rounded-lg border border-slate-600 bg-slate-950 px-3 py-2 text-slate-100 outline-none"
                value={filterMap}
                onChange={(event) => setFilterMap(event.target.value)}
              >
                <option value="">Todos</option>
                {filterOptions.maps.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </label>

            <label className="space-y-2 text-sm text-slate-300">
              <span>Local</span>
              <select
                className="w-full rounded-lg border border-slate-600 bg-slate-950 px-3 py-2 text-slate-100 outline-none"
                value={filterLocation}
                onChange={(event) => setFilterLocation(event.target.value)}
              >
                <option value="">Todos</option>
                {filterOptions.locations.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </label>

            <label className="space-y-2 text-sm text-slate-300">
              <span>Posicao</span>
              <select
                className="w-full rounded-lg border border-slate-600 bg-slate-950 px-3 py-2 text-slate-100 outline-none"
                value={filterPosition}
                onChange={(event) => setFilterPosition(event.target.value)}
              >
                <option value="">Todos</option>
                {filterOptions.positions.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>

        {filteredFeatures.length === 0 ? (
          <div className="rounded-2xl border border-slate-700 bg-slate-900/75 p-6 text-slate-300">
            {`Nenhuma ${copy.singular} encontrada com esses filtros. `}
            {canAddFeature ? "Use o botão acima para criar a primeira." : "Aguarde novas publicações."}
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4 items-start">
            {filteredFeatures.map((feature) => {
            const commentsForFeature = featureComments[feature.id] ?? [];
            const imageList = feature.imageTexts?.length
              ? feature.imageTexts
              : [feature.imageText ?? feature.imageUrl ?? ""].filter(Boolean);
            const coverImageText = feature.coverImageText ?? imageList[0] ?? "";
            const embedUrl = getYouTubeEmbedUrl(feature.youtubeUrl);
            const videoThumbnailUrl = getYouTubeThumbnailUrl(feature.youtubeUrl);
            const renderableImage = coverImageText.startsWith("data:") || coverImageText.startsWith("http")
              ? coverImageText
              : "";
            const isExpanded = expandedFeatureId === feature.id;
            const featureTitleSizeClass = getFeatureTitleSizeClass(feature.title);
            const grenadeTypeIconCandidates = getGrenadeTypeIconCandidates(feature.grenadeType);
            const mapIconCandidates = getMapIconCandidates(feature.map);
            const videoHoverPreviewUrl = getYouTubeHoverPreviewUrl(feature.youtubeUrl);
            const showVideoHoverPreview = !isExpanded && hoveredFeatureId === feature.id && Boolean(videoHoverPreviewUrl);

              const mediaImageSources = Array.from(
                new Set(
                  [coverImageText, ...imageList]
                    .map((src) => src.trim())
                    .filter((src) => src.startsWith("data:") || src.startsWith("http"))
                )
              );

              const mediaItems = [
                ...mediaImageSources.map((src) => ({
                  type: "image" as const,
                  src,
                  label: "Imagem",
                })),
                ...(embedUrl
                  ? [
                      {
                        type: "video" as const,
                        src: embedUrl,
                        thumbnail: videoThumbnailUrl,
                        label: "Video",
                      },
                    ]
                  : []),
              ];

              const safeMediaIndex = mediaItems.length
                ? Math.min(activeExpandedImageIndex, mediaItems.length - 1)
                : 0;
              const activeMediaItem = mediaItems[safeMediaIndex] ?? null;
              const hasMultipleMedia = mediaItems.length > 1;

            const goToPreviousImage = () => {
                if (!mediaItems.length) {
                return;
              }

              setActiveExpandedImageIndex((current) =>
                  current === 0 ? mediaItems.length - 1 : current - 1
              );
            };

            const goToNextImage = () => {
                if (!mediaItems.length) {
                return;
              }

              setActiveExpandedImageIndex((current) =>
                  current >= mediaItems.length - 1 ? 0 : current + 1
              );
            };

            return (
              <article
                key={feature.id}
                className={`rounded-2xl border border-slate-700/70 bg-slate-900/75 p-4 shadow-[0_10px_20px_rgba(0,0,0,.2)] md:p-5 ${
                  isExpanded ? "col-span-full" : ""
                }`}
              >
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => openExpandedFeature(feature.id)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      openExpandedFeature(feature.id);
                    }
                  }}
                  className="flex w-full flex-col gap-3 text-left outline-none"
                >
                  <div className="flex w-full items-start justify-between gap-3">
                    <div className="min-w-0 space-y-1.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="flex min-w-0 items-center gap-2">
                          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-slate-700 bg-slate-800/80">
                            <IconWithFallback
                              candidates={grenadeTypeIconCandidates}
                              alt={feature.grenadeType ? `Tipo ${feature.grenadeType}` : "Tipo"}
                              className="h-6 w-6 shrink-0 object-contain"
                            />
                          </div>
                          <h2
                            className={`max-w-full truncate whitespace-nowrap font-semibold uppercase leading-tight text-white ${featureTitleSizeClass}`}
                            title={feature.title}
                          >
                            {feature.title}
                          </h2>
                        </div>
                        {isExpanded && (
                          <span className="rounded-full border border-slate-700 px-2.5 py-1 text-xs text-slate-400">
                            Clique para recolher
                          </span>
                        )}
                      </div>

                      {!isExpanded && canAddFeature && (
                        <div className="flex flex-wrap gap-2 pt-1">
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              openEditFeatureModal(feature);
                            }}
                            className="rounded-md border border-slate-500 px-2.5 py-1 text-xs font-semibold text-slate-200 transition hover:border-slate-300"
                          >
                            Editar
                          </button>
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              if (window.confirm(`Deseja excluir esta ${copy.singular}?`)) {
                                void deleteFeature(feature.id);
                              }
                            }}
                            className="rounded-md border border-red-500/50 px-2.5 py-1 text-xs font-semibold text-red-200 transition hover:border-red-300"
                          >
                            Excluir
                          </button>
                        </div>
                      )}
                    </div>

                    {isExpanded && (
                      <div className="flex flex-wrap gap-2">
                        {canAddFeature && (
                        <>
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              openEditFeatureModal(feature);
                            }}
                            className="rounded-md border border-slate-500 px-2.5 py-1 text-xs font-semibold text-slate-200 transition hover:border-slate-300"
                          >
                            Editar
                          </button>
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              if (window.confirm(`Deseja excluir esta ${copy.singular}?`)) {
                                void deleteFeature(feature.id);
                              }
                            }}
                            className="rounded-md border border-red-500/50 px-2.5 py-1 text-xs font-semibold text-red-200 transition hover:border-red-300"
                          >
                            Excluir
                          </button>
                        </>
                        )}
                      </div>
                    )}
                  </div>

                  {!isExpanded && (
                    <div className="flex w-full flex-col gap-3">
                      <div
                        className="-mx-4 aspect-video w-[calc(100%+2rem)] overflow-hidden border border-slate-700 bg-slate-950/60 md:-mx-5 md:w-[calc(100%+2.5rem)]"
                        onMouseEnter={() => setHoveredFeatureId(feature.id)}
                        onMouseLeave={() => setHoveredFeatureId((current) => (current === feature.id ? null : current))}
                      >
                        {showVideoHoverPreview ? (
                          <iframe
                            className="h-full w-full"
                            src={videoHoverPreviewUrl}
                            title={`${feature.title} preview`}
                            allow="autoplay; encrypted-media; picture-in-picture"
                            allowFullScreen
                            onLoad={(event) => {
                              const targetWindow = event.currentTarget.contentWindow;
                              sendYouTubePlaybackCommands(targetWindow, 1.5);
                              for (let attempt = 1; attempt <= 6; attempt += 1) {
                                window.setTimeout(() => {
                                  sendYouTubePlaybackCommands(targetWindow, 1.5);
                                }, attempt * 300);
                              }
                            }}
                          />
                        ) : renderableImage ? (
                          <>
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={renderableImage}
                              alt={feature.title}
                              className="h-full w-full object-cover"
                            />
                          </>
                        ) : (
                          <div className="flex h-full w-full items-center justify-center text-[10px] text-slate-500">
                            Sem capa
                          </div>
                        )}
                      </div>

                      {feature.map && (
                        <div className="flex min-h-6 items-center gap-2 text-sm text-slate-300">
                          <IconWithFallback
                            candidates={mapIconCandidates}
                            alt={`Mapa ${feature.map}`}
                            className="h-5 w-5 shrink-0 object-contain"
                          />
                          <span className="truncate">{feature.map}</span>
                        </div>
                      )}
                    </div>
                  )}

                  {isExpanded && (
                    <div className="flex flex-wrap gap-2 text-xs text-slate-400">
                      <span className="rounded-full border border-slate-700 px-2.5 py-1">
                        Criado por {feature.createdByName ?? feature.createdBy}
                      </span>
                      {feature.grenadeType && (
                        <span className="rounded-full border border-slate-700 px-2.5 py-1">
                          Tipo: {feature.grenadeType}
                        </span>
                      )}
                      {feature.map && (
                        <span className="rounded-full border border-slate-700 px-2.5 py-1">
                          Mapa: {feature.map}
                        </span>
                      )}
                      {feature.position && (
                        <span className="rounded-full border border-slate-700 px-2.5 py-1">
                          Posicao: {normalizePosition(feature.position)}
                        </span>
                      )}
                      {feature.location && (
                        <span className="rounded-full border border-slate-700 px-2.5 py-1">
                          Local: {feature.location}
                        </span>
                      )}
                    </div>
                  )}
                </div>

                {isExpanded && (
                  <div className="mt-5 space-y-5">
                    <div>
                      {activeMediaItem ? (
                        <div className="grid gap-3 lg:grid-cols-[1fr_160px] lg:items-start">
                          <div className="relative overflow-hidden rounded-xl border border-slate-700 bg-slate-950/60">
                            {activeMediaItem.type === "image" ? (
                              <button
                                type="button"
                                onClick={() => openImageViewer(activeMediaItem.src, feature.title)}
                                className="block w-full"
                              >
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img
                                  src={activeMediaItem.src}
                                  alt={feature.title}
                                  className="aspect-video h-auto w-full cursor-zoom-in object-cover"
                                />
                              </button>
                            ) : (
                              <iframe
                                className="aspect-video w-full"
                                src={activeMediaItem.src}
                                title={`${feature.title} video`}
                                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                                allowFullScreen
                              />
                            )}

                            {hasMultipleMedia && (
                              <>
                                <button
                                  type="button"
                                  onClick={goToPreviousImage}
                                  className="absolute left-3 top-1/2 inline-flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full border border-slate-700 bg-slate-950/80 text-2xl leading-none font-semibold text-slate-100 shadow-lg transition hover:border-slate-300 hover:bg-slate-900"
                                  aria-label="Imagem anterior"
                                >
                                  <svg
                                    viewBox="0 0 24 24"
                                    className="h-6 w-6"
                                    fill="none"
                                    xmlns="http://www.w3.org/2000/svg"
                                    aria-hidden="true"
                                  >
                                    <path
                                      d="M15 6L9 12L15 18"
                                      stroke="currentColor"
                                      strokeWidth="2.5"
                                      strokeLinecap="round"
                                      strokeLinejoin="round"
                                    />
                                  </svg>
                                </button>
                                <button
                                  type="button"
                                  onClick={goToNextImage}
                                  className="absolute right-3 top-1/2 inline-flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full border border-slate-700 bg-slate-950/80 text-2xl leading-none font-semibold text-slate-100 shadow-lg transition hover:border-slate-300 hover:bg-slate-900"
                                  aria-label="Próxima imagem"
                                >
                                  <svg
                                    viewBox="0 0 24 24"
                                    className="h-6 w-6"
                                    fill="none"
                                    xmlns="http://www.w3.org/2000/svg"
                                    aria-hidden="true"
                                  >
                                    <path
                                      d="M9 6L15 12L9 18"
                                      stroke="currentColor"
                                      strokeWidth="2.5"
                                      strokeLinecap="round"
                                      strokeLinejoin="round"
                                    />
                                  </svg>
                                </button>
                                <div className="absolute bottom-3 right-3 rounded-full border border-slate-700 bg-slate-950/80 px-2.5 py-1 text-[11px] text-slate-300">
                                  {safeMediaIndex + 1}/{mediaItems.length}
                                </div>
                              </>
                            )}
                          </div>

                          {hasMultipleMedia && (
                            <div className="flex gap-2 overflow-x-auto pb-1 lg:max-h-130 lg:flex-col lg:overflow-y-auto lg:overflow-x-hidden lg:pr-1">
                              {mediaItems.map((media, index) => (
                                <button
                                  key={`${feature.id}-thumb-${media.type}-${index}`}
                                  type="button"
                                  onClick={() => setActiveExpandedImageIndex(index)}
                                  className={`shrink-0 overflow-hidden rounded-lg border transition ${
                                    safeMediaIndex === index
                                      ? "border-orange-300"
                                      : "border-slate-700"
                                  }`}
                                >
                                  {media.type === "image" ? (
                                    <>
                                      {/* eslint-disable-next-line @next/next/no-img-element */}
                                      <img
                                        src={media.src}
                                        alt={`${feature.title} ${index + 1}`}
                                        className="aspect-video w-32 object-cover md:w-40 lg:w-full"
                                      />
                                    </>
                                  ) : (
                                    media.thumbnail ? (
                                      <div className="relative">
                                        {/* eslint-disable-next-line @next/next/no-img-element */}
                                        <img
                                          src={media.thumbnail}
                                          alt={`${feature.title} video`}
                                          className="aspect-video w-32 object-cover md:w-40 lg:w-full"
                                        />
                                        <span className="pointer-events-none absolute inset-0 flex items-center justify-center text-2xl text-white/95">
                                          ▶
                                        </span>
                                      </div>
                                    ) : (
                                      <div className="flex aspect-video w-32 items-center justify-center bg-slate-900 text-xs font-semibold text-slate-200 md:w-40 lg:w-full">
                                        Video
                                      </div>
                                    )
                                  )}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      ) : (
                        <div className="flex aspect-video w-full items-center justify-center rounded-xl border border-dashed border-slate-700 bg-slate-950/60 text-sm text-slate-500">
                          Sem imagem de capa cadastrada
                        </div>
                      )}
                    </div>

                    <div>
                      <p className="text-sm text-slate-300 md:text-base">{feature.description}</p>

                      {feature.teleportCommand && (
                        <div className="mt-4 rounded-xl border border-slate-700 bg-slate-950/70 p-3">
                          <p className="text-xs uppercase tracking-[0.14em] text-slate-400">Comando de teleporte</p>
                          <div className="mt-2 flex flex-wrap items-center gap-3">
                            <button
                              type="button"
                              onClick={() => void copyToClipboard(feature.teleportCommand ?? "", feature.id)}
                              className="max-w-full truncate text-left text-sm text-orange-300 underline decoration-orange-300/60 underline-offset-4"
                            >
                              {feature.teleportCommand}
                            </button>
                            <button
                              type="button"
                              onClick={() => void copyToClipboard(feature.teleportCommand ?? "", feature.id)}
                              className="rounded-md border border-slate-500 bg-slate-800 px-2.5 py-1.5 text-xs font-semibold text-slate-100 transition hover:border-slate-300"
                            >
                              {copiedCommandKey === feature.id ? "Copiado" : "Copiar"}
                            </button>
                          </div>
                        </div>
                      )}

                      <div className="mt-4 rounded-xl border border-slate-700 bg-slate-950/55 p-4">
                        <form className="space-y-3" onSubmit={(event) => void submitComment(event, feature.id)}>
                          <textarea
                            className="min-h-24 w-full rounded-lg border border-slate-600 bg-slate-950 p-3 text-sm text-slate-100 outline-none transition focus:border-orange-300"
                            placeholder={user ? "Escreva um comentario..." : "Faça login para comentar"}
                            value={commentDrafts[feature.id] ?? ""}
                            onChange={(event) =>
                              setCommentDrafts((current) => ({
                                ...current,
                                [feature.id]: event.target.value,
                              }))
                            }
                            disabled={!user}
                          />
                          <button
                            type="submit"
                            disabled={!user || saving}
                            className="rounded-lg border border-slate-500 bg-slate-800 px-3 py-2 text-sm font-semibold text-slate-100 transition hover:border-slate-300 disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            Enviar comentario
                          </button>
                        </form>

                        <div className="mt-4 space-y-3">
                          {commentsForFeature.length === 0 ? (
                            <p className="text-sm text-slate-500">Nenhum comentario ainda.</p>
                          ) : (
                            commentsForFeature.map((comment) => (
                              <div
                                key={comment.id}
                                className="rounded-xl border border-slate-700 bg-slate-900 p-3"
                              >
                                {editingComment?.id === comment.id ? (
                                  <div className="space-y-3">
                                    <textarea
                                      className="min-h-24 w-full rounded-lg border border-slate-600 bg-slate-950 p-3 text-sm text-slate-100 outline-none transition focus:border-orange-300"
                                      value={editingCommentText}
                                      onChange={(event) => setEditingCommentText(event.target.value)}
                                    />
                                    <div className="flex flex-wrap gap-2">
                                      <button
                                        type="button"
                                        onClick={() => void saveCommentEdit()}
                                        className="rounded-lg border border-orange-300/45 bg-orange-400 px-3 py-2 text-sm font-semibold text-slate-950 transition hover:brightness-110"
                                      >
                                        Salvar
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setEditingComment(null);
                                          setEditingCommentText("");
                                        }}
                                        className="rounded-lg border border-slate-500 bg-slate-800 px-3 py-2 text-sm font-semibold text-slate-100 transition hover:border-slate-300"
                                      >
                                        Cancelar
                                      </button>
                                    </div>
                                  </div>
                                ) : (
                                  <>
                                    <div className="flex items-start justify-between gap-3">
                                      <div>
                                        <p className="text-sm font-semibold text-orange-200">
                                          {comment.userName}
                                        </p>
                                        <p className="text-xs text-slate-500">
                                          {getCommentTimeLabel(comment.createdAt)}
                                        </p>
                                      </div>

                                      {canModerateComments && (
                                        <div className="flex flex-wrap gap-2 text-xs">
                                          <button
                                            type="button"
                                            onClick={() => {
                                              setEditingComment(comment);
                                              setEditingCommentText(comment.text);
                                            }}
                                            className="rounded-md border border-slate-500 px-2.5 py-1 text-slate-200 transition hover:border-slate-300"
                                          >
                                            Editar
                                          </button>
                                          <button
                                            type="button"
                                            onClick={() => void deleteComment(comment.id)}
                                            className="rounded-md border border-red-500/50 px-2.5 py-1 text-red-200 transition hover:border-red-300"
                                          >
                                            Apagar
                                          </button>
                                        </div>
                                      )}
                                    </div>

                                    <p className="mt-3 text-sm text-slate-200">{comment.text}</p>
                                  </>
                                )}
                              </div>
                            ))
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </article>
            );
          })}
          </div>
        )}
      </section>

      {featureModalOpen && canAddFeature && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="w-[min(96vw,1120px)] max-h-[92vh] overflow-y-auto rounded-3xl border border-slate-700 bg-slate-950 p-6 shadow-[0_28px_65px_rgba(0,0,0,.45)] md:p-7">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-xs uppercase tracking-[0.16em] text-orange-300">
                  {editingFeature ? `Editar ${copy.singular}` : `Nova ${copy.singular}`}
                </p>
                <h3 className="mt-1 text-2xl font-semibold text-white">
                  {editingFeature ? "Atualizar conteúdo" : "Cadastrar conteúdo"}
                </h3>
              </div>
              <button
                type="button"
                onClick={closeFeatureModal}
                className="rounded-lg border border-slate-500 px-3 py-2 text-sm text-slate-200 transition hover:border-slate-300"
              >
                Fechar
              </button>
            </div>

            <form className="mt-6 space-y-4" onSubmit={(event) => void submitFeature(event)}>
              {feedback && (
                <p className="rounded-xl border border-slate-700 bg-slate-900/75 px-4 py-3 text-sm text-slate-300">
                  {feedback}
                </p>
              )}

              <div className="grid gap-4 md:grid-cols-2">
                <label className="space-y-2 text-sm text-slate-300">
                  <span>Nome</span>
                  <input
                    className="w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-slate-100 outline-none transition focus:border-orange-300"
                    value={featureForm.title}
                    onChange={(event) =>
                      setFeatureForm((current) => ({ ...current, title: event.target.value }))
                    }
                  />
                </label>

                <label className="space-y-2 text-sm text-slate-300">
                  <span>Tipo de granada</span>
                  <select
                    className="w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-slate-100 outline-none transition focus:border-orange-300"
                    value={featureForm.grenadeType}
                    onChange={(event) =>
                      setFeatureForm((current) => ({ ...current, grenadeType: event.target.value }))
                    }
                  >
                    <option value="Smoke">Smoke</option>
                    <option value="Flash">Flash</option>
                    <option value="He">He</option>
                    <option value="Molotov">Molotov</option>
                    <option value="Decoy">Decoy</option>
                  </select>
                </label>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <label className="space-y-2 text-sm text-slate-300">
                  <span>Mapa</span>
                  <input
                    className="w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-slate-100 outline-none transition focus:border-orange-300"
                    value={featureForm.map}
                    onChange={(event) =>
                      setFeatureForm((current) => ({ ...current, map: event.target.value }))
                    }
                  />
                </label>

                <label className="space-y-2 text-sm text-slate-300">
                  <span>Local</span>
                  <input
                    className="w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-slate-100 outline-none transition focus:border-orange-300"
                    value={featureForm.location}
                    onChange={(event) =>
                      setFeatureForm((current) => ({ ...current, location: event.target.value }))
                    }
                    placeholder="Ex: janelão"
                  />
                </label>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <label className="space-y-2 text-sm text-slate-300">
                  <span>Posição</span>
                  <select
                    className="w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-slate-100 outline-none transition focus:border-orange-300"
                    value={featureForm.position}
                    onChange={(event) =>
                      setFeatureForm((current) => ({ ...current, position: event.target.value }))
                    }
                  >
                    <option value="Respawn">Respawn</option>
                    <option value="Diverso">Diverso</option>
                  </select>
                </label>
              </div>

              <label className="space-y-2 text-sm text-slate-300">
                <span>Imagem de capa</span>
                <input
                  type="file"
                  accept="image/*"
                  className="w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-slate-100 outline-none transition file:mr-4 file:rounded-md file:border-0 file:bg-orange-400 file:px-3 file:py-1.5 file:text-sm file:font-semibold file:text-slate-950 focus:border-orange-300"
                  onChange={(event) => void handleCoverImageUpload(event.target.files?.[0] ?? null)}
                />
                <span className="block text-xs text-slate-500">
                  Essa imagem sera usada apenas quando o card estiver minimizado.
                </span>
                {coverProcessingImage && (
                  <span className="block text-xs text-orange-300">Processando imagem de capa...</span>
                )}
              </label>

              {featureForm.coverImageText && (
                <div className="space-y-2 rounded-xl border border-slate-700 bg-slate-950/60 p-2">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={featureForm.coverImageText} alt="Preview da imagem de capa" className="h-36 w-full rounded-md object-cover" />
                  <button
                    type="button"
                    onClick={() =>
                      setFeatureForm((current) => ({
                        ...current,
                        coverImageText: "",
                      }))
                    }
                    className="w-full rounded-md border border-red-500/50 bg-red-950/30 px-3 py-1.5 text-xs font-semibold text-red-200 transition hover:border-red-300"
                  >
                    Remover capa
                  </button>
                </div>
              )}

              <label className="space-y-2 text-sm text-slate-300">
                <span>Imagem</span>
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  className="w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-slate-100 outline-none transition file:mr-4 file:rounded-md file:border-0 file:bg-orange-400 file:px-3 file:py-1.5 file:text-sm file:font-semibold file:text-slate-950 focus:border-orange-300"
                  onChange={(event) => {
                    void handleImageUpload(event.target.files);
                    event.currentTarget.value = "";
                  }}
                />
                <span className="block text-xs text-slate-500">
                  Adicione ate 5 imagens. Elas serao convertidas e salvas como texto no Firestore.
                </span>
                {processingImage && (
                  <span className="block text-xs text-orange-300">Processando imagem...</span>
                )}
              </label>

              {featureForm.imageTexts.length > 0 && (
                <div className="space-y-2">
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {featureForm.imageTexts.map((src, index) => (
                      <div key={`preview-${index}`} className="space-y-2 rounded-xl border border-slate-700 bg-slate-950/60 p-2">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={src} alt={`Preview ${index + 1}`} className="h-28 w-full rounded-md object-cover" />
                        <button
                          type="button"
                          onClick={() =>
                            setFeatureForm((current) => ({
                              ...current,
                              imageTexts: current.imageTexts.filter((_, currentIndex) => currentIndex !== index),
                            }))
                          }
                          className="w-full rounded-md border border-red-500/50 bg-red-950/30 px-3 py-1.5 text-xs font-semibold text-red-200 transition hover:border-red-300"
                        >
                          Remover imagem
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="grid gap-4 md:grid-cols-2">
                <label className="space-y-2 text-sm text-slate-300 md:col-span-2">
                  <span>Descrição</span>
                  <textarea
                    className="min-h-32 w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-slate-100 outline-none transition focus:border-orange-300"
                    value={featureForm.description}
                    onChange={(event) =>
                      setFeatureForm((current) => ({ ...current, description: event.target.value }))
                    }
                  />
                </label>
              </div>

              <label className="space-y-2 text-sm text-slate-300">
                <span>Link do video do YouTube</span>
                <input
                  className="w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-slate-100 outline-none transition focus:border-orange-300"
                  value={featureForm.youtubeUrl}
                  onChange={(event) =>
                    setFeatureForm((current) => ({ ...current, youtubeUrl: event.target.value }))
                  }
                  placeholder="https://www.youtube.com/watch?v=..."
                />
              </label>

              <label className="space-y-2 text-sm text-slate-300">
                <span>Comando de teleporte</span>
                <input
                  className="w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-slate-100 outline-none transition focus:border-orange-300"
                  value={featureForm.teleportCommand}
                  onChange={(event) =>
                    setFeatureForm((current) => ({ ...current, teleportCommand: event.target.value }))
                  }
                  placeholder="Ex: https://link-do-comando ou comando direto"
                />
              </label>

              <div className="flex flex-wrap justify-end gap-5 pt-2">
                <button
                  type="button"
                  onClick={closeFeatureModal}
                  className="rounded-lg border border-slate-500 bg-slate-800 px-4 py-2.5 text-sm font-semibold text-slate-100 transition hover:border-slate-300"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={saving || processingImage || coverProcessingImage}
                  className="rounded-lg border border-orange-300/45 bg-linear-to-r from-orange-400 to-orange-300 px-4 py-2.5 text-sm font-semibold text-slate-950 transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {processingImage || coverProcessingImage ? "Aguarde imagem" : "Salvar"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {imageViewer && (
        <div
          className="fixed inset-0 z-60 flex items-center justify-center bg-black/90 p-4"
          onClick={closeImageViewer}
        >
          <div
            className="w-full max-w-6xl rounded-2xl border border-slate-700 bg-slate-950/95 p-4 md:p-6"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <p className="max-w-[70%] truncate text-sm text-slate-300 md:text-base">{imageViewer.alt}</p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => applyZoom(imageZoom - 0.2)}
                  className="rounded-md border border-slate-500 bg-slate-900 px-3 py-1.5 text-sm text-slate-200 transition hover:border-slate-300"
                >
                  -
                </button>
                <button
                  type="button"
                  onClick={() => applyZoom(1)}
                  className="rounded-md border border-slate-500 bg-slate-900 px-3 py-1.5 text-sm text-slate-200 transition hover:border-slate-300"
                >
                  {`${Math.round(imageZoom * 100)}%`}
                </button>
                <button
                  type="button"
                  onClick={() => applyZoom(imageZoom + 0.2)}
                  className="rounded-md border border-slate-500 bg-slate-900 px-3 py-1.5 text-sm text-slate-200 transition hover:border-slate-300"
                >
                  +
                </button>
                <button
                  type="button"
                  onClick={closeImageViewer}
                  className="rounded-md border border-red-500/50 bg-red-950/30 px-3 py-1.5 text-sm text-red-200 transition hover:border-red-300"
                >
                  Fechar
                </button>
              </div>
            </div>

            <div
              className="max-h-[75vh] overflow-auto rounded-xl border border-slate-700 bg-black"
              onWheel={onImageWheel}
            >
              <div className="flex min-h-[50vh] items-center justify-center p-4">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={imageViewer.src}
                  alt={imageViewer.alt}
                  className="max-h-[70vh] max-w-full select-none object-contain transition duration-150"
                  style={{ transform: `scale(${imageZoom})` }}
                />
              </div>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
