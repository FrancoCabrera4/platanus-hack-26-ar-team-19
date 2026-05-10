import Link from "next/link";
import { Button } from "@repo/ui/components/ui/button";

const productCards = [
  {
    title: "Notebook Lenovo ThinkPad",
    price: "$ 580.000",
    status: "Oferta enviada",
    imageSrc: "/landing-products/thinkpad.jpg",
    statusClass: "bg-amber-100 text-amber-900",
  },
  {
    title: "Bicicleta urbana",
    price: "$ 145.000",
    status: "Negociando",
    imageSrc: "/landing-products/bicicleta-urbana.jpg",
    statusClass: "bg-blue-100 text-blue-900",
  },
  {
    title: "Sillón escandinavo",
    price: "$ 92.000",
    status: "Acuerdo listo",
    imageSrc: "/landing-products/sillon-nordico.webp",
    statusClass: "bg-emerald-100 text-emerald-900",
  },
];

const steps = [
  "Describís lo que querés comprar o vender.",
  "El agente busca opciones, conversa y negocia precio.",
  "Vos revisas el acuerdo y coordinas la entrega.",
];

export default function Page(): JSX.Element {
  return (
    <main className="min-h-screen bg-background text-foreground">
      <section className="relative overflow-hidden border-b border-border bg-[#fbfaf7]">
        <header className="mx-auto flex h-20 max-w-6xl items-center justify-between px-5">
          <Link href="/" className="flex items-center gap-3" aria-label="negocIA">
            <img src="/logo-icon.svg" alt="" className="h-10 w-10" />
            <span
              className="text-2xl tracking-tight"
              style={{ fontFamily: "var(--font-heading)", fontStyle: "italic" }}
            >
              negocIA
            </span>
          </Link>
          <Link
            href="/login"
            className="rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-background hover:text-foreground"
          >
            Iniciar sesión
          </Link>
        </header>

        <div className="mx-auto grid min-h-[calc(100vh-5rem)] max-w-6xl items-center gap-10 px-5 pb-12 pt-6 lg:grid-cols-[1.02fr_0.98fr] lg:pb-16">
          <div className="max-w-2xl">
            <p className="mb-5 inline-flex rounded-full border border-foreground/10 bg-background px-3 py-1 text-sm font-medium text-muted-foreground">
              Platanus Hack 26 - Agentic Money
            </p>
            <h1
              className="max-w-3xl text-5xl leading-[0.98] tracking-tight text-foreground sm:text-6xl lg:text-7xl"
              style={{ fontFamily: "var(--font-heading)", fontStyle: "italic" }}
            >
              Tu agente negocia, vos cerrás el trato.
            </h1>
            <p className="mt-6 max-w-xl text-lg leading-8 text-muted-foreground">
              negocIA es un marketplace donde podés comprar y vender con IA:
              busca productos, conversa con vendedores, negocia ofertas y deja
              el acuerdo listo para coordinar.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Button asChild size="lg" className="h-12 px-6 text-base">
                <Link href="/signup">Entrar al proyecto</Link>
              </Button>
              <Button
                asChild
                size="lg"
                variant="outline"
                className="h-12 px-6 text-base"
              >
                <Link href="/login">Ya tengo cuenta</Link>
              </Button>
            </div>
          </div>

          <div className="relative mx-auto w-full max-w-[680px] lg:min-h-[560px]">
            <div className="absolute inset-x-4 top-16 hidden h-[440px] rotate-[-3deg] rounded-[48px] bg-primary/20 blur-3xl lg:block" />
            <div className="relative">
              <div className="grid gap-4 sm:grid-cols-3">
                {productCards.map((product, index) => (
                  <article
                    key={product.title}
                    className={`overflow-hidden rounded-lg border border-foreground/10 bg-background shadow-xl shadow-foreground/10 ${
                      index === 1 ? "sm:translate-y-12" : ""
                    }`}
                  >
                    <div className="h-44 bg-muted sm:h-56">
                      <img
                        src={product.imageSrc}
                        alt={product.title}
                        className="h-full w-full object-cover"
                      />
                    </div>
                    <div className="p-4">
                      <h2 className="min-h-12 text-base font-medium leading-6">
                        {product.title}
                      </h2>
                      <p className="mt-2 text-base font-medium text-foreground">
                        {product.price}
                      </p>
                      <p
                        className={`mt-4 rounded-md px-2.5 py-1.5 text-xs font-semibold ${product.statusClass}`}
                      >
                        {product.status}
                      </p>
                    </div>
                  </article>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="bg-background px-5 py-14">
        <div className="mx-auto grid max-w-6xl gap-4 md:grid-cols-3">
          {steps.map((step, index) => (
            <article
              key={step}
              className="rounded-lg border border-border bg-background p-5"
            >
              <p className="text-sm font-medium text-accent">
                Paso {index + 1}
              </p>
              <h2 className="mt-3 text-xl font-medium leading-7">{step}</h2>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
