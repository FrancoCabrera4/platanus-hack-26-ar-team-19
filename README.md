# negocIA

Marketplace agentico para comprar y vender usado sin tener que revisar cientos de publicaciones ni negociar a mano.

negocIA permite que una persona describa qué quiere comprar o qué quiere vender en lenguaje natural. A partir de eso, agentes de IA arman publicaciones, buscan productos compatibles, comparan candidatos, negocian entre comprador y vendedor, y dejan el acuerdo listo para que la persona lo revise y coordine la entrega.

## Overview Arquitectura (tl;dr)
![Architecture overview](./important/C_tTQZPW0AAHTU8.jpg)

Se realizó scrapping the facebook marketplace para obtener la data, se normalizó eliminando 
outliers por precio primero mediante cotas fijas y luego calculando la desviación estandar del resto y sacando los outliers en base a ello.
Se utiliza RAG mediante una base vectorial de embeddings que representan los productos en la DB y también, naturalmente se hacen los embeddings de las queries para comparar respecto a los
productos.
Pequeños flows de agentes e integraciones con mercado pago.


## Por qué existe

Comprar usado suele ser lento: buscar, filtrar, preguntar si sigue disponible, comparar precios, regatear y coordinar entrega. Vender también tiene fricción: escribir la publicación, responder preguntas repetidas y decidir cuánto bajar el precio.

negocIA convierte ese ida y vuelta en un flujo asistido por agentes:

- El comprador dice qué busca, su presupuesto y preferencias.
- El vendedor carga el producto conversando con un agente.
- El sistema matchea productos con embeddings, texto e imagen.
- Dos agentes negocian siguiendo las restricciones de comprador y vendedor.
- El usuario aprueba el acuerdo y coordina el envío desde el dashboard.

## Demo flow

1. Crear una cuenta o iniciar sesión.
2. Entrar a `Explorar`.
3. Pedir algo por chat, por ejemplo: "Busco una bici urbana hasta 200.000 pesos".
4. El agente crea una búsqueda, encuentra candidatos y negocia automáticamente.
5. Revisar los resultados negociados y aceptar o rechazar un trato.
6. Ir al dashboard para ver compras, ventas y sugerencias de coordinación.
7. Para vender, iniciar una conversación de publicación, subir imagen y describir el producto.

## Por qué es Agentic Money

El proyecto no solo recomienda productos: toma tareas económicas reales y las ejecuta con agentes bajo límites definidos por personas.

- Representa al comprador en una negociación con presupuesto máximo.
- Representa al vendedor con precio pedido y estrategia de negociación.
- Decide qué productos vale la pena perseguir usando matching semántico.
- Produce ofertas, contraofertas, aceptaciones y rechazos.
- Cierra un deal solo si respeta las restricciones del usuario.

La IA no reemplaza la aprobación final: reduce trabajo operativo y deja a la persona controlando el dinero.

## Stack

- Monorepo con pnpm workspaces y Turborepo.
- Web: Next.js, React, Tailwind.
- API: Express, TypeScript.
- DB: PostgreSQL, Prisma y pgvector.
- IA: OpenAI o Gemini para chat, JSON estructurado, embeddings y visión.
- Jobs: cola en proceso con persistencia en tabla `Job`.

## Arquitectura

```text
apps/web       Interfaz web, chat, exploración y dashboard
apps/api       Auth, agentes, búsquedas, negociaciones, uploads y transcripción
packages/db    Prisma schema, cliente y scripts de base de datos
packages/ui    Componentes y estilos compartidos
```

## Correr localmente

Requisitos:

- Node.js 18+
- pnpm 10+
- Docker

```bash
pnpm install
cp packages/db/.env.example packages/db/.env
cp apps/api/.env.example apps/api/.env
pnpm db:up
pnpm db:setup
pnpm seed
pnpm dev
```

La web corre en `http://localhost:3000` y el API en `http://localhost:4000`.

`pnpm db:setup` resetea la base local, habilita pgvector, genera Prisma Client y crea el indice vectorial. Es destructivo para datos locales de demo.

## Variables importantes

En `apps/api/.env`:

```env
LLM_PROVIDER=openai
OPENAI_API_KEY=sk-your-key-here
OPENAI_MODEL=gpt-4o-mini
OPENAI_TRANSCRIPTION_MODEL=whisper-1
GEMINI_API_KEY=your-gemini-key-here
GEMINI_MODEL=gemini-2.0-flash
DATABASE_URL=postgresql://marketplace:marketplace@localhost:5432/marketplace?schema=public
PORT=4000
WEB_ORIGIN=http://localhost:3000
MIN_MATCH_SIMILARITY=0.3
```

La clave de OpenAI vive solo en el backend. El frontend graba audio y lo manda a `POST /transcriptions`; el API transcribe server-side y devuelve `{ text }`.

## Scripts utiles

```bash
pnpm dev          # levanta web + api
pnpm build        # build de todos los paquetes
pnpm type-check   # chequeo TypeScript
pnpm lint         # lint
pnpm db:up        # levanta Postgres
pnpm db:setup     # prepara schema + pgvector
pnpm seed         # datos de demo
```

## Estado actual

El prototipo cubre el loop principal: publicar productos, buscar por chat, matchear con embeddings, negociar automaticamente y revisar operaciones cerradas. Las partes intencionalmente demo-grade son autenticacion, cola de jobs en memoria y persistencia local de archivos subidos.
