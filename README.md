# negocIA

Marketplace agentico donde agentes de IA negocian en tu nombre. Publicás o buscás un producto, un agente entiende lo que necesitás, encuentra matches y negocia el mejor precio automáticamente.

**Track:** Agentic Money | **Platanus Hack 26** | Buenos Aires

---

## Qué hace

1. **Onboarding conversacional** : Un agente te entrevista por chat para entender qué querés vender o comprar. Extrae precio, categoría, condición, estrategia de negociación.
2. **Matching semántico** : Embeddings vectoriales (pgvector) + re-ranking con LLM encuentran los mejores productos para cada búsqueda.
3. **Negociación autónoma** : Agentes comprador y vendedor negocian entre sí usando técnicas de negociación profesional (empatía táctica, mirroring, Ackerman). Hasta 8 turnos por negociación.
4. **Pago integrado** : MercadoPago Checkout Pro con auto-pay opcional. Código de verificación para entrega.
5. **Detección de fraude** : Validación de precios, keywords sospechosos, análisis de imágenes con vision AI.

## Stack

| Capa | Tecnología |
|---|---|
| Frontend | Next.js 14 (App Router), Tailwind CSS, shadcn/ui |
| Backend | Express + TypeScript (tsup) |
| Base de datos | PostgreSQL 16 + pgvector |
| LLM | OpenAI (GPT-4o-mini) o Google Gemini (2.0 Flash) |
| Pagos | MercadoPago SDK |
| Monorepo | pnpm workspaces + Turborepo |

## Arquitectura

```
apps/
  web/          Next.js frontend (:3000)
  api/          Express API server (:4000)
packages/
  db/           Prisma client + schema (pgvector)
  ui/           Componentes shadcn/ui compartidos
  logger/       Wrapper de logging
  config-*/     Configs compartidas (ESLint, TS, Tailwind)
```

### Flujo principal

```
Usuario (chat) → Agente Onboarding → BuyerSearch / Product
                                          ↓
                              Matching (embeddings + LLM re-rank)
                                          ↓
                              Negociación (buyer agent vs seller agent)
                                          ↓
                              Deal cerrado → MercadoPago → Verificación
```

### Agentes

| Agente | Archivo | Función |
|---|---|---|
| Seller Onboarding | `agents/seller-onboarding.ts` | Entrevista al vendedor, extrae datos del producto |
| Buyer Onboarding | `agents/buyer-onboarding.ts` | Entrevista al comprador, extrae intent de búsqueda |
| Seller Negotiator | `agents/seller-negotiator.ts` | Negocia el precio defendiendo el valor del producto |
| Buyer Negotiator | `agents/buyer-negotiator.ts` | Negocia el mejor precio usando método Ackerman |

Los negociadores usan técnicas basadas en Chris Voss (FBI):
- **Empatía táctica** y **labeling** para generar confianza
- **Mirroring** para extraer información
- **Preguntas calibradas** ("¿Cómo...?" en vez de "¿Por qué...?")
- **Método Ackerman** : ofertas en incrementos decrecientes con números precisos no redondos
- **Concesiones decrecientes** para señalar límite

### Modelo de datos

| Modelo | Descripción |
|---|---|
| `User` | Cuenta unificada (auth + MercadoPago + auto-pay + ubicación) |
| `Product` | Producto del vendedor (askPrice, negotiationStrategy, imagen, status) |
| `ProductEmbedding` | Embedding vectorial 1536d para búsqueda semántica |
| `BuyerSearch` | Intent del comprador (query, maxPrice, strategy, requirements) |
| `Negotiation` | Estado de negociación buyer/seller (status, finalPrice, payment) |
| `Conversation` | Chat de onboarding (buying o posting_product) |
| `Job` | Estado de jobs asincrónicos (search matching) |

### Servicios

| Servicio | Función |
|---|---|
| `matching.ts` | Búsqueda vectorial + filtros + re-ranking LLM |
| `negotiation.ts` | Loop de negociación (max 8 turnos) con transacciones |
| `embeddings.ts` | Generación de embeddings (OpenAI o Gemini) |
| `auto-pay.ts` | Pago automático post-negociación exitosa |
| `fraud.ts` | Detección de scams (keywords, precios, imágenes) |
| `vision.ts` | Análisis de imágenes de productos |
| `mercadolibre.ts` | Referencia de precios de mercado |

## Setup

### Requisitos

- Node.js >= 18
- pnpm 10.x
- Docker (para PostgreSQL)

### 1. Clonar e instalar

```bash
git clone <repo-url>
cd platanus-hack-26-ar-team-19
pnpm install
```

### 2. Variables de entorno

```bash
# Root .env
DATABASE_URL="postgresql://marketplace:marketplace@localhost:5432/marketplace?schema=public"
```

```bash
# apps/api/.env
DATABASE_URL="postgresql://marketplace:marketplace@localhost:5432/marketplace?schema=public"
PORT=4000
WEB_ORIGIN=http://localhost:3000

# LLM (elegir uno)
LLM_PROVIDER=openai
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4o-mini
# o
LLM_PROVIDER=gemini
GEMINI_API_KEY=...
GEMINI_MODEL=gemini-2.0-flash

# MercadoPago
MP_DEV=true
MP_APP_ID=...
MP_CLIENT_SECRET=...
MP_ACCESS_TOKEN_TEST=...
API_PUBLIC_URL=http://localhost:4000
```

```bash
# apps/web/.env.local
NEXT_PUBLIC_API_URL=http://localhost:4000
NEXT_PUBLIC_MP_PUBLIC_KEY=APP_USR-...
```

### 3. Base de datos

```bash
pnpm db:up                    # Levanta PostgreSQL con pgvector (Docker)
pnpm db:setup                 # Push schema + genera client Prisma
```

### 4. Ejecutar

```bash
pnpm dev                      # Web (:3000) + API (:4000) en paralelo
```

O por separado:

```bash
pnpm --filter web dev         # Solo frontend
pnpm --filter api dev         # Solo backend
```

### 5. Seed (opcional)

```bash
pnpm seed                     # Importa productos de FB Marketplace scrape
```

## API Endpoints

| Método | Ruta | Descripción |
|---|---|---|
| POST | `/auth/signup` | Registro |
| POST | `/auth/login` | Login |
| POST | `/auth/logout` | Logout |
| GET | `/auth/me` | Usuario actual |
| POST | `/conversations` | Iniciar chat de onboarding |
| POST | `/conversations/:id/messages` | Enviar mensaje (SSE streaming) |
| GET | `/products` | Listar productos |
| POST | `/searches/:id/run` | Ejecutar búsqueda + matching |
| GET | `/negotiations/:id` | Ver transcript de negociación |
| POST | `/payments/create-preference` | Crear link de pago MP |
| POST | `/payments/webhook` | Webhook IPN de MercadoPago |
| POST | `/payments/verify-code` | Verificar código de entrega |
| GET | `/payments/mp/connect` | Iniciar OAuth MercadoPago |

## Scripts útiles

```bash
pnpm dev              # Dev completo (web + api)
pnpm build            # Build de producción
pnpm lint             # Lint (ESLint)
pnpm type-check       # Type check (TypeScript)
pnpm db:up            # Levantar PostgreSQL
pnpm db:down          # Bajar PostgreSQL
pnpm db:setup         # Reset DB + push schema + generate
pnpm seed             # Seed de productos
```

## Equipo

- **Franco Cabrera**
- **Uriel Gandelman**
- **Ignacio Rojas**
