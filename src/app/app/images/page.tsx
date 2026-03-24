export default function ImagesPage() {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 pb-4">
      <header>
        <h1 className="font-[family-name:var(--font-app-heading)] text-4xl font-semibold tracking-tight text-[var(--app-foreground)] md:text-5xl">
          Images
        </h1>
        <p className="mt-2 max-w-xl text-sm text-[var(--app-muted)]">
          Your image library is coming soon. This area will hold photos and assets you reuse across listing videos.
        </p>
      </header>
    </div>
  );
}
