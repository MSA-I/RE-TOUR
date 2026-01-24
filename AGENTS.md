# Agent Operating Guide (RE:TOUR)

This repo is a Vite + React + TypeScript SPA with Tailwind + shadcn/ui, React Router, TanStack Query, and Supabase (DB + Edge Functions).

## Quick Commands

Package manager:
- Primary: `npm` (repo includes `package-lock.json`).
- `bun.lockb` exists; prefer `npm` unless the task explicitly targets Bun.

**Install:**
```bash
npm install
```

**Dev Server:**
```bash
npm run dev
```
- Runs on port 8080 (configured in `vite.config.ts`).

**Production Build:**
```bash
npm run build
```

**Lint & Typecheck:**
```bash
npm run lint
npx tsc -p tsconfig.app.json --noEmit
```

## Project Structure

- **`src/pages/`**: Application routes/pages.
- **`src/components/`**: Shared components.
- **`src/components/ui/`**: Reusable UI components (shadcn/ui).
- **`src/hooks/`**: Custom React hooks (business logic).
- **`src/lib/`**: Utilities (e.g., `utils.ts` for `cn`).
- **`src/integrations/supabase/`**: Supabase client (`client.ts`) and types (`types.ts`).
- **`supabase/functions/`**: Deno-based Edge Functions.

## Tests

There is currently **no test runner configured** (no `test` script, no Jest/Vitest).

If you add tests, prefer **Vitest**:
- Run all tests: `npx vitest run`
- Run single file: `npx vitest run src/foo.test.ts`
- Run by name: `npx vitest run -t "renders empty state"`

**Note:** Update `package.json` scripts if you configure a runner.

## Supabase / Edge Functions

**Frontend Client:**
- `src/integrations/supabase/client.ts`: Auto-generated client. Avoid manual edits.
- `src/integrations/supabase/types.ts`: Database types.

**Environment Variables:**
- `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`
- `VITE_SUPABASE_PROJECT_ID` (see `.env.example`)
- **Never commit `.env.local`**.

**Edge Functions:**
- Location: `supabase/functions/*` (Deno runtime).
- Secrets: Accessed via `Deno.env.get(...)`.

**CLI Commands (if installed):**
```bash
supabase functions serve --no-verify-jwt
supabase gen types typescript --project-id <id> --schema public > src/integrations/supabase/types.ts
```

## Code Style (TypeScript/React)

**General:**
- **Indentation:** 2 spaces.
- **Semicolons:** Yes.
- **Quotes:** Double quotes for TS/TSX.
- **JSX:** Wrap long props, keep readable.

**Imports:**
- **Aliases:** Prefer `@/` (e.g., `@/components/Button`).
- **Relative:** Use `./` for same-folder modules.
- **Order:**
  1. React / React Router
  2. Third-party libraries
  3. App code (`@/...`)
  4. Relative imports (`./...`)
  5. Styles (`./index.css`)

**Components & Hooks:**
- **Naming:** PascalCase for components (`ProjectList`), `useCamelCase` for hooks.
- **Structure:** Keep hooks at the top level. Define early returns *after* hooks.
- **Props:** Use interfaces named `ComponentNameProps`.

**Types:**
- Avoid `any`. Use `unknown` in `catch` blocks (narrow with `instanceof Error`).
- Use generated Supabase types (`Tables<"projects">`) where possible.

**React Query:**
- Use `useQuery`/`useMutation` for server state.
- Include dependencies (like `user.id`) in query keys.
- **Invalidate queries** on mutation success to refresh data.

**Error Handling:**
- **UI:** Show toast notifications (`useToast`) for user-facing errors.
- **Logging:** `console.error` with context.
- **Edge Functions:** Return clear HTTP errors with CORS headers.

**UI / Tailwind:**
- **Styling:** Use `cn(...)` for class merging.
- **Tokens:** Use CSS variables/tokens from `src/index.css` (e.g., `bg-primary`, `text-muted-foreground`).
- **Shadcn:** `src/components/ui/*` files are vendored; modify carefully.

## Cursor / Copilot Rules

- **Cursor:** No rules found in `.cursor/rules/` or `.cursorrules`.
- **Copilot:** No instructions found in `.github/copilot-instructions.md`.
