"use client";

export default function DesignSystemPage() {
  const colors = [
    { name: "Background", var: "background", fg: "foreground" },
    { name: "Foreground", var: "foreground", fg: "background" },
    { name: "Primary", var: "primary", fg: "primary-foreground" },
    { name: "Secondary", var: "secondary", fg: "secondary-foreground" },
    { name: "Accent", var: "accent", fg: "accent-foreground" },
    { name: "Muted", var: "muted", fg: "muted-foreground" },
    { name: "Destructive", var: "destructive", fg: "destructive-foreground" },
    { name: "Border", var: "border", fg: "foreground" },
    { name: "Card", var: "card", fg: "card-foreground" },
  ];

  return (
    <div className="min-h-screen bg-background">
      {/* ─── Color palette ─── */}
      <section className="p-8 border-b border-border">
        <h1 className="text-3xl font-bold mb-1" style={{ fontFamily: "var(--font-heading)", fontStyle: "italic" }}>
          Design System
        </h1>
        <p className="text-muted-foreground mb-6">Paleta y tipograf&iacute;a del marketplace</p>
        <div className="grid grid-cols-3 sm:grid-cols-5 lg:grid-cols-9 gap-3">
          {colors.map((c) => (
            <div key={c.var} className="flex flex-col gap-1.5">
              <div
                className="h-16 rounded-lg border border-border flex items-center justify-center"
                style={{
                  backgroundColor: `hsl(var(--${c.var}))`,
                  color: `hsl(var(--${c.fg}))`,
                }}
              >
                <span className="text-xs font-medium">{c.name}</span>
              </div>
              <span className="text-[10px] text-muted-foreground font-mono">--{c.var}</span>
            </div>
          ))}
        </div>
      </section>

      {/* ─── Typography ─── */}
      <section className="p-8 border-b border-border">
        <h2 className="text-xl font-bold mb-4" style={{ fontFamily: "var(--font-heading)", fontStyle: "italic" }}>
          Tipograf&iacute;a
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          <div>
            <p className="text-xs text-muted-foreground mb-3 uppercase tracking-wider">Georgia Italic — Headings</p>
            <div className="space-y-2">
              <p className="text-4xl" style={{ fontFamily: "var(--font-heading)", fontStyle: "italic" }}>Tu agente negocia por vos</p>
              <p className="text-2xl" style={{ fontFamily: "var(--font-heading)", fontStyle: "italic" }}>Deal cerrado a $220</p>
              <p className="text-lg" style={{ fontFamily: "var(--font-heading)", fontStyle: "italic" }}>Nueva oferta recibida</p>
            </div>
          </div>
          <div>
            <p className="text-xs text-muted-foreground mb-3 uppercase tracking-wider">Nohemi — Body</p>
            <div className="space-y-2">
              <p className="text-base">Texto normal del cuerpo. Nohemi regular 400.</p>
              <p className="text-base font-medium">Texto medium. Nohemi 500.</p>
              <p className="text-base font-semibold">Texto semibold. Nohemi 600.</p>
              <p className="text-base font-bold">Texto bold. Nohemi 700.</p>
              <p className="text-base font-light">Texto light. Nohemi 300.</p>
              <p className="text-sm text-muted-foreground">Texto secundario/muted.</p>
            </div>
          </div>
        </div>
      </section>

      {/* ─── Navbar ─── */}
      <section className="p-8 border-b border-border">
        <h2 className="text-xl font-bold mb-4" style={{ fontFamily: "var(--font-heading)", fontStyle: "italic" }}>
          Navbar
        </h2>
        <div className="rounded-lg border border-border bg-card p-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center">
              <span className="text-primary-foreground text-sm font-bold">A</span>
            </div>
            <span className="font-semibold text-lg" style={{ fontFamily: "var(--font-heading)", fontStyle: "italic" }}>
              negocIA
            </span>
          </div>
          <div className="flex items-center gap-6 text-sm">
            <span className="text-muted-foreground cursor-pointer">Explorar</span>
            <span className="text-muted-foreground cursor-pointer">Mis Deals</span>
            <span className="text-muted-foreground cursor-pointer">Notificaciones</span>
          </div>
          <div className="flex items-center gap-3">
            <button className="bg-primary text-primary-foreground px-4 py-2 rounded-md text-sm font-medium">
              Vender algo
            </button>
            <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center">
              <span className="text-muted-foreground text-xs font-medium">IR</span>
            </div>
          </div>
        </div>
      </section>

      {/* ─── Hero ─── */}
      <section className="p-8 border-b border-border">
        <h2 className="text-xl font-bold mb-4" style={{ fontFamily: "var(--font-heading)", fontStyle: "italic" }}>
          Hero
        </h2>
        <div className="rounded-lg border border-border bg-card p-12 text-center">
          <p className="text-sm font-medium text-accent mb-3">Marketplace con IA</p>
          <h3 className="text-4xl mb-3" style={{ fontFamily: "var(--font-heading)", fontStyle: "italic" }}>
            Tu agente negocia por vos
          </h3>
          <p className="text-muted-foreground max-w-lg mx-auto mb-8">
            Decile a tu agente qué querés vender o comprar. Él se encarga de encontrar el mejor deal.
          </p>
          <div className="flex items-center justify-center gap-3">
            <button className="bg-primary text-primary-foreground px-6 py-3 rounded-md text-sm font-medium">
              Quiero vender
            </button>
            <button className="bg-accent text-accent-foreground px-6 py-3 rounded-md text-sm font-medium">
              Quiero comprar
            </button>
          </div>
        </div>
      </section>

      {/* ─── Listing cards ─── */}
      <section className="p-8 border-b border-border">
        <h2 className="text-xl font-bold mb-4" style={{ fontFamily: "var(--font-heading)", fontStyle: "italic" }}>
          Listings
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[
            { title: "Bicicleta Trek FX3", price: "$180 USD", status: "Negociando", statusColor: "bg-secondary text-secondary-foreground" },
            { title: "MacBook Air M2", price: "$850 USD", status: "Activo", statusColor: "bg-accent text-accent-foreground" },
            { title: "Escritorio IKEA", price: "$120 USD", status: "Vendido", statusColor: "bg-muted text-muted-foreground" },
          ].map((item) => (
            <div key={item.title} className="rounded-lg border border-border bg-card p-5 flex flex-col gap-3">
              <div className="h-32 rounded-md bg-muted flex items-center justify-center">
                <span className="text-muted-foreground text-sm">Foto</span>
              </div>
              <div className="flex items-center justify-between">
                <h4 className="font-semibold">{item.title}</h4>
                <span className={`text-xs px-2 py-1 rounded-full font-medium ${item.statusColor}`}>
                  {item.status}
                </span>
              </div>
              <p className="text-lg font-bold">{item.price}</p>
              <p className="text-sm text-muted-foreground">Buenos Aires, Argentina</p>
            </div>
          ))}
        </div>
      </section>

      {/* ─── Chat ─── */}
      <section className="p-8 border-b border-border">
        <h2 className="text-xl font-bold mb-4" style={{ fontFamily: "var(--font-heading)", fontStyle: "italic" }}>
          Chat con Agente
        </h2>
        <div className="rounded-lg border border-border bg-card max-w-lg mx-auto">
          <div className="p-4 border-b border-border flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-accent flex items-center justify-center">
              <span className="text-accent-foreground text-xs font-bold">AI</span>
            </div>
            <div>
              <p className="text-sm font-semibold">Agente Vendedor</p>
              <p className="text-xs text-muted-foreground">Online</p>
            </div>
          </div>
          <div className="p-4 space-y-3 min-h-[200px]">
            <div className="flex gap-2">
              <div className="bg-muted rounded-lg rounded-tl-none p-3 max-w-[80%]">
                <p className="text-sm">Hola! Contame qué querés vender y te ayudo a armar la publicación.</p>
              </div>
            </div>
            <div className="flex gap-2 justify-end">
              <div className="bg-primary text-primary-foreground rounded-lg rounded-tr-none p-3 max-w-[80%]">
                <p className="text-sm">Quiero vender mi bici Trek, la pagué 300 pero acepto hasta 180.</p>
              </div>
            </div>
            <div className="flex gap-2">
              <div className="bg-muted rounded-lg rounded-tl-none p-3 max-w-[80%]">
                <p className="text-sm">Perfecto! Trek, precio ideal $300, mínimo $180. En qué condición está?</p>
              </div>
            </div>
          </div>
          <div className="p-4 border-t border-border flex gap-2">
            <input
              type="text"
              placeholder="Escribí tu mensaje..."
              className="flex-1 h-10 rounded-md border border-input bg-background px-3 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            <button className="bg-primary text-primary-foreground px-4 py-2 rounded-md text-sm font-medium">
              Enviar
            </button>
          </div>
        </div>
      </section>

      {/* ─── Negotiation ─── */}
      <section className="p-8 border-b border-border">
        <h2 className="text-xl font-bold mb-4" style={{ fontFamily: "var(--font-heading)", fontStyle: "italic" }}>
          Negociación
        </h2>
        <div className="rounded-lg border border-border bg-card p-6 max-w-2xl mx-auto">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h4 className="font-semibold text-lg">Bicicleta Trek FX3</h4>
              <p className="text-sm text-muted-foreground">Ronda 3 de 5</p>
            </div>
            <span className="text-xs px-3 py-1 rounded-full font-medium bg-secondary text-secondary-foreground">
              Negociando
            </span>
          </div>
          <div className="flex items-center gap-4 mb-6">
            <div className="flex-1 text-center p-4 rounded-lg bg-muted">
              <p className="text-xs text-muted-foreground mb-1">Vendedor pide</p>
              <p className="text-xl font-bold">$250</p>
            </div>
            <div className="flex-1 text-center p-4 rounded-lg bg-muted">
              <p className="text-xs text-muted-foreground mb-1">Comprador ofrece</p>
              <p className="text-xl font-bold">$200</p>
            </div>
          </div>
        </div>
      </section>

      {/* ─── Deal ─── */}
      <section className="p-8 border-b border-border">
        <h2 className="text-xl font-bold mb-4" style={{ fontFamily: "var(--font-heading)", fontStyle: "italic" }}>
          Deal Cerrado
        </h2>
        <div className="rounded-lg border-2 border-accent bg-card p-6 max-w-md mx-auto text-center">
          <div className="w-12 h-12 rounded-full bg-accent mx-auto mb-4 flex items-center justify-center">
            <span className="text-accent-foreground text-xl font-bold">✓</span>
          </div>
          <h4 className="text-xl mb-1" style={{ fontFamily: "var(--font-heading)", fontStyle: "italic" }}>
            Deal cerrado!
          </h4>
          <p className="text-muted-foreground text-sm mb-4">Bicicleta Trek FX3</p>
          <p className="text-3xl font-bold mb-4">$220 USD</p>
          <div className="flex items-center justify-center gap-4 text-sm text-muted-foreground mb-6">
            <span>Vendedor: Franco</span>
            <span>Comprador: Uriel</span>
          </div>
          <div className="flex gap-3 justify-center">
            <button className="bg-accent text-accent-foreground px-5 py-2 rounded-md text-sm font-medium">
              Confirmar
            </button>
            <button className="border border-border bg-background px-5 py-2 rounded-md text-sm font-medium text-destructive">
              Cancelar
            </button>
          </div>
        </div>
      </section>

      {/* ─── Buttons ─── */}
      <section className="p-8">
        <h2 className="text-xl font-bold mb-4" style={{ fontFamily: "var(--font-heading)", fontStyle: "italic" }}>
          Botones
        </h2>
        <div className="flex flex-wrap gap-3">
          <button className="bg-primary text-primary-foreground px-4 py-2 rounded-md text-sm font-medium">Primary</button>
          <button className="bg-secondary text-secondary-foreground px-4 py-2 rounded-md text-sm font-medium">Secondary</button>
          <button className="bg-accent text-accent-foreground px-4 py-2 rounded-md text-sm font-medium">Accent</button>
          <button className="bg-destructive text-destructive-foreground px-4 py-2 rounded-md text-sm font-medium">Destructive</button>
          <button className="border border-input bg-background px-4 py-2 rounded-md text-sm font-medium">Outline</button>
          <button className="bg-muted text-muted-foreground px-4 py-2 rounded-md text-sm font-medium">Muted</button>
        </div>
      </section>
    </div>
  );
}
