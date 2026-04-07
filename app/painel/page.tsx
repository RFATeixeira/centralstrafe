"use client";

import { collection, doc, onSnapshot, updateDoc } from "firebase/firestore";
import { useEffect, useMemo, useState } from "react";
import { db } from "@/lib/firebase";
import { canAssignRole, Role } from "@/lib/roles";
import { useAuthSession } from "@/components/auth-provider";

type UserRow = {
  id: string;
  uid: string;
  email: string | null;
  displayName: string | null;
  role: Role;
};

export default function PainelPage() {
  const { role, user } = useAuthSession();
  const [users, setUsers] = useState<UserRow[]>([]);
  const [feedback, setFeedback] = useState("");
  const [saving, setSaving] = useState(false);

  const isAdmin = role === "admin" || role === "owner";

  const availableRoles = useMemo(() => {
    if (role === "owner") {
      return ["user", "mod", "admin"] as Role[];
    }

    if (role === "admin") {
      return ["user", "mod"] as Role[];
    }

    return [] as Role[];
  }, [role]);

  useEffect(() => {
    if (!db || !isAdmin) {
      return;
    }

    const usersQuery = collection(db, "users");
    const unsubscribe = onSnapshot(usersQuery, (snapshot) => {
      const rows = snapshot.docs.map((item) => ({
        id: item.id,
        ...(item.data() as Omit<UserRow, "id">),
      }));

      setUsers(rows.sort((a, b) => (a.email ?? "").localeCompare(b.email ?? "")));
    });

    return () => unsubscribe();
  }, [isAdmin]);

  const saveRole = async (uid: string, nextRole: Role) => {
    if (!db || !role) {
      return;
    }

    if (!canAssignRole(role, nextRole)) {
      setFeedback("Sua permissao nao permite atribuir este papel.");
      return;
    }

    setSaving(true);

    try {
      await updateDoc(doc(db, "users", uid), { role: nextRole });
      setFeedback("Papel atualizado com sucesso.");
    } catch {
      setFeedback("Nao foi possivel atualizar o papel.");
    } finally {
      setSaving(false);
    }
  };

  if (!isAdmin) {
    return (
      <main className="mx-auto w-[min(1120px,92vw)] pb-12 text-slate-100">
        <section className="rounded-3xl border border-slate-700/70 bg-slate-950/70 p-6 shadow-[0_28px_65px_rgba(0,0,0,.45)]">
          <h1 className="text-3xl font-bold uppercase text-white">Painel restrito</h1>
          <p className="mt-3 text-slate-300">
            Apenas admin e owner conseguem visualizar este painel.
          </p>
        </section>
      </main>
    );
  }

  return (
    <main className="mx-auto w-[min(1120px,92vw)] pb-12 text-slate-100">
      <section className="rounded-3xl border border-slate-700/70 bg-slate-950/70 p-6 shadow-[0_28px_65px_rgba(0,0,0,.45)] md:p-10">
        <p className="mb-3 inline-flex rounded-full border border-orange-300/35 px-3 py-1 text-xs uppercase tracking-[0.14em] text-orange-300">
          Painel
        </p>
        <h1 className="text-3xl font-bold uppercase tracking-tight text-white md:text-5xl">
          Controle de permissões
        </h1>
        <p className="mt-4 max-w-4xl text-slate-300 md:text-lg">
          Owner e admin podem organizar mod, admin e usuários dentro do projeto.
          O owner pode atribuir admin e mod; o admin pode atribuir apenas mod.
        </p>

        {feedback && (
          <p className="mt-4 rounded-xl border border-slate-700 bg-slate-900/75 px-4 py-3 text-sm text-slate-300">
            {feedback}
          </p>
        )}
      </section>

      <section className="mt-6 rounded-3xl border border-slate-700/70 bg-slate-900/75 p-5 shadow-[0_10px_20px_rgba(0,0,0,.2)] md:p-6">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-xl font-semibold uppercase text-white">Usuarios cadastrados</h2>
          <p className="text-sm text-slate-400">{users.length} registros</p>
        </div>

        <div className="space-y-3">
          {users.map((item) => {
            const editableRoles = availableRoles;
            const isCurrentUser = item.uid === user?.uid;

            return (
              <div key={item.id} className="rounded-2xl border border-slate-700 bg-slate-950/60 p-4">
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div>
                    <p className="font-semibold text-white">{item.displayName ?? item.email ?? item.uid}</p>
                    <p className="text-xs text-slate-500">UID: {item.uid}</p>
                    {isCurrentUser && <p className="text-xs text-orange-300">Seu usuario atual</p>}
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full border border-slate-700 px-2.5 py-1 text-xs text-slate-300">
                      Papel atual: {item.role}
                    </span>

                    <select
                      className="rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none"
                      defaultValue={item.role}
                      onChange={(event) => void saveRole(item.uid, event.target.value as Role)}
                      disabled={saving}
                    >
                      {editableRoles.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </main>
  );
}
