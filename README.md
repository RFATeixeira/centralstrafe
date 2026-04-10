## CentralStrafe - Hub CS2

Projeto em Next.js para treino de CS2 com foco em:

- Granadas
- Movimentacoes
- Taticas
- Autenticacao (Google)
- Dados em Firebase (Auth + Firestore)

## Requisitos

- Node.js 20+
- npm 10+
- Projeto Firebase ativo

## Desenvolvimento local

1. Instale dependencias:

```bash
npm install
```

2. Crie `.env.local` a partir de `.env.example`:

```bash
cp .env.example .env.local
```

3. Preencha as variaveis Firebase em `.env.local`:

```bash
NEXT_PUBLIC_FIREBASE_API_KEY=
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=
NEXT_PUBLIC_FIREBASE_PROJECT_ID=
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=
NEXT_PUBLIC_FIREBASE_APP_ID=
NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID=
```

4. Rode o projeto:

```bash
npm run dev
```

## Scripts

- `npm run dev`: ambiente local
- `npm run lint`: lint
- `npm run build`: build de producao
- `npm run start`: servidor de producao local

## Colecoes do Firestore usadas pelo app

- `users`
- `features`
- `comments`
- `favorites`

As permissoes estao em `firestore.rules`.

## Publicacao no GitHub

1. Garanta que `.env.local` nao esta versionado (ja esta no `.gitignore`).
2. Commit inicial:

```bash
git add .
git commit -m "chore: prepare project for deploy"
```

3. Crie repositorio no GitHub e envie:

```bash
git branch -M main
git remote add origin https://github.com/SEU_USUARIO/SEU_REPO.git
git push -u origin main
```

## Deploy na Vercel

1. Importar o repo no painel da Vercel.
2. Framework detectado: Next.js.
3. Build command: `npm run build`.
4. Output: default da Vercel para Next.js.
5. Em Settings > Environment Variables, adicionar todas as variaveis do `.env.example` para:
- Production
- Preview
- Development (opcional)
6. Fazer Deploy.

## Checklist Firebase para producao

1. Authentication:
- Ativar Google Provider.
- Em Authorized domains, adicionar:
  - dominio da Vercel (`*.vercel.app` e dominio custom, se houver)

2. Firestore Rules:
- Publicar `firestore.rules`:

```bash
firebase deploy --only firestore:rules
```

3. Documento de usuario owner (manual):
- Criar/editar `users/{UID}` com `role: "owner"` para o primeiro administrador do sistema.

## Observacoes de EOL (Windows)

O projeto inclui `.gitattributes` para reduzir avisos de LF/CRLF entre ambientes.
